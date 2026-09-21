-- Segurança · integridade do ledger e do recebimento. Reproduz os exploits sec_08 (chave de idempotência sequestrada),
-- sec_09/sec_09b (status 'recebida' e xml_path gravados pelo upsert; OC recebida sem recebimento), sec_11 (serial com SKU
-- minúsculo) e as suspeitas aceitas: custo negativo e estorno de entrada de recebimento devolvendo a quantidade à OC.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000012a', 'ana12@a.com'),
  ('00000000-0000-0000-0000-00000000012d', null);
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-00000000012d';
select auth.test_login('00000000-0000-0000-0000-00000000012a');
select public.create_tenant('Sec A', 'sec-a12', '11111111000111') as tenant_a \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false);
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000012a';
update public.tenants set exigir_projecao_para_imprimir = false;
insert into public.locations (id, tenant_id, nome) values ('aa000000-0000-0000-0000-000000000001', :'tenant_a', 'Galpão A');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_a', 'un', 'Unidade', 'unidade');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo) values ('aa000000-0000-0000-0000-000000000002', :'tenant_a', 'MPA', 'Insumo A', 'un', 'un');
insert into public.products (id, tenant_id, sku, nome, familia) values ('aa000000-0000-0000-0000-000000000009', :'tenant_a', 'pa-min', 'Minúsculo', 'F');
insert into public.suppliers (id, tenant_id, nome, cnpj) values ('aa000000-0000-0000-0000-000000000004', :'tenant_a', 'Forn A', '33333333000133');
select set_config('test.chave', '35260912345678000190550010000000031000000033', false);

select auth.test_login('00000000-0000-0000-0000-00000000012a');
select device_id, pair_code from public.create_device(:'tenant_a', 'Cel', null) \gset
select public.upsert_nfe_inbound(:'tenant_a', jsonb_build_object('chave', current_setting('test.chave'), 'numero', 3, 'cnpj_emitente', '33333333000133', 'valor_total', 100),
  '[{"n_item":1,"c_prod":"X","q_com":10,"v_prod":100,"material_id":"aa000000-0000-0000-0000-000000000002"}]') as nfe \gset
