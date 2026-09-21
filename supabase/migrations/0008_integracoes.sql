-- 0008 · Integrações: conectores (completa a 0004), credenciais cifradas, mapa de status, estado de sync,
-- pedidos importados (demanda), snapshots do hub, auditoria, RPCs do worker. Contrato em docs/schema.md (seção 0008).
-- Regra: RPCs worker_* só aceitam service_role (auth.role()) e não têm execute para authenticated.

alter table public.connectors
  add column if not exists ultimo_sync timestamptz,
  add column if not exists ultimo_erro text,
  add column if not exists updated_at timestamptz not null default now();
drop trigger if exists connectors_updated_at on public.connectors;
create trigger connectors_updated_at before update on public.connectors for each row execute function public.set_updated_at();
drop trigger if exists connectors_audit on public.connectors;
create trigger connectors_audit after insert or update or delete on public.connectors for each row execute function public.audit_trigger();

-- Credenciais: bytea cifrado com pgp_sym_encrypt e a CREDENTIALS_KEY do worker. Sem SELECT para authenticated.
create table if not exists public.connector_credentials (
  connector_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payload bytea not null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete cascade
);

create table if not exists public.connector_status_map (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connector_id uuid not null,
  status_externo text not null,
  significado text not null check (significado in ('ignorar', 'demanda', 'carteira', 'enviado', 'cancelado')),
  primary key (tenant_id, connector_id, status_externo),
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete cascade
);

create table if not exists public.sync_state (
  connector_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cursor jsonb,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  runs int not null default 0,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete cascade
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connector_id uuid not null,
  external_id text not null,
  external_status text,
  significado text check (significado is null or significado in ('ignorar', 'demanda', 'carteira', 'enviado', 'cancelado')),
  confirmed_at timestamptz,
  updated_at_external timestamptz,
  total numeric(14,2) not null default 0,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, connector_id, external_id),
  unique (tenant_id, id),
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete cascade
);
create index if not exists orders_confirmed_idx on public.orders(tenant_id, confirmed_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  sku_externo text,
  product_id uuid,
  quantidade numeric(14,4) not null default 0,
  preco numeric(14,4) not null default 0,
  foreign key (tenant_id, order_id) references public.orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id)
);
create index if not exists order_items_product_idx on public.order_items(tenant_id, product_id);

create table if not exists public.hub_stock_snapshots (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connector_id uuid not null,
  product_id uuid not null,
  saldo_hub numeric(14,4) not null default 0,
  capturado_em timestamptz not null default now(),
  primary key (tenant_id, connector_id, product_id),
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete cascade
);

