-- Testes de estoque (0004) e produção (0005): etapas, plano do dia, etiquetas, bipe com backflush multinível e outbox,
-- competência por fuso/hora_virada, estorno, ledger append-only, custo médio, isolamento entre tenants.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000003a', 'ana3@a.com'),
  ('00000000-0000-0000-0000-00000000003b', 'bento3@b.com'),
  ('00000000-0000-0000-0000-00000000003d', null);
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-00000000003d';

select auth.test_login('00000000-0000-0000-0000-00000000003a');
select public.create_tenant('Fábrica A', 'fabrica-a3', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000003b');
select public.create_tenant('Fábrica B', 'fabrica-b3', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000003a';
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000003b';

-- Etapa 'final' nasceu com o tenant (trigger).
do $$ begin
  if (select count(*) from public.stages where tenant_id = current_setting('test.tenant_a')::uuid and codigo = 'final') <> 1 then
    raise exception 'tenant deveria nascer com a etapa final';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Cadastro base de A: local, unidades, insumos, produtos, ficha em 2 níveis (PA usa PB), perfil, conector.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000003a');
insert into public.locations (id, tenant_id, nome) values ('40000000-0000-0000-0000-000000000001', :'tenant_a', 'Galpão');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_a', 'un', 'Unidade', 'unidade'), (:'tenant_a', 'm2', 'Metro quadrado', 'area');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo, minimo) values
  ('20000000-0000-0000-0000-000000000001', :'tenant_a', 'MP01', 'Chapa', 'un', 'm2', 10),
  ('20000000-0000-0000-0000-000000000002', :'tenant_a', 'MP02', 'Parafuso', 'un', 'un', 100),
  ('20000000-0000-0000-0000-000000000003', :'tenant_a', 'MP03', 'Cola', 'un', 'un', 1);
insert into public.products (id, tenant_id, sku, nome, familia) values
  ('30000000-0000-0000-0000-000000000001', :'tenant_a', 'PA', 'Produto A', 'Espelho'),
  ('30000000-0000-0000-0000-000000000002', :'tenant_a', 'PB', 'Subconjunto B', 'Espelho');
insert into public.label_profiles (tenant_id, familia, prefixo, unidades_por_caixa) values (:'tenant_a', 'Espelho', 'EH', 6);
-- PB: 2 parafusos. PA: 0.5 m2 de chapa (perda 10%) + 2 × PB. Explosão de 1 PA = 0.55 m2 MP01 + 4 un MP02.
select public.activate_bom(:'tenant_a', '30000000-0000-0000-0000-000000000002', '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000002","consumo":2}]');
select public.activate_bom(:'tenant_a', '30000000-0000-0000-0000-000000000001',
  '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":0.5,"perda_pct":0.1},
    {"tipo":"produto","component_product_id":"30000000-0000-0000-0000-000000000002","consumo":2}]');
select auth.test_logout();
-- Conectores ainda não têm RPC (0008): o teste insere direto como dono do banco.
insert into public.connectors (id, tenant_id, plataforma, nome, status, config) values
  ('50000000-0000-0000-0000-000000000001', :'tenant_a', 'baselinker', 'Base', 'conectado', '{"push_estoque": true}'),
  ('50000000-0000-0000-0000-000000000002', :'tenant_a', 'bling', 'Bling', 'conectado', '{"push_estoque": false}'),
  ('50000000-0000-0000-0000-000000000003', :'tenant_a', 'tiny', 'Tiny', 'desconectado', '{"push_estoque": true}');

select auth.test_login('00000000-0000-0000-0000-00000000003a');
-- Saldo inicial e custo médio ponderado: 10 @ 2 + 10 @ 4 = 20 @ 3.
select public.post_stock_move(:'tenant_a', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'saldo_inicial', 10, 2, 'inicial', null, null, 'test:ini:1') as mv1 \gset
select public.post_stock_move(:'tenant_a', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'entrada_manual', 10, 4, 'compra', null, null, 'test:ent:1') as mv2 \gset
select public.post_stock_move(:'tenant_a', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'saldo_inicial', 1000, 0.1, 'inicial', null, null, 'test:ini:2') as mv3 \gset
select set_config('test.mv1', :'mv1', false), set_config('test.mv2', :'mv2', false);
do $$
declare b public.stock_balances%rowtype; v uuid;
begin
  select * into b from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000001';
  if b.saldo <> 20 or b.custo_medio <> 3 then raise exception 'custo médio esperado 20 @ 3, veio % @ %', b.saldo, b.custo_medio; end if;
  -- mesma chave de idempotência devolve o mesmo movimento, sem duplicar
  v := public.post_stock_move(current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'entrada_manual', 10, 4, 'compra', null, null, 'test:ent:1');
  if v <> current_setting('test.mv2')::uuid then raise exception 'idempotência deveria devolver o mesmo id'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000001') <> 20 then raise exception 'saldo não deveria dobrar'; end if;
  -- perda com delta positivo e tipo proibido são rejeitados
  begin
    perform public.post_stock_move(current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'perda', 1, null, 'x', null, null, null);
    raise exception 'perda positiva deveria falhar';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.post_stock_move(current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'entrada_nfe', 1, 1, 'x', null, null, null);
    raise exception 'entrada_nfe por post_stock_move deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- saída mantém o custo médio; estorno da saída devolve o saldo
  v := public.post_stock_move(current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'perda', -5, null, 'quebra', null, null, 'test:perda:1');
  select * into b from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000001';
  if b.saldo <> 15 or b.custo_medio <> 3 then raise exception 'saída deveria manter custo 3 e saldo 15'; end if;
  if (select custo_unit from public.stock_moves where id = v) <> 3 then raise exception 'movimento de saída deveria registrar custo médio'; end if;
  perform public.reverse_stock_move(current_setting('test.tenant_a')::uuid, v, 'engano');
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000001') <> 20 then raise exception 'estorno deveria devolver saldo 20'; end if;
  if (select count(*) from public.stock_moves where reverses_id = v and move_type = 'estorno' and delta = 5) <> 1 then raise exception 'estorno deveria gerar movimento contrário'; end if;
  if public.reverse_stock_move(current_setting('test.tenant_a')::uuid, v, 'de novo') <> (select id from public.stock_moves where reverses_id = v) then
    raise exception 'segundo estorno deveria ser idempotente';
  end if;
  -- ledger append-only: sem grant de escrita para authenticated
  begin
    update public.stock_moves set delta = 999 where id = v;
    raise exception 'update em stock_moves deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.stock_moves where id = v;
    raise exception 'delete em stock_moves deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.stock_balances (tenant_id, material_id, location_id, saldo) values (current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 1);
    raise exception 'insert em stock_balances deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Plano do dia e etiquetas
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    perform public.reserve_label_batch(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000001', 3, 'unidade', null);
    raise exception 'sem plano deveria falhar';
  exception when raise_exception then
    if sqlerrm <> 'Sem projeção do dia' then raise exception 'mensagem inesperada: %', sqlerrm; end if;
  end;
end $$;
select public.set_daily_plan(:'tenant_a', public.production_date(:'tenant_a', now()), '40000000-0000-0000-0000-000000000001',
  '[{"product_id":"30000000-0000-0000-0000-000000000001","demanda_dia":10,"projetado":12,"carteira":3,"saldo_hub":40}]');
do $$
declare v_dia date := public.production_date(current_setting('test.tenant_a')::uuid, now()); r record; n int := 0;
begin
  if (select projetado from public.v_daily_plan where product_id = '30000000-0000-0000-0000-000000000001' and dia = v_dia) <> 12 then raise exception 'plano não gravou'; end if;
  for r in select * from public.reserve_label_batch(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000001', 3, 'unidade', null) loop
    n := n + 1;
    if r.seq <> n or r.serial <> 'EHPA' || to_char(v_dia, 'YYMMDD') || lpad(n::text, 4, '0') then raise exception 'serial inesperado: % seq %', r.serial, r.seq; end if;
  end loop;
  if n <> 3 then raise exception 'deveria gerar 3 etiquetas'; end if;
  -- segunda leva continua a sequência do dia
  if (select min(seq) from public.reserve_label_batch(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000001', 2, 'caixa', null)) <> 4 then
    raise exception 'sequência deveria continuar em 4';
  end if;
  if (select quantidade from public.labels where seq = 5) <> 6 then raise exception 'caixa deveria ter unidades_por_caixa'; end if;
  if (select impresso from public.v_daily_plan where product_id = '30000000-0000-0000-0000-000000000001' and dia = v_dia) <> 15 then raise exception 'impresso deveria somar 3 + 2×6'; end if;
  -- anular a 5ª
  perform public.annul_label(current_setting('test.tenant_a')::uuid, (select id from public.labels where seq = 5));
  if (select status from public.labels where seq = 5) <> 'anulada' then raise exception 'etiqueta deveria estar anulada'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Bipe: sucesso, backflush multinível, outbox, duplicidade sem erro
-- ---------------------------------------------------------------------------
do $$
declare v_dia date := public.production_date(current_setting('test.tenant_a')::uuid, now()); v_serial text := 'EHPA' || to_char(v_dia, 'YYMMDD') || '0001'; r jsonb; v_scan uuid;
begin
  r := public.register_scan(current_setting('test.tenant_a')::uuid, v_serial, 'evt-1', 'final');
  if not (r ->> 'ok')::boolean then raise exception 'bipe deveria ter sucesso: %', r; end if;
  v_scan := (r ->> 'scan_id')::uuid;
  if (r ->> 'bipado_hoje')::numeric <> 1 or (r ->> 'projetado_hoje')::numeric <> 12 or (r -> 'product' ->> 'sku') <> 'PA' then raise exception 'resposta inesperada: %', r; end if;
  if (r ->> 'competencia')::date <> v_dia then raise exception 'competência deveria ser a data de produção'; end if;
  if (select competencia from public.scan_events where id = v_scan) <> v_dia then raise exception 'scan_event.competencia errada'; end if;
  -- backflush multinível: 0.55 m2 de MP01 e 4 un de MP02, com chave scan:<id>:<material>
  if (select delta from public.stock_moves where idempotency_key = 'scan:' || v_scan || ':20000000-0000-0000-0000-000000000001') <> -0.55 then raise exception 'baixa de MP01 deveria ser -0.55'; end if;
  if (select delta from public.stock_moves where idempotency_key = 'scan:' || v_scan || ':20000000-0000-0000-0000-000000000002') <> -4 then raise exception 'baixa de MP02 deveria ser -4'; end if;
  if (select count(*) from public.stock_moves where ref_type = 'scan_event' and ref_id = v_scan and move_type = 'baixa_producao') <> 2 then raise exception 'deveria haver 2 baixas'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000001') <> 19.45 then raise exception 'saldo de MP01 deveria ser 19.45'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000002') <> 996 then raise exception 'saldo de MP02 deveria ser 996'; end if;
  if (select custo_unit from public.stock_moves where idempotency_key = 'scan:' || v_scan || ':20000000-0000-0000-0000-000000000001') <> 3 then raise exception 'baixa deveria carregar o custo médio'; end if;
  -- outbox só para o conector conectado com push_estoque
  if (select count(*) from public.integration_outbox where dedupe_key = 'scan:' || v_scan) <> 1 then raise exception 'outbox deveria ter 1 item'; end if;
  if (select connector_id from public.integration_outbox where dedupe_key = 'scan:' || v_scan) <> '50000000-0000-0000-0000-000000000001' then raise exception 'outbox no conector errado'; end if;
  if (select delta from public.integration_outbox where dedupe_key = 'scan:' || v_scan) <> 1 then raise exception 'outbox delta +1'; end if;
  -- segundo bipe: ja_bipado sem erro e sem novas baixas; replay offline pelo client_event_id idem
  r := public.register_scan(current_setting('test.tenant_a')::uuid, v_serial, 'evt-2', 'final');
  if (r ->> 'ok')::boolean or r ->> 'motivo' <> 'ja_bipado' then raise exception 'segundo bipe deveria devolver ja_bipado: %', r; end if;
  r := public.register_scan(current_setting('test.tenant_a')::uuid, 'EHPA' || to_char(v_dia, 'YYMMDD') || '0002', 'evt-1', 'final');
  if (r ->> 'ok')::boolean or r ->> 'motivo' <> 'ja_bipado' then raise exception 'client_event_id repetido deveria devolver ja_bipado: %', r; end if;
  if (select count(*) from public.stock_moves where move_type = 'baixa_producao') <> 2 then raise exception 'bipe duplicado não pode baixar estoque'; end if;
  if (select count(*) from public.scan_events where event_type = 'produzido') <> 1 then raise exception 'bipe duplicado não pode gerar evento'; end if;
  -- serial desconhecido e etiqueta anulada
  r := public.register_scan(current_setting('test.tenant_a')::uuid, 'NAOEXISTE', null, 'final');
  if (r ->> 'ok')::boolean or r ->> 'motivo' <> 'serial_desconhecido' then raise exception 'serial desconhecido: %', r; end if;
  r := public.register_scan(current_setting('test.tenant_a')::uuid, 'EHPA' || to_char(v_dia, 'YYMMDD') || '0005', null, 'final');
  if (r ->> 'ok')::boolean or r ->> 'motivo' <> 'anulada' then raise exception 'etiqueta anulada: %', r; end if;
  if (select bipado from public.v_daily_plan where product_id = '30000000-0000-0000-0000-000000000001' and dia = v_dia) <> 1 then raise exception 'v_daily_plan.bipado deveria ser 1'; end if;
  -- estorno: evento estorno, movimentos contrários com rev:, saldo restaurado, outbox negativo
  perform public.reverse_scan(current_setting('test.tenant_a')::uuid, v_scan);
  if (select count(*) from public.scan_events where reverses_id = v_scan and event_type = 'estorno') <> 1 then raise exception 'estorno deveria gerar scan_event'; end if;
  if (select delta from public.stock_moves where idempotency_key = 'rev:' || v_scan || ':20000000-0000-0000-0000-000000000001') <> 0.55 then raise exception 'estorno de MP01 deveria ser +0.55'; end if;
  if (select count(*) from public.stock_moves where idempotency_key like 'rev:' || v_scan || ':%' and move_type = 'estorno') <> 2 then raise exception 'estorno deveria gerar 2 contrários'; end if;
  if (select saldo from public.stock_balances where material_id = '20000000-0000-0000-0000-000000000001') <> 20 then raise exception 'saldo de MP01 deveria voltar a 20'; end if;
  if (select delta from public.integration_outbox where dedupe_key = 'rev:' || v_scan) <> -1 then raise exception 'outbox de estorno deveria ser -1'; end if;
  if (select bipado from public.v_daily_plan where product_id = '30000000-0000-0000-0000-000000000001' and dia = v_dia) <> 0 then raise exception 'bipado líquido deveria ser 0'; end if;
  begin
    perform public.reverse_scan(current_setting('test.tenant_a')::uuid, v_scan);
    raise exception 'segundo estorno deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- v_stock agrega saldo e sinaliza mínimo
  if (select saldo from public.v_stock where sku = 'MP01') <> 20 or (select abaixo_do_minimo from public.v_stock where sku = 'MP03') is not true then raise exception 'v_stock inconsistente'; end if;
end $$;

-- Competência: fuso America/Sao_Paulo com virada 05:00. 05:00Z = 02:00 local → dia anterior; 09:00Z = 06:00 local → mesmo dia.
do $$
declare t uuid := current_setting('test.tenant_a')::uuid;
begin
  if public.production_date(t, '2026-03-10T05:00:00Z') <> date '2026-03-09' then raise exception 'bipe às 02:00 deveria cair no dia anterior'; end if;
  if public.production_date(t, '2026-03-10T09:00:00Z') <> date '2026-03-10' then raise exception 'bipe às 06:00 deveria cair no mesmo dia'; end if;
  if public.production_date(t, '2026-03-11T02:59:00Z') <> date '2026-03-10' then raise exception '23:59 local deveria ser o mesmo dia'; end if;
  update public.tenants set hora_virada = '00:00' where id = t;
  if public.production_date(t, '2026-03-10T05:00:00Z') <> date '2026-03-10' then raise exception 'sem virada, 02:00 é o próprio dia'; end if;
  update public.tenants set hora_virada = '05:00' where id = t;
end $$;

-- Aparelho: registra, entra com PIN e o bipe carrega operator_id e device_id. Sem operador, recusa.
select device_id, pair_code from public.create_device(:'tenant_a', 'Celular linha 1', '40000000-0000-0000-0000-000000000001') \gset
select public.upsert_operator(:'tenant_a', null, 'Thiago', '1234');
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000003d');
select public.register_device(:'pair_code');
select auth.test_logout();
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000003d';
select set_config('test.device', :'device_id', false);
select auth.test_login('00000000-0000-0000-0000-00000000003d');
do $$
declare v_dia date := public.production_date(current_setting('test.tenant_a')::uuid, now()); r jsonb;
begin
  r := public.register_scan(current_setting('test.tenant_a')::uuid, 'EHPA' || to_char(v_dia, 'YYMMDD') || '0002', null, 'final');
  if (r ->> 'ok')::boolean or r ->> 'motivo' <> 'sem_operador' then raise exception 'aparelho sem operador deveria recusar: %', r; end if;
  perform public.set_operator('1234');
  r := public.register_scan(current_setting('test.tenant_a')::uuid, 'EHPA' || to_char(v_dia, 'YYMMDD') || '0002', null, 'final');
  if not (r ->> 'ok')::boolean then raise exception 'bipe do aparelho deveria ter sucesso: %', r; end if;
  if (select operator_id from public.scan_events where id = (r ->> 'scan_id')::uuid) <> (select public.current_operator_id()) then raise exception 'operator_id deveria vir da sessão do aparelho'; end if;
  if (select device_id from public.scan_events where id = (r ->> 'scan_id')::uuid) <> current_setting('test.device')::uuid then raise exception 'device_id deveria ser o aparelho'; end if;
  if (select last_scan_at from public.devices where id = current_setting('test.device')::uuid) is null then raise exception 'last_scan_at deveria atualizar'; end if;
  -- aparelho não estorna, não reserva etiqueta nem lança estoque
  begin
    perform public.reverse_scan(current_setting('test.tenant_a')::uuid, (r ->> 'scan_id')::uuid);
    raise exception 'dispositivo não deveria estornar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.post_stock_move(current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'ajuste', 1, null, 'x', null, null, null);
    raise exception 'dispositivo não deveria lançar estoque';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

-- Append-only vale até para o dono do banco (trigger).
do $$
declare v uuid := current_setting('test.mv1')::uuid;
begin
  begin
    update public.stock_moves set delta = 999 where id = v;
    raise exception 'trigger deveria bloquear update';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from public.stock_moves where id = v;
    raise exception 'trigger deveria bloquear delete';
  exception when object_not_in_prerequisite_state then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- Tenant B: sem exigir projeção imprime sem plano; não vê nem escreve nada de A.
-- ---------------------------------------------------------------------------
update public.tenants set exigir_projecao_para_imprimir = false where id = :'tenant_b';
select auth.test_login('00000000-0000-0000-0000-00000000003b');
insert into public.locations (tenant_id, nome) values (:'tenant_b', 'Galpão B');
insert into public.products (id, tenant_id, sku, nome, familia) values ('30000000-0000-0000-0000-00000000000b', :'tenant_b', 'PZ', 'Produto Z', 'Outra');
do $$
declare t text; n bigint;
begin
  if (select count(*) from public.reserve_label_batch(current_setting('test.tenant_b')::uuid, '30000000-0000-0000-0000-00000000000b', 2, 'unidade', null)) <> 2 then
    raise exception 'tenant sem exigência deveria imprimir sem plano';
  end if;
  if (select count(*) from public.labels where serial like 'ETPZ%') <> 2 then raise exception 'sem perfil, prefixo padrão ET'; end if;
  foreach t in array array['stages', 'daily_plans', 'labels', 'scan_events', 'stock_moves', 'stock_balances', 'connectors', 'integration_outbox', 'v_stock', 'v_daily_plan'] loop
    execute format('select count(*) from public.%I where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid into n;
    if n <> 0 then raise exception 'tenant B não deveria ver % linhas de %', n, t; end if;
  end loop;
  foreach t in array array['stages', 'daily_plans', 'labels', 'scan_events', 'stock_moves', 'stock_balances', 'connectors', 'integration_outbox'] loop
    begin
      execute format('update public.%I set tenant_id = tenant_id where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'tenant B alterou % linhas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
    begin
      execute format('delete from public.%I where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'tenant B apagou % linhas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
  end loop;
  -- RPCs cruzadas
  begin
    perform public.register_scan(current_setting('test.tenant_a')::uuid, 'EHPA' || to_char(current_date, 'YYMMDD') || '0003', null, 'final');
    raise exception 'register_scan cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_daily_plan(current_setting('test.tenant_a')::uuid, current_date, '40000000-0000-0000-0000-000000000001', '[]');
    raise exception 'set_daily_plan cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.post_stock_move(current_setting('test.tenant_a')::uuid, '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'ajuste', 1, null, null, null, null, null);
    raise exception 'post_stock_move cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reverse_stock_move(current_setting('test.tenant_a')::uuid, current_setting('test.mv1')::uuid, null);
    raise exception 'reverse_stock_move cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.annul_label(current_setting('test.tenant_a')::uuid, (select id from public.labels limit 1));
    raise exception 'annul_label cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reserve_label_batch(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000001', 1, 'unidade', null);
    raise exception 'reserve_label_batch cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

rollback;
