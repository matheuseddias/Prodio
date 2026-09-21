-- Stubs do ambiente Supabase para rodar migrations e testes num PostgreSQL comum.
-- Reproduz o mínimo do schema auth e os papéis anon / authenticated / service_role.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', 'anon')
$$;

-- Helper dos testes: assume a identidade de um usuário como o PostgREST faria.
create or replace function auth.test_login(p_user uuid, p_role text default 'authenticated') returns void
language plpgsql as $$
declare
  v_meta jsonb;
begin
  select raw_app_meta_data into v_meta from auth.users where id = p_user;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', p_role, 'app_metadata', coalesce(v_meta, '{}'::jsonb))::text, true);
  execute format('set local role %I', p_role);
end $$;

create or replace function auth.test_logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  reset role;
end $$;
