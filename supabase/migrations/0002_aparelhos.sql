-- 0002 · Aparelhos e operadores do chão de fábrica: pareamento por código, PIN com bloqueio por tentativas,
-- sessão do operador no aparelho. Regras em docs/arquitetura.md, seção 2 (item 11).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  location_id uuid,
  device_user_id uuid unique references auth.users(id) on delete set null,
  pair_code text,
  pair_code_expires_at timestamptz,
  registered_at timestamptz,
  last_scan_at timestamptz,
  revoked_at timestamptz,
  pin_failures int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id) on delete set null (location_id)
);

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  pin_hash text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, nome),
  unique (tenant_id, id)
);

create table if not exists public.device_sessions (
  device_id uuid primary key references public.devices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operator_id uuid,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  foreign key (tenant_id, operator_id) references public.operators(tenant_id, id) on delete set null (operator_id)
);

drop trigger if exists devices_audit on public.devices;
create trigger devices_audit after insert or update or delete on public.devices for each row execute function public.audit_trigger();
drop trigger if exists operators_audit on public.operators;
create trigger operators_audit after insert or update or delete on public.operators for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS e grants. pair_code e pin_hash nunca saem para o cliente (grant por coluna).
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.operators enable row level security;
alter table public.device_sessions enable row level security;

drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists devices_admin_update on public.devices;
create policy devices_admin_update on public.devices for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin');
drop policy if exists operators_select on public.operators;
create policy operators_select on public.operators for select to authenticated using (tenant_id = (select public.current_tenant_id()));
drop policy if exists device_sessions_select on public.device_sessions;
create policy device_sessions_select on public.device_sessions for select to authenticated using (tenant_id = (select public.current_tenant_id()));

revoke all on table public.devices, public.operators, public.device_sessions from public, anon, authenticated;
grant select (id, tenant_id, nome, location_id, device_user_id, registered_at, last_scan_at, revoked_at, pin_failures, pin_locked_until, created_at) on public.devices to authenticated;
grant update (nome, location_id) on public.devices to authenticated;
grant select (id, tenant_id, nome, ativo, created_at) on public.operators to authenticated;
grant select on public.device_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
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
  if p_location_id is not null and not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then
    raise exception 'local não encontrado' using errcode = '22023';
  end if;
  insert into public.devices (tenant_id, nome, location_id, pair_code, pair_code_expires_at)
  values (p_tenant_id, p_nome, p_location_id, v_code, now() + interval '1 hour')
  returning id into v_id;
  return query select v_id, v_code;
end $$;
revoke execute on function public.create_device(uuid, text, uuid) from public, anon;
grant execute on function public.create_device(uuid, text, uuid) to authenticated;

-- Só um usuário anônimo (o aparelho) resgata o código: um membro do escritório não pode virar 'dispositivo'
-- para ganhar as permissões do chão (o papel dispositivo escreve NF-e e bipes).
create or replace function public.register_device(p_pair_code text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado' using errcode = '42501'; end if;
  if not public.is_anonymous_user() then raise exception 'só um aparelho (sessão anônima) pode ser pareado' using errcode = '42501'; end if;
  select * into d from public.devices
   where pair_code = upper(p_pair_code) and pair_code_expires_at > now() and registered_at is null and revoked_at is null
   for update;
  if d.id is null then raise exception 'código de pareamento inválido ou expirado' using errcode = '22023'; end if;
  if exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.role <> 'dispositivo') then
    raise exception 'usuário já é membro de uma empresa com outro papel' using errcode = '42501';
  end if;
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

