-- limpar_so_exemplo.sql (supabase/limpar_so_exemplo.sql, copiado para dist/ pelo build.sh), rodado como está, sobre o
-- estado real do fundador: o seed + o BaseLinker 0d…01 do seed ligado de verdade (credencial, cursor, De-Para) +
-- pedidos reais cujos itens casaram com produto do exemplo + testes feitos na tela em cima do exemplo.
-- Confere o que fica e o que sai (inclusive canal do seed editado na tela e aviso real que cita SKU do exemplo, que
-- ficam), a importação do ES religando os itens depois, a idempotência, a trava (inclusive De-Para de SKU feito na
-- tela num produto do exemplo), o erro no meio (nada apagado, gatilho do ledger ligado) e a confirmação.
\set limpar `cat limpar_so_exemplo.sql`
\o /dev/null
begin;
set local client_min_messages = warning; -- o script lista as contagens em NOTICE a cada rodada
select set_config('test.limpar', :'limpar', false);

create function pg_temp.conta(p_tabela text, p_filtro text default 'true') returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where tenant_id = %L and (%s)', p_tabela, '11111111-1111-1111-1111-111111111111', p_filtro) into n;
  return n;
end $$;
create function pg_temp.exigir(p_ok boolean, p_oque text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'limpar_so_exemplo: %', p_oque; end if;
end $$;
create function pg_temp.limpar() returns jsonb language plpgsql as $$
begin
  execute current_setting('test.limpar');
  return current_setting('prodio.limpar_so_exemplo')::jsonb;
end $$;
-- Linha do resultado do script: [o_que, apagados, ficam].
create function pg_temp.linha(r jsonb, o_que text) returns jsonb language sql as $$
  select l from jsonb_array_elements(r) l where l ->> 0 = o_que
$$;

-- ---------------------------------------------------------------------------
-- 0. O estado do fundador.
-- ---------------------------------------------------------------------------
update public.tenants set exigir_projecao_para_imprimir = false where id = '11111111-1111-1111-1111-111111111111';
-- Cadastro feito à mão, fora do exemplo: fica.
insert into public.products (id, tenant_id, sku, nome, familia) values
  ('17000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'ED777777', 'Produto real', 'Mesa');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo) values
  ('17000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'MP7777', 'Insumo real', 'un', 'un');
insert into public.suppliers (id, tenant_id, nome, cnpj) values
  ('17000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'Fornecedor real', '11222333000181');
-- O BaseLinker do seed ligado pela tela, com a credencial e o cursor gravados pelo worker.
select auth.test_login('22222222-2222-2222-2222-222222222222');
select public.upsert_connector('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'baselinker', 'Base.com (BaseLinker)',
  '{"status": "conectado", "dry_run": false, "dias_iniciais": 30}');
select public.set_status_map('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', '[{"status_externo": "1", "significado": "demanda"}]');
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-0000000017ff', 'service_role');
select public.worker_set_credentials('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', '{"token": "segredo-real"}', 'chave-17');
select public.worker_set_sync_state('0d000000-0000-0000-0000-000000000001', '{"date_confirmed_from": 1758800000}', true);
-- Pedidos reais: ED000001 é SKU real que casou com o produto do exemplo; ED000130 é apelido do exemplo; ED999999 não casa.
select public.worker_upsert_orders('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', jsonb_build_array(
  jsonb_build_object('external_id', '7001', 'external_status', '1', 'confirmed_at', now() - interval '1 day', 'total', 180,
    'itens', '[{"sku_externo": "ED000001", "quantidade": 2, "preco": 49.9}, {"sku_externo": "ED000130", "quantidade": 1, "preco": 129.9}]'::jsonb),
  jsonb_build_object('external_id', '7002', 'external_status', '1', 'confirmed_at', now(), 'total', 80,
    'itens', '[{"sku_externo": "ED999999", "quantidade": 1, "preco": 80}]'::jsonb)));
select public.worker_upsert_hub_stock('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', '[{"sku": "ED000001", "saldo": 388}]');
select auth.test_logout();
-- Testes na tela: etiquetas e bipes de ED000001 do exemplo (baixa MP0068/MP0017 do exemplo e enfileira estoque no
-- BaseLinker), um estorno, plano do dia, inventário de insumo do exemplo; e o produto real bipado de verdade.
select auth.test_login('22222222-2222-2222-2222-222222222222');
do $$
declare s text; r jsonb; v_scan uuid; v_inv uuid; t uuid := '11111111-1111-1111-1111-111111111111';
begin
  for s in select serial from public.reserve_label_batch(t, 'a0000000-0000-0000-0000-000000000005', 2) loop
    r := public.register_scan(t, s);
    if not (r ->> 'ok')::boolean then raise exception 'bipe de teste: %', r; end if;
    v_scan := (r ->> 'scan_id')::uuid;
  end loop;
  perform public.reverse_scan(t, v_scan);
  for s in select serial from public.reserve_label_batch(t, '17000000-0000-0000-0000-000000000001', 1) loop
    perform public.register_scan(t, s);
  end loop;
  perform public.set_daily_plan(t, current_date + 1, 'aaaaaaaa-0000-0000-0000-000000000001',
    '[{"product_id": "a0000000-0000-0000-0000-000000000005", "projetado": 10}, {"product_id": "17000000-0000-0000-0000-000000000001", "projetado": 5}]');
  v_inv := public.open_inventory_session(t, 'aaaaaaaa-0000-0000-0000-000000000002', 'teste');
  perform public.save_inventory_item(t, v_inv, 'b0000000-0000-0000-0000-000000000001', 10);
  perform public.close_inventory_session(t, v_inv);
  perform public.post_stock_move(t, '17000000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001', 'saldo_inicial', 50, 1, 'inicial', null, null, 'real:1');
  -- Inventário misto (insumo do exemplo + insumo real): fica, sem o item do exemplo.
  v_inv := public.open_inventory_session(t, 'aaaaaaaa-0000-0000-0000-000000000001', 'misto');
  perform public.save_inventory_item(t, v_inv, 'b0000000-0000-0000-0000-000000000002', 20);
  perform public.save_inventory_item(t, v_inv, '17000000-0000-0000-0000-000000000011', 45);
  perform public.close_inventory_session(t, v_inv);
  -- Canal do seed ajustado na tela (comissão de verdade): é configuração do fundador e fica, mesmo sem preço.
  perform public.upsert_channel(t, '0a000000-0000-0000-0000-000000000002', '{"nome": "Shopee", "preset": "shopee", "comissao_pct": 0.14, "taxa_fixa": 4}');
end $$;
select auth.test_logout();
-- Preço do produto real num canal do seed: o canal fica. Um item da fila já foi ao hub. Avisos que não são do seed
-- ficam, mesmo citando um SKU que também está no exemplo (ED000001 é SKU real da Eddias).
insert into public.product_prices (tenant_id, product_id, channel_id, preco) values
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000001', 99.9);
update public.integration_outbox set status = 'aplicado', applied_at = now()
 where id = (select min(id) from public.integration_outbox where product_id = 'a0000000-0000-0000-0000-000000000005');
insert into public.notifications (tenant_id, tipo, texto) values
  ('11111111-1111-1111-1111-111111111111', 'minimo', 'ED000001 está sem saldo no hub'),
  ('11111111-1111-1111-1111-111111111111', 'conector', 'Base.com sincronizou 2 pedidos');
do $$ begin
  perform pg_temp.exigir(pg_temp.conta('labels', 'product_id = ''a0000000-0000-0000-0000-000000000005''') = 2
    and pg_temp.conta('scan_events', 'product_id = ''a0000000-0000-0000-0000-000000000005''') = 3
    and pg_temp.conta('integration_outbox', 'product_id = ''a0000000-0000-0000-0000-000000000005''') = 3
    and pg_temp.conta('hub_stock_snapshots') = 1 and pg_temp.conta('order_items', 'product_id is not null and order_id in (select id from public.orders where external_id in (''7001'', ''7002''))') = 2
    and pg_temp.conta('stock_moves', 'idempotency_key like ''scan:%'' or idempotency_key like ''rev:%'' or idempotency_key like ''inv:%''') = 10,
    'o estado do fundador não foi montado como esperado');
end $$;

savepoint antes_da_limpeza;

-- ---------------------------------------------------------------------------
-- 1. Roda: some o exemplo e o que foi feito em cima dele; fica a integração, os pedidos reais e o que não é exemplo.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb := pg_temp.limpar();
begin
  -- sai
  perform pg_temp.exigir(pg_temp.conta('products', 'id::text like ''a0%''') + pg_temp.conta('materials', 'id::text like ''b0%''')
    + pg_temp.conta('suppliers', 'id::text like ''c0%''') = 0, 'produtos, insumos e fornecedores do exemplo deveriam sair');
  perform pg_temp.exigir(pg_temp.conta('orders', 'external_id like ''seed:%''') = 0, 'pedidos do seed deveriam sair');
  perform pg_temp.exigir(pg_temp.conta('purchase_orders') + pg_temp.conta('nfe_inbound') + pg_temp.conta('receipts') + pg_temp.conta('sku_aliases')
    + pg_temp.conta('bom_versions') + pg_temp.conta('bom_lines') + pg_temp.conta('supplier_materials') + pg_temp.conta('hub_stock_snapshots') = 0,
    'documentos e cadastros pendurados no exemplo deveriam sair');
  perform pg_temp.exigir(pg_temp.conta('channels') = 2 and pg_temp.conta('channels', 'id = ''0a000000-0000-0000-0000-000000000001''') = 1
    and pg_temp.conta('channels', 'id = ''0a000000-0000-0000-0000-000000000002'' and comissao_pct = 0.14') = 1
    and pg_temp.conta('product_prices') = 1, 'canais do seed saem, menos o que tem preço de produto real e o editado na tela; preços do exemplo saem');
  perform pg_temp.exigir(pg_temp.conta('inventory_sessions') = 1 and pg_temp.conta('inventory_items') = 1
    and pg_temp.conta('inventory_items', 'material_id = ''17000000-0000-0000-0000-000000000011''') = 1,
    'inventário do seed e o só de exemplo saem; o misto fica sem o item do exemplo');
  perform pg_temp.exigir(pg_temp.conta('labels') = 1 and pg_temp.conta('scan_events') = 1 and pg_temp.conta('integration_outbox') = 1 and pg_temp.conta('daily_plans') = 1,
    'etiqueta, bipe, fila e plano do exemplo deveriam sair e os do produto real ficar');
  perform pg_temp.exigir(pg_temp.conta('stock_moves') = 2 and pg_temp.conta('stock_moves', 'material_id = ''17000000-0000-0000-0000-000000000011''') = 2
    and pg_temp.conta('stock_balances') = 1, 'só os movimentos e o saldo do insumo real deveriam ficar');
  perform pg_temp.exigir(pg_temp.conta('notifications') = 4 and pg_temp.conta('notifications', 'id::text like ''09%''') = 0
    and pg_temp.conta('notifications', 'texto = ''ED000001 está sem saldo no hub''') = 1,
    'só os avisos do seed saem; os outros ficam, mesmo citando SKU que também está no exemplo');
  -- fica
  perform pg_temp.exigir(pg_temp.conta('connectors') = 5 and pg_temp.conta('connector_credentials') = 1 and pg_temp.conta('connector_status_map') = 1
    and pg_temp.conta('sync_state') = 1, 'conectores, credencial, De-Para e sync_state deveriam ficar');
  perform pg_temp.exigir((select status = 'conectado' and config ->> 'dry_run' = 'false' and config ->> 'dias_iniciais' = '30'
    from public.connectors where id = '0d000000-0000-0000-0000-000000000001'), 'o BaseLinker deveria continuar ligado e configurado');
  perform pg_temp.exigir((select cursor = '{"date_confirmed_from": 1758800000}' from public.sync_state where connector_id = '0d000000-0000-0000-0000-000000000001'),
    'o cursor do robô deveria ficar');
  perform pg_temp.exigir(pg_temp.conta('orders') = 2 and pg_temp.conta('order_items') = 3 and pg_temp.conta('order_items', 'product_id is not null') = 0
    and pg_temp.conta('order_items', 'sku_externo in (''ED000001'', ''ED000130'', ''ED999999'')') = 3,
    'pedidos reais ficam; os itens perdem o produto do exemplo e guardam o sku_externo');
  perform pg_temp.exigir(pg_temp.conta('products') = 1 and pg_temp.conta('materials') = 1 and pg_temp.conta('suppliers') = 1, 'cadastro real deveria ficar');
  perform pg_temp.exigir(exists (select 1 from public.tenants where slug = 'eddias') and pg_temp.conta('memberships') = 2 and pg_temp.conta('units') = 8
    and pg_temp.conta('locations') = 2 and pg_temp.conta('label_profiles') = 4 and pg_temp.conta('operators') = 3 and pg_temp.conta('devices') = 1
    and pg_temp.conta('doc_counters', 'kind = ''oc'' and next_value = 1044') = 1, 'empresa, usuários, locais, unidades, perfis, operadores, aparelhos e numeração ficam');
  perform pg_temp.exigir((select tgenabled = 'O' from pg_trigger where tgname = 'stock_moves_append_only'), 'o gatilho do ledger deveria voltar ligado');
  -- resultado: [o que, apagados, ficam]
  perform pg_temp.exigir(pg_temp.linha(r, 'produtos') = '["produtos", 11, 1]' and pg_temp.linha(r, 'conectores') = '["conectores", 0, 5]'
    and pg_temp.linha(r, 'itens de pedido real que ficaram sem produto (a importação do ES religa)') ->> 2 = '2'
    and pg_temp.linha(r, 'itens da fila de estoque do exemplo que já tinham ido ao hub') ->> 1 = '1', 'resultado: ' || r::text);
  perform pg_temp.exigir(current_setting('prodio.limpar_mesmo_assim', true) is distinct from 'sim', 'sem confirmação nenhuma');
end $$;
select auth.test_login('00000000-0000-0000-0000-0000000017ff', 'service_role');
do $$ begin
  perform pg_temp.exigir(public.worker_get_credentials('0d000000-0000-0000-0000-000000000001', 'chave-17') ->> 'token' = 'segredo-real', 'a credencial deveria continuar decifrável');
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- 2. De novo: não quebra e não apaga nada.
-- ---------------------------------------------------------------------------
do $$
declare r jsonb := pg_temp.limpar(); l jsonb;
begin
  for l in select x from jsonb_array_elements(r) x loop
    perform pg_temp.exigir((l ->> 1)::int = 0, 'a segunda vez apagou ' || l::text);
  end loop;
  perform pg_temp.exigir(pg_temp.conta('orders') = 2 and pg_temp.conta('products') = 1 and pg_temp.conta('connector_credentials') = 1, 'a segunda vez mudou algo');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Importação do ES liberada: simula (conta os itens religados sem gravar), grava (religa por SKU e por
--    apelido, como o robô), reimporta (0 religados). Rodar a limpeza depois não apaga o catálogo importado.
-- ---------------------------------------------------------------------------
select set_config('test.payload', '{"versao": 1, "origem": "es", "produtos": [
  {"sku": "ED000001", "nome": "Mouse Pad Desk Pad 90x40 Preto", "atributos": {}, "status": "ativo", "apelidos": []},
  {"sku": "TM000076", "nome": "Espelho Redondo Adnet 40cm Preto", "atributos": {}, "status": "ativo", "apelidos": ["ED000130"]}]}', false);
select auth.test_login('22222222-2222-2222-2222-222222222222');
do $$
declare t uuid := '11111111-1111-1111-1111-111111111111'; p jsonb := current_setting('test.payload')::jsonb; r jsonb;
begin
  r := public.import_catalog(t, p, true);
  if r -> 'exemplo' <> '{"produtos": 0, "insumos": 0, "fornecedores": 0}' or r -> 'uso_real' <> '{"conectores_ligados": 1, "pedidos_reais": 2}'
     or r -> 'itens_pedido_religados' <> '2' then raise exception 'simulação depois da limpeza: %', r - 'linhas'; end if;
  if exists (select 1 from public.order_items where tenant_id = t and product_id is not null) then raise exception 'a simulação religou de verdade'; end if;
  r := public.import_catalog(t, p, false);
  if r -> 'itens_pedido_religados' <> '2' then raise exception 'gravação: %', r - 'linhas'; end if;
  if (select p.sku from public.order_items i join public.products p on p.id = i.product_id where i.tenant_id = t and i.sku_externo = 'ED000001') <> 'ED000001'
     or (select p.sku from public.order_items i join public.products p on p.id = i.product_id where i.tenant_id = t and i.sku_externo = 'ED000130') <> 'TM000076'
     or (select product_id from public.order_items where tenant_id = t and sku_externo = 'ED999999') is not null then
    raise exception 'religação por SKU e por apelido';
  end if;
  if public.import_catalog(t, p, false) -> 'itens_pedido_religados' <> '0' then raise exception 'reimportar deveria religar 0'; end if;
end $$;
select auth.test_logout();
do $$
declare r jsonb := pg_temp.limpar();
begin
  perform pg_temp.exigir(pg_temp.conta('products') = 3 and pg_temp.conta('sku_aliases') = 1 and pg_temp.conta('order_items', 'product_id is not null') = 2
    and pg_temp.linha(r, 'produtos') = '["produtos", 0, 3]', 'depois da importação, a limpeza não deveria apagar nada: ' || r::text);
end $$;

rollback to savepoint antes_da_limpeza;

-- ---------------------------------------------------------------------------
-- 4. Trava: cada sinal de dado que não é do exemplo ligado ao exemplo para tudo, sem apagar nada.
-- ---------------------------------------------------------------------------
do $$
declare sinal record;
begin
  for sinal in select * from (values
    ('OCs fora do exemplo', 'insert into public.purchase_orders (id, tenant_id, numero, supplier_id, location_id) values (''17000000-0000-0000-0000-0000000000c1'', ''11111111-1111-1111-1111-111111111111'', 5001, ''17000000-0000-0000-0000-000000000021'', ''aaaaaaaa-0000-0000-0000-000000000001''); insert into public.purchase_order_items (tenant_id, purchase_order_id, material_id, qtd) values (''11111111-1111-1111-1111-111111111111'', ''17000000-0000-0000-0000-0000000000c1'', ''b0000000-0000-0000-0000-000000000001'', 1)'),
    ('NF-e fora do exemplo', 'insert into public.nfe_inbound (tenant_id, chave, supplier_id) values (''11111111-1111-1111-1111-111111111111'', ''35260912345678000190550010000999991000999991'', ''c0000000-0000-0000-0000-000000000001'')'),
    ('recebimentos fora do exemplo', 'insert into public.receipts (id, tenant_id, location_id, idempotency_key) values (''17000000-0000-0000-0000-0000000000f1'', ''11111111-1111-1111-1111-111111111111'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''manual:real''); insert into public.receipt_items (tenant_id, receipt_id, material_id, qtd_consumo) values (''11111111-1111-1111-1111-111111111111'', ''17000000-0000-0000-0000-0000000000f1'', ''b0000000-0000-0000-0000-000000000001'', 1)'),
    ('movimentos de insumo do exemplo lançados à mão', 'insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, idempotency_key) values (''11111111-1111-1111-1111-111111111111'', ''b0000000-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''ajuste'', -1, ''manual:contagem-real'')'),
    ('movimentos de insumo fora do exemplo feitos por bipe', 'insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, ref_type, ref_id, idempotency_key) select ''11111111-1111-1111-1111-111111111111'', ''17000000-0000-0000-0000-000000000011'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''baixa_producao'', -1, ''scan_event'', min(id::text)::uuid, ''scan:teste:real'' from public.scan_events where product_id = ''a0000000-0000-0000-0000-000000000005'''),
    ('fichas de produto fora do exemplo', 'insert into public.bom_versions (id, tenant_id, product_id, versao, ativa) values (''17000000-0000-0000-0000-0000000000d1'', ''11111111-1111-1111-1111-111111111111'', ''17000000-0000-0000-0000-000000000001'', 1, true); insert into public.bom_lines (tenant_id, bom_version_id, ordem, tipo, material_id, consumo, unidade) values (''11111111-1111-1111-1111-111111111111'', ''17000000-0000-0000-0000-0000000000d1'', 1, ''insumo'', ''b0000000-0000-0000-0000-000000000001'', 1, ''m2'')'),
    -- De-Para de SKU feito na tela do conector (vincularSkuExterno) num produto do exemplo: o SKU do pedido real que
    -- não casava; e um apelido do seed repontado para outro produto. O seed só cria os cinco pares de seed.sql.
    ('De-Para de SKU feito fora do exemplo', 'insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (''11111111-1111-1111-1111-111111111111'', ''a0000000-0000-0000-0000-000000000005'', ''MLB-REAL-1'')'),
    ('De-Para de SKU feito fora do exemplo', 'update public.sku_aliases set product_id = ''a0000000-0000-0000-0000-000000000005'' where tenant_id = ''11111111-1111-1111-1111-111111111111'' and sku_externo = ''ED000130''')
  ) s(nome, comando) loop
    begin
      execute sinal.comando;
      begin
        perform pg_temp.limpar();
        raise exception 'a trava não parou o script com %', sinal.nome;
      exception when raise_exception then
        if sqlerrm not like '%ligados ao exemplo%' || sinal.nome || '%nada foi apagado%' then raise exception 'mensagem da trava (%): %', sinal.nome, sqlerrm; end if;
      end;
      perform pg_temp.exigir(pg_temp.conta('products') = 12 and pg_temp.conta('materials') = 14 and pg_temp.conta('orders', 'external_id like ''seed:%''') = 14,
        'a trava deixou apagar (' || sinal.nome || ')');
      raise exception using errcode = 'PRD02'; -- desfaz o sinal antes do próximo
    exception when sqlstate 'PRD02' then null;
    end;
  end loop;
  -- A trava do De-Para lista o que sairia, para o fundador refazer depois da importação.
  begin
    insert into public.sku_aliases (tenant_id, product_id, sku_externo) values ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'MLB-REAL-1');
    begin
      perform pg_temp.limpar();
      raise exception 'a trava não parou o script com o De-Para';
    exception when raise_exception then
      if sqlerrm not like '%MLB-REAL-1 → ED000001%' then raise exception 'a trava deveria listar o De-Para: %', sqlerrm; end if;
    end;
    raise exception using errcode = 'PRD02';
  exception when sqlstate 'PRD02' then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Erro no meio do DELETE do ledger: a limpeza inteira volta e o gatilho append-only continua ligado.
-- ---------------------------------------------------------------------------
create function public.teste17_falha() returns trigger language plpgsql as $$ begin raise exception 'falha simulada no ledger'; end $$;
create trigger teste17_falha before delete on public.stock_moves for each row execute function public.teste17_falha();
do $$ begin
  begin
    perform pg_temp.limpar();
    raise exception 'deveria ter falhado';
  exception when raise_exception then
    if sqlerrm <> 'falha simulada no ledger' then raise; end if;
  end;
  perform pg_temp.exigir(pg_temp.conta('products') = 12 and pg_temp.conta('orders') = 16 and pg_temp.conta('stock_moves', 'material_id::text like ''b0%''') > 0,
    'erro no meio não pode deixar nada apagado');
  perform pg_temp.exigir((select tgenabled = 'O' from pg_trigger where tgname = 'stock_moves_append_only'), 'o gatilho do ledger deveria continuar ligado');
end $$;
drop trigger teste17_falha on public.stock_moves;
drop function public.teste17_falha();

-- ---------------------------------------------------------------------------
-- 6. Confirmação: passa por cima da trava, apaga o exemplo, poupa o que é real e vale para uma execução só.
-- ---------------------------------------------------------------------------
insert into public.purchase_orders (id, tenant_id, numero, supplier_id, location_id) values
  ('17000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 5001, 'c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('17000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 5002, '17000000-0000-0000-0000-000000000021', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.purchase_order_items (tenant_id, purchase_order_id, material_id, qtd) values
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-0000000000c2', 'b0000000-0000-0000-0000-000000000001', 1),
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-0000000000c2', '17000000-0000-0000-0000-000000000011', 2);
insert into public.nfe_inbound (id, tenant_id, chave, supplier_id) values
  ('17000000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111', '35260912345678000190550010000999991000999991', 'c0000000-0000-0000-0000-000000000001');
insert into public.nfe_inbound_items (tenant_id, nfe_id, n_item, material_id) values
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-0000000000e1', 1, 'b0000000-0000-0000-0000-000000000001');
insert into public.bom_versions (id, tenant_id, product_id, versao, ativa) values
  ('17000000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-000000000001', 1, true);
insert into public.bom_lines (tenant_id, bom_version_id, ordem, tipo, material_id, component_product_id, consumo, unidade) values
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-0000000000d1', 1, 'insumo', 'b0000000-0000-0000-0000-000000000001', null, 1, 'm2'),
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-0000000000d1', 2, 'produto', null, 'a0000000-0000-0000-0000-000000000005', 1, 'un'),
  ('11111111-1111-1111-1111-111111111111', '17000000-0000-0000-0000-0000000000d1', 3, 'insumo', '17000000-0000-0000-0000-000000000011', null, 2, 'un');
insert into public.sku_aliases (tenant_id, product_id, sku_externo) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 'MLB-REAL-1');
set local prodio.limpar_mesmo_assim = 'sim';
do $$
declare r jsonb := pg_temp.limpar();
begin
  perform pg_temp.exigir(pg_temp.conta('products', 'id::text like ''a0%''') + pg_temp.conta('materials', 'id::text like ''b0%''') = 0, 'com a confirmação, o exemplo sai');
  perform pg_temp.exigir(pg_temp.conta('sku_aliases') = 0 and exists (select 1 from jsonb_array_elements(r) l where l ->> 0 like '%MLB-REAL-1 → ED000001%' and l ->> 1 = '1'),
    'o De-Para feito fora do exemplo sai com o produto e aparece no resultado, para ser refeito: ' || r::text);
  perform pg_temp.exigir(pg_temp.conta('purchase_orders') = 1 and pg_temp.conta('purchase_order_items') = 1
    and pg_temp.conta('purchase_order_items', 'material_id = ''17000000-0000-0000-0000-000000000011''') = 1,
    'a OC do fornecedor do exemplo sai; a OC real fica sem o item do exemplo');
  perform pg_temp.exigir((select supplier_id is null from public.nfe_inbound where id = '17000000-0000-0000-0000-0000000000e1')
    and (select material_id is null from public.nfe_inbound_items where nfe_id = '17000000-0000-0000-0000-0000000000e1'), 'a NF-e real fica, sem o vínculo com o exemplo');
  perform pg_temp.exigir(pg_temp.conta('bom_lines', 'bom_version_id = ''17000000-0000-0000-0000-0000000000d1''') = 1, 'a ficha real perde só as linhas do exemplo');
  perform pg_temp.exigir(pg_temp.conta('connectors') = 5 and pg_temp.conta('orders') = 2 and pg_temp.conta('connector_credentials') = 1, 'a integração fica');
  perform pg_temp.exigir(current_setting('prodio.limpar_mesmo_assim', true) = '', 'a confirmação vale para uma execução só');
end $$;

rollback;
