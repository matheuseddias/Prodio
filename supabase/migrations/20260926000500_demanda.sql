-- 20260926000500 · Demanda pelos pedidos: a média de vendas chega na Linha de hoje, na Necessidade de compra e no
-- Painel (docs/melhorias.md itens 13, 15b, 16 e 17). Reexecutável: add column if not exists, create index if not
-- exists, create or replace (view e funções mantêm nome, colunas e argumentos).
--
-- O que muda:
--   1. tenants.dias_demanda: a janela da média de vendas (N dias corridos), por empresa. Padrão 14.
--      tenants.dias_cobertura_acabado: quantos dias de venda a sugestão da Linha de hoje repõe no hub quando o saldo
--      de acabado é conhecido. Padrão 3 (o mínimo de produto da curva A no ES). Antes a Linha de hoje usava
--      dias_cobertura, que é a cobertura de INSUMO da compra (15): com saldo no hub, pedia 15 dias de venda num dia só.
--   2. Regra dos pedidos que contam (decisão do fundador de 25/09): todo pedido confirmado na janela conta, inclusive
--      cancelado e enviado; só o status mapeado como 'ignorar' fica de fora. Sem significado (status fora do De-Para)
--      conta. Antes v_demand_by_sku e demand_for_projection somavam só 'demanda' e 'carteira': com o De-Para
--      preenchido, o pedido que já saiu da fábrica (enviado) sumia da média — e na carga inicial de 90 dias quase
--      todo pedido já está enviado.
--   3. demand_for_projection.demanda_dia passa a ser por DIA DE PRODUÇÃO (item 17): vendido ÷ dias × 30 ÷
--      dias_uteis_mes, a mesma conta de packages/core/src/planejamento.ts (demandaPorDiaDeProducao, sem margem).
--   4. demand_summary: o agregado que a web lê (uma chamada, só somas; os pedidos nunca vão para o navegador).
--   5. sales_by_day: unidades e pedidos por dia de calendário (fuso do tenant) para o gráfico do Painel. Antes a web
--      trazia pedido por pedido e o teto de 1.000 linhas do PostgREST cortava a série sem aviso.
--   6. Índice de order_items por pedido: as agregações e o `delete … where order_id` de worker_upsert_orders.
-- Regra igual à do core (planejamento.ts: contaNaDemanda, resumirPedidos); teste em supabase/tests/0019_demanda.test.sql.

-- ---------------------------------------------------------------------------
-- 1. Janela da média de vendas por empresa
-- ---------------------------------------------------------------------------
alter table public.tenants add column if not exists dias_demanda int not null default 14 check (dias_demanda between 1 and 90);
alter table public.tenants add column if not exists dias_cobertura_acabado int not null default 3 check (dias_cobertura_acabado between 0 and 60);

-- ---------------------------------------------------------------------------
-- 6. Índice por pedido. Começa por order_id: o `delete from order_items where order_id = v_id` de
--    worker_upsert_orders filtra só por ele (um índice (tenant_id, order_id) não servia e cada pedido gravado lia a
--    tabela inteira: 100 pedidos em 1,1 s com 200 mil itens; assim, 21 ms). Atende também o join de demand_summary e
--    o on delete cascade da FK (tenant_id, order_id).
-- ---------------------------------------------------------------------------
create index if not exists order_items_order_id_idx on public.order_items(order_id);

-- ---------------------------------------------------------------------------
-- 2. View de demanda por SKU (mesmas colunas; só a regra dos pedidos que contam muda)
-- ---------------------------------------------------------------------------
create or replace view public.v_demand_by_sku with (security_invoker = on) as
select p.tenant_id, p.id as product_id, p.sku, p.nome,
       coalesce(sum(i.quantidade) filter (where o.confirmed_at >= now() - interval '7 days'), 0)::numeric(14,4) as vendido_7d,
       coalesce(sum(i.quantidade) filter (where o.confirmed_at >= now() - interval '14 days'), 0)::numeric(14,4) as vendido_14d,
       coalesce(sum(i.quantidade) filter (where o.confirmed_at >= now() - interval '30 days'), 0)::numeric(14,4) as vendido_30d,
       coalesce(sum(i.quantidade) filter (where o.significado = 'carteira'), 0)::numeric(14,4) as carteira,
       max(o.confirmed_at) as ultimo_pedido
  from public.products p
  left join public.order_items i on i.product_id = p.id and i.tenant_id = p.tenant_id
  left join public.orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
        and o.significado is distinct from 'ignorar' and o.confirmed_at >= now() - interval '30 days'
 where p.deleted_at is null
 group by p.tenant_id, p.id;
