-- 0001 · Fundação multi-tenant: tenants, memberships, claim de tenant, helpers de RLS,
-- locais, unidades, contadores de documento, auditoria, aparelhos e operadores.
-- Regras em docs/arquitetura.md, seção 2.

-- pgcrypto e citext vivem no schema extensions do Supabase.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.member_role as enum ('admin', 'compras', 'producao', 'leitura', 'dispositivo');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tax_regime as enum ('simples', 'presumido', 'real');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.location_kind as enum ('fabrica', 'terceiro', 'deposito');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.unit_kind as enum ('unidade', 'comprimento', 'area', 'peso', 'volume');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tenants e membros
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug extensions.citext not null unique,
  nome text not null,
  cnpj text not null,
  regime public.tax_regime not null default 'simples',
  credita_impostos boolean not null default false,
  fuso text not null default 'America/Sao_Paulo',
  hora_virada time not null default '05:00',
  dias_uteis_mes int not null default 22 check (dias_uteis_mes between 1 and 31),
  margem_projecao numeric(6,4) not null default 0.10,
  dias_cobertura int not null default 15 check (dias_cobertura >= 0),
  margem_alvo_padrao numeric(6,4) not null default 0.20,
  exigir_projecao_para_imprimir boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'leitura',
  location_id uuid,
  nome text,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (tenant_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);

-- Tenant ativo por usuário: é o que o hook de token grava na claim.
create table if not exists public.user_active_tenant (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helpers de segurança
-- ---------------------------------------------------------------------------
-- Tenant corrente: claim do JWT confirmada pela membership. STABLE para o initPlan cachear.
-- SECURITY DEFINER para ler memberships sem passar pela própria policy (evita recursão); só filtra por auth.uid().
create or replace function public.current_tenant_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'tenant_id', ''), '')::uuid
  limit 1
$$;

create or replace function public.current_member_role()
returns public.member_role
language sql stable security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid()
    and m.tenant_id = (select public.current_tenant_id())
  limit 1
$$;

-- Guarda obrigatória nas RPCs SECURITY DEFINER.
create or replace function public.assert_member(p_tenant_id uuid, p_roles public.member_role[] default null)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_role public.member_role;
begin
  if p_tenant_id is null then
    raise exception 'tenant obrigatório' using errcode = '42501';
  end if;
  select m.role into v_role
  from public.memberships m
  where m.user_id = auth.uid() and m.tenant_id = p_tenant_id;
  if v_role is null then
    raise exception 'sem acesso a este tenant' using errcode = '42501';
  end if;
  if p_roles is not null and not (v_role = any (p_roles)) then
    raise exception 'papel % não pode executar esta operação', v_role using errcode = '42501';
  end if;
end $$;

revoke execute on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;
revoke execute on function public.current_member_role() from public, anon;
grant execute on function public.current_member_role() to authenticated;
revoke execute on function public.assert_member(uuid, public.member_role[]) from public, anon;
grant execute on function public.assert_member(uuid, public.member_role[]) to authenticated;

-- Hook de token: grava tenant_id e papel em app_metadata. Executado pelo Auth (supabase_auth_admin).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_tenant uuid;
  v_role public.member_role;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_meta jsonb;
begin
  select uat.tenant_id into v_tenant from public.user_active_tenant uat where uat.user_id = v_user;
  if v_tenant is null then
    select m.tenant_id into v_tenant from public.memberships m where m.user_id = v_user order by m.invited_at limit 1;
  end if;
  if v_tenant is not null then
    select m.role into v_role from public.memberships m where m.user_id = v_user and m.tenant_id = v_tenant;
  end if;
  v_meta := coalesce(v_claims -> 'app_metadata', '{}'::jsonb)
    || jsonb_build_object('tenant_id', v_tenant, 'role', v_role);
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_meta, true);
  return jsonb_set(event, '{claims}', v_claims, true);
end $$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.user_active_tenant, public.memberships to supabase_auth_admin;

-- Troca de tenant: valida a membership e grava o ativo. O cliente chama refreshSession() em seguida.
create or replace function public.set_active_tenant(p_tenant_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.assert_member(p_tenant_id);
  insert into public.user_active_tenant (user_id, tenant_id, updated_at)
  values (auth.uid(), p_tenant_id, now())
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();
end $$;
revoke execute on function public.set_active_tenant(uuid) from public, anon;
grant execute on function public.set_active_tenant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS de tenants e memberships
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.user_active_tenant enable row level security;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
  using (exists (select 1 from public.memberships m where m.tenant_id = tenants.id and m.user_id = auth.uid()));
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin')
  with check (id = (select public.current_tenant_id()));

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) or user_id = auth.uid());
drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin');