create table if not exists public.audit_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connector_id uuid,
  executado_em timestamptz not null default now(),
  divergencias jsonb not null default '[]'::jsonb,
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete set null (connector_id)
);
create index if not exists audit_runs_tenant_idx on public.audit_runs(tenant_id, executado_em desc);

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS e grants: leitura por tenant; escrita só por RPC. connector_credentials não tem leitura nem para o tenant.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['connector_credentials', 'connector_status_map', 'sync_state', 'orders', 'order_items', 'hub_stock_snapshots', 'audit_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    if t <> 'connector_credentials' then
      execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
end $$;
grant select, insert, update, delete on public.connectors, public.connector_status_map, public.sync_state, public.orders, public.order_items,
  public.hub_stock_snapshots, public.audit_runs, public.integration_outbox to service_role;

-- ---------------------------------------------------------------------------
-- Guarda do worker
-- ---------------------------------------------------------------------------
create or replace function public.assert_service_role()
returns void language plpgsql stable set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'somente o worker (service_role)' using errcode = '42501'; end if;
end $$;
revoke execute on function public.assert_service_role() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs de cliente (admin)
-- ---------------------------------------------------------------------------
-- p_config pode trazer `status` (a interface grava por aqui); o resto vai para connectors.config.
create or replace function public.upsert_connector(p_tenant_id uuid, p_id uuid, p_plataforma text, p_nome text, p_config jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text := nullif(p_config ->> 'status', ''); v_config jsonb := coalesce(p_config, '{}'::jsonb) - 'status' - 'cursor' - 'pedidos_24h';
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  if p_plataforma not in ('baselinker', 'bling', 'tiny', 'omie', 'magis5') then raise exception 'plataforma inválida: %', p_plataforma using errcode = '22023'; end if;
  if v_status is not null and v_status not in ('conectado', 'erro', 'desconectado') then raise exception 'status inválido: %', v_status using errcode = '22023'; end if;
  select c.id into v_id from public.connectors c where c.tenant_id = p_tenant_id and (c.id = p_id or (p_id is null and c.plataforma = p_plataforma));
  if v_id is null and p_id is not null and exists (select 1 from public.connectors c where c.id = p_id) then
    raise exception 'conector não encontrado' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.connectors (id, tenant_id, plataforma, nome, status, config)
    values (coalesce(p_id, gen_random_uuid()), p_tenant_id, p_plataforma, coalesce(nullif(p_nome, ''), p_plataforma), coalesce(v_status, 'desconectado'), v_config)
    returning id into v_id;
  else
    update public.connectors set nome = coalesce(nullif(p_nome, ''), nome), plataforma = p_plataforma, status = coalesce(v_status, status),
      config = config || v_config, ultimo_erro = case when v_status = 'conectado' then null else ultimo_erro end
     where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.upsert_connector(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.upsert_connector(uuid, uuid, text, text, jsonb) to authenticated;

-- Substitui o mapa inteiro do conector. p_map: [{status_externo, significado}]
create or replace function public.set_status_map(p_tenant_id uuid, p_connector_id uuid, p_map jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  if not exists (select 1 from public.connectors c where c.id = p_connector_id and c.tenant_id = p_tenant_id) then raise exception 'conector não encontrado' using errcode = '22023'; end if;
  delete from public.connector_status_map where tenant_id = p_tenant_id and connector_id = p_connector_id;
  insert into public.connector_status_map (tenant_id, connector_id, status_externo, significado)
  select distinct on (x ->> 'status_externo') p_tenant_id, p_connector_id, x ->> 'status_externo', x ->> 'significado'
    from jsonb_array_elements(coalesce(p_map, '[]'::jsonb)) x where nullif(x ->> 'status_externo', '') is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.set_status_map(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_status_map(uuid, uuid, jsonb) to authenticated;

-- Desconecta: apaga credenciais, marca desconectado e ignora o outbox pendente do conector.
create or replace function public.disconnect_connector(p_tenant_id uuid, p_connector_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  update public.connectors set status = 'desconectado', ultimo_erro = null where id = p_connector_id and tenant_id = p_tenant_id;
  if not found then raise exception 'conector não encontrado' using errcode = '22023'; end if;
  delete from public.connector_credentials where connector_id = p_connector_id;
  update public.integration_outbox set status = 'ignorado', erro = 'conector desconectado' where connector_id = p_connector_id and status in ('pendente', 'erro');
end $$;
revoke execute on function public.disconnect_connector(uuid, uuid) from public, anon;
grant execute on function public.disconnect_connector(uuid, uuid) to authenticated;

-- Reenvio manual pela interface: item em 'erro' volta a 'pendente' e o worker aplica no próximo ciclo.
create or replace function public.retry_outbox(p_tenant_id uuid, p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  update public.integration_outbox set status = 'pendente', erro = null
   where tenant_id = p_tenant_id and id = p_id and status = 'erro';
  if not found then raise exception 'item do outbox não encontrado ou não está em erro' using errcode = '22023'; end if;
end $$;
revoke execute on function public.retry_outbox(uuid, bigint) from public, anon;
grant execute on function public.retry_outbox(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs do worker (service_role)
-- ---------------------------------------------------------------------------
create or replace function public.worker_set_credentials(p_tenant_id uuid, p_connector_id uuid, p_payload jsonb, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_service_role();
  if coalesce(p_key, '') = '' then raise exception 'chave de cifra obrigatória' using errcode = '22023'; end if;
  if not exists (select 1 from public.connectors c where c.id = p_connector_id and c.tenant_id = p_tenant_id) then raise exception 'conector não encontrado' using errcode = '22023'; end if;
  insert into public.connector_credentials (connector_id, tenant_id, payload, updated_at)
  values (p_connector_id, p_tenant_id, extensions.pgp_sym_encrypt(coalesce(p_payload, '{}'::jsonb)::text, p_key), now())
  on conflict (connector_id) do update set payload = excluded.payload, updated_at = now();
end $$;
revoke execute on function public.worker_set_credentials(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.worker_set_credentials(uuid, uuid, jsonb, text) to service_role;

create or replace function public.worker_get_credentials(p_connector_id uuid, p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v bytea;
begin
  perform public.assert_service_role();
  select payload into v from public.connector_credentials where connector_id = p_connector_id;
  if v is null then return null; end if;
  return extensions.pgp_sym_decrypt(v, p_key)::jsonb;
end $$;
revoke execute on function public.worker_get_credentials(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_get_credentials(uuid, text) to service_role;

-- p_orders: [{external_id, external_status, confirmed_at, updated_at_external, total, raw, itens: [{sku_externo, quantidade, preco}]}]
-- significado vem do connector_status_map; sem mapa cadastrado, todo pedido conta como demanda.
create or replace function public.worker_upsert_orders(p_tenant_id uuid, p_connector_id uuid, p_orders jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_id uuid; v_sig text; v_has_map boolean; v_n int := 0;
begin
  perform public.assert_service_role();
  if not exists (select 1 from public.connectors c where c.id = p_connector_id and c.tenant_id = p_tenant_id) then raise exception 'conector não encontrado' using errcode = '22023'; end if;
  v_has_map := exists (select 1 from public.connector_status_map m where m.connector_id = p_connector_id);
  for x in select * from jsonb_array_elements(coalesce(p_orders, '[]'::jsonb)) loop
    if nullif(x ->> 'external_id', '') is null then continue; end if;
    select m.significado into v_sig from public.connector_status_map m where m.connector_id = p_connector_id and m.status_externo = coalesce(x ->> 'external_status', '');
    if v_sig is null and not v_has_map then v_sig := 'demanda'; end if;
    insert into public.orders (tenant_id, connector_id, external_id, external_status, significado, confirmed_at, updated_at_external, total, raw)
    values (p_tenant_id, p_connector_id, x ->> 'external_id', x ->> 'external_status', v_sig, (x ->> 'confirmed_at')::timestamptz, (x ->> 'updated_at_external')::timestamptz,
            coalesce((x ->> 'total')::numeric, 0), x -> 'raw')
    on conflict (tenant_id, connector_id, external_id) do update set external_status = excluded.external_status, significado = excluded.significado,
      confirmed_at = coalesce(excluded.confirmed_at, orders.confirmed_at), updated_at_external = coalesce(excluded.updated_at_external, orders.updated_at_external),
      total = excluded.total, raw = coalesce(excluded.raw, orders.raw)
    returning id into v_id;
    delete from public.order_items where order_id = v_id;
    insert into public.order_items (tenant_id, order_id, sku_externo, product_id, quantidade, preco)
    select p_tenant_id, v_id, i ->> 'sku_externo',
           coalesce((select a.product_id from public.sku_aliases a join public.products ap on ap.id = a.product_id and ap.tenant_id = p_tenant_id
                       where a.tenant_id = p_tenant_id and a.sku_externo = i ->> 'sku_externo' limit 1),
                    (select p.id from public.products p where p.tenant_id = p_tenant_id and p.sku = i ->> 'sku_externo' and p.deleted_at is null limit 1)),
           coalesce((i ->> 'quantidade')::numeric, 0), coalesce((i ->> 'preco')::numeric, 0)
      from jsonb_array_elements(coalesce(x -> 'itens', '[]'::jsonb)) i;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.worker_upsert_orders(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.worker_upsert_orders(uuid, uuid, jsonb) to service_role;

-- Reserva um lote do outbox (for update skip locked), marca em_processamento e devolve agrupado por produto.
create or replace function public.worker_claim_outbox(p_connector_id uuid, p_limit int default 200)
returns table (product_id uuid, sku text, delta numeric, ids bigint[])
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_service_role();
  return query
    with lote as (
      select o.id from public.integration_outbox o
       where o.connector_id = p_connector_id and o.status = 'pendente'
       order by o.created_at, o.id limit greatest(coalesce(p_limit, 200), 1)
       for update skip locked
    ), marcado as (
      update public.integration_outbox o set status = 'em_processamento', tentativas = o.tentativas + 1
        from lote where o.id = lote.id
      returning o.id, o.product_id, o.delta
    )
    select m.product_id, p.sku, sum(m.delta)::numeric, array_agg(m.id order by m.id)
      from marcado m join public.products p on p.id = m.product_id
     group by m.product_id, p.sku order by p.sku;
end $$;
revoke execute on function public.worker_claim_outbox(uuid, int) from public, anon, authenticated;
grant execute on function public.worker_claim_outbox(uuid, int) to service_role;

-- p_ok: aplicado. p_ok=false com erro: 'erro'. p_ok=false sem erro: volta a 'pendente' sem contar tentativa (freio do lote).
create or replace function public.worker_apply_outbox_result(p_ids bigint[], p_ok boolean, p_erro text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_service_role();
  if p_ok then
    update public.integration_outbox set status = 'aplicado', erro = null, applied_at = now() where id = any (p_ids) and status = 'em_processamento';
  elsif nullif(p_erro, '') is null then
    update public.integration_outbox set status = 'pendente', tentativas = greatest(tentativas - 1, 0) where id = any (p_ids) and status = 'em_processamento';
  else
    update public.integration_outbox set status = 'erro', erro = left(p_erro, 500) where id = any (p_ids) and status = 'em_processamento';
  end if;
end $$;
revoke execute on function public.worker_apply_outbox_result(bigint[], boolean, text) from public, anon, authenticated;
grant execute on function public.worker_apply_outbox_result(bigint[], boolean, text) to service_role;

-- Cursor nulo mantém o anterior; p_ok=false grava ultimo_erro e status 'erro' (não reativa conector desconectado).
create or replace function public.worker_set_sync_state(p_connector_id uuid, p_cursor jsonb, p_ok boolean, p_erro text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  perform public.assert_service_role();
  select c.tenant_id into v_tenant from public.connectors c where c.id = p_connector_id;
  if v_tenant is null then raise exception 'conector não encontrado' using errcode = '22023'; end if;
  insert into public.sync_state (connector_id, tenant_id, cursor, last_run_at, last_ok_at, runs)
  values (p_connector_id, v_tenant, p_cursor, now(), case when p_ok then now() end, 1)
  on conflict (connector_id) do update set cursor = coalesce(excluded.cursor, sync_state.cursor), last_run_at = now(),
    last_ok_at = case when p_ok then now() else sync_state.last_ok_at end, runs = sync_state.runs + 1, updated_at = now();
  update public.connectors set
    ultimo_sync = case when p_ok then now() else ultimo_sync end,
    ultimo_erro = case when p_ok then null else left(p_erro, 500) end,
    status = case when status = 'desconectado' then status when p_ok then 'conectado' else 'erro' end
   where id = p_connector_id;
end $$;
revoke execute on function public.worker_set_sync_state(uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.worker_set_sync_state(uuid, jsonb, boolean, text) to service_role;

-- p_itens: [{sku, saldo}] (sku do hub: resolve por alias ou sku do produto)
create or replace function public.worker_upsert_hub_stock(p_tenant_id uuid, p_connector_id uuid, p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.assert_service_role();
  if not exists (select 1 from public.connectors c where c.id = p_connector_id and c.tenant_id = p_tenant_id) then raise exception 'conector não encontrado' using errcode = '22023'; end if;
  insert into public.hub_stock_snapshots (tenant_id, connector_id, product_id, saldo_hub, capturado_em)
  select distinct on (r.product_id) p_tenant_id, p_connector_id, r.product_id, r.saldo, now()
    from (
      select coalesce((select a.product_id from public.sku_aliases a join public.products ap on ap.id = a.product_id and ap.tenant_id = p_tenant_id
                        where a.tenant_id = p_tenant_id and a.sku_externo = i ->> 'sku' limit 1),
                      (select p.id from public.products p where p.tenant_id = p_tenant_id and p.sku = i ->> 'sku' limit 1)) as product_id,
             coalesce((i ->> 'saldo')::numeric, 0) as saldo
        from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
    ) r where r.product_id is not null
  on conflict (tenant_id, connector_id, product_id) do update set saldo_hub = excluded.saldo_hub, capturado_em = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.worker_upsert_hub_stock(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.worker_upsert_hub_stock(uuid, uuid, jsonb) to service_role;

create or replace function public.worker_record_audit(p_tenant_id uuid, p_connector_id uuid, p_divergencias jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.assert_service_role();
  insert into public.audit_runs (tenant_id, connector_id, divergencias) values (p_tenant_id, p_connector_id, coalesce(p_divergencias, '[]'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.worker_record_audit(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.worker_record_audit(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Demanda por SKU: view (janelas fixas) e função com N dias para a projeção.
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
  left join public.orders o on o.id = i.order_id and o.significado in ('demanda', 'carteira') and o.confirmed_at >= now() - interval '30 days'
 where p.deleted_at is null
 group by p.tenant_id, p.id;
revoke all on table public.v_demand_by_sku from public, anon, authenticated;
grant select on public.v_demand_by_sku to authenticated, service_role;

-- Membro do tenant ou worker (service_role).
create or replace function public.demand_for_projection(p_tenant_id uuid, p_dias int default 14)
returns table (product_id uuid, sku text, vendido numeric, carteira numeric, demanda_dia numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then perform public.assert_member(p_tenant_id); end if;
  return query
  select p.id, p.sku,
         coalesce(sum(i.quantidade) filter (where o.significado in ('demanda', 'carteira')), 0)::numeric(14,4),
         coalesce(sum(i.quantidade) filter (where o.significado = 'carteira'), 0)::numeric(14,4),
         (coalesce(sum(i.quantidade) filter (where o.significado in ('demanda', 'carteira')), 0) / greatest(coalesce(p_dias, 14), 1))::numeric(14,4)
    from public.products p
    left join public.order_items i on i.product_id = p.id and i.tenant_id = p.tenant_id
    left join public.orders o on o.id = i.order_id and o.confirmed_at >= now() - make_interval(days => greatest(coalesce(p_dias, 14), 1))
   where p.tenant_id = p_tenant_id and p.deleted_at is null and p.status = 'ativo'
   group by p.id, p.sku;
end $$;
revoke execute on function public.demand_for_projection(uuid, int) from public, anon;
grant execute on function public.demand_for_projection(uuid, int) to authenticated, service_role;