revoke all on table public.v_demand_by_sku from public, anon, authenticated;
grant select on public.v_demand_by_sku to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Demanda para a projeção (membro do tenant ou worker). p_dias nulo = tenants.dias_demanda.
--    carteira continua limitada à janela: sem o acompanhamento de status depois da confirmação (item 5), um pedido
--    'carteira' antigo ficaria em carteira para sempre.
-- ---------------------------------------------------------------------------
create or replace function public.demand_for_projection(p_tenant_id uuid, p_dias int default null)
returns table (product_id uuid, sku text, vendido numeric, carteira numeric, demanda_dia numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_dias int; v_uteis int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then perform public.assert_member(p_tenant_id); end if;
  select coalesce(p_dias, t.dias_demanda), t.dias_uteis_mes into v_dias, v_uteis from public.tenants t where t.id = p_tenant_id;
  v_dias := least(greatest(coalesce(v_dias, 14), 1), 90);
  v_uteis := greatest(coalesce(v_uteis, 22), 1);
  return query
  select p.id, p.sku,
         coalesce(sum(i.quantidade) filter (where o.id is not null), 0)::numeric(14,4),
         coalesce(sum(i.quantidade) filter (where o.significado = 'carteira'), 0)::numeric(14,4),
         (coalesce(sum(i.quantidade) filter (where o.id is not null), 0) / v_dias * 30 / v_uteis)::numeric(14,4)
    from public.products p
    left join public.order_items i on i.product_id = p.id and i.tenant_id = p.tenant_id
    left join public.orders o on o.id = i.order_id and o.tenant_id = i.tenant_id
          and o.confirmed_at >= now() - make_interval(days => v_dias) and o.significado is distinct from 'ignorar'
   where p.tenant_id = p_tenant_id and p.deleted_at is null and p.status = 'ativo'
   group by p.id, p.sku;
end $$;
revoke execute on function public.demand_for_projection(uuid, int) from public, anon;
grant execute on function public.demand_for_projection(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Resumo da demanda para a web. p_dias nulo = tenants.dias_demanda (1 a 90). Devolve jsonb:
--    dias, desde, gerado_em
--    ultimo_pedido      confirmação mais recente de QUALQUER pedido gravado (diz até onde o robô leu)
--    pedidos, pedidos_24h, unidades      da janela, pela regra acima
--    sem_produto        {linhas, unidades, skus} dos itens sem produto na janela
--    skus_sem_produto   [{sku, unidades, pedidos}] os 50 que mais vendem
--    produtos           [{product_id, vendido, carteira, ultimo_pedido}] com venda na janela
--    hub                [{product_id, saldo, capturado_em}] snapshot mais recente por produto, de conector ligado
-- Qualquer membro lê (é o que a RLS de orders, order_items e hub_stock_snapshots já deixa ler, só que somado).
-- ---------------------------------------------------------------------------
create or replace function public.demand_summary(p_tenant_id uuid, p_dias int default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dias int;
  v_agora timestamptz := now();
  v_desde timestamptz;
  v jsonb;
begin
  perform public.assert_member(p_tenant_id);
  select coalesce(p_dias, t.dias_demanda) into v_dias from public.tenants t where t.id = p_tenant_id;
  v_dias := least(greatest(coalesce(v_dias, 14), 1), 90);
  v_desde := v_agora - make_interval(days => v_dias);
  with ped as materialized (
    select o.id, o.confirmed_at, o.significado
      from public.orders o
     where o.tenant_id = p_tenant_id and o.confirmed_at >= v_desde and o.significado is distinct from 'ignorar'
  ), it as materialized (
    select i.product_id, coalesce(i.sku_externo, '') as sku, i.quantidade, ped.id as order_id, ped.confirmed_at, ped.significado
      from ped join public.order_items i on i.tenant_id = p_tenant_id and i.order_id = ped.id
  ), prod as (
    select it.product_id, sum(it.quantidade) as vendido, coalesce(sum(it.quantidade) filter (where it.significado = 'carteira'), 0) as carteira,
           max(it.confirmed_at) as ultimo
      from it where it.product_id is not null group by it.product_id
  ), sem as (
    select it.sku, sum(it.quantidade) as unidades, count(distinct it.order_id) as pedidos
      from it where it.product_id is null group by it.sku
  ), hub as (
    select distinct on (h.product_id) h.product_id, h.saldo_hub, h.capturado_em
      from public.hub_stock_snapshots h
      join public.connectors c on c.id = h.connector_id and c.tenant_id = h.tenant_id
     where h.tenant_id = p_tenant_id and c.status <> 'desconectado'
     order by h.product_id, h.capturado_em desc
  )
  select jsonb_build_object(
    'dias', v_dias,
    'desde', v_desde,
    'gerado_em', v_agora,
    'ultimo_pedido', (select max(o.confirmed_at) from public.orders o where o.tenant_id = p_tenant_id),
    'pedidos', (select count(*) from ped),
    'pedidos_24h', (select count(*) from ped where ped.confirmed_at >= v_agora - interval '24 hours'),
    'unidades', (select coalesce(sum(it.quantidade), 0) from it),
    'sem_produto', (select jsonb_build_object('linhas', count(*), 'unidades', coalesce(sum(it.quantidade), 0), 'skus', count(distinct it.sku))
                      from it where it.product_id is null),
    'skus_sem_produto', coalesce((select jsonb_agg(jsonb_build_object('sku', s.sku, 'unidades', s.unidades, 'pedidos', s.pedidos) order by s.unidades desc, s.sku)
                                    from (select * from sem order by sem.unidades desc, sem.sku limit 50) s), '[]'::jsonb),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'vendido', x.vendido, 'carteira', x.carteira, 'ultimo_pedido', x.ultimo)
                                            order by x.vendido desc, x.product_id)
                            from prod x), '[]'::jsonb),
    'hub', coalesce((select jsonb_agg(jsonb_build_object('product_id', h.product_id, 'saldo', h.saldo_hub, 'capturado_em', h.capturado_em) order by h.product_id)
                       from hub h), '[]'::jsonb))
    into v;
  return v;
