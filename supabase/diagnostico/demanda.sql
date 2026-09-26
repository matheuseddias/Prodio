-- Diagnóstico da demanda (26/09/2026) · SÓ LEITURA: nenhum comando aqui grava, apaga ou altera nada.
-- Rode no SQL Editor do Supabase. O editor mostra só o resultado do ÚLTIMO comando: rodando o arquivo
-- inteiro você vê o bloco 6 (resumo). Para ver outro bloco, selecione só ele e clique em "Run".
-- Todas as datas saem no fuso da empresa (tenants.fuso).

-- 1. Até onde o robô já leu, por conector: `lido_ate` é o cursor gravado em sync_state (o próximo pedido que ele
--    busca é confirmado a partir dali). A carga inicial anda 2 páginas de 100 pedidos por rodada de 5 minutos.
select t.nome as empresa, c.nome as conector, c.plataforma, c.status,
       case when s.cursor ->> 'date_confirmed_from' ~ '^[0-9]+(\.[0-9]+)?$' then to_timestamp((s.cursor ->> 'date_confirmed_from')::double precision) at time zone t.fuso
            when s.cursor ->> 'alterado_desde' ~ '^[0-9]+(\.[0-9]+)?$' then to_timestamp((s.cursor ->> 'alterado_desde')::double precision / 1000) at time zone t.fuso
       end as lido_ate,
       s.last_ok_at at time zone t.fuso as ultima_rodada_ok,
       s.last_run_at at time zone t.fuso as ultima_tentativa,
       s.runs as rodadas,
       c.config ->> 'dias_iniciais' as dias_iniciais,
       c.config ->> 'paginas_por_rodada' as paginas_por_rodada,
       c.ultimo_erro,
       s.cursor
  from public.connectors c
  join public.tenants t on t.id = c.tenant_id
  left join public.sync_state s on s.connector_id = c.id
 order by t.nome, c.nome;

-- 2. Pedidos por dia de confirmação nos últimos 90 dias: quantos pedidos, itens com e sem produto e unidades.
--    Dia sem linha = nenhum pedido gravado naquele dia (a carga ainda não chegou lá, ou não houve venda).
select t.nome as empresa,
       (o.confirmed_at at time zone t.fuso)::date as dia,
       count(distinct o.id) as pedidos,
       count(distinct o.id) filter (where o.significado = 'ignorar') as pedidos_ignorar,
       count(distinct o.id) filter (where o.significado is null) as pedidos_sem_significado,
       count(i.id) as itens,
       count(i.id) filter (where i.product_id is not null) as itens_com_produto,
       count(i.id) filter (where i.product_id is null) as itens_sem_produto,
       coalesce(sum(i.quantidade), 0) as unidades
  from public.orders o
  join public.tenants t on t.id = o.tenant_id
  left join public.order_items i on i.tenant_id = o.tenant_id and i.order_id = o.id
 where o.confirmed_at >= now() - interval '90 days'
 group by t.nome, 2
 order by t.nome, 2 desc;

-- 3. Status da plataforma × significado no Prodio (90 dias). Sem significado = status fora do De-Para.
select t.nome as empresa, o.external_status as status_na_plataforma, coalesce(o.significado, '(sem significado)') as significado,
       count(*) as pedidos, min(o.confirmed_at) at time zone t.fuso as primeiro, max(o.confirmed_at) at time zone t.fuso as ultimo
  from public.orders o
  join public.tenants t on t.id = o.tenant_id
 where o.confirmed_at >= now() - interval '90 days'
 group by t.nome, o.external_status, o.significado, t.fuso
 order by t.nome, pedidos desc;

-- 4. Os SKUs que chegam nos pedidos (90 dias) e não casam com produto nem apelido do Prodio.
select t.nome as empresa, coalesce(nullif(i.sku_externo, ''), '(sem SKU)') as sku, sum(i.quantidade) as unidades,
       count(distinct i.order_id) as pedidos
  from public.order_items i
  join public.orders o on o.tenant_id = i.tenant_id and o.id = i.order_id
  join public.tenants t on t.id = i.tenant_id
 where i.product_id is null and o.confirmed_at >= now() - interval '90 days'
 group by t.nome, 2
 order by t.nome, unidades desc
 limit 50;

