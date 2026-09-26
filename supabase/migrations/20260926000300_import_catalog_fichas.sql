-- Importação do ES, parte 3: vínculos insumo-fornecedor, fichas técnicas e a RPC pública import_catalog.
-- Regras da RPC (docs/arquitetura.md, seção 2): SECURITY DEFINER, search_path vazio, primeira instrução
-- assert_member(admin), revoke de public/anon, grant a authenticated. Tudo numa transação; o dry-run roda o
-- mesmo código dentro de um bloco com EXCEPTION e desfaz tudo no fim (inclusive audit_log e versões de
-- ficha), então a prévia é exatamente o que a gravação faria no estado atual do banco.

-- ---------------------------------------------------------------------------
-- Vínculos (supplier_materials): chave (tenant_id, supplier_id, material_id) resolvida por (cnpj, sku).
-- Vínculo que já existe só ganha o que está nulo: o que o recebimento de NF-e aprendeu no Prodio vence.
-- p_ctx: {itens: [...], insumos_bloqueados: [sku]}
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_links(p_tenant_id uuid, p_ctx jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_itens jsonb := coalesce(p_ctx -> 'itens', '[]');
  v_bloq text[] := array(select jsonb_array_elements_text(coalesce(p_ctx -> 'insumos_bloqueados', '[]')));
  v_prob jsonb; v_avisos jsonb; v_up jsonb; v_ins jsonb;
  v_n_prob int; v_n_up int; v_n_ins int;
begin
  create temporary table if not exists import_catalog_vinc (
    cnpj text, sku text, supplier_id uuid, material_id uuid, codigo text, colide text, unidade_compra text,
    fator numeric(14,6), preco numeric(14,4), aliq_icms numeric(8,5), inteiro boolean) on commit drop;
  truncate pg_temp.import_catalog_vinc;
  insert into pg_temp.import_catalog_vinc
  select r.fornecedor_cnpj, r.insumo_sku, s.id, case when not (r.insumo_sku = any (v_bloq)) then m.id end, r.codigo_fornecedor,
         (select mm.sku from public.supplier_materials sm join public.materials mm on mm.id = sm.material_id
           where sm.tenant_id = p_tenant_id and sm.supplier_id = s.id and sm.codigo_fornecedor = r.codigo_fornecedor and sm.material_id <> m.id limit 1),
         r.unidade_compra, r.fator, r.preco, r.aliq_icms, r.inteiro
    from jsonb_to_recordset(v_itens) r(fornecedor_cnpj text, insumo_sku text, codigo_fornecedor text, unidade_compra text, fator numeric, preco numeric,
                                        aliq_icms numeric, inteiro boolean)
    left join public.suppliers s on s.tenant_id = p_tenant_id and s.cnpj = r.fornecedor_cnpj and s.deleted_at is null
    left join public.materials m on m.tenant_id = p_tenant_id and m.sku = r.insumo_sku and m.deleted_at is null;

  select coalesce(jsonb_agg(public.import_catalog_linha('vinculo', v.cnpj || '|' || v.sku, 'problema', case
           when v.supplier_id is null then format('fornecedor %s não está no Prodio (ficou de fora ou está excluído)', v.cnpj)
           else format('insumo %s não está no Prodio (ficou de fora ou está excluído)', v.sku) end) order by v.cnpj, v.sku), '[]'), count(*)
    into v_prob, v_n_prob from pg_temp.import_catalog_vinc v where v.supplier_id is null or v.material_id is null;
  select coalesce(jsonb_agg(public.import_catalog_linha('vinculo', v.cnpj || '|' || v.sku, 'aviso',
           format('código %s já é do insumo %s neste fornecedor; vínculo gravado sem código', v.codigo, v.colide)) order by v.cnpj, v.sku), '[]')
    into v_avisos from pg_temp.import_catalog_vinc v
   where v.colide is not null and v.supplier_id is not null and v.material_id is not null
     and not exists (select 1 from public.supplier_materials sm where sm.tenant_id = p_tenant_id and sm.supplier_id = v.supplier_id
                        and sm.material_id = v.material_id and sm.codigo_fornecedor is not null);
  update pg_temp.import_catalog_vinc set codigo = null where colide is not null;

  with up as (
    update public.supplier_materials t set
      codigo_fornecedor = coalesce(t.codigo_fornecedor, v.codigo), unidade_compra = coalesce(t.unidade_compra, v.unidade_compra),
      fator = coalesce(t.fator, v.fator), preco = coalesce(t.preco, v.preco), aliq_icms = coalesce(t.aliq_icms, v.aliq_icms)
      from pg_temp.import_catalog_vinc v, public.supplier_materials o
     where t.tenant_id = p_tenant_id and t.supplier_id = v.supplier_id and t.material_id = v.material_id and o.id = t.id
       and (t.codigo_fornecedor, t.unidade_compra, t.fator, t.preco, t.aliq_icms) is distinct from
           (coalesce(t.codigo_fornecedor, v.codigo), coalesce(t.unidade_compra, v.unidade_compra), coalesce(t.fator, v.fator), coalesce(t.preco, v.preco),
            coalesce(t.aliq_icms, v.aliq_icms))
    returning v.cnpj || '|' || v.sku as chave, array_remove(array[
      case when o.codigo_fornecedor is distinct from t.codigo_fornecedor then 'codigo_fornecedor' end,
      case when o.unidade_compra is distinct from t.unidade_compra then 'unidade_compra' end, case when o.fator is distinct from t.fator then 'fator' end,
      case when o.preco is distinct from t.preco then 'preco' end, case when o.aliq_icms is distinct from t.aliq_icms then 'aliq_icms' end], null) as campos
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('vinculo', chave, 'atualizado', null, campos) order by chave), '[]'), count(*) into v_up, v_n_up from up;

  with ins as (
    insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor, unidade_compra, fator, preco, aliq_icms, inteiro)
    select p_tenant_id, v.supplier_id, v.material_id, v.codigo, v.unidade_compra, v.fator, v.preco, v.aliq_icms, coalesce(v.inteiro, false)
      from pg_temp.import_catalog_vinc v
     where v.supplier_id is not null and v.material_id is not null
       and not exists (select 1 from public.supplier_materials sm where sm.tenant_id = p_tenant_id and sm.supplier_id = v.supplier_id and sm.material_id = v.material_id)
    on conflict do nothing
    returning supplier_id, material_id
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('vinculo', v.cnpj || '|' || v.sku, 'novo') order by v.cnpj, v.sku), '[]'), count(*) into v_ins, v_n_ins
    from ins join pg_temp.import_catalog_vinc v on v.supplier_id = ins.supplier_id and v.material_id = ins.material_id;

  return jsonb_build_object('contagens', jsonb_build_object('vinculo', public.import_catalog_contagem(jsonb_array_length(v_itens), v_n_ins, v_n_up, v_n_prob)),
    'linhas', v_prob || v_ins || v_up || v_avisos);