end $$;
revoke execute on function public.demand_summary(uuid, int) from public, anon;
grant execute on function public.demand_summary(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Vendas por dia de calendário no fuso do tenant: os últimos p_dias dias até hoje (1 a 366), dia sem pedido = 0.
-- ---------------------------------------------------------------------------
create or replace function public.sales_by_day(p_tenant_id uuid, p_dias int default 14)
returns table (dia date, pedidos int, unidades numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text;
  v_hoje date;
  v_inicio date;
  v_dias int := least(greatest(coalesce(p_dias, 14), 1), 366);
begin
  perform public.assert_member(p_tenant_id);
  select t.fuso into v_fuso from public.tenants t where t.id = p_tenant_id;
  v_hoje := (now() at time zone v_fuso)::date;
  v_inicio := v_hoje - (v_dias - 1);
  return query
    with ped as (
      select (o.confirmed_at at time zone v_fuso)::date as d, o.id
        from public.orders o
       where o.tenant_id = p_tenant_id and o.confirmed_at >= (v_inicio::timestamp at time zone v_fuso)
         and o.significado is distinct from 'ignorar'
    ), agg as (
      select ped.d, count(distinct ped.id)::int as n, coalesce(sum(i.quantidade), 0)::numeric as un
        from ped left join public.order_items i on i.tenant_id = p_tenant_id and i.order_id = ped.id
       group by ped.d
    )
    select g.d::date, coalesce(agg.n, 0), coalesce(agg.un, 0)::numeric
      from generate_series(v_inicio::timestamp, v_hoje::timestamp, interval '1 day') as g(d)
      left join agg on agg.d = g.d::date
     order by 1;
end $$;
revoke execute on function public.sales_by_day(uuid, int) from public, anon;
grant execute on function public.sales_by_day(uuid, int) to authenticated;