select set_config('test.nfe', :'nfe', false);
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_nfe uuid := current_setting('test.nfe')::uuid; v_item uuid; v_mv uuid; v_aj uuid; v_bloq uuid; v_rev uuid; v_rc uuid; v_po uuid; v_poi uuid; r record; v_st text;
begin
  select id into v_item from public.nfe_inbound_items where nfe_id = v_nfe;
  -- sec_08: movimento manual com a chave que o recebimento da NF-e usaria fica no namespace manual:
  v_mv := public.post_stock_move(v_t, 'aa000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'entrada_manual', 1, 1, 'sequestro', null, null, 'nfe:' || current_setting('test.chave') || ':1');
  if (select idempotency_key from public.stock_moves where id = v_mv) <> 'manual:nfe:' || current_setting('test.chave') || ':1' then raise exception 'chave do cliente deveria ganhar o prefixo manual:'; end if;
  if v_mv <> public.post_stock_move(v_t, 'aa000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'entrada_manual', 1, 1, 'de novo', null, null, 'nfe:' || current_setting('test.chave') || ':1') then
    raise exception 'idempotência do cliente deveria continuar valendo';
  end if;
  begin
    perform public.post_stock_move(v_t, 'aa000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'entrada_manual', 1, 1, 'falso', 'nfe', v_nfe, null);
    raise exception 'ref_type nfe pelo cliente deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- OC vinculada ao item para conferir o retorno de qtd_recebida no estorno
  v_po := public.create_purchase_order(v_t, 'aa000000-0000-0000-0000-000000000004', null, null, '{0}', '[{"material_id":"aa000000-0000-0000-0000-000000000002","qtd":10,"preco":10}]');
  select id into v_poi from public.purchase_order_items where purchase_order_id = v_po;
  v_rc := public.receive_nfe(v_t, v_nfe, 'aa000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('item_id', v_item, 'purchase_order_item_id', v_poi)), 'nfe:' || current_setting('test.chave') || ':lote1');
  if (select saldo from public.stock_balances where material_id = 'aa000000-0000-0000-0000-000000000002') <> 11 then raise exception 'nota de 10 deveria somar ao 1 manual (11)'; end if;
  if (select stock_move_id from public.receipt_items where receipt_id = v_rc) = v_mv then raise exception 'recibo apontou para o movimento manual'; end if;
  if (select idempotency_key from public.receipts where id = v_rc) <> 'nfe:' || current_setting('test.chave') then raise exception 'chave do recibo deveria ser nfe:<chave>'; end if;
  if (select status from public.purchase_orders where id = v_po) <> 'recebida' then raise exception 'OC deveria estar recebida'; end if;
  -- suspeita 4 aceita: estornar a entrada da NF-e devolve a quantidade à OC e o status volta
  select stock_move_id into v_mv from public.receipt_items where receipt_id = v_rc;
  v_rev := public.reverse_stock_move(v_t, v_mv, 'nota devolvida');
  if (select qtd_recebida from public.purchase_order_items where id = v_poi) <> 0 then raise exception 'estorno deveria devolver a quantidade à OC'; end if;
  if (select status from public.purchase_orders where id = v_po) <> 'aberta' then raise exception 'OC deveria voltar a aberta'; end if;
  if (select saldo from public.stock_balances where material_id = 'aa000000-0000-0000-0000-000000000002') <> 1 then raise exception 'saldo deveria voltar a 1'; end if;
  -- sec_08 (rev:): pré-ocupar 'rev:<id>' não bloqueia nem falsifica o estorno
  v_aj := public.post_stock_move(v_t, 'aa000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'ajuste', 5, 1, 'x', null, null, 'sec:aj');
  v_bloq := public.post_stock_move(v_t, 'aa000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000001', 'ajuste', 1, 1, 'bloqueio', null, null, 'rev:' || v_aj);
  v_rev := public.reverse_stock_move(v_t, v_aj, 'estorno real');
  if v_rev = v_bloq then raise exception 'estorno devolveu o movimento falso'; end if;
  if (select delta from public.stock_moves where id = v_rev) <> -5 or (select reverses_id from public.stock_moves where id = v_rev) <> v_aj then raise exception 'estorno errado'; end if;
  if (select saldo from public.stock_balances where material_id = 'aa000000-0000-0000-0000-000000000002') <> 2 then raise exception 'saldo esperado 1 + 5 + 1 - 5 = 2'; end if;
  if public.reverse_stock_move(v_t, v_aj, 'de novo') <> v_rev then raise exception 'segundo estorno deveria ser idempotente pelo vínculo'; end if;

  -- sec_09: status 'recebida', 'aberta' e xml_path fora da pasta são recusados no upsert; OC não vira recebida na mão
  begin
    perform public.upsert_nfe_inbound(v_t, '{"chave":"35260912345678000190550010000000041000000041","status":"recebida"}', '[]');
    raise exception 'status recebida pelo upsert deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.upsert_nfe_inbound(v_t, jsonb_build_object('chave', '35260912345678000190550010000000041000000041', 'xml_path', '../../outro-tenant/nota.xml'), '[]');
    raise exception 'xml_path fora do tenant deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.upsert_nfe_inbound(v_t, jsonb_build_object('chave', '35260912345678000190550010000000041000000041', 'xml_path', gen_random_uuid() || '/nota.xml'), '[]');
    raise exception 'xml_path de outro tenant deveria falhar';
  exception when invalid_parameter_value then null; end;
  perform public.upsert_nfe_inbound(v_t, jsonb_build_object('chave', '35260912345678000190550010000000041000000041', 'status', 'conferida', 'xml_path', v_t || '/35260912345678000190550010000000041000000041.xml'), '[]');
  if (select status from public.nfe_inbound where chave = '35260912345678000190550010000000041000000041') <> 'conferida' then raise exception 'status conferida deveria gravar'; end if;
  v_po := public.create_purchase_order(v_t, 'aa000000-0000-0000-0000-000000000004', null, null, '{0}', '[{"material_id":"aa000000-0000-0000-0000-000000000002","qtd":5,"preco":1}]');
  foreach v_st in array array['recebida', 'parcial'] loop
    begin
      perform public.update_purchase_order_status(v_t, v_po, v_st);
      raise exception 'status % na mão deveria falhar', v_st;
    exception when invalid_parameter_value then null; end;
  end loop;
  perform public.update_purchase_order_status(v_t, v_po, 'cancelada');
  perform public.update_purchase_order_status(v_t, v_po, 'aberta');
  if (select status from public.purchase_orders where id = v_po) <> 'aberta' then raise exception 'reabrir deveria voltar a aberta'; end if;
  -- custo negativo (desconto maior que o valor) é recusado
  perform public.upsert_nfe_inbound(v_t, '{"chave":"35260912345678000190550010000000051000000058","valor_total":1,"valor_desconto":500}',
    '[{"n_item":1,"q_com":10,"v_prod":100,"material_id":"aa000000-0000-0000-0000-000000000002"}]');
  begin
    perform public.receive_nfe(v_t, (select id from public.nfe_inbound where chave = '35260912345678000190550010000000051000000058'), 'aa000000-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('item_id', (select id from public.nfe_inbound_items where nfe_id = (select id from public.nfe_inbound where chave = '35260912345678000190550010000000051000000058')))));
    raise exception 'custo negativo deveria falhar';
  exception when invalid_parameter_value then null; end;

  -- sec_11: SKU minúsculo gera serial em maiúsculas e o bipe encontra
  select * into r from public.reserve_label_batch(v_t, 'aa000000-0000-0000-0000-000000000009', 1) limit 1;
  if r.serial not like 'ETPA-MIN%' then raise exception 'serial deveria ser gerado em maiúsculas: %', r.serial; end if;
  if (public.register_scan(v_t, lower(r.serial), 'sec12-serial', 'final') ->> 'ok')::boolean is not true then raise exception 'bipe do serial minúsculo deveria funcionar'; end if;
end $$;
select auth.test_logout();

-- Aparelho (dispositivo) também não grava 'recebida' e receive_nfe de nota marcada errada não devolve null.
select auth.test_login('00000000-0000-0000-0000-00000000012d');
select public.register_device(:'pair_code');
select auth.test_logout();
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000012d';
select auth.test_login('00000000-0000-0000-0000-00000000012d');
do $$ begin
  begin
    perform public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid, '{"chave":"35260912345678000190550010000000061000000065","status":"recebida","xml_path":"../../x.xml"}', '[]');
    raise exception 'dispositivo não deveria gravar recebida';
  exception when invalid_parameter_value then null; end;
  perform public.upsert_nfe_inbound(current_setting('test.tenant_a')::uuid, '{"chave":"35260912345678000190550010000000061000000065","origem":"sem_xml","status":"aguardando_xml"}', '[]');
  if (select status from public.nfe_inbound where chave = '35260912345678000190550010000000061000000065') <> 'aguardando_xml' then raise exception 'aparelho deveria registrar a nota aguardando XML'; end if;
end $$;
select auth.test_logout();

rollback;