end $$;

-- ---------------------------------------------------------------------------
-- Fichas: chave = produto. Compara com a versão ativa (tipo, sku, consumo, unidade, perda, calc, sem ordem);
-- igual = nada; diferente = activate_bom (nova versão max+1, com as validações de unidade, tenant, excluído,
-- componente ≠ próprio e ciclo multinível) marcada 'importado do ES'. Uma ficha ruim não derruba as outras.
-- p_ctx: {itens: [...], insumos_bloqueados: [sku], produtos_bloqueados: [sku]}
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_boms(p_tenant_id uuid, p_ctx jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_itens jsonb := coalesce(p_ctx -> 'itens', '[]');
  v_bloq_ins text[] := array(select jsonb_array_elements_text(coalesce(p_ctx -> 'insumos_bloqueados', '[]')));
  v_bloq_prod text[] := array(select jsonb_array_elements_text(coalesce(p_ctx -> 'produtos_bloqueados', '[]')));
  v_ficha jsonb; v_sku text; v_produto uuid; v_erro text; v_linhas jsonb; v_nova jsonb; v_atual jsonb; v_tinha boolean; v_versao uuid;
  v_saida jsonb := '[]'; v_novos int := 0; v_up int := 0; v_prob int := 0;
  v_mudou uuid[] := '{}'; v_ciclo text;
begin
  for v_ficha in select e from jsonb_array_elements(v_itens) e order by e ->> 'produto_sku' loop
    v_sku := v_ficha ->> 'produto_sku';
    select p.id into v_produto from public.products p where p.tenant_id = p_tenant_id and p.sku = v_sku and p.deleted_at is null and not (v_sku = any (v_bloq_prod));
    if v_produto is null then
      v_saida := v_saida || public.import_catalog_linha('ficha', v_sku, 'problema', format('o produto %s não está no Prodio (ficou de fora ou está excluído)', v_sku));
      v_prob := v_prob + 1;
      continue;
    end if;
    -- Resolve as linhas por SKU; a primeira que não resolve derruba a ficha inteira.
    select (array_agg(x.erro order by x.ordem) filter (where x.erro is not null))[1],
           jsonb_agg(jsonb_strip_nulls(jsonb_build_object('tipo', x.tipo, 'material_id', x.material_id, 'component_product_id', x.component_id,
             'consumo', x.consumo, 'unidade', x.unidade, 'perda_pct', x.perda, 'calc', x.calc, 'ordem', x.ordem)) order by x.ordem),
           jsonb_agg(jsonb_build_object('tipo', x.tipo, 'sku', x.ref, 'consumo', x.consumo, 'unidade', x.unidade, 'perda_pct', x.perda, 'calc', x.calc)
             order by x.tipo, x.ref, x.consumo, x.unidade, x.perda, x.calc::text)
      into v_erro, v_linhas, v_nova
      from (
        select l.ordem, l.v ->> 'tipo' as tipo, coalesce(l.v ->> 'insumo_sku', l.v ->> 'componente_sku') as ref, m.id as material_id, c.id as component_id,
               (l.v ->> 'consumo')::numeric(14,6) as consumo, l.v ->> 'unidade' as unidade, (l.v ->> 'perda_pct')::numeric(8,5) as perda, l.v -> 'calc' as calc,
               case
                 when l.v ->> 'tipo' = 'insumo' and m.id is null then format('insumo %s não está no Prodio (ficou de fora ou está excluído)', l.v ->> 'insumo_sku')
                 when l.v ->> 'tipo' = 'insumo' and m.unidade_consumo <> l.v ->> 'unidade'
                   then format('insumo %s está em %s no Prodio e em %s no arquivo', l.v ->> 'insumo_sku', m.unidade_consumo, l.v ->> 'unidade')
                 when l.v ->> 'tipo' = 'produto' and c.id is null then format('componente %s não está no Prodio (ficou de fora ou está excluído)', l.v ->> 'componente_sku')
               end as erro
          from jsonb_array_elements(v_ficha -> 'linhas') with ordinality l(v, ordem)
          left join public.materials m on l.v ->> 'tipo' = 'insumo' and m.tenant_id = p_tenant_id and m.sku = l.v ->> 'insumo_sku' and m.deleted_at is null
                                      and not (m.sku = any (v_bloq_ins))
          left join public.products c on l.v ->> 'tipo' = 'produto' and c.tenant_id = p_tenant_id and c.sku = l.v ->> 'componente_sku' and c.deleted_at is null
                                     and not (c.sku = any (v_bloq_prod))
      ) x;
    if v_erro is not null then
      v_saida := v_saida || public.import_catalog_linha('ficha', v_sku, 'problema', v_erro || '; a ficha inteira fica de fora');
      v_prob := v_prob + 1;
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('tipo', l.tipo, 'sku', coalesce(m.sku, c.sku), 'consumo', l.consumo, 'unidade', l.unidade,
             'perda_pct', l.perda_pct, 'calc', l.calc) order by l.tipo, coalesce(m.sku, c.sku), l.consumo, l.unidade, l.perda_pct, l.calc::text), '[]'),
           count(*) > 0
      into v_atual, v_tinha
      from public.bom_versions v
      join public.bom_lines l on l.tenant_id = v.tenant_id and l.bom_version_id = v.id
      left join public.materials m on m.id = l.material_id
      left join public.products c on c.id = l.component_product_id
     where v.tenant_id = p_tenant_id and v.product_id = v_produto and v.ativa;
    if v_atual = v_nova then continue; end if;

    begin
      v_versao := public.activate_bom(p_tenant_id, v_produto, v_linhas);
      update public.bom_versions set observacao = 'importado do ES' where id = v_versao;
      v_mudou := v_mudou || v_produto;
      if v_tinha then
        v_saida := v_saida || public.import_catalog_linha('ficha', v_sku, 'atualizado', 'nova versão da ficha (a anterior fica no histórico)', array['linhas']);
        v_up := v_up + 1;
      else
        v_saida := v_saida || public.import_catalog_linha('ficha', v_sku, 'novo');
        v_novos := v_novos + 1;
      end if;
    exception when sqlstate '22023' then
      v_saida := v_saida || public.import_catalog_linha('ficha', v_sku, 'problema', sqlerrm || '; a ficha inteira fica de fora');
      v_prob := v_prob + 1;
    end;
  end loop;

  -- Defesa de última linha: nenhum ciclo nas fichas ativas a partir do que mudou. Se houver, aborta tudo.
  with recursive e as (
    select v.product_id as pai, l.component_product_id as filho
      from public.bom_versions v join public.bom_lines l on l.tenant_id = v.tenant_id and l.bom_version_id = v.id
     where v.tenant_id = p_tenant_id and v.ativa and l.tipo = 'produto'
  ), r(raiz, no, caminho) as (
    select e.pai, e.filho, array[e.pai] from e where e.pai = any (v_mudou)
    union all
    select r.raiz, e.filho, r.caminho || r.no from r join e on e.pai = r.no where not (r.no = any (r.caminho)) and cardinality(r.caminho) < 50
  )
  select p.sku into v_ciclo from r join public.products p on p.id = r.raiz where r.no = r.raiz limit 1;
  if v_ciclo is not null then
    raise exception 'ciclo nas fichas ativas a partir de %; nada foi gravado', v_ciclo using errcode = 'P0001';
  end if;

  return jsonb_build_object('contagens', jsonb_build_object('ficha', public.import_catalog_contagem(jsonb_array_length(v_itens), v_novos, v_up, v_prob)),
    'linhas', v_saida);
