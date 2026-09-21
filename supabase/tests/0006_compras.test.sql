-- Testes de compras e NF-e: numeração de OC por tenant, isolamento, upsert_nfe_inbound idempotente com De-Para sugerido,
-- receive_nfe (custo com rateio de frete, OC parcial → recebida, segunda chamada não duplica), receive_manual, service_role.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000004a', 'ana4@a.com'),
  ('00000000-0000-0000-0000-00000000004b', 'bento4@b.com'),
  ('00000000-0000-0000-0000-00000000004c', 'carla4@a.com'),
  ('00000000-0000-0000-0000-00000000004e', 'worker4@x.com');

select auth.test_login('00000000-0000-0000-0000-00000000004a');
select public.create_tenant('Fábrica A', 'fabrica-a4', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000004b');
select public.create_tenant('Fábrica B', 'fabrica-b4', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
insert into public.memberships (tenant_id, user_id, role, accepted_at) values (:'tenant_a', '00000000-0000-0000-0000-00000000004c', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000004a', '00000000-0000-0000-0000-00000000004c');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000004b';

-- ---------------------------------------------------------------------------
-- Cadastro base de A: local, unidades, fornecedor, insumos (MP01 un→m2 fator 5; MP02 un→un), De-Para de MP02.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000004a');
insert into public.locations (id, tenant_id, nome) values ('40000000-0000-0000-0000-000000000004', :'tenant_a', 'Galpão');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_a', 'un', 'Unidade', 'unidade'), (:'tenant_a', 'm2', 'Metro quadrado', 'area');
insert into public.suppliers (id, tenant_id, nome, cnpj, regime, condicao_pagamento) values ('10000000-0000-0000-0000-000000000004', :'tenant_a', 'Vidros', '12345678000190', 'normal', '{28,42}');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo, fator_conversao, minimo, fornecedor_padrao_id) values
  ('20000000-0000-0000-0000-000000000041', :'tenant_a', 'MP01', 'Chapa', 'un', 'm2', 5, 10, '10000000-0000-0000-0000-000000000004'),
  ('20000000-0000-0000-0000-000000000042', :'tenant_a', 'MP02', 'Disco MDF', 'un', 'un', 1, 100, '10000000-0000-0000-0000-000000000004');
insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor, fator) values (:'tenant_a', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000042', 'MDF370', 1);

-- OC 1 (MP01 20 un @ 100 + IPI 10%; MP02 100 un @ 0.5) e OC 2. Numeração sequencial por tenant.
select public.create_purchase_order(:'tenant_a', '10000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', current_date + 7, '{28,42}',
  '[{"material_id":"20000000-0000-0000-0000-000000000041","unidade_compra":"un","fator":5,"qtd":20,"preco":100,"ipi_pct":0.1},
    {"material_id":"20000000-0000-0000-0000-000000000042","qtd":100,"preco":0.5}]', 'primeira') as po1 \gset
select public.create_purchase_order(:'tenant_a', '10000000-0000-0000-0000-000000000004', null, null, '{0}',
  '[{"material_id":"20000000-0000-0000-0000-000000000042","qtd":10,"preco":0.5}]', null) as po2 \gset
select set_config('test.po1', :'po1', false), set_config('test.po2', :'po2', false);
do $$
declare v record;
begin
  select * into v from public.v_purchase_orders where id = current_setting('test.po1')::uuid;
  if v.numero <> 1 then raise exception 'primeira OC deveria ser 1, veio %', v.numero; end if;
  if v.total <> 2250 or v.fornecedor <> 'Vidros' or v.recebido_pct <> 0 or v.status <> 'aberta' or v.itens <> 2 then raise exception 'v_purchase_orders inesperada: %', v; end if;
  if (select numero from public.purchase_orders where id = current_setting('test.po2')::uuid) <> 2 then raise exception 'segunda OC deveria ser 2'; end if;
  if (select location_id from public.purchase_orders where id = current_setting('test.po2')::uuid) <> '40000000-0000-0000-0000-000000000004' then raise exception 'OC sem local deveria usar o local padrão'; end if;
  if (select fator from public.purchase_order_items where purchase_order_id = current_setting('test.po2')::uuid) <> 1 then raise exception 'fator deveria vir do insumo'; end if;
  -- cabeçalho editável direto; status não
  update public.purchase_orders set observacao = 'editada' where id = current_setting('test.po2')::uuid;
  if (select observacao from public.purchase_orders where id = current_setting('test.po2')::uuid) <> 'editada' then raise exception 'cabeçalho deveria ser editável'; end if;
  begin
    update public.purchase_orders set status = 'recebida' where id = current_setting('test.po2')::uuid;
    raise exception 'status direto deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.purchase_order_items (tenant_id, purchase_order_id, material_id, qtd) values (current_setting('test.tenant_a')::uuid, current_setting('test.po2')::uuid, '20000000-0000-0000-0000-000000000042', 1);
    raise exception 'insert direto de item deveria falhar';
  exception when insufficient_privilege then null; end;
  perform public.update_purchase_order_status(current_setting('test.tenant_a')::uuid, current_setting('test.po2')::uuid, 'cancelada');
  if (select status from public.purchase_orders where id = current_setting('test.po2')::uuid) <> 'cancelada' then raise exception 'OC 2 deveria estar cancelada'; end if;
  begin
    perform public.create_purchase_order(current_setting('test.tenant_a')::uuid, '10000000-0000-0000-0000-000000000004', null, null, '{0}', '[]', null);
    raise exception 'OC sem itens deveria falhar';
  exception when invalid_parameter_value then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- NF-e: upsert idempotente, De-Para sugerido para MDF370, vínculo com a OC 1.
-- ---------------------------------------------------------------------------
select set_config('test.chave1', '35260912345678000190550010000000011000000015', false), set_config('test.chave2', '35260912345678000190550010000000021000000024', false);
do $$
declare v_id uuid; v_id2 uuid; it record;
begin
  v_id := public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid,
    jsonb_build_object('chave', current_setting('test.chave1'), 'numero', 1, 'serie', 1, 'cnpj_emitente', '12.345.678/0001-90', 'emitente', 'VIDROS LTDA', 'emissao', current_date,
                       'valor_total', 1050, 'valor_frete', 50, 'origem', 'upload', 'status', 'pendente', 'po_ids', jsonb_build_array(current_setting('test.po1'))),
    '[{"n_item":1,"c_prod":"CH3MM","x_prod":"CHAPA 3MM","cfop":"5102","u_com":"PC","q_com":10,"v_un_com":90,"v_prod":900},
      {"n_item":2,"c_prod":"MDF370","x_prod":"DISCO MDF","cfop":"5102","u_com":"UN","q_com":100,"v_un_com":1,"v_prod":100}]');
  perform set_config('test.nfe1', v_id::text, false);
  if (select supplier_id from public.nfe_inbound where id = v_id) <> '10000000-0000-0000-0000-000000000004' then raise exception 'fornecedor deveria ser resolvido pelo CNPJ'; end if;
  select * into it from public.nfe_inbound_items where nfe_id = v_id and n_item = 2;
  if it.material_id <> '20000000-0000-0000-0000-000000000042' or it.fator <> 1 or it.qtd_consumo <> 100 then raise exception 'De-Para de MDF370 deveria ser sugerido: %', it; end if;
  if (select material_id from public.nfe_inbound_items where nfe_id = v_id and n_item = 1) is not null then raise exception 'CH3MM não tem De-Para ainda'; end if;
  if (select count(*) from public.nfe_po_links where nfe_id = v_id) <> 1 then raise exception 'vínculo com a OC deveria existir'; end if;
  -- segunda chamada: mesmo id, sem duplicar itens; De-Para informado pelo cliente entra
  v_id2 := public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid, jsonb_build_object('chave', current_setting('test.chave1'), 'valor_frete', 50),
    '[{"n_item":1,"c_prod":"CH3MM","q_com":10,"v_un_com":90,"v_prod":900,"material_id":"20000000-0000-0000-0000-000000000041","fator":5,"qtd_consumo":50}]');
  if v_id2 <> v_id then raise exception 'upsert deveria devolver o mesmo id'; end if;
  if (select count(*) from public.nfe_inbound_items where nfe_id = v_id) <> 2 then raise exception 'itens não podem duplicar'; end if;
  if (select emitente from public.nfe_inbound where id = v_id) <> 'VIDROS LTDA' then raise exception 'campos ausentes no segundo upsert devem ser mantidos'; end if;
  if (select qtd_consumo from public.nfe_inbound_items where nfe_id = v_id and n_item = 1) <> 50 then raise exception 'De-Para do cliente deveria ser gravado'; end if;
  begin
    perform public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid, '{"chave":"123"}', '[]');
    raise exception 'chave inválida deveria falhar';
  exception when invalid_parameter_value then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Recebimento: custo = (v_prod + rateio do frete) / qtd_consumo. Frete 50 rateado por v_prod (900/100).