-- 5. Produtos vendidos nos últimos 14 dias (regra de 25/09: todo pedido confirmado conta, menos 'ignorar'), com e
--    sem ficha técnica ativa. `ativos_sem_ficha_vendidos_ou_nao` é o que o Painel mostrava como "Produtos vendidos
--    sem ficha" (contava todo produto ativo sem ficha, vendido ou não).
with vendidos as (
  select i.tenant_id, i.product_id, sum(i.quantidade) as unidades
    from public.order_items i
    join public.orders o on o.tenant_id = i.tenant_id and o.id = i.order_id
   where i.product_id is not null and o.confirmed_at >= now() - interval '14 days' and o.significado is distinct from 'ignorar'
   group by i.tenant_id, i.product_id
), ficha as (
  select v.tenant_id, v.product_id from public.bom_versions v
   where v.ativa and exists (select 1 from public.bom_lines l where l.bom_version_id = v.id)
)
select t.nome as empresa,
       (select count(*) from vendidos x where x.tenant_id = t.id) as produtos_vendidos_14d,
       (select count(*) from vendidos x where x.tenant_id = t.id and exists (select 1 from ficha f where f.tenant_id = x.tenant_id and f.product_id = x.product_id)) as vendidos_com_ficha_ativa,
       (select count(*) from vendidos x where x.tenant_id = t.id and not exists (select 1 from ficha f where f.tenant_id = x.tenant_id and f.product_id = x.product_id)) as vendidos_sem_ficha,
       (select count(*) from public.products p where p.tenant_id = t.id and p.deleted_at is null and p.status = 'ativo'
           and not exists (select 1 from ficha f where f.tenant_id = p.tenant_id and f.product_id = p.id)) as ativos_sem_ficha_vendidos_ou_nao,
       (select count(*) from public.products p where p.tenant_id = t.id and p.deleted_at is null) as produtos_cadastrados
  from public.tenants t
 order by t.nome;

-- 6. Resumo (é o que aparece rodando o arquivo inteiro).
select t.nome as empresa, x.indicador, x.valor
  from public.tenants t
  cross join lateral (values
    (1, 'último pedido gravado (qualquer status)', (select to_char(max(o.confirmed_at) at time zone t.fuso, 'DD/MM/YYYY HH24:MI') from public.orders o where o.tenant_id = t.id)),
    (2, 'pedidos gravados nos últimos 90 dias', (select count(*)::text from public.orders o where o.tenant_id = t.id and o.confirmed_at >= now() - interval '90 days')),
    (3, 'pedidos nas últimas 24 h (menos ignorar)', (select count(*)::text from public.orders o where o.tenant_id = t.id and o.confirmed_at >= now() - interval '24 hours' and o.significado is distinct from 'ignorar')),
    (4, 'pedidos nos últimos 14 dias (menos ignorar)', (select count(*)::text from public.orders o where o.tenant_id = t.id and o.confirmed_at >= now() - interval '14 days' and o.significado is distinct from 'ignorar')),
    (5, 'itens de pedido (90 dias) com produto', (select count(*)::text from public.order_items i join public.orders o on o.tenant_id = i.tenant_id and o.id = i.order_id where i.tenant_id = t.id and i.product_id is not null and o.confirmed_at >= now() - interval '90 days')),
    (6, 'itens de pedido (90 dias) sem produto', (select count(*)::text from public.order_items i join public.orders o on o.tenant_id = i.tenant_id and o.id = i.order_id where i.tenant_id = t.id and i.product_id is null and o.confirmed_at >= now() - interval '90 days')),
    (7, 'produtos vendidos em 14 dias', (select count(distinct i.product_id)::text from public.order_items i join public.orders o on o.tenant_id = i.tenant_id and o.id = i.order_id where i.tenant_id = t.id and i.product_id is not null and o.confirmed_at >= now() - interval '14 days' and o.significado is distinct from 'ignorar')),
    (8, 'desses, com ficha técnica ativa', (select count(distinct i.product_id)::text from public.order_items i join public.orders o on o.tenant_id = i.tenant_id and o.id = i.order_id where i.tenant_id = t.id and i.product_id is not null and o.confirmed_at >= now() - interval '14 days' and o.significado is distinct from 'ignorar' and exists (select 1 from public.bom_versions v join public.bom_lines l on l.bom_version_id = v.id where v.tenant_id = i.tenant_id and v.product_id = i.product_id and v.ativa))),
    (9, 'plano do dia gravado hoje (linhas)', (select count(*)::text from public.daily_plans d where d.tenant_id = t.id and d.dia = ((now() at time zone t.fuso) - t.hora_virada)::date)),
    (10, 'produtos com saldo do hub (snapshot)', (select count(*)::text from public.hub_stock_snapshots h where h.tenant_id = t.id))
  ) as x(ordem, indicador, valor)
 order by t.nome, x.ordem;