end $$;

revoke execute on function public.import_catalog_links(uuid, jsonb), public.import_catalog_boms(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC pública
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog(p_tenant_id uuid, p_payload jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_exemplo jsonb;
  v_cont jsonb := '{}';
  v_linhas jsonb := '[]';
  v_r jsonb;
  v_bloq_ins jsonb := '[]';
  v_bloq_prod jsonb := '[]';
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
  if not v_simular and ((v_exemplo ->> 'produtos')::int + (v_exemplo ->> 'insumos')::int + (v_exemplo ->> 'fornecedores')::int) > 0 then
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
    v_r := public.import_catalog_links(p_tenant_id, jsonb_build_object('itens', coalesce(p_payload -> 'vinculos', '[]'), 'insumos_bloqueados', v_bloq_ins));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');
    v_r := public.import_catalog_boms(p_tenant_id, jsonb_build_object('itens', coalesce(p_payload -> 'fichas', '[]'),
             'insumos_bloqueados', v_bloq_ins, 'produtos_bloqueados', v_bloq_prod));
    v_cont := v_cont || (v_r -> 'contagens');
    v_linhas := v_linhas || (v_r -> 'linhas');

    -- Resumo no audit_log (só contagens), e só quando algo mudou. Os triggers já registraram cada linha.
    if exists (select 1 from jsonb_each(v_cont) c where (c.value ->> 'novos')::int + (c.value ->> 'atualizados')::int > 0) then
      insert into public.audit_log (tenant_id, user_id, entidade, entidade_id, acao, depois)
      values (p_tenant_id, auth.uid(), 'import_catalog', null, 'importacao_es', jsonb_build_object('contagens', v_cont));
    end if;
    if v_simular then
      raise exception 'simulação: desfaz tudo' using errcode = 'PRD01';
    end if;
  exception when sqlstate 'PRD01' then
    null; -- o bloco desfez as escritas; as variáveis guardam o resultado da simulação
  end;

  return jsonb_build_object('simulacao', v_simular, 'exemplo', v_exemplo, 'contagens', v_cont, 'linhas', v_linhas);
end $$;
revoke execute on function public.import_catalog(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_catalog(uuid, jsonb, boolean) to authenticated;