-- Operadores: admin cadastra com PIN (obrigatório no cadastro; opcional na edição para manter o atual).
-- p_id de operador de outro tenant é recusado: o upsert por PK só alcança linhas do próprio tenant.
create or replace function public.upsert_operator(p_tenant_id uuid, p_id uuid, p_nome text, p_pin text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_existe boolean := false;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao']::public.member_role[]);
  if nullif(trim(coalesce(p_nome, '')), '') is null then raise exception 'nome do operador obrigatório' using errcode = '22023'; end if;
  if p_pin is not null and p_pin !~ '^\d{4,6}$' then raise exception 'PIN deve ter de 4 a 6 dígitos' using errcode = '22023'; end if;
  if p_id is not null then
    select exists (select 1 from public.operators o where o.id = p_id and o.tenant_id = p_tenant_id) into v_existe;
    if not v_existe and exists (select 1 from public.operators o where o.id = p_id) then
      raise exception 'operador não encontrado' using errcode = '22023';
    end if;
  end if;
  if not v_existe and p_pin is null then raise exception 'PIN obrigatório para operador novo' using errcode = '22023'; end if;
  insert into public.operators (id, tenant_id, nome, pin_hash)
  values (v_id, p_tenant_id, trim(p_nome), extensions.crypt(coalesce(p_pin, '0000'), extensions.gen_salt('bf')))
  on conflict (id) do update set nome = excluded.nome,
    pin_hash = case when p_pin is null then public.operators.pin_hash else excluded.pin_hash end
    where public.operators.tenant_id = p_tenant_id;
  if not found then raise exception 'operador não encontrado' using errcode = '22023'; end if;
  return v_id;
end $$;
revoke execute on function public.upsert_operator(uuid, uuid, text, text) from public, anon;
grant execute on function public.upsert_operator(uuid, uuid, text, text) to authenticated;

-- Entrada do operador pelo PIN. PIN errado devolve zero linhas (não lança: assim a contagem de falhas
-- persiste) e conta no aparelho; 5 falhas bloqueiam o aparelho por 15 minutos (aí sim lança 28000).
create or replace function public.set_operator(p_pin text)
returns table (operator_id uuid, nome text, expires_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.devices%rowtype;
  o public.operators%rowtype;
  c_max_falhas constant int := 5;
  c_bloqueio constant interval := interval '15 minutes';
begin
  select * into d from public.devices where device_user_id = auth.uid() and revoked_at is null for update;
  if d.id is null then raise exception 'aparelho não registrado' using errcode = '42501'; end if;
  if d.pin_locked_until is not null and d.pin_locked_until > now() then
    raise exception 'aparelho bloqueado por tentativas erradas; tente de novo em % minuto(s)',
      greatest(1, ceil(extract(epoch from d.pin_locked_until - now()) / 60)) using errcode = '28000';
  end if;
  if p_pin ~ '^\d{4,6}$' then
    select * into o from public.operators
     where tenant_id = d.tenant_id and ativo and pin_hash = extensions.crypt(p_pin, pin_hash)
     limit 1;
  end if;
  if o.id is null then
    update public.devices set
      pin_failures = case when pin_failures + 1 >= c_max_falhas then 0 else pin_failures + 1 end,
      pin_locked_until = case when pin_failures + 1 >= c_max_falhas then now() + c_bloqueio else pin_locked_until end
     where id = d.id;
    insert into public.audit_log (tenant_id, user_id, entidade, entidade_id, acao, depois)
    values (d.tenant_id, auth.uid(), 'devices', d.id::text, 'pin_invalido', jsonb_build_object('falhas', d.pin_failures + 1));
    return;
  end if;
  update public.devices set pin_failures = 0, pin_locked_until = null where id = d.id;
  insert into public.device_sessions (device_id, tenant_id, operator_id, started_at, expires_at)
  values (d.id, d.tenant_id, o.id, now(), now() + interval '12 hours')
  on conflict (device_id) do update set operator_id = excluded.operator_id, started_at = now(), expires_at = excluded.expires_at;
  return query select o.id, o.nome, now() + interval '12 hours';
end $$;
revoke execute on function public.set_operator(text) from public, anon;
grant execute on function public.set_operator(text) to authenticated;

-- Operador da sessão do aparelho corrente (para register_scan). Operador desativado ou aparelho revogado encerram a sessão.
create or replace function public.current_operator_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select s.operator_id
  from public.device_sessions s
  join public.devices d on d.id = s.device_id
  join public.operators o on o.id = s.operator_id
  where d.device_user_id = auth.uid() and d.revoked_at is null and o.ativo and s.expires_at > now()
$$;
revoke execute on function public.current_operator_id() from public, anon;
grant execute on function public.current_operator_id() to authenticated;
