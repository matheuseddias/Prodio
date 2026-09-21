-- Segurança · isolamento entre tenants por referência. Reproduz os exploits sec_03 (etiqueta/estoque de A no local
-- de B), sec_03b (membership com local alheio virando local padrão), sec_06 (production_date como oráculo),
-- sec_07 (FKs simples aceitando ids de outro tenant e o worker propagando produto de B) e o upsert_connector por id alheio.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000011a', 'ana11@a.com'),
  ('00000000-0000-0000-0000-00000000011b', 'bento11@b.com'),
  ('00000000-0000-0000-0000-00000000011e', 'worker11@x.com');
select auth.test_login('00000000-0000-0000-0000-00000000011a');
select public.create_tenant('Sec A', 'sec-a11', '11111111000111') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000011b');
select public.create_tenant('Sec B', 'sec-b11', '22222222000122') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000011a';
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000011b';
update public.tenants set exigir_projecao_para_imprimir = false;
-- Cadastro mínimo em A e B (como dono do banco).
insert into public.locations (id, tenant_id, nome) values ('aa000000-0000-0000-0000-000000000001', :'tenant_a', 'Galpão A'), ('bb000000-0000-0000-0000-000000000001', :'tenant_b', 'Galpão B');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_a', 'un', 'Unidade', 'unidade'), (:'tenant_b', 'un', 'Unidade', 'unidade');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo) values
  ('aa000000-0000-0000-0000-000000000002', :'tenant_a', 'MPA', 'Insumo A', 'un', 'un'),
  ('bb000000-0000-0000-0000-000000000002', :'tenant_b', 'MPB', 'Insumo B', 'un', 'un');
insert into public.products (id, tenant_id, sku, nome, familia) values
  ('aa000000-0000-0000-0000-000000000003', :'tenant_a', 'PA', 'Produto A', 'F'),
  ('bb000000-0000-0000-0000-000000000003', :'tenant_b', 'PB', 'Produto B', 'F');
insert into public.suppliers (id, tenant_id, nome, cnpj) values
  ('aa000000-0000-0000-0000-000000000004', :'tenant_a', 'Forn A', '33333333000133'),
  ('bb000000-0000-0000-0000-000000000004', :'tenant_b', 'Forn B', '44444444000144');
insert into public.connectors (id, tenant_id, plataforma, nome, status) values ('bb000000-0000-0000-0000-000000000005', :'tenant_b', 'bling', 'Bling B', 'conectado');

select auth.test_login('00000000-0000-0000-0000-00000000011a');
select public.activate_bom(:'tenant_a', 'aa000000-0000-0000-0000-000000000003', '[{"tipo":"insumo","material_id":"aa000000-0000-0000-0000-000000000002","consumo":1}]');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; r record; v_serial text; v_scan jsonb;
begin
  -- sec_03: etiqueta com local de B
  begin
    perform public.reserve_label_batch(v_t, 'aa000000-0000-0000-0000-000000000003', 1, 'unidade', 'bb000000-0000-0000-0000-000000000001');
    raise exception 'reserve_label_batch deveria recusar local de B';
  exception when invalid_parameter_value then null; end;
  -- sec_03b: membership com local de B (escrita direta pelo admin) é barrada pela FK composta
  begin
    update public.memberships set location_id = 'bb000000-0000-0000-0000-000000000001' where user_id = auth.uid();
    raise exception 'membership com local de B deveria falhar';
  exception when foreign_key_violation then null; end;
  -- OC, movimento e inventário com local de B
  begin
    perform public.create_purchase_order(v_t, 'aa000000-0000-0000-0000-000000000004', 'bb000000-0000-0000-0000-000000000001', null, '{0}', '[{"material_id":"aa000000-0000-0000-0000-000000000002","qtd":1,"preco":1}]');
    raise exception 'OC com local de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.post_stock_move(v_t, 'aa000000-0000-0000-0000-000000000002', 'bb000000-0000-0000-0000-000000000001', 'entrada_manual', 1, 1);
    raise exception 'movimento em local de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.open_inventory_session(v_t, 'bb000000-0000-0000-0000-000000000001', null);
    raise exception 'inventário em local de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- sem local informado, a etiqueta nasce no local de A e o bipe baixa em A
  select * into r from public.reserve_label_batch(v_t, 'aa000000-0000-0000-0000-000000000003', 1) limit 1;
  if (select location_id from public.labels where id = r.label_id) <> 'aa000000-0000-0000-0000-000000000001' then raise exception 'etiqueta deveria nascer no local de A'; end if;
  v_scan := public.register_scan(v_t, r.serial, 'sec11-1', 'final');
  if not (v_scan ->> 'ok')::boolean then raise exception 'bipe deveria funcionar: %', v_scan; end if;
  if exists (select 1 from public.stock_balances where tenant_id = v_t and location_id <> 'aa000000-0000-0000-0000-000000000001') then raise exception 'saldo de A fora do local de A'; end if;

  -- sec_07: FKs cruzadas em escrita direta. O erro é o mesmo de um uuid inexistente (sem oráculo).
  begin
    insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (v_t, 'bb000000-0000-0000-0000-000000000003', 'ALIAS-PARA-PRODUTO-DE-B');
    raise exception 'alias para produto de B deveria falhar';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (v_t, gen_random_uuid(), 'nao-existe');
    raise exception 'alias para uuid inexistente deveria falhar';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor) values (v_t, 'bb000000-0000-0000-0000-000000000004', 'bb000000-0000-0000-0000-000000000002', 'X');
    raise exception 'De-Para com fornecedor/insumo de B deveria falhar';
  exception when foreign_key_violation then null; end;
  begin
    update public.materials set fornecedor_padrao_id = 'bb000000-0000-0000-0000-000000000004' where id = 'aa000000-0000-0000-0000-000000000002';
    raise exception 'fornecedor padrão de B deveria falhar';
  exception when foreign_key_violation then null; end;
  begin
    perform public.activate_bom(v_t, 'aa000000-0000-0000-0000-000000000003', '[{"tipo":"insumo","material_id":"bb000000-0000-0000-0000-000000000002","consumo":1}]');
    raise exception 'ficha com insumo de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.upsert_connector(v_t, 'bb000000-0000-0000-0000-000000000005', 'bling', 'Sequestro', '{}');
    raise exception 'upsert_connector com id de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- referências legítimas continuam funcionando
  insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (v_t, 'aa000000-0000-0000-0000-000000000003', 'ALIAS-PA');
  insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor) values (v_t, 'aa000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000002', 'X');
  update public.materials set fornecedor_padrao_id = 'aa000000-0000-0000-0000-000000000004' where id = 'aa000000-0000-0000-0000-000000000002';
