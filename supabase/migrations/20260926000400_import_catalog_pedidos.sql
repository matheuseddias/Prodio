-- Importação do ES, parte 4: depois de gravar produtos e apelidos, os itens de pedido que chegaram sem produto
-- (product_id nulo) passam a apontar para o produto importado; e a resposta diz se o Prodio já tem uso real
-- (conector ligado ou pedido que não é do exemplo), para a tela indicar o script de limpeza certo.
--
-- Por que existe: o robô grava o pedido com o produto que casa NAQUELE momento (worker_upsert_orders). Pedido
-- que chegou antes do cadastro — ou cujo produto era do exemplo e virou nulo no supabase/limpar_so_exemplo.sql —
-- fica sem produto e some da demanda até o pedido mudar de status na plataforma. A importação religa na hora.

-- ---------------------------------------------------------------------------
-- Religa itens de pedido sem produto. Interna (só a import_catalog chama). Devolve quantos religou.
-- Regra de casamento = a de worker_upsert_orders (20260921000800_integracoes.sql), copiada de propósito:
--   1. apelido: sku_aliases.sku_externo = sku_externo (o apelido vence o SKU; o produto do apelido não é filtrado
--      por deleted_at, como lá);
--   2. senão, SKU principal: products.sku = sku_externo, produto não excluído.
-- Comparação exata, sem trim nem maiúsculas: é o que o robô faz. Se a regra mudar lá, muda aqui, senão o
-- próximo sync do mesmo pedido desfaria (ou faria diferente) o que a importação religou.
-- Só mexe em product_id nulo: item já ligado (pelo robô ou pela importação anterior) nunca muda de produto.
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_order_items(p_tenant_id uuid)
returns int language plpgsql set search_path = '' as $$
declare v_n int;
begin
  with alvo as (
    select i.id,
           coalesce((select a.product_id from public.sku_aliases a join public.products ap on ap.id = a.product_id and ap.tenant_id = p_tenant_id
                      where a.tenant_id = p_tenant_id and a.sku_externo = i.sku_externo limit 1),
                    (select p.id from public.products p where p.tenant_id = p_tenant_id and p.sku = i.sku_externo and p.deleted_at is null limit 1)) as product_id
      from public.order_items i
     where i.tenant_id = p_tenant_id and i.product_id is null and i.sku_externo is not null
  )
  update public.order_items o set product_id = alvo.product_id
    from alvo
   where o.id = alvo.id and o.tenant_id = p_tenant_id and o.product_id is null and alvo.product_id is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.import_catalog_order_items(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC pública (substitui a da parte 3). Mesmas garantias: assert_member(admin) primeiro, validação, advisory
-- lock por tenant, trava do exemplo na gravação, simulação desfeita por inteiro (PRD01). Novidades na resposta:
--   itens_pedido_religados  itens de pedido que passam a apontar para produto (também na simulação);
--   uso_real                {conectores_ligados, pedidos_reais}: com uso real, limpar_exemplo.sql apagaria a
--                           integração e os pedidos; o caminho é limpar_so_exemplo.sql (a tela e o erro dizem isso).
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog(p_tenant_id uuid, p_payload jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exemplo jsonb;
  v_uso jsonb;
  v_cont jsonb := '{}';
  v_linhas jsonb := '[]';
  v_r jsonb;
  v_bloq_ins jsonb := '[]';
  v_bloq_prod jsonb := '[]';
  v_religados int := 0;
  -- Nulo é simulação, como o padrão: senão `if p_dry_run` e `not p_dry_run` dariam nulo e o null gravaria
  -- furando a trava dos dados de exemplo.
  v_simular boolean := coalesce(p_dry_run, true);
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  perform public.import_catalog_validate(p_payload);
  -- Duas importações do mesmo tenant rodam em fila.
  perform pg_advisory_xact_lock(hashtextextended('prodio:import_catalog:' || p_tenant_id::text, 0));

  -- Dados de exemplo do seed (ids fixos a0…/b0…/c0…): a gravação é recusada enquanto existirem.
  select jsonb_build_object(
    'produtos', (select count(*) from public.products where tenant_id = p_tenant_id and id::text like 'a0000000-0000-0000-0000-%'),
    'insumos', (select count(*) from public.materials where tenant_id = p_tenant_id and id::text like 'b0000000-0000-0000-0000-%'),
    'fornecedores', (select count(*) from public.suppliers where tenant_id = p_tenant_id and id::text like 'c0000000-0000-0000-0000-%'))
    into v_exemplo;
  -- Uso real: os dois sinais da trava do limpar_exemplo.sql que dizem que a integração está no ar (a trava tem outros,
  -- como OC, NF-e e bipe; com eles a tela indica o limpar_exemplo.sql e a trava dele aponta o limpar_so_exemplo.sql).
  select jsonb_build_object(
    'conectores_ligados', (select count(*) from public.connectors where tenant_id = p_tenant_id and status <> 'desconectado'),
    'pedidos_reais', (select count(*) from public.orders where tenant_id = p_tenant_id and external_id not like 'seed:%'))
    into v_uso;
  if not v_simular and ((v_exemplo ->> 'produtos')::int + (v_exemplo ->> 'insumos')::int + (v_exemplo ->> 'fornecedores')::int) > 0 then
    if (v_uso ->> 'conectores_ligados')::int + (v_uso ->> 'pedidos_reais')::int > 0 then
      raise exception 'remova os dados de exemplo antes de importar: o Prodio já tem conector ligado ou pedido real, então rode supabase/dist/limpar_so_exemplo.sql (limpar_exemplo.sql apagaria a integração e os pedidos)'
        using errcode = '55000';
    end if;
    raise exception 'remova os dados de exemplo antes de importar (supabase/dist/limpar_exemplo.sql)' using errcode = '55000';
  end if;

  begin
    v_r := public.import_catalog_suppliers(p_tenant_id, coalesce(p_payload -> 'fornecedores', '[]'));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');
    v_r := public.import_catalog_materials(p_tenant_id, coalesce(p_payload -> 'insumos', '[]'));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');
    v_bloq_ins := v_r -> 'bloqueados';
    v_r := public.import_catalog_products(p_tenant_id, coalesce(p_payload -> 'produtos', '[]'));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');
    v_bloq_prod := v_r -> 'bloqueados';
    -- Produtos e apelidos gravados: pedidos que estavam sem produto passam a apontar para eles.
    v_religados := public.import_catalog_order_items(p_tenant_id);
    v_r := public.import_catalog_links(p_tenant_id, jsonb_build_object('itens', coalesce(p_payload -> 'vinculos', '[]'), 'insumos_bloqueados', v_bloq_ins));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');
    v_r := public.import_catalog_boms(p_tenant_id, jsonb_build_object('itens', coalesce(p_payload -> 'fichas', '[]'),
             'insumos_bloqueados', v_bloq_ins, 'produtos_bloqueados', v_bloq_prod));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');

    -- Resumo no audit_log (só contagens), e só quando algo mudou. Os triggers já registraram cada linha.
    if v_religados > 0 or exists (select 1 from jsonb_each(v_cont) c where (c.value ->> 'novos')::int + (c.value ->> 'atualizados')::int > 0) then
      insert into public.audit_log (tenant_id, user_id, entidade, entidade_id, acao, depois)
      values (p_tenant_id, auth.uid(), 'import_catalog', null, 'importacao_es', jsonb_build_object('contagens', v_cont, 'itens_pedido_religados', v_religados));
    end if;
    if v_simular then
      raise exception 'simulação: desfaz tudo' using errcode = 'PRD01';
    end if;
  exception when sqlstate 'PRD01' then
    null; -- o bloco desfez as escritas; as variáveis guardam o resultado da simulação
  end;

  return jsonb_build_object('simulacao', v_simular, 'exemplo', v_exemplo, 'uso_real', v_uso, 'contagens', v_cont, 'linhas', v_linhas,
    'itens_pedido_religados', v_religados);
end $$;
revoke execute on function public.import_catalog(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_catalog(uuid, jsonb, boolean) to authenticated;
