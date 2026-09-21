-- 0004 · Estoque: ledger append-only (stock_moves), saldos com custo médio (stock_balances), conectores (mínimo;
-- a 0008 completa) e outbox de integração, helpers de saldo e RPCs de movimento manual. Contrato em docs/schema.md (seção 0004).
-- Chaves de idempotência do ledger têm namespace por origem: manual:, nfe:, rcpt:, scan:, rev:, inv:. O cliente só
-- escreve em manual: (post_stock_move prefixa), então não consegue pré-ocupar a chave que outra RPC usaria.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  material_id uuid not null,
  location_id uuid not null,
  move_type text not null check (move_type in ('entrada_nfe', 'entrada_manual', 'baixa_producao', 'ajuste', 'perda', 'estorno', 'saldo_inicial', 'transferencia')),
  delta numeric(14,4) not null check (delta <> 0),
  custo_unit numeric(14,4),
  valor numeric(14,2),
  ref_type text,
  ref_id uuid,
  motivo text,
  idempotency_key text not null,
  reverses_id uuid references public.stock_moves(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id)
);
create index if not exists stock_moves_material_idx on public.stock_moves(tenant_id, material_id, created_at desc);
create index if not exists stock_moves_ref_idx on public.stock_moves(tenant_id, ref_type, ref_id);

-- Ledger append-only: nem o dono do banco altera ou apaga.
create or replace function public.forbid_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'stock_moves é append-only: use um movimento de estorno' using errcode = '55000';
end $$;
revoke execute on function public.forbid_change() from public, anon, authenticated;
drop trigger if exists stock_moves_append_only on public.stock_moves;
create trigger stock_moves_append_only before update or delete on public.stock_moves for each row execute function public.forbid_change();

create table if not exists public.stock_balances (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  material_id uuid not null,
  location_id uuid not null,
  saldo numeric(14,4) not null default 0,
  custo_medio numeric(14,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, material_id, location_id),
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id)
);

-- Conectores (mínimo) e outbox: nascem aqui porque o backflush do bipe (0005) enfileira; a 0008 completa as colunas.
create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plataforma text not null check (plataforma in ('baselinker', 'bling', 'tiny', 'omie', 'magis5')),
  nome text not null,
  status text not null default 'desconectado' check (status in ('conectado', 'erro', 'desconectado')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, plataforma),
  unique (tenant_id, id)
);

create table if not exists public.integration_outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connector_id uuid not null,
  product_id uuid not null,
  delta numeric(14,4) not null,
  dedupe_key text not null,
  status text not null default 'pendente' check (status in ('pendente', 'em_processamento', 'aplicado', 'erro', 'ignorado')),
  tentativas int not null default 0,
  erro text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (tenant_id, connector_id, dedupe_key),
  foreign key (tenant_id, connector_id) references public.connectors(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id)
);
create index if not exists integration_outbox_pending_idx on public.integration_outbox(connector_id, status, created_at) where status = 'pendente';

-- ---------------------------------------------------------------------------
-- RLS e grants: leitura por tenant para todos; nenhuma escrita direta (só RPC).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stock_moves', 'stock_balances', 'connectors', 'integration_outbox'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.integration_outbox_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers internos (sem execute para authenticated)
-- ---------------------------------------------------------------------------
-- Aplica um delta ao saldo (com lock) e devolve o custo unitário do movimento.
-- Entrada com custo informado: média ponderada. Saída: mantém o custo médio.
create or replace function public.apply_stock_delta(p_tenant_id uuid, p_material_id uuid, p_location_id uuid, p_delta numeric, p_custo_unit numeric)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  b public.stock_balances%rowtype;
  v_custo numeric(14,4);
begin
  insert into public.stock_balances (tenant_id, material_id, location_id) values (p_tenant_id, p_material_id, p_location_id)
  on conflict do nothing;
  select * into b from public.stock_balances where tenant_id = p_tenant_id and material_id = p_material_id and location_id = p_location_id for update;
  if p_delta > 0 and p_custo_unit is not null then
    v_custo := p_custo_unit;
    if b.saldo > 0 then b.custo_medio := (b.saldo * b.custo_medio + p_delta * p_custo_unit) / (b.saldo + p_delta);
    else b.custo_medio := p_custo_unit; end if;
  else
    v_custo := coalesce(p_custo_unit, b.custo_medio);
  end if;
  update public.stock_balances set saldo = saldo + p_delta, custo_medio = b.custo_medio, updated_at = now()
   where tenant_id = p_tenant_id and material_id = p_material_id and location_id = p_location_id;
  return v_custo;
end $$;
revoke execute on function public.apply_stock_delta(uuid, uuid, uuid, numeric, numeric) from public, anon, authenticated;