end $$;
select public.upsert_connector(:'tenant_a', null, 'bling', 'Bling A', '{"status":"conectado"}') as conn_a \gset
select auth.test_logout();
select set_config('test.conn_a', :'conn_a', false);

-- Conector de B ficou intocado; local de B continua livre (B pode apagá-lo).
do $$ begin
  if (select nome from public.connectors where id = 'bb000000-0000-0000-0000-000000000005') <> 'Bling B' then raise exception 'conector de B foi alterado'; end if;
end $$;
select auth.test_login('00000000-0000-0000-0000-00000000011b');
do $$ begin
  delete from public.locations where id = 'bb000000-0000-0000-0000-000000000001';
  if not found then raise exception 'B deveria conseguir apagar o próprio local'; end if;
  -- sec_06: production_date de outro tenant e de tenant inexistente devolvem o mesmo (null): sem oráculo
  if public.production_date(current_setting('test.tenant_a')::uuid, now()) is not null then raise exception 'production_date vazou tenant A'; end if;
  if public.production_date(gen_random_uuid(), now()) is not null then raise exception 'production_date de tenant inexistente deveria ser null'; end if;
  if public.production_date(current_setting('test.tenant_b')::uuid, now()) is null then raise exception 'membro deveria calcular a própria competência'; end if;
end $$;
select auth.test_logout();

-- Worker: mesmo que um alias apontasse para fora (impossível pela FK), o pedido de A só resolve produto de A.
insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (:'tenant_b', 'bb000000-0000-0000-0000-000000000003', 'ALIAS-B');
select auth.test_login('00000000-0000-0000-0000-00000000011e', 'service_role');
do $$ begin
  perform public.worker_upsert_orders(current_setting('test.tenant_a')::uuid, current_setting('test.conn_a')::uuid,
    '[{"external_id":"1","itens":[{"sku_externo":"ALIAS-B","quantidade":3},{"sku_externo":"ALIAS-PA","quantidade":1}]}]');
  if (select product_id from public.order_items i join public.orders o on o.id = i.order_id where i.sku_externo = 'ALIAS-B') is not null then
    raise exception 'alias de B resolveu produto para pedido de A';
  end if;
  if (select product_id from public.order_items i join public.orders o on o.id = i.order_id where i.sku_externo = 'ALIAS-PA') <> 'aa000000-0000-0000-0000-000000000003' then
    raise exception 'alias de A deveria resolver PA';
  end if;
end $$;
select auth.test_logout();

rollback;
