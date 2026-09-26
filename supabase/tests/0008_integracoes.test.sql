-- Testes de integrações: conectores e mapa de status (admin), worker_* rejeitadas para authenticated e aceitas
-- para service_role, credenciais cifradas, pedidos → demanda, claim do outbox agrupado e sem repetição, sync_state, hub, auditoria.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000005a', 'ana5@a.com'),
  ('00000000-0000-0000-0000-00000000005b', 'bento5@b.com'),
  ('00000000-0000-0000-0000-00000000005e', 'worker5@x.com');

select auth.test_login('00000000-0000-0000-0000-00000000005a');
select public.create_tenant('Fábrica A', 'fabrica-a5', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000005b');
select public.create_tenant('Fábrica B', 'fabrica-b5', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000005a';
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000005b';

-- ---------------------------------------------------------------------------
-- Admin de A: produtos, conector e mapa de status.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000005a');
insert into public.products (id, tenant_id, sku, nome, familia) values
  ('30000000-0000-0000-0000-000000000051', :'tenant_a', 'PA', 'Produto A', 'Espelho'),
  ('30000000-0000-0000-0000-000000000052', :'tenant_a', 'PB', 'Produto B', 'Espelho');
insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (:'tenant_a', '30000000-0000-0000-0000-000000000051', 'ED-PA');
select public.upsert_connector(:'tenant_a', null, 'baselinker', 'Base', '{"push_estoque": true, "status": "conectado", "inventory_id": 1}') as conn \gset
select public.upsert_connector(:'tenant_a', null, 'bling', 'Bling', '{"push_estoque": true, "status": "conectado"}') as conn_bling \gset
select set_config('test.conn', :'conn', false), set_config('test.conn_bling', :'conn_bling', false);
do $$
declare c public.connectors%rowtype; v uuid;
begin
  select * into c from public.connectors where id = current_setting('test.conn')::uuid;
  if c.status <> 'conectado' or c.config ? 'status' or (c.config ->> 'inventory_id') <> '1' then raise exception 'conector inesperado: %', to_jsonb(c); end if;
  v := public.upsert_connector(current_setting('test.tenant_a')::uuid, null, 'baselinker', 'Base 2', '{"dry_run": true}');
  if v <> c.id then raise exception 'upsert por plataforma deveria devolver o mesmo id'; end if;
  select * into c from public.connectors where id = v;
  if c.nome <> 'Base 2' or not (c.config ->> 'push_estoque')::boolean or not (c.config ->> 'dry_run')::boolean then raise exception 'config deveria ser mesclada: %', c.config; end if;
  if public.set_status_map(current_setting('test.tenant_a')::uuid, v, '[{"status_externo":"new","significado":"demanda"},{"status_externo":"confirmed","significado":"carteira"},{"status_externo":"shipped","significado":"enviado"},{"status_externo":"cancelled","significado":"cancelado"}]') <> 4 then
    raise exception 'mapa deveria ter 4 linhas';
  end if;
  if public.set_status_map(current_setting('test.tenant_a')::uuid, v, '[{"status_externo":"new","significado":"demanda"},{"status_externo":"confirmed","significado":"carteira"},{"status_externo":"cancelled","significado":"cancelado"}]') <> 3 then
    raise exception 'mapa deveria ser substituído';
  end if;
  -- worker_* rejeitadas para authenticated (mesmo admin)
  begin
    perform public.worker_set_credentials(current_setting('test.tenant_a')::uuid, v, '{"token":"x"}', 'k');
    raise exception 'worker_set_credentials deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_get_credentials(v, 'k');
    raise exception 'worker_get_credentials deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_upsert_orders(current_setting('test.tenant_a')::uuid, v, '[]');
    raise exception 'worker_upsert_orders deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_claim_outbox(v, 10);
    raise exception 'worker_claim_outbox deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_apply_outbox_result(array[1]::bigint[], true, null);
    raise exception 'worker_apply_outbox_result deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_set_sync_state(v, null, true, null);
    raise exception 'worker_set_sync_state deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_upsert_hub_stock(current_setting('test.tenant_a')::uuid, v, '[]');
    raise exception 'worker_upsert_hub_stock deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_record_audit(current_setting('test.tenant_a')::uuid, v, '[]');
    raise exception 'worker_record_audit deveria ser negada';
  exception when insufficient_privilege then null; end;
  begin
    perform payload from public.connector_credentials;
    raise exception 'connector_credentials não deveria ser legível';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

-- Outbox: 0005 enfileira pelo bipe; aqui entra direto como dono do banco para testar o claim.
insert into public.integration_outbox (tenant_id, connector_id, product_id, delta, dedupe_key, status) values
  (:'tenant_a', :'conn', '30000000-0000-0000-0000-000000000051', 1, 'scan:1', 'pendente'),
  (:'tenant_a', :'conn', '30000000-0000-0000-0000-000000000051', 2, 'scan:2', 'pendente'),
  (:'tenant_a', :'conn', '30000000-0000-0000-0000-000000000052', 5, 'scan:3', 'pendente'),
  (:'tenant_a', :'conn', '30000000-0000-0000-0000-000000000051', -1, 'rev:1', 'pendente'),
  (:'tenant_a', :'conn', '30000000-0000-0000-0000-000000000052', 9, 'scan:0', 'aplicado'),
  (:'tenant_a', :'conn_bling', '30000000-0000-0000-0000-000000000051', 7, 'scan:1', 'pendente');

-- ---------------------------------------------------------------------------
-- Worker (service_role, usuário sem membership)
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000005e', 'service_role');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_c uuid := current_setting('test.conn')::uuid; r record; n int; v_ids_pa bigint[]; v_ids_pb bigint[]; v_cred jsonb;
begin
  -- credenciais: grava cifrado, lê com a chave certa, falha com a errada
  perform public.worker_set_credentials(v_t, v_c, '{"token":"segredo-xyz","inventory_id":1}', 'chave-teste');
  v_cred := public.worker_get_credentials(v_c, 'chave-teste');
  if v_cred ->> 'token' <> 'segredo-xyz' then raise exception 'credencial deveria voltar decifrada: %', v_cred; end if;
  perform public.worker_set_credentials(v_t, v_c, '{"token":"segredo-2"}', 'chave-teste');
  if (public.worker_get_credentials(v_c, 'chave-teste')) ->> 'token' <> 'segredo-2' then raise exception 'credencial deveria ser substituída'; end if;
  begin
    perform public.worker_get_credentials(v_c, 'chave-errada');
    raise exception 'chave errada deveria falhar';
  exception when others then
    if sqlstate = 'P0001' then raise; end if;
  end;
  if public.worker_get_credentials(current_setting('test.conn_bling')::uuid, 'chave-teste') is not null then raise exception 'conector sem credencial devolve null'; end if;

  -- pedidos: significado pelo mapa; item resolve por alias (ED-PA) e por sku (PB)
  n := public.worker_upsert_orders(v_t, v_c, jsonb_build_array(
    jsonb_build_object('external_id', 'o1', 'external_status', 'new', 'confirmed_at', now() - interval '1 day', 'total', 100, 'itens', '[{"sku_externo":"ED-PA","quantidade":2,"preco":50}]'::jsonb),
    jsonb_build_object('external_id', 'o2', 'external_status', 'confirmed', 'confirmed_at', now() - interval '2 days', 'total', 30, 'itens', '[{"sku_externo":"PB","quantidade":3,"preco":10}]'::jsonb),
    jsonb_build_object('external_id', 'o3', 'external_status', 'cancelled', 'confirmed_at', now(), 'total', 0, 'itens', '[{"sku_externo":"PA","quantidade":10,"preco":1}]'::jsonb),
    jsonb_build_object('external_id', 'o4', 'external_status', 'estranho', 'confirmed_at', now(), 'total', 0, 'itens', '[{"sku_externo":"ZZZ","quantidade":1,"preco":1}]'::jsonb)));
  if n <> 4 then raise exception 'deveria gravar 4 pedidos, veio %', n; end if;
  if (select significado from public.orders where external_id = 'o1') <> 'demanda' or (select significado from public.orders where external_id = 'o2') <> 'carteira' then raise exception 'significado do mapa errado'; end if;
  if (select significado from public.orders where external_id = 'o4') is not null then raise exception 'status fora do mapa deveria ficar sem significado'; end if;
  if (select product_id from public.order_items i join public.orders o on o.id = i.order_id where o.external_id = 'o1') <> '30000000-0000-0000-0000-000000000051' then raise exception 'alias ED-PA deveria resolver PA'; end if;
  if (select product_id from public.order_items i join public.orders o on o.id = i.order_id where o.external_id = 'o2') <> '30000000-0000-0000-0000-000000000052' then raise exception 'sku PB deveria resolver'; end if;
  if (select product_id from public.order_items i join public.orders o on o.id = i.order_id where o.external_id = 'o4') is not null then raise exception 'sku desconhecido fica sem produto'; end if;
  -- Decisão de 25/09 (20260926000500_demanda.sql): todo pedido confirmado conta, inclusive o cancelado (o3, 10 un de PA);
  -- demanda_dia é por dia de produção (vendido ÷ 14 × 30 ÷ 22 dias úteis do tenant).
  select * into r from public.demand_for_projection(v_t, 14) where sku = 'PA';
  if r.vendido <> 12 or r.demanda_dia <> round(12.0 / 14 * 30 / 22, 4) then raise exception 'demanda de PA inesperada: %', r; end if;
  select * into r from public.demand_for_projection(v_t, 14) where sku = 'PB';
  if r.vendido <> 3 or r.carteira <> 3 then raise exception 'demanda de PB inesperada: %', r; end if;
  -- reimportar o1 como enviado substitui itens e continua na demanda (enviado conta)
  perform public.worker_upsert_orders(v_t, v_c, '[{"external_id":"o1","external_status":"shipped","total":100,"itens":[{"sku_externo":"ED-PA","quantidade":2,"preco":50}]}]');
  if (select count(*) from public.orders where external_id = 'o1') <> 1 or (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.external_id = 'o1') <> 1 then raise exception 'reimportação não pode duplicar'; end if;
  if (select confirmed_at from public.orders where external_id = 'o1') is null then raise exception 'confirmed_at ausente deveria ser mantido'; end if;
  if (select vendido from public.demand_for_projection(v_t, 14) where sku = 'PA') <> 12 then raise exception 'pedido enviado continua contando na demanda'; end if;

  -- claim do outbox: agrupa por produto, marca em_processamento, não devolve duas vezes; conector Bling fica intacto
  n := 0;
  for r in select * from public.worker_claim_outbox(v_c, 10) loop
    n := n + 1;
    if r.sku = 'PA' then
      if r.delta <> 2 or array_length(r.ids, 1) <> 3 then raise exception 'PA deveria somar 2 em 3 ids: %', r; end if;
      v_ids_pa := r.ids;
    elsif r.sku = 'PB' then
      if r.delta <> 5 or array_length(r.ids, 1) <> 1 then raise exception 'PB deveria somar 5 em 1 id: %', r; end if;
      v_ids_pb := r.ids;
    else raise exception 'sku inesperado %', r.sku; end if;
  end loop;
  if n <> 2 then raise exception 'claim deveria devolver 2 grupos, veio %', n; end if;
  if (select count(*) from public.integration_outbox where connector_id = v_c and status = 'em_processamento') <> 4 then raise exception 'lote deveria estar em_processamento'; end if;
  if (select count(*) from public.worker_claim_outbox(v_c, 10)) <> 0 then raise exception 'segundo claim não pode devolver de novo'; end if;
  if (select status from public.integration_outbox where connector_id = current_setting('test.conn_bling')::uuid) <> 'pendente' then raise exception 'outbox de outro conector não pode ser tocado'; end if;
  perform public.worker_apply_outbox_result(v_ids_pa, true, null);
  if (select count(*) from public.integration_outbox where id = any (v_ids_pa) and status = 'aplicado' and applied_at is not null) <> 3 then raise exception 'PA deveria estar aplicado'; end if;
  perform public.worker_apply_outbox_result(v_ids_pb, false, null);
  if (select status from public.integration_outbox where id = v_ids_pb[1]) <> 'pendente' or (select tentativas from public.integration_outbox where id = v_ids_pb[1]) <> 0 then raise exception 'freio deveria devolver a pendente sem contar tentativa'; end if;
  if (select count(*) from public.worker_claim_outbox(v_c, 10)) <> 1 then raise exception 'item devolvido deveria ser reclamado'; end if;
  perform public.worker_apply_outbox_result(v_ids_pb, false, 'SKU não encontrado');
  if (select status from public.integration_outbox where id = v_ids_pb[1]) <> 'erro' or (select erro from public.integration_outbox where id = v_ids_pb[1]) <> 'SKU não encontrado' then raise exception 'falha deveria marcar erro'; end if;
  if (select tentativas from public.integration_outbox where id = v_ids_pb[1]) <> 1 then raise exception 'tentativa deveria contar 1'; end if;

  -- sync_state e status do conector
  perform public.worker_set_sync_state(v_c, '{"page": 1}', true, null);
  if (select runs from public.sync_state where connector_id = v_c) <> 1 or (select last_ok_at from public.sync_state where connector_id = v_c) is null then raise exception 'sync_state inicial'; end if;
  if (select ultimo_sync from public.connectors where id = v_c) is null then raise exception 'ultimo_sync deveria gravar'; end if;
  perform public.worker_set_sync_state(v_c, null, false, 'boom');
  if (select cursor from public.sync_state where connector_id = v_c) <> '{"page": 1}'::jsonb or (select runs from public.sync_state where connector_id = v_c) <> 2 then raise exception 'cursor nulo deveria manter o anterior'; end if;
  if (select status from public.connectors where id = v_c) <> 'erro' or (select ultimo_erro from public.connectors where id = v_c) <> 'boom' then raise exception 'falha deveria marcar erro no conector'; end if;
  perform public.worker_set_sync_state(v_c, '{"page": 2}', true, null);
  if (select status from public.connectors where id = v_c) <> 'conectado' or (select ultimo_erro from public.connectors where id = v_c) is not null then raise exception 'sucesso deveria reconectar'; end if;

  -- O worker grava o pulso (last_run_at, antes de ler a plataforma) e o cursor de cada página DIRETO
  -- em sync_state, pelo upsert do PostgREST (Db.marcarPulso / Db.gravarCursor), sem RPC. Isto trava
  -- o que ele depende: service_role escreve em sync_state; o pulso só mexe em last_run_at; o cursor
  -- só em cursor; e a RPC do fim da rodada, com cursor nulo, mantém o cursor gravado por página.
  insert into public.sync_state (connector_id, tenant_id, last_run_at, updated_at) values (v_c, v_t, '2026-09-25 12:00:00+00', now())
    on conflict (connector_id) do update set last_run_at = excluded.last_run_at, updated_at = excluded.updated_at;
  if (select last_run_at from public.sync_state where connector_id = v_c) <> '2026-09-25 12:00:00+00'::timestamptz then raise exception 'pulso deveria gravar last_run_at'; end if;
  if (select cursor from public.sync_state where connector_id = v_c) <> '{"page": 2}'::jsonb or (select runs from public.sync_state where connector_id = v_c) <> 3
     or (select last_ok_at from public.sync_state where connector_id = v_c) is null then raise exception 'pulso não pode mexer em cursor, runs nem last_ok_at'; end if;
  if (select status from public.connectors where id = v_c) <> 'conectado' then raise exception 'pulso não pode mexer no cartão'; end if;
  insert into public.sync_state (connector_id, tenant_id, cursor, updated_at) values (v_c, v_t, '{"date_confirmed_from": 123}', now())
    on conflict (connector_id) do update set cursor = excluded.cursor, updated_at = excluded.updated_at;
  perform public.worker_set_sync_state(v_c, null, true, null);
  if (select cursor from public.sync_state where connector_id = v_c) <> '{"date_confirmed_from": 123}'::jsonb then raise exception 'fim da rodada deveria manter o cursor gravado por página'; end if;
  -- Botão "Sincronizar agora": marca só o cartão, direto em connectors (Db.marcarRodadaManual), e
  -- nunca ressuscita conector desconectado.
  update public.connectors set status = 'conectado', ultimo_erro = null, ultimo_sync = '2026-09-25 12:05:00+00' where id = v_c and tenant_id = v_t and status <> 'desconectado';
  if (select ultimo_sync from public.connectors where id = v_c) <> '2026-09-25 12:05:00+00'::timestamptz then raise exception 'service_role deveria marcar o cartão'; end if;

  -- hub e auditoria
  if public.worker_upsert_hub_stock(v_t, v_c, '[{"sku":"ED-PA","saldo":40},{"sku":"PB","saldo":7},{"sku":"NOPE","saldo":1}]') <> 2 then raise exception 'hub deveria gravar 2'; end if;
  if (select saldo_hub from public.hub_stock_snapshots where product_id = '30000000-0000-0000-0000-000000000051') <> 40 then raise exception 'snapshot de PA'; end if;
  perform public.worker_upsert_hub_stock(v_t, v_c, '[{"sku":"PA","saldo":41}]');
  if (select saldo_hub from public.hub_stock_snapshots where product_id = '30000000-0000-0000-0000-000000000051') <> 41 then raise exception 'snapshot deveria atualizar'; end if;
  if public.worker_record_audit(v_t, v_c, '[{"sku":"PA","diferenca":1}]') is null then raise exception 'auditoria'; end if;
  if (select count(*) from public.audit_runs where tenant_id = v_t) <> 1 then raise exception 'audit_runs'; end if;
  -- nota do worker em conector alheio falha
  begin
    perform public.worker_set_credentials(current_setting('test.tenant_b')::uuid, v_c, '{"token":"x"}', 'k');
    raise exception 'conector de outro tenant deveria falhar';
  exception when invalid_parameter_value then null; end;
end $$;
select auth.test_logout();

-- Cifra: o bytea gravado não contém o segredo em texto (dono do banco lê a coluna crua).
do $$ begin
  if (select position('segredo' in encode(payload, 'escape')) from public.connector_credentials where connector_id = current_setting('test.conn')::uuid) <> 0 then
    raise exception 'payload deveria estar cifrado';
  end if;
end $$;

-- Admin de A vê demanda pela view e desconecta: credenciais somem, outbox pendente vira ignorado.
select auth.test_login('00000000-0000-0000-0000-00000000005a');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_c uuid := current_setting('test.conn')::uuid;
begin
  if (select vendido_14d from public.v_demand_by_sku where sku = 'PB') <> 3 or (select carteira from public.v_demand_by_sku where sku = 'PB') <> 3 then raise exception 'v_demand_by_sku de PB'; end if;
  if (select vendido_14d from public.v_demand_by_sku where sku = 'PA') <> 12 then raise exception 'v_demand_by_sku de PA deveria contar enviado e cancelado (12)'; end if;
  if (select count(*) from public.sync_state where connector_id = v_c) <> 1 then raise exception 'admin deveria ler sync_state'; end if;
  -- A interface lê o pulso (last_run_at) e o cursor, mas não escreve: sync_state é do worker.
  if (select last_run_at from public.sync_state where connector_id = v_c) is null then raise exception 'admin deveria ler o pulso'; end if;
  begin
    update public.sync_state set last_run_at = now() where connector_id = v_c;
    raise exception 'authenticated não pode escrever em sync_state';
  exception when insufficient_privilege then null; end;
  perform public.disconnect_connector(v_t, v_c);
  if (select status from public.connectors where id = v_c) <> 'desconectado' then raise exception 'deveria desconectar'; end if;
  if (select status from public.integration_outbox where connector_id = v_c and dedupe_key = 'scan:3') <> 'ignorado' then raise exception 'outbox com erro deveria virar ignorado'; end if;
end $$;
select auth.test_logout();
do $$ begin
  if exists (select 1 from public.connector_credentials where connector_id = current_setting('test.conn')::uuid) then raise exception 'credenciais deveriam ser apagadas'; end if;
end $$;

-- Reenvio manual: admin devolve item em erro a 'pendente'; item que não está em erro é recusado.
insert into public.integration_outbox (tenant_id, connector_id, product_id, delta, dedupe_key, status, erro)
  values (:'tenant_a', :'conn_bling', '30000000-0000-0000-0000-000000000052', 3, 'scan:retry', 'erro', 'timeout') returning id as outbox_erro \gset
select set_config('test.outbox_erro', :'outbox_erro'::text, false);
select auth.test_login('00000000-0000-0000-0000-00000000005a');
do $$ begin
  perform public.retry_outbox(current_setting('test.tenant_a')::uuid, current_setting('test.outbox_erro')::bigint);
  if (select status from public.integration_outbox where id = current_setting('test.outbox_erro')::bigint) <> 'pendente' then raise exception 'retry_outbox deveria devolver a pendente'; end if;
  begin
    perform public.retry_outbox(current_setting('test.tenant_a')::uuid, current_setting('test.outbox_erro')::bigint);
    raise exception 'retry de item pendente deveria falhar';
  exception when invalid_parameter_value then null; end;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Tenant B: não vê nem escreve nada de A; worker_* também negadas para ele.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000005b');
do $$
declare t text; n bigint;
begin
  foreach t in array array['connectors', 'connector_status_map', 'sync_state', 'orders', 'order_items', 'hub_stock_snapshots', 'audit_runs', 'integration_outbox', 'v_demand_by_sku'] loop
    execute format('select count(*) from public.%I where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid into n;
    if n <> 0 then raise exception 'tenant B não deveria ver % linhas de %', n, t; end if;
  end loop;
  begin
    perform public.demand_for_projection(current_setting('test.tenant_a')::uuid, 14);
    raise exception 'demand_for_projection cruzada deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.upsert_connector(current_setting('test.tenant_a')::uuid, null, 'tiny', 'x', '{}');
    raise exception 'upsert_connector cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_status_map(current_setting('test.tenant_a')::uuid, current_setting('test.conn')::uuid, '[]');
    raise exception 'set_status_map cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.disconnect_connector(current_setting('test.tenant_a')::uuid, current_setting('test.conn')::uuid);
    raise exception 'disconnect_connector cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.worker_claim_outbox(current_setting('test.conn')::uuid, 10);
    raise exception 'worker_claim_outbox deveria ser negada para B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.retry_outbox(current_setting('test.tenant_a')::uuid, current_setting('test.outbox_erro')::bigint);
    raise exception 'retry_outbox cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

rollback;
