-- Prodio · limpeza SELETIVA dos dados de exemplo do tenant 'eddias' (fonte versionada; build.sh copia para dist/).
--
-- QUANDO USAR
--   O banco recebeu dados_eddias.sql (o exemplo) e o Prodio JÁ ESTÁ EM USO: conector ligado puxando pedidos
--   reais, credencial salva, cursor do robô. limpar_exemplo.sql não serve nesse caso: ele apaga todos os dados do tenant
--   (conectores, credenciais, sync_state e pedidos reais) e por isso para na trava quando vê uso real. Este apaga
--   só o exemplo e o que foi criado em cima dele nos testes; depois dele a importação do ES fica liberada.
--   Sem uso real nenhum, qualquer um dos dois serve (docs/deploy.md).
--
-- O QUE FICA
--   Empresa, membros, usuários, locais, unidades, perfis de etiqueta, operadores, aparelhos, etapas, numeração de
--   documentos e auditorias do robô. TODOS os conectores — inclusive as linhas 0d… do seed: o BaseLinker 0d…01 pode
--   estar em uso de verdade —, credenciais, De-Para de status e sync_state. Pedidos que não são 'seed:%' e os seus
--   itens. Todo cadastro, documento e movimento que não é do exemplo.
--
-- O QUE SAI (o exemplo é reconhecido pelos ids fixos do seed, nunca por nome ou SKU)
--   · produtos a0…, insumos b0…, fornecedores c0… e o que pendura neles: apelidos, fichas (versões e linhas),
--     vínculos fornecedor-insumo, preços por canal, saldos de estoque, saldos do hub, plano do dia;
--   · documentos do seed: pedidos 'seed:%' (com itens), OCs 0c…, NF-e 0e…, recebimento 0f…, inventário 0b…,
--     canais 0a… (o canal fica se algum produto que não é do exemplo tiver preço nele ou se foi editado na tela:
--     comissão, taxas e frete são configuração de verdade), avisos 09… (só estes: aviso que não é do seed fica,
--     mesmo citando SKU do exemplo — vários são SKUs reais);
--   · o que os testes criaram em cima do exemplo: etiquetas e bipes de produto do exemplo, fila de estoque (outbox)
--     desses produtos, recebimentos de OC/NF-e do seed, inventários só com insumos do exemplo (os mistos ficam,
--     sem os itens do exemplo), e os movimentos de estoque de insumo do exemplo que vêm do seed, de bipe de
--     produto do exemplo, de inventário, de recebimento de OC/NF-e do seed, e os estornos desses. Inventário conta como teste: a contagem é de um insumo que vai sumir; o insumo real nasce
--     na importação com saldo zero e o saldo volta pelo inventário.
--   Item de pedido REAL que aponta para produto do exemplo: product_id vira nulo e o sku_externo fica. A importação
--   do ES religa (mesma regra do robô: apelido, depois SKU principal).
--
-- TRAVA: para sem apagar nada, e mostra as contagens, quando acha dado que não é do exemplo ligado ao exemplo —
-- pode ser real e o script não sabe classificar:
--   · OC fora dos ids do seed com fornecedor ou insumo do exemplo;
--   · NF-e fora dos ids do seed com fornecedor ou insumo do exemplo;
--   · recebimento que não é de OC/NF-e do seed com insumo do exemplo;
--   · movimento de estoque de insumo do exemplo que não é do seed, de bipe, de inventário nem de recebimento do
--     seed (lançamento manual, recebimento de nota de verdade…): pode ser estoque real lançado no insumo errado;
--   · baixa de insumo que NÃO é do exemplo feita por bipe, NF-e ou recebimento do exemplo (o saldo real mudou);
--   · ficha de produto que não é do exemplo usando insumo ou produto do exemplo;
--   · De-Para de SKU (sku_aliases) num produto do exemplo que não é um dos cinco pares do seed.sql: é o que a tela
--     De-Para do conector grava quando o SKU de um pedido real não casa — trabalho do fundador. A mensagem lista
--     os pares (SKU do pedido → SKU do produto) para refazer depois da importação.
-- Para apagar mesmo assim, ponha esta linha no começo da MESMA execução do SQL Editor:
--   set prodio.limpar_mesmo_assim = 'sim';
-- Com a confirmação: a OC do fornecedor do exemplo sai com os itens; item de OC ou de recebimento com insumo do
-- exemplo sai (recebimento que fica sem item sai também); NF-e fica e perde só o fornecedor/insumo do exemplo;
-- movimento de insumo do exemplo sai; baixa de insumo real feita pelo exemplo FICA (o saldo não é reescrito:
-- acerte no inventário); linha de ficha com insumo/produto do exemplo sai; o De-Para sai com o produto e o
-- resultado lista os pares (os itens desses pedidos voltam para a lista do De-Para). A confirmação vale para uma
-- execução só: o script a apaga no fim.
--
-- LEDGER. stock_moves é append-only: o gatilho stock_moves_append_only barra UPDATE e DELETE até do dono do banco.
-- Movimento de insumo do exemplo não tem como ser estornado — o estorno é outro movimento do mesmo insumo, e o
-- insumo precisa sair (a FK não deixa apagar insumo com movimento). Então, como no limpar_exemplo.sql, o gatilho
-- é desligado só em volta do DELETE e religado logo em seguida; aqui só ele (pelo nome, não todos os gatilhos) e
-- só para os movimentos dos insumos do exemplo — movimento de insumo que não é do exemplo nunca é apagado.
-- ALTER TABLE é transacional: o desligamento só existe dentro desta transação (as outras sessões nunca veem a
-- tabela sem o gatilho e esperam para escrever em stock_moves até o fim), e qualquer erro desfaz tudo, inclusive
-- o desligamento. Mesmo assim o bloco religa o gatilho no tratamento de erro antes de repassar a falha.
--
-- COMO RODAR: no SQL Editor do Supabase (como dono do banco, postgres), cole o arquivo inteiro e rode; ou
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dist/limpar_so_exemplo.sql
-- A limpeza é um bloco só (do $$ … $$): ou tudo, ou nada. O bloco termina com RAISE NOTICE das contagens, e a
-- consulta do fim mostra a mesma lista como tabela (o SQL Editor do painel pode não exibir NOTICE).
-- SEGURO RODAR DE NOVO: a segunda vez não acha exemplo e não apaga nada. Depois da importação do ES também não
-- apaga nada: o catálogo importado não tem os ids do exemplo.