-- item 1: (900 + 45) / 50 m2 = 18.9; item 2: (100 + 5) / 100 = 1.05. OC 1 fica parcial (MP01 10 de 20).
-- ---------------------------------------------------------------------------
do $$
declare v_nfe uuid := current_setting('test.nfe1')::uuid; v_t uuid := current_setting('test.tenant_a')::uuid; v_rc uuid; v_rc2 uuid; v_itens jsonb; b record;
begin
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'material_id', i.material_id, 'fator', i.fator, 'qtd_consumo', i.qtd_consumo,
           'purchase_order_item_id', (select p.id from public.purchase_order_items p where p.purchase_order_id = current_setting('test.po1')::uuid and p.material_id = i.material_id), 'divergente', false))
    into v_itens from public.nfe_inbound_items i where i.nfe_id = v_nfe;
  v_rc := public.receive_nfe(v_t, v_nfe, '40000000-0000-0000-0000-000000000004', v_itens, 'nfe:' || current_setting('test.chave1') || ':1');
  perform set_config('test.rc1', v_rc::text, false);
  if (select delta from public.stock_moves where idempotency_key = 'nfe:' || current_setting('test.chave1') || ':1') <> 50 then raise exception 'entrada de MP01 deveria ser 50 m2'; end if;
  if (select custo_unit from public.stock_moves where idempotency_key = 'nfe:' || current_setting('test.chave1') || ':1') <> 18.9 then raise exception 'custo de MP01 deveria ser 18.9 (com rateio de frete)'; end if;
  if (select custo_unit from public.stock_moves where idempotency_key = 'nfe:' || current_setting('test.chave1') || ':2') <> 1.05 then raise exception 'custo de MP02 deveria ser 1.05'; end if;
  if (select move_type from public.stock_moves where idempotency_key = 'nfe:' || current_setting('test.chave1') || ':2') <> 'entrada_nfe' then raise exception 'tipo deveria ser entrada_nfe'; end if;
  select * into b from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000041';
  if b.saldo <> 50 or b.custo_medio <> 18.9 then raise exception 'saldo de MP01 esperado 50 @ 18.9, veio % @ %', b.saldo, b.custo_medio; end if;
  if (select qtd_recebida from public.purchase_order_items where purchase_order_id = current_setting('test.po1')::uuid and material_id = '20000000-0000-0000-0000-000000000041') <> 10 then raise exception 'OC deveria ter 10 un de MP01 recebidas'; end if;
  if (select status from public.purchase_orders where id = current_setting('test.po1')::uuid) <> 'parcial' then raise exception 'OC 1 deveria estar parcial'; end if;
  if (select recebido_pct from public.v_purchase_orders where id = current_setting('test.po1')::uuid) <> round(110.0 / 120, 5) then raise exception 'recebido_pct inesperado'; end if;
  if (select status from public.nfe_inbound where id = v_nfe) <> 'recebida' then raise exception 'nota deveria estar recebida'; end if;
  if (select count(*) from public.receipt_items where receipt_id = v_rc) <> 2 then raise exception 'recibo deveria ter 2 itens'; end if;
  if not exists (select 1 from public.supplier_materials where supplier_id = '10000000-0000-0000-0000-000000000004' and material_id = '20000000-0000-0000-0000-000000000041' and codigo_fornecedor = 'CH3MM' and fator = 5) then
    raise exception 'De-Para de CH3MM deveria ter sido aprendido';
  end if;
  -- segunda chamada: devolve o mesmo recibo, sem novos movimentos nem saldo dobrado
  v_rc2 := public.receive_nfe(v_t, v_nfe, '40000000-0000-0000-0000-000000000004', v_itens, 'outra-chave');
  if v_rc2 <> v_rc then raise exception 'nota já recebida deveria devolver o mesmo recibo'; end if;
  if (select count(*) from public.stock_moves where move_type = 'entrada_nfe') <> 2 then raise exception 'segunda chamada não pode duplicar movimentos'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000041') <> 50 then raise exception 'saldo não pode dobrar'; end if;
  -- OC com recebimento não cancela
  begin
    perform public.update_purchase_order_status(v_t, current_setting('test.po1')::uuid, 'cancelada');
    raise exception 'OC com recebimento não deveria cancelar';
  exception when invalid_parameter_value then null; end;
  -- upsert de nota recebida não mexe em nada
  perform public.upsert_nfe_inbound(v_t, jsonb_build_object('chave', current_setting('test.chave1'), 'status', 'pendente'), '[]');
  if (select status from public.nfe_inbound where id = v_nfe) <> 'recebida' then raise exception 'nota recebida não pode voltar a pendente'; end if;