drop policy if exists uat_own on public.user_active_tenant;
create policy uat_own on public.user_active_tenant for select to authenticated using (user_id = auth.uid());

grant select, update on public.tenants to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select on public.user_active_tenant to authenticated;

-- Criação de tenant (onboarding): quem cria vira admin.
create or replace function public.create_tenant(p_nome text, p_slug text, p_cnpj text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  insert into public.tenants (nome, slug, cnpj) values (p_nome, p_slug, regexp_replace(p_cnpj, '\D', '', 'g')) returning id into v_id;
  insert into public.memberships (tenant_id, user_id, role, accepted_at) values (v_id, auth.uid(), 'admin', now());
  insert into public.user_active_tenant (user_id, tenant_id) values (auth.uid(), v_id)
    on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();
  return v_id;
end $$;
revoke execute on function public.create_tenant(text, text, text) from public, anon;
grant execute on function public.create_tenant(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cadastros de base do tenant
-- ---------------------------------------------------------------------------
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  kind public.location_kind not null default 'fabrica',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, nome)
);
alter table public.memberships
  drop constraint if exists memberships_location_fk,
  add constraint memberships_location_fk foreign key (location_id) references public.locations(id) on delete set null;

create table if not exists public.units (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  nome text not null,
  kind public.unit_kind not null,
  primary key (tenant_id, code)
);

-- Contadores por tenant e tipo de documento. Só a RPC next_doc_number escreve aqui.
create table if not exists public.doc_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  next_value bigint not null default 1,
  primary key (tenant_id, kind)
);

create or replace function public.next_doc_number(p_tenant_id uuid, p_kind text)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  insert into public.doc_counters (tenant_id, kind, next_value) values (p_tenant_id, p_kind, 1)
    on conflict (tenant_id, kind) do nothing;
  update public.doc_counters set next_value = next_value + 1
    where tenant_id = p_tenant_id and kind = p_kind
    returning next_value - 1 into v;
  return v;
end $$;
revoke execute on function public.next_doc_number(uuid, text) from public, anon, authenticated;

-- Auditoria genérica.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  entidade text not null,
  entidade_id text,
  acao text not null,
  antes jsonb,
  depois jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_tenant_idx on public.audit_log(tenant_id, created_at desc);