do $$
declare
  t uuid;
  v_p uuid[]; v_m uuid[]; v_s uuid[];                -- produtos, insumos e fornecedores do exemplo
  v_oc_seed uuid[]; v_oc uuid[]; v_nfe uuid[]; v_rc uuid[]; v_rc_del uuid[]; v_inv uuid[]; v_scan uuid[]; v_mov uuid[];
  v_sinais jsonb;
  v_depara text[];                                   -- De-Para de SKU feito fora do exemplo em produto do exemplo
  v_forcar boolean := coalesce(current_setting('prodio.limpar_mesmo_assim', true), '') = 'sim';
  v_tabelas text[][] := array[
    ['produtos', 'products'], ['apelidos de SKU', 'sku_aliases'], ['insumos', 'materials'], ['fornecedores', 'suppliers'],
    ['vínculos fornecedor-insumo', 'supplier_materials'], ['versões de ficha', 'bom_versions'], ['linhas de ficha', 'bom_lines'],
    ['pedidos', 'orders'], ['itens de pedido', 'order_items'], ['ordens de compra', 'purchase_orders'], ['itens de OC', 'purchase_order_items'],
    ['NF-e', 'nfe_inbound'], ['itens de NF-e', 'nfe_inbound_items'], ['vínculos NF-e × OC', 'nfe_po_links'],
    ['recebimentos', 'receipts'], ['itens de recebimento', 'receipt_items'],
    ['movimentos de estoque', 'stock_moves'], ['saldos de estoque', 'stock_balances'], ['etiquetas', 'labels'], ['bipes', 'scan_events'],
    ['plano do dia', 'daily_plans'], ['fila de estoque (outbox)', 'integration_outbox'], ['saldos do hub', 'hub_stock_snapshots'],
    ['inventários', 'inventory_sessions'], ['itens de inventário', 'inventory_items'], ['canais', 'channels'], ['preços por canal', 'product_prices'],
    ['avisos', 'notifications'], ['conectores', 'connectors'], ['credenciais de conector', 'connector_credentials'],
    ['De-Para de status', 'connector_status_map'], ['estado do robô (sync_state)', 'sync_state'], ['auditorias do robô', 'audit_runs'],
    ['membros', 'memberships'], ['locais', 'locations'], ['unidades', 'units'], ['perfis de etiqueta', 'label_profiles'],
    ['operadores', 'operators'], ['aparelhos', 'devices']];
  v_antes bigint[] := '{}';
  v_saida jsonb := '[]';
  v_religar bigint; v_outbox_hub bigint; v_forn_padrao bigint;
  n bigint;
  i int;
  l jsonb;