-- Enfileira delta de acabado para cada conector ativo com push_estoque.
create or replace function public.enqueue_outbox(p_tenant_id uuid, p_product_id uuid, p_delta numeric, p_dedupe_key text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  insert into public.integration_outbox (tenant_id, connector_id, product_id, delta, dedupe_key)
  select c.tenant_id, c.id, p_product_id, p_delta, p_dedupe_key
    from public.connectors c
   where c.tenant_id = p_tenant_id and c.status = 'conectado' and coalesce((c.config ->> 'push_estoque')::boolean, false)
  on conflict (tenant_id, connector_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.enqueue_outbox(uuid, uuid, numeric, text) from public, anon, authenticated;

-- Local de estoque padrão do membro corrente: local da membership (conferido contra o tenant) ou o primeiro local ativo.
create or replace function public.default_location(p_tenant_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select l.id from public.memberships m join public.locations l on l.id = m.location_id and l.tenant_id = p_tenant_id
      where m.tenant_id = p_tenant_id and m.user_id = auth.uid()),
    (select l.id from public.locations l where l.tenant_id = p_tenant_id and l.ativo order by (l.kind = 'fabrica') desc, l.created_at limit 1))
$$;
revoke execute on function public.default_location(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Movimento manual: entrada_manual, ajuste, perda, saldo_inicial. Idempotente pela chave (devolve o id existente).
-- A chave do cliente entra sempre no namespace manual: (nunca alcança nfe:/rev:/scan:/inv:/rcpt:).
create or replace function public.post_stock_move(p_tenant_id uuid, p_material_id uuid, p_location_id uuid, p_move_type text, p_delta numeric,
  p_custo_unit numeric default null, p_motivo text default null, p_ref_type text default null, p_ref_id uuid default null, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_key text := 'manual:' || coalesce(nullif(p_idempotency_key, ''), gen_random_uuid()::text);
  v_id uuid;
  v_custo numeric;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras', 'producao']::public.member_role[]);
  if p_ref_type in ('nfe', 'receipt', 'scan_event', 'inventory_session') then raise exception 'ref_type reservado às RPCs de origem: %', p_ref_type using errcode = '22023'; end if;
  if p_move_type not in ('entrada_manual', 'ajuste', 'perda', 'saldo_inicial') then raise exception 'tipo de movimento não permitido aqui: %', p_move_type using errcode = '22023'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'delta não pode ser zero' using errcode = '22023'; end if;
  if p_move_type in ('entrada_manual', 'saldo_inicial') and p_delta < 0 then raise exception 'entrada exige delta positivo' using errcode = '22023'; end if;
  if p_move_type = 'perda' and p_delta > 0 then raise exception 'perda exige delta negativo' using errcode = '22023'; end if;
  if not exists (select 1 from public.materials m where m.id = p_material_id and m.tenant_id = p_tenant_id) then raise exception 'insumo não encontrado' using errcode = '22023'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then raise exception 'local não encontrado' using errcode = '22023'; end if;
  select id into v_id from public.stock_moves where tenant_id = p_tenant_id and idempotency_key = v_key;
  if v_id is not null then return v_id; end if;
  v_custo := public.apply_stock_delta(p_tenant_id, p_material_id, p_location_id, p_delta, p_custo_unit);
  insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, created_by)
  values (p_tenant_id, p_material_id, p_location_id, p_move_type, p_delta, v_custo, round(p_delta * v_custo, 2), p_ref_type, p_ref_id, p_motivo, v_key, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.post_stock_move(uuid, uuid, uuid, text, numeric, numeric, text, text, uuid, text) from public, anon;
grant execute on function public.post_stock_move(uuid, uuid, uuid, text, numeric, numeric, text, text, uuid, text) to authenticated;

create or replace function public.reverse_stock_move(p_tenant_id uuid, p_move_id uuid, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  m public.stock_moves%rowtype;
  v_id uuid;
  v_custo numeric;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras', 'producao']::public.member_role[]);
  select * into m from public.stock_moves where id = p_move_id and tenant_id = p_tenant_id;
  if m.id is null then raise exception 'movimento não encontrado' using errcode = '22023'; end if;
  if m.move_type = 'estorno' then raise exception 'estorno não pode ser estornado' using errcode = '22023'; end if;
  if m.move_type = 'baixa_producao' then raise exception 'baixa de produção se estorna pelo bipe (reverse_scan)' using errcode = '22023'; end if;
  -- Idempotência pelo vínculo (reverses_id), não só pela chave: a chave sozinha poderia ser de outro movimento.
  select id into v_id from public.stock_moves where tenant_id = p_tenant_id and reverses_id = m.id and move_type = 'estorno';
  if v_id is not null then return v_id; end if;
  v_custo := public.apply_stock_delta(p_tenant_id, m.material_id, m.location_id, -m.delta, m.custo_unit);
  insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, reverses_id, created_by)
  values (p_tenant_id, m.material_id, m.location_id, 'estorno', -m.delta, v_custo, round(-m.delta * v_custo, 2), m.ref_type, m.ref_id, coalesce(p_motivo, 'estorno'), 'rev:' || m.id, m.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.reverse_stock_move(uuid, uuid, text) from public, anon;
grant execute on function public.reverse_stock_move(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: herdam a RLS das tabelas)
-- ---------------------------------------------------------------------------
create or replace view public.v_stock with (security_invoker = on) as
select m.tenant_id, m.id as material_id, m.sku, m.nome, m.unidade_compra, m.unidade_consumo, m.fator_conversao, m.minimo,
       m.fornecedor_padrao_id, m.lead_time_dias, m.custo_referencia,
       coalesce(sum(b.saldo), 0)::numeric(14,4) as saldo,
       case when coalesce(sum(b.saldo), 0) > 0 then (sum(b.saldo * b.custo_medio) / sum(b.saldo))::numeric(14,4)
            else coalesce(max(b.custo_medio), 0)::numeric(14,4) end as custo_medio,
       (coalesce(sum(b.saldo), 0) < m.minimo) as abaixo_do_minimo,
       max(b.updated_at) as updated_at
  from public.materials m
  left join public.stock_balances b on b.tenant_id = m.tenant_id and b.material_id = m.id
 where m.deleted_at is null
 group by m.tenant_id, m.id;
revoke all on table public.v_stock from public, anon, authenticated;
grant select on public.v_stock to authenticated;