create or replace function public.audit_trigger()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id text;
begin
  v_tenant := coalesce((to_jsonb(coalesce(new, old)) ->> 'tenant_id')::uuid, null);
  v_id := to_jsonb(coalesce(new, old)) ->> 'id';
  insert into public.audit_log (tenant_id, user_id, entidade, entidade_id, acao, antes, depois)
  values (v_tenant, auth.uid(), tg_table_name, v_id, lower(tg_op),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Aparelhos e operadores do chão de fábrica
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  location_id uuid references public.locations(id) on delete set null,
  device_user_id uuid unique references auth.users(id) on delete set null,
  pair_code text,
  pair_code_expires_at timestamptz,
  registered_at timestamptz,
  last_scan_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  pin_hash text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

create table if not exists public.device_sessions (
  device_id uuid primary key references public.devices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operator_id uuid references public.operators(id) on delete set null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Admin gera um código de pareamento; o aparelho (sign-in anônimo) resgata o código e vira membro 'dispositivo'.
create or replace function public.create_device(p_tenant_id uuid, p_nome text, p_location_id uuid)
returns table (device_id uuid, pair_code text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_id uuid;
begin
  perform public.assert_member(p_tenant_id, array['admin']::public.member_role[]);
  insert into public.devices (tenant_id, nome, location_id, pair_code, pair_code_expires_at)
  values (p_tenant_id, p_nome, p_location_id, v_code, now() + interval '1 hour')
  returning id into v_id;
  return query select v_id, v_code;
end $$;
revoke execute on function public.create_device(uuid, text, uuid) from public, anon;
grant execute on function public.create_device(uuid, text, uuid) to authenticated;

create or replace function public.register_device(p_pair_code text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  select * into d from public.devices
   where pair_code = upper(p_pair_code) and pair_code_expires_at > now() and registered_at is null and revoked_at is null
   for update;
  if d.id is null then raise exception 'código de pareamento inválido ou expirado' using errcode = '22023'; end if;
  update public.devices set device_user_id = auth.uid(), registered_at = now(), pair_code = null, pair_code_expires_at = null where id = d.id;
  insert into public.memberships (tenant_id, user_id, role, location_id, nome, accepted_at)
  values (d.tenant_id, auth.uid(), 'dispositivo', d.location_id, d.nome, now())
  on conflict (tenant_id, user_id) do update set role = 'dispositivo', location_id = excluded.location_id, nome = excluded.nome;
  insert into public.user_active_tenant (user_id, tenant_id) values (auth.uid(), d.tenant_id)
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, updated_at = now();
  return d.id;
end $$;
revoke execute on function public.register_device(text) from public, anon;
grant execute on function public.register_device(text) to authenticated;

create or replace function public.revoke_device(p_device_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
begin
  select * into d from public.devices where id = p_device_id;
  if d.id is null then return; end if;
  perform public.assert_member(d.tenant_id, array['admin']::public.member_role[]);
  update public.devices set revoked_at = now() where id = d.id;
  delete from public.device_sessions where device_id = d.id;
  if d.device_user_id is not null then
    delete from public.memberships where tenant_id = d.tenant_id and user_id = d.device_user_id;
  end if;
end $$;
revoke execute on function public.revoke_device(uuid) from public, anon;
grant execute on function public.revoke_device(uuid) to authenticated;

-- Operadores: admin cadastra com PIN; o aparelho entra com o PIN.
create or replace function public.upsert_operator(p_tenant_id uuid, p_id uuid, p_nome text, p_pin text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao']::public.member_role[]);
  if p_pin is not null and p_pin !~ '^\d{4,6}$' then raise exception 'PIN deve ter de 4 a 6 dígitos' using errcode = '22023'; end if;
  insert into public.operators (id, tenant_id, nome, pin_hash)
  values (v_id, p_tenant_id, p_nome, extensions.crypt(coalesce(p_pin, '0000'), extensions.gen_salt('bf')))
  on conflict (id) do update set nome = excluded.nome,
    pin_hash = case when p_pin is null then public.operators.pin_hash else excluded.pin_hash end;
  return v_id;
end $$;
revoke execute on function public.upsert_operator(uuid, uuid, text, text) from public, anon;
grant execute on function public.upsert_operator(uuid, uuid, text, text) to authenticated;

create or replace function public.set_operator(p_pin text)
returns table (operator_id uuid, nome text, expires_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  o public.operators%rowtype;
begin
  select * into d from public.devices where device_user_id = auth.uid() and revoked_at is null;
  if d.id is null then raise exception 'aparelho não registrado' using errcode = '42501'; end if;
  select * into o from public.operators
   where tenant_id = d.tenant_id and ativo and pin_hash = extensions.crypt(p_pin, pin_hash)
   limit 1;
  if o.id is null then raise exception 'PIN inválido' using errcode = '28000'; end if;
  insert into public.device_sessions (device_id, tenant_id, operator_id, started_at, expires_at)
  values (d.id, d.tenant_id, o.id, now(), now() + interval '12 hours')
  on conflict (device_id) do update set operator_id = excluded.operator_id, started_at = now(), expires_at = excluded.expires_at;
  return query select o.id, o.nome, now() + interval '12 hours';
end $$;
revoke execute on function public.set_operator(text) from public, anon;
grant execute on function public.set_operator(text) to authenticated;

-- Operador da sessão do aparelho corrente (para register_scan).
create or replace function public.current_operator_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select s.operator_id
  from public.device_sessions s
  join public.devices d on d.id = s.device_id
  where d.device_user_id = auth.uid() and s.expires_at > now()
$$;
revoke execute on function public.current_operator_id() from public, anon;
grant execute on function public.current_operator_id() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS dos cadastros de base
-- ---------------------------------------------------------------------------
alter table public.locations enable row level security;
alter table public.units enable row level security;
alter table public.doc_counters enable row level security;
alter table public.audit_log enable row level security;
alter table public.devices enable row level security;
alter table public.operators enable row level security;
alter table public.device_sessions enable row level security;

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'producao'))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'producao'));

drop policy if exists units_select on public.units;
create policy units_select on public.units for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists units_write on public.units;
create policy units_write on public.units for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'compras', 'producao'))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'compras', 'producao'));

drop policy if exists doc_counters_select on public.doc_counters;
create policy doc_counters_select on public.doc_counters for select to authenticated using (tenant_id = (select public.current_tenant_id()));

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin');

drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists operators_select on public.operators;
create policy operators_select on public.operators for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists device_sessions_select on public.device_sessions;
create policy device_sessions_select on public.device_sessions for select to authenticated using (tenant_id = (select public.current_tenant_id()));

grant select, insert, update, delete on public.locations, public.units to authenticated;
grant select on public.doc_counters, public.audit_log, public.devices, public.device_sessions to authenticated;
-- Colunas sensíveis: pin_hash nunca sai para o cliente (grant só nas colunas públicas).
grant select (id, tenant_id, nome, ativo, created_at) on public.operators to authenticated;