end $$;

-- Segunda nota completa a OC 1 (mais 10 un de MP01, sem frete) → recebida.
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_nfe uuid; v_itens jsonb;
begin
  v_nfe := public.upsert_nfe_inbound(v_t, jsonb_build_object('chave', current_setting('test.chave2'), 'numero', 2, 'serie', 1, 'cnpj_emitente', '12345678000190', 'emitente', 'VIDROS LTDA', 'valor_total', 900),
    '[{"n_item":1,"c_prod":"CH3MM","q_com":10,"v_un_com":90,"v_prod":900}]');
  -- De-Para aprendido na primeira nota já sugere MP01 com fator 5
  if (select qtd_consumo from public.nfe_inbound_items where nfe_id = v_nfe) <> 50 then raise exception 'De-Para aprendido deveria sugerir 50 m2'; end if;
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'material_id', i.material_id, 'fator', i.fator, 'qtd_consumo', i.qtd_consumo,
           'purchase_order_item_id', (select p.id from public.purchase_order_items p where p.purchase_order_id = current_setting('test.po1')::uuid and p.material_id = i.material_id)))
    into v_itens from public.nfe_inbound_items i where i.nfe_id = v_nfe;
  perform public.receive_nfe(v_t, v_nfe, '40000000-0000-0000-0000-000000000004', v_itens, null);
  if (select status from public.purchase_orders where id = current_setting('test.po1')::uuid) <> 'recebida' then raise exception 'OC 1 deveria estar recebida'; end if;
  if (select count(*) from public.nfe_po_links where nfe_id = v_nfe) <> 1 then raise exception 'vínculo deveria nascer do item da OC'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000041') <> 100 then raise exception 'saldo de MP01 deveria ser 100'; end if;
  if (select custo_medio from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000041') <> 18.45 then raise exception 'custo médio deveria ser (50×18.9 + 50×18)/100 = 18.45'; end if;
end $$;

-- Recebimento manual (sem XML): OC 3 de 10 un de MP02, recebe 4 → parcial; idempotente.
select public.create_purchase_order(:'tenant_a', '10000000-0000-0000-0000-000000000004', null, null, '{0}', '[{"material_id":"20000000-0000-0000-0000-000000000042","qtd":10,"preco":2}]', null) as po3 \gset
select set_config('test.po3', :'po3', false);
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_poi uuid; v_rc uuid;
begin
  select id into v_poi from public.purchase_order_items where purchase_order_id = current_setting('test.po3')::uuid;
  v_rc := public.receive_manual(v_t, current_setting('test.po3')::uuid, '40000000-0000-0000-0000-000000000004', jsonb_build_array(jsonb_build_object('purchase_order_item_id', v_poi, 'qtd_compra', 4)), 'man:1');
  if v_rc <> public.receive_manual(v_t, current_setting('test.po3')::uuid, '40000000-0000-0000-0000-000000000004', jsonb_build_array(jsonb_build_object('purchase_order_item_id', v_poi, 'qtd_compra', 4)), 'man:1') then
    raise exception 'receive_manual deveria ser idempotente';
  end if;
  if (select qtd_recebida from public.purchase_order_items where id = v_poi) <> 4 then raise exception 'deveria ter 4 recebidos'; end if;
  if (select status from public.purchase_orders where id = current_setting('test.po3')::uuid) <> 'parcial' then raise exception 'OC 3 deveria estar parcial'; end if;
  if (select delta from public.stock_moves where idempotency_key = 'rcpt:' || v_rc || ':' || v_poi) <> 4 then raise exception 'entrada manual deveria ser 4'; end if;
  if (select custo_unit from public.stock_moves where idempotency_key = 'rcpt:' || v_rc || ':' || v_poi) <> 2 then raise exception 'custo manual deveria ser preco/fator = 2'; end if;
end $$;
select auth.test_logout();

-- Leitura não cria OC.
select auth.test_login('00000000-0000-0000-0000-00000000004c');
do $$ begin
  begin
    perform public.create_purchase_order(current_setting('test.tenant_a')::uuid, '10000000-0000-0000-0000-000000000004', null, null, '{0}', '[{"material_id":"20000000-0000-0000-0000-000000000042","qtd":1}]', null);
    raise exception 'leitura não deveria criar OC';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

-- Worker (service_role, sem membership) grava nota por e-mail para o tenant A.
select auth.test_login('00000000-0000-0000-0000-00000000004e', 'service_role');
do $$
declare v_id uuid;
begin
  v_id := public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid, '{"chave":"35260912345678000190550010000000031000000033","numero":3,"serie":1,"cnpj_emitente":"12345678000190","emitente":"VIDROS","origem":"email","status":"pendente","valor_total":10}', '[{"n_item":1,"c_prod":"MDF370","q_com":10,"v_prod":10}]');
  if v_id is null then raise exception 'worker deveria gravar a nota'; end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Tenant B: numeração própria começa em 1; não vê nem escreve nada de A.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000004b');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_b', 'un', 'Unidade', 'unidade');