begin
  perform set_config('prodio.limpar_so_exemplo', '', false);
  select id into t from public.tenants where slug = 'eddias';
  if t is null then raise notice 'empresa eddias não encontrada: nada a fazer'; return; end if;

  -- O exemplo e o que foi feito em cima dele.
  v_p := array(select id from public.products where tenant_id = t and id::text like 'a0000000-0000-0000-0000-%');
  v_m := array(select id from public.materials where tenant_id = t and id::text like 'b0000000-0000-0000-0000-%');
  v_s := array(select id from public.suppliers where tenant_id = t and id::text like 'c0000000-0000-0000-0000-%');
  -- Tranca as linhas do exemplo até o fim: robô, bipe ou tela que tente ligar algo novo a elas espera e, depois
  -- do commit, não acha mais o produto (o robô grava o item sem produto na próxima rodada).
  perform 1 from public.products where tenant_id = t and id = any (v_p) for update;
  perform 1 from public.materials where tenant_id = t and id = any (v_m) for update;
  perform 1 from public.suppliers where tenant_id = t and id = any (v_s) for update;
  v_oc_seed := array(select id from public.purchase_orders where tenant_id = t and id::text like '0c000000-0000-0000-0000-%');
  v_oc := v_oc_seed || array(select id from public.purchase_orders where tenant_id = t and supplier_id = any (v_s) and not (id = any (v_oc_seed)));
  v_nfe := array(select id from public.nfe_inbound where tenant_id = t and id::text like '0e000000-0000-0000-0000-%');
  -- Recebimento do exemplo: o do seed, o de NF-e do seed e o manual de OC do seed (recebimento de nota de verdade
  -- amarrado a OC do seed não entra: a nota pode ser real).
  v_rc := array(select id from public.receipts where tenant_id = t and (id::text like '0f000000-0000-0000-0000-%' or nfe_id = any (v_nfe)
                  or (nfe_id is null and purchase_order_id = any (v_oc_seed))));
  -- Sai também (só chega aqui com a confirmação) o recebimento cujos itens são todos de insumo do exemplo.
  v_rc_del := v_rc || array(select r.id from public.receipts r where r.tenant_id = t and not (r.id = any (v_rc))
                  and exists (select 1 from public.receipt_items x where x.receipt_id = r.id)
                  and not exists (select 1 from public.receipt_items x where x.receipt_id = r.id and not (x.material_id = any (v_m))));
  v_inv := array(select s.id from public.inventory_sessions s where s.tenant_id = t and (s.id::text like '0b000000-0000-0000-0000-%'
                  or (exists (select 1 from public.inventory_items x where x.session_id = s.id)
                      and not exists (select 1 from public.inventory_items x where x.session_id = s.id and not (x.material_id = any (v_m))))));
  v_scan := array(select id from public.scan_events where tenant_id = t and product_id = any (v_p));
  -- Movimentos de insumo do exemplo que se sabe de onde vieram (o resto é sinal da trava) e os estornos deles.
  v_mov := array(select m.id from public.stock_moves m where m.tenant_id = t and m.material_id = any (v_m) and (
             m.idempotency_key like 'seed:%' or m.ref_type = 'inventory_session'
             or (m.ref_type = 'nfe' and m.ref_id = any (v_nfe)) or (m.ref_type = 'receipt' and m.ref_id = any (v_rc))
             or (m.ref_type = 'scan_event' and m.ref_id = any (v_scan))));
  v_mov := v_mov || array(select m.id from public.stock_moves m where m.tenant_id = t and m.reverses_id = any (v_mov) and not (m.id = any (v_mov)));
  -- De-Para de SKU em produto do exemplo que não é um dos pares do seed.sql (se o seed mudar, mude aqui; o teste
  -- 0017 roda o seed sem trava e acusa). Reconhece o seed pelo par (id fixo do produto, apelido), nunca pelo SKU sozinho.
  v_depara := array(select a.sku_externo || ' → ' || p.sku from public.sku_aliases a join public.products p on p.id = a.product_id
                     where a.tenant_id = t and a.product_id = any (v_p)
                       and (a.product_id, a.sku_externo) not in (select x.p::uuid, x.s from (values
                             ('a0000000-0000-0000-0000-000000000001', 'ED000130'), ('a0000000-0000-0000-0000-000000000002', 'ED000127'),
                             ('a0000000-0000-0000-0000-000000000003', 'ED000215'), ('a0000000-0000-0000-0000-000000000004', 'ED000240'),
                             ('a0000000-0000-0000-0000-000000000009', 'ED000376')) x(p, s))
                     order by 1);

  -- Trava: dado que não é do exemplo ligado ao exemplo.
  select jsonb_strip_nulls(jsonb_build_object(
    'OCs fora do exemplo com fornecedor ou insumo do exemplo', nullif((select count(*) from public.purchase_orders po where po.tenant_id = t
        and not (po.id = any (v_oc_seed))
        and (po.supplier_id = any (v_s) or exists (select 1 from public.purchase_order_items x where x.purchase_order_id = po.id and x.material_id = any (v_m)))), 0),
    'NF-e fora do exemplo com fornecedor ou insumo do exemplo', nullif((select count(*) from public.nfe_inbound nf where nf.tenant_id = t and not (nf.id = any (v_nfe))
        and (nf.supplier_id = any (v_s) or exists (select 1 from public.nfe_inbound_items x where x.nfe_id = nf.id and x.material_id = any (v_m)))), 0),
    'recebimentos fora do exemplo com insumo do exemplo', nullif((select count(*) from public.receipts r where r.tenant_id = t and not (r.id = any (v_rc))
        and exists (select 1 from public.receipt_items x where x.receipt_id = r.id and x.material_id = any (v_m))), 0),
    'movimentos de insumo do exemplo lançados à mão ou por documento fora do exemplo', nullif((select count(*) from public.stock_moves m
        where m.tenant_id = t and m.material_id = any (v_m) and not (m.id = any (v_mov))), 0),
    'movimentos de insumo fora do exemplo feitos por bipe, NF-e ou recebimento do exemplo', nullif((select count(*) from public.stock_moves m
        where m.tenant_id = t and not (m.material_id = any (v_m)) and ((m.ref_type = 'scan_event' and m.ref_id = any (v_scan))
          or (m.ref_type = 'nfe' and m.ref_id = any (v_nfe)) or (m.ref_type = 'receipt' and m.ref_id = any (v_rc)))), 0),
    'fichas de produto fora do exemplo que usam insumo ou produto do exemplo', nullif((select count(distinct x.bom_version_id) from public.bom_lines x
        join public.bom_versions v on v.id = x.bom_version_id
        where x.tenant_id = t and not (v.product_id = any (v_p)) and (x.material_id = any (v_m) or x.component_product_id = any (v_p))), 0),
    'De-Para de SKU feito fora do exemplo em produto do exemplo', nullif(cardinality(v_depara), 0)))
    into v_sinais;
  if v_sinais <> '{}'::jsonb and not v_forcar then
    raise exception 'há dados que não são do exemplo ligados ao exemplo no tenant eddias: %.% Podem ser reais e este script não sabe classificar; nada foi apagado. Confira e, para apagar mesmo assim, rode antes, na mesma execução: set prodio.limpar_mesmo_assim = ''sim'';',
      v_sinais, case when cardinality(v_depara) > 0 then ' De-Para de SKU que sairia com o produto do exemplo (anote e refaça na tela De-Para do conector depois da importação): '
                     || array_to_string(v_depara, ', ') || '.' else '' end;
  end if;

  for i in 1 .. array_length(v_tabelas, 1) loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tabelas[i][2]) using t into n;
    v_antes := v_antes || n;
  end loop;

  -- Pedidos: os do seed saem com os itens; item de pedido real perde o produto do exemplo (o sku_externo fica).
  delete from public.orders where tenant_id = t and external_id like 'seed:%';
  update public.order_items set product_id = null where tenant_id = t and product_id = any (v_p);
  get diagnostics v_religar = row_count;

  -- O que pendura nos produtos do exemplo.
  with d as (delete from public.integration_outbox where tenant_id = t and product_id = any (v_p) returning status)
  select count(*) filter (where status = 'aplicado') into v_outbox_hub from d;
  delete from public.hub_stock_snapshots where tenant_id = t and product_id = any (v_p);
  delete from public.daily_plans where tenant_id = t and product_id = any (v_p);
  delete from public.scan_events where tenant_id = t and product_id = any (v_p);
  delete from public.labels where tenant_id = t and product_id = any (v_p);
  delete from public.product_prices where tenant_id = t and product_id = any (v_p);
  -- Canal do seed editado na tela (upsert_channel: updated_at passa do created_at) é configuração do fundador: fica.
  -- O que ele excluiu na tela (deleted_at) sai.
  delete from public.channels c where c.tenant_id = t and c.id::text like '0a000000-0000-0000-0000-%'
     and (c.updated_at <= c.created_at or c.deleted_at is not null)
     and not exists (select 1 from public.product_prices pp where pp.tenant_id = t and pp.channel_id = c.id);
  -- Avisos: só os do seed, pelo id. Casar texto com SKU ou nome do exemplo apagaria aviso real (ED000001 é SKU real).
  delete from public.notifications where tenant_id = t and id::text like '09000000-0000-0000-0000-%';

  -- Inventário, recebimentos, NF-e e OCs.
  delete from public.inventory_items where tenant_id = t and (session_id = any (v_inv) or material_id = any (v_m));
  delete from public.inventory_sessions where tenant_id = t and id = any (v_inv);
  delete from public.receipt_items where tenant_id = t and (receipt_id = any (v_rc_del) or material_id = any (v_m));
  update public.receipts set purchase_order_id = null where tenant_id = t and purchase_order_id = any (v_oc) and not (id = any (v_rc_del));
  delete from public.receipts where tenant_id = t and id = any (v_rc_del);
  delete from public.nfe_inbound where tenant_id = t and id = any (v_nfe);
  update public.nfe_inbound_items set material_id = null where tenant_id = t and material_id = any (v_m);
  update public.nfe_inbound set supplier_id = null where tenant_id = t and supplier_id = any (v_s);
  delete from public.purchase_order_items where tenant_id = t and material_id = any (v_m);
  delete from public.purchase_orders where tenant_id = t and id = any (v_oc);

  -- Estoque dos insumos do exemplo. Ledger: ver o cabeçalho.
  delete from public.stock_balances where tenant_id = t and material_id = any (v_m);
  alter table public.stock_moves disable trigger stock_moves_append_only;
  begin
    delete from public.stock_moves where tenant_id = t and material_id = any (v_m);
  exception when others then
    alter table public.stock_moves enable trigger stock_moves_append_only;
    raise;
  end;
  alter table public.stock_moves enable trigger stock_moves_append_only;

  -- Cadastro do exemplo.
  delete from public.bom_lines x using public.bom_versions v
   where v.id = x.bom_version_id and x.tenant_id = t and (v.product_id = any (v_p) or x.material_id = any (v_m) or x.component_product_id = any (v_p));
  delete from public.bom_versions where tenant_id = t and product_id = any (v_p);
  delete from public.supplier_materials where tenant_id = t and (material_id = any (v_m) or supplier_id = any (v_s));
  update public.materials set fornecedor_padrao_id = null where tenant_id = t and fornecedor_padrao_id = any (v_s) and not (id = any (v_m));
  get diagnostics v_forn_padrao = row_count;
  delete from public.materials where tenant_id = t and id = any (v_m);
  delete from public.sku_aliases where tenant_id = t and product_id = any (v_p);
  delete from public.products where tenant_id = t and id = any (v_p);
  delete from public.suppliers where tenant_id = t and id = any (v_s);

  -- Resultado: o que saiu e o que ficou, tabela por tabela, e os ajustes em dado que ficou.
  for i in 1 .. array_length(v_tabelas, 1) loop
    execute format('select count(*) from public.%I where tenant_id = $1', v_tabelas[i][2]) using t into n;
    v_saida := v_saida || jsonb_build_array(jsonb_build_array(v_tabelas[i][1], v_antes[i] - n, n));
  end loop;
  v_saida := v_saida
    || jsonb_build_array(jsonb_build_array('itens de pedido real que ficaram sem produto (a importação do ES religa)', 0, v_religar))
    || jsonb_build_array(jsonb_build_array('itens da fila de estoque do exemplo que já tinham ido ao hub', v_outbox_hub, 0))
    || jsonb_build_array(jsonb_build_array('insumos que perderam o fornecedor padrão do exemplo', 0, v_forn_padrao))
    || case when cardinality(v_depara) > 0 then jsonb_build_array(jsonb_build_array('De-Para de SKU feito fora do exemplo que saiu (refaça na tela De-Para do conector depois da importação): '
         || array_to_string(v_depara, ', '), cardinality(v_depara), 0)) else '[]'::jsonb end
    || jsonb_build_array(jsonb_build_array('conectores ligados', 0, (select count(*) from public.connectors where tenant_id = t and status <> 'desconectado')))
    || jsonb_build_array(jsonb_build_array('pedidos reais', 0, (select count(*) from public.orders where tenant_id = t and external_id not like 'seed:%')));
  if v_sinais <> '{}'::jsonb then
    raise notice 'apagado com a confirmação (prodio.limpar_mesmo_assim): %', v_sinais;
  end if;
  for l in select x from jsonb_array_elements(v_saida) x loop
    raise notice '%: apagados %, ficam %', l ->> 0, l ->> 1, l ->> 2;
  end loop;
  perform set_config('prodio.limpar_so_exemplo', v_saida::text, false);
  perform set_config('prodio.limpar_mesmo_assim', '', false); -- a confirmação vale para uma execução só
end $$;

select l.x ->> 0 as o_que, (l.x ->> 1)::bigint as apagados, (l.x ->> 2)::bigint as ficam
  from jsonb_array_elements(coalesce(nullif(current_setting('prodio.limpar_so_exemplo', true), ''), '[]')::jsonb) with ordinality l(x, ordem)
 order by l.ordem;
