-- Demanda pelos pedidos (20260926000500_demanda.sql): a regra dos pedidos que contam (cancelado, enviado e sem
-- significado contam; 'ignorar' não), a janela do tenant (dias_demanda), demand_summary, sales_by_day,
-- demand_for_projection por dia de produção, v_demand_by_sku, saldo do hub, e o isolamento entre tenants.
-- A mesma regra está no core (packages/core/src/planejamento.ts, resumirPedidos) e é testada lá com os mesmos casos.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000019a', 'ana19@a.com'),
  ('00000000-0000-0000-0000-00000000019b', 'bento19@b.com'),
  ('00000000-0000-0000-0000-00000000019c', 'carla19@a.com'),
  ('00000000-0000-0000-0000-00000000019e', 'worker19@x.com');
select auth.test_login('00000000-0000-0000-0000-00000000019a');
select public.create_tenant('Fábrica A', 'fabrica-a19', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000019b');
select public.create_tenant('Fábrica B', 'fabrica-b19', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
insert into public.memberships (tenant_id, user_id, role, accepted_at) values (:'tenant_a', '00000000-0000-0000-0000-00000000019c', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000019a', '00000000-0000-0000-0000-00000000019c');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000019b';

-- Cadastro e conector de A (dono do banco). PA e PB vendem; o De-Para cobre todos os significados.
insert into public.products (id, tenant_id, sku, nome, familia) values
  ('19000000-0000-0000-0000-000000000001', :'tenant_a', 'PA', 'Produto A', 'Espelho'),
  ('19000000-0000-0000-0000-000000000002', :'tenant_a', 'PB', 'Produto B', 'Espelho');
insert into public.connectors (id, tenant_id, plataforma, nome, status) values ('19000000-0000-0000-0000-0000000000c1', :'tenant_a', 'baselinker', 'Base', 'conectado');
insert into public.connector_status_map (tenant_id, connector_id, status_externo, significado) values
  (:'tenant_a', '19000000-0000-0000-0000-0000000000c1', 'new', 'demanda'),
  (:'tenant_a', '19000000-0000-0000-0000-0000000000c1', 'confirmed', 'carteira'),
  (:'tenant_a', '19000000-0000-0000-0000-0000000000c1', 'shipped', 'enviado'),
  (:'tenant_a', '19000000-0000-0000-0000-0000000000c1', 'cancelled', 'cancelado'),
  (:'tenant_a', '19000000-0000-0000-0000-0000000000c1', 'quote', 'ignorar');

-- Pedidos pelo caminho do robô (service role).
select auth.test_login('00000000-0000-0000-0000-00000000019e', 'service_role');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v_c uuid := '19000000-0000-0000-0000-0000000000c1';
begin
  perform public.worker_upsert_orders(v_t, v_c, jsonb_build_array(
    jsonb_build_object('external_id', 'o1', 'external_status', 'new', 'confirmed_at', now() - interval '30 hours', 'itens', '[{"sku_externo":"PA","quantidade":2},{"sku_externo":"ZZZ","quantidade":1}]'::jsonb),
    jsonb_build_object('external_id', 'o2', 'external_status', 'confirmed', 'confirmed_at', now() - interval '2 hours', 'itens', '[{"sku_externo":"PA","quantidade":3},{"sku_externo":"PB","quantidade":1}]'::jsonb),
    jsonb_build_object('external_id', 'o3', 'external_status', 'shipped', 'confirmed_at', now() - interval '3 days', 'itens', '[{"sku_externo":"PA","quantidade":4}]'::jsonb),
    jsonb_build_object('external_id', 'o4', 'external_status', 'cancelled', 'confirmed_at', now() - interval '5 days', 'itens', '[{"sku_externo":"PA","quantidade":5}]'::jsonb),
    jsonb_build_object('external_id', 'o5', 'external_status', 'quote', 'confirmed_at', now() - interval '1 hour', 'itens', '[{"sku_externo":"PA","quantidade":100}]'::jsonb),
    jsonb_build_object('external_id', 'o6', 'external_status', 'estranho', 'confirmed_at', now() - interval '6 days', 'itens', '[{"sku_externo":"PB","quantidade":2},{"sku_externo":"ZZZ","quantidade":3},{"sku_externo":"","quantidade":2}]'::jsonb),
    jsonb_build_object('external_id', 'o7', 'external_status', 'new', 'confirmed_at', now() - interval '20 days', 'itens', '[{"sku_externo":"PA","quantidade":50}]'::jsonb)));
  if (select significado from public.orders where external_id = 'o6') is not null then raise exception 'status fora do De-Para deveria ficar sem significado'; end if;
  perform public.worker_upsert_hub_stock(v_t, v_c, '[{"sku":"PA","saldo":40}]');
  -- o worker também lê a projeção
  if (select vendido from public.demand_for_projection(v_t) where sku = 'PA') <> 14 then raise exception 'demand_for_projection como service_role'; end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Admin de A
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000019a');
do $$
declare v_t uuid := current_setting('test.tenant_a')::uuid; v jsonb; r record; n int; np numeric; u numeric;
begin
  if (select dias_demanda from public.tenants where id = v_t) <> 14 then raise exception 'dias_demanda padrão deveria ser 14'; end if;
  if (select dias_cobertura_acabado from public.tenants where id = v_t) <> 3 then raise exception 'dias_cobertura_acabado padrão deveria ser 3'; end if;
  update public.tenants set dias_cobertura_acabado = 0 where id = v_t; -- zero vale (sem estoque de segurança no hub)
  begin
    update public.tenants set dias_cobertura_acabado = 61 where id = v_t;
    raise exception 'dias_cobertura_acabado 61 deveria ser recusado';
  exception when check_violation then null; end;
  v := public.demand_summary(v_t);
  if (v ->> 'dias')::int <> 14 then raise exception 'janela padrão: %', v ->> 'dias'; end if;
  -- o1, o2, o3 (enviado), o4 (cancelado) e o6 (sem significado) contam; o5 (ignorar) e o7 (fora da janela) não.
  if (v ->> 'pedidos')::int <> 5 then raise exception 'pedidos na janela: %', v ->> 'pedidos'; end if;
  if (v ->> 'pedidos_24h')::int <> 1 then raise exception 'pedidos 24h (o2; o5 é ignorar): %', v ->> 'pedidos_24h'; end if;
  if (v ->> 'unidades')::numeric <> 3 + 4 + 4 + 5 + 7 then raise exception 'unidades: %', v ->> 'unidades'; end if;
  select * into r from jsonb_to_recordset(v -> 'produtos') as x(product_id uuid, vendido numeric, carteira numeric, ultimo_pedido timestamptz)
   where x.product_id = '19000000-0000-0000-0000-000000000001';
  if r.vendido <> 2 + 3 + 4 + 5 or r.carteira <> 3 then raise exception 'PA: %', r; end if;
  select * into r from jsonb_to_recordset(v -> 'produtos') as x(product_id uuid, vendido numeric, carteira numeric, ultimo_pedido timestamptz)
   where x.product_id = '19000000-0000-0000-0000-000000000002';
  if r.vendido <> 3 or r.carteira <> 1 then raise exception 'PB: %', r; end if;
  if (v -> 'produtos' -> 0 ->> 'product_id')::uuid <> '19000000-0000-0000-0000-000000000001' then raise exception 'produtos do mais vendido para o menos'; end if;
  if v -> 'sem_produto' <> '{"linhas": 3, "unidades": 6, "skus": 2}'::jsonb then raise exception 'sem_produto: %', v -> 'sem_produto'; end if;
  if v -> 'skus_sem_produto' <> '[{"sku": "ZZZ", "unidades": 4, "pedidos": 2}, {"sku": "", "unidades": 2, "pedidos": 1}]'::jsonb then
    raise exception 'skus_sem_produto: %', v -> 'skus_sem_produto';
  end if;
  -- até onde o robô leu: o pedido mais recente, mesmo 'ignorar'
  if (v ->> 'ultimo_pedido')::timestamptz <> (select confirmed_at from public.orders where external_id = 'o5') then raise exception 'ultimo_pedido: %', v ->> 'ultimo_pedido'; end if;
  if v -> 'hub' <> jsonb_build_array(jsonb_build_object('product_id', '19000000-0000-0000-0000-000000000001', 'saldo', 40.0000,
       'capturado_em', (select capturado_em from public.hub_stock_snapshots where product_id = '19000000-0000-0000-0000-000000000001'))) then
    raise exception 'hub: %', v -> 'hub';
  end if;

  -- janela explícita, limites e a janela do tenant
  v := public.demand_summary(v_t, 30);
  if (select x.vendido from jsonb_to_recordset(v -> 'produtos') as x(product_id uuid, vendido numeric) where x.product_id = '19000000-0000-0000-0000-000000000001') <> 64 then
    raise exception 'janela de 30 dias deveria pegar o7';
  end if;
  if (public.demand_summary(v_t, 500) ->> 'dias')::int <> 90 or (public.demand_summary(v_t, 0) ->> 'dias')::int <> 1 then raise exception 'janela fora de 1..90'; end if;
  update public.tenants set dias_demanda = 7 where id = v_t;
  v := public.demand_summary(v_t);
  if (v ->> 'dias')::int <> 7 or (v ->> 'pedidos')::int <> 5 then raise exception 'janela do tenant (7): %', v; end if;
  begin
    update public.tenants set dias_demanda = 0 where id = v_t;
    raise exception 'dias_demanda 0 deveria ser recusado';
  exception when check_violation then null; end;
  begin
    update public.tenants set dias_demanda = 91 where id = v_t;
    raise exception 'dias_demanda 91 deveria ser recusado';
  exception when check_violation then null; end;

  -- projeção por dia de produção (7 dias, 22 dias úteis): 14 ÷ 7 × 30 ÷ 22
  select * into r from public.demand_for_projection(v_t) where sku = 'PA';
  if r.vendido <> 14 or r.carteira <> 3 or r.demanda_dia <> round(14.0 / 7 * 30 / 22, 4) then raise exception 'demand_for_projection PA: %', r; end if;
  if (select vendido from public.demand_for_projection(v_t, 30) where sku = 'PA') <> 64 then raise exception 'demand_for_projection com p_dias'; end if;
  if (select vendido_14d from public.v_demand_by_sku where sku = 'PA') <> 14 or (select vendido_30d from public.v_demand_by_sku where sku = 'PA') <> 64 then
    raise exception 'v_demand_by_sku PA';
  end if;

  -- vendas por dia (fuso do tenant): 14 dias até hoje, dia sem pedido = 0, mesmas regras
  select count(*), sum(s.pedidos), sum(s.unidades) into n, np, u from public.sales_by_day(v_t, 14) s;
  if n <> 14 or np <> 5 or u <> 23 then raise exception 'sales_by_day: % dias, % pedidos, % unidades', n, np, u; end if;
  if (select max(s.dia) from public.sales_by_day(v_t, 14) s) <> (now() at time zone 'America/Sao_Paulo')::date then raise exception 'sales_by_day termina hoje no fuso do tenant'; end if;
  if (select count(*) from public.sales_by_day(v_t, 1000)) <> 366 then raise exception 'sales_by_day limitado a 366 dias'; end if;
  if (select sum(s.unidades) from public.sales_by_day(v_t, 30) s) <> 73 then raise exception 'sales_by_day 30 dias deveria pegar o7'; end if;
end $$;
select auth.test_logout();
-- Conector desconectado (o dono do banco troca o status; authenticated só lê connectors): o saldo do hub dele sai do resumo.
update public.connectors set status = 'desconectado' where id = '19000000-0000-0000-0000-0000000000c1';
select auth.test_login('00000000-0000-0000-0000-00000000019a');
do $$ begin
  if public.demand_summary(current_setting('test.tenant_a')::uuid) -> 'hub' <> '[]'::jsonb then raise exception 'hub de conector desconectado não entra'; end if;
end $$;
select auth.test_logout();

-- Leitura (papel sem escrita) lê o resumo e as vendas por dia.
select auth.test_login('00000000-0000-0000-0000-00000000019c');
do $$ begin
  if (public.demand_summary(current_setting('test.tenant_a')::uuid) ->> 'pedidos')::int <> 5 then raise exception 'leitura deveria ler o resumo'; end if;
  if (select count(*) from public.sales_by_day(current_setting('test.tenant_a')::uuid)) <> 14 then raise exception 'leitura deveria ler as vendas por dia'; end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Tenant B: não lê a demanda de A; a dele está vazia.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000019b');
do $$
declare v_a uuid := current_setting('test.tenant_a')::uuid; v jsonb;
begin
  begin
    perform public.demand_summary(v_a);
    raise exception 'demand_summary de A por B deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.sales_by_day(v_a, 14);
    raise exception 'sales_by_day de A por B deveria falhar';
  exception when insufficient_privilege then null; end;
  begin
    perform public.demand_for_projection(v_a);
    raise exception 'demand_for_projection de A por B deveria falhar';
  exception when insufficient_privilege then null; end;
  v := public.demand_summary(current_setting('test.tenant_b')::uuid);
  if (v ->> 'pedidos')::int <> 0 or v -> 'produtos' <> '[]'::jsonb or v ->> 'ultimo_pedido' is not null or v -> 'hub' <> '[]'::jsonb then
    raise exception 'B deveria ver a demanda vazia: %', v;
  end if;
  if (select sum(s.unidades) from public.sales_by_day(current_setting('test.tenant_b')::uuid, 14) s) <> 0 then raise exception 'B não vê vendas de A'; end if;
end $$;
select auth.test_logout();

-- anon não executa nada disto
do $$ begin
  if has_function_privilege('anon', 'public.demand_summary(uuid,int)', 'execute') or has_function_privilege('anon', 'public.sales_by_day(uuid,int)', 'execute') then
    raise exception 'anon não pode executar as funções de demanda';
  end if;
  if not has_function_privilege('authenticated', 'public.demand_summary(uuid,int)', 'execute') then raise exception 'authenticated deveria executar demand_summary'; end if;
end $$;

-- O `delete from order_items where order_id = v_id` de worker_upsert_orders filtra só por order_id: o índice precisa
-- começar por order_id. Um índice (tenant_id, order_id) não serve a esse delete, e cada pedido gravado lia a tabela
-- inteira (medido: 100 pedidos em 1,1 s com 200 mil itens; com o índice certo, 21 ms). O mesmo índice atende o join de
-- demand_summary e o on delete cascade da FK (tenant_id, order_id).
do $$ begin
  if not exists (select 1 from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
                  where x.indrelid = 'public.order_items'::regclass and a.attname = 'order_id') then
    raise exception 'order_items sem índice que comece por order_id: o delete de worker_upsert_orders lê a tabela inteira';
  end if;
end $$;

rollback;

-- O diagnóstico do fundador (supabase/diagnostico/demanda.sql) roda inteiro numa transação SÓ LEITURA: se alguém puser
-- ali um comando que grava, o Postgres recusa e este teste quebra; se o schema mudar e ele parar de rodar, também.
begin read only;
\o /dev/null
\ir ../diagnostico/demanda.sql
\o
rollback;