insert into public.suppliers (id, tenant_id, nome, cnpj) values ('10000000-0000-0000-0000-00000000004b', :'tenant_b', 'Forn B', '99999999000199');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo) values ('20000000-0000-0000-0000-00000000004b', :'tenant_b', 'MPB', 'Insumo B', 'un', 'un');
insert into public.locations (tenant_id, nome) values (:'tenant_b', 'Galpão B');
do $$
declare t text; n bigint; v_po uuid;
begin
  v_po := public.create_purchase_order(current_setting('test.tenant_b')::uuid, '10000000-0000-0000-0000-00000000004b', null, null, '{0}', '[{"material_id":"20000000-0000-0000-0000-00000000004b","qtd":5,"preco":1}]', null);
  if (select numero from public.purchase_orders where id = v_po) <> 1 then raise exception 'tenant B deveria começar em 1'; end if;
  if (select count(*) from public.purchase_orders) <> 1 then raise exception 'tenant B deveria ver só a própria OC'; end if;
  foreach t in array array['purchase_orders', 'purchase_order_items', 'nfe_inbound', 'nfe_inbound_items', 'nfe_po_links', 'receipts', 'receipt_items', 'v_purchase_orders'] loop
    execute format('select count(*) from public.%I where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid into n;
    if n <> 0 then raise exception 'tenant B não deveria ver % linhas de %', n, t; end if;
  end loop;
  begin
    perform public.create_purchase_order(current_setting('test.tenant_a')::uuid, '10000000-0000-0000-0000-000000000004', null, null, '{0}', '[{"material_id":"20000000-0000-0000-0000-000000000042","qtd":1}]', null);
    raise exception 'create_purchase_order cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid, jsonb_build_object('chave', current_setting('test.chave2')), '[]');
    raise exception 'upsert_nfe_inbound cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.receive_nfe(current_setting('test.tenant_a')::uuid, current_setting('test.nfe1')::uuid, '40000000-0000-0000-0000-000000000004', '[]', null);
    raise exception 'receive_nfe cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.update_purchase_order_status(current_setting('test.tenant_a')::uuid, current_setting('test.po1')::uuid, 'cancelada');
    raise exception 'update_purchase_order_status cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  -- OC de A não pode ser usada como vínculo pela B (vínculo silenciosamente ignorado; supplier de A não resolve)
  update public.purchase_orders set observacao = 'invasão' where tenant_id = current_setting('test.tenant_a')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'tenant B alterou OC de A'; end if;
end $$;
select auth.test_logout();

rollback;
