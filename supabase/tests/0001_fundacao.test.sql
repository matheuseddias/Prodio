-- Testes da fundação: claim de tenant, isolamento entre tenants, convite sem captura, anônimo não cria empresa.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@a.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bento@b.com'),
  ('00000000-0000-0000-0000-00000000000d', null);
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-00000000000d';

-- Ana cria o tenant A; Bento cria o tenant B.
select auth.test_login('00000000-0000-0000-0000-00000000000a');
select public.create_tenant('Fábrica A', 'fabrica-a', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000000b');
select public.create_tenant('Fábrica B', 'fabrica-b', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
-- Variáveis psql não entram em blocos DO: guardamos em settings de sessão.
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);

-- Simula o hook de token gravando a claim.
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000000a';
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000000b';

-- Ana vê só o tenant A.
select auth.test_login('00000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select count(*) from public.tenants) <> 1 then raise exception 'ana deveria ver 1 tenant'; end if;
  if (select public.current_tenant_id()) is null then raise exception 'claim de tenant não resolveu'; end if;
  if (select public.current_member_role()) <> 'admin' then raise exception 'ana deveria ser admin'; end if;
end $$;
insert into public.locations (tenant_id, nome) values (:'tenant_a', 'Galpão A');
-- Tentar gravar no tenant B falha.
do $$ begin
  begin
    insert into public.locations (tenant_id, nome) values (current_setting('test.tenant_b')::uuid, 'Invasão');
    raise exception 'escrita cruzada deveria falhar';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;
-- Convite: o admin insere a membership de Bento em A, mas não consegue marcar accepted_at nem por insert nem por update.
insert into public.memberships (tenant_id, user_id, role, nome) values (:'tenant_a', '00000000-0000-0000-0000-00000000000b', 'compras', 'Bento');
do $$ begin
  begin
    update public.memberships set accepted_at = now() where user_id = '00000000-0000-0000-0000-00000000000b';
    raise exception 'admin não deveria gravar accepted_at';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.memberships (tenant_id, user_id, role, accepted_at) values (current_setting('test.tenant_a')::uuid, '00000000-0000-0000-0000-00000000000d', 'leitura', now());
    raise exception 'insert com accepted_at deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();
-- O convite de A é mais antigo que a membership de B, mas o hook só considera memberships aceitas: Bento continua em B.
update public.memberships set invited_at = now() - interval '1 day' where tenant_id = :'tenant_a' and user_id = '00000000-0000-0000-0000-00000000000b';
delete from public.user_active_tenant where user_id = '00000000-0000-0000-0000-00000000000b';
do $$
declare v jsonb;
begin
  v := public.custom_access_token_hook(jsonb_build_object('user_id', '00000000-0000-0000-0000-00000000000b', 'claims', '{}'::jsonb));
  if (v -> 'claims' -> 'app_metadata' ->> 'tenant_id')::uuid <> current_setting('test.tenant_b')::uuid then
    raise exception 'hook deveria ignorar o convite não aceito: %', v;
  end if;
end $$;

-- Bento não vê o local de A; escolher A pelo set_active_tenant é o aceite do convite.
select auth.test_login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.locations) <> 0 then raise exception 'bento não deveria ver locais de A'; end if;
  perform public.set_active_tenant(current_setting('test.tenant_a')::uuid);
  if (select accepted_at from public.memberships where tenant_id = current_setting('test.tenant_a')::uuid and user_id = auth.uid()) is null then
    raise exception 'set_active_tenant deveria aceitar o convite';
  end if;
  perform public.set_active_tenant(current_setting('test.tenant_b')::uuid);
end $$;
select auth.test_logout();
-- Sem membership, a troca de tenant falha.
delete from public.memberships where tenant_id = :'tenant_a' and user_id = '00000000-0000-0000-0000-00000000000b';
select auth.test_login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  begin
    perform public.set_active_tenant(current_setting('test.tenant_a')::uuid);
    raise exception 'set_active_tenant cruzado deveria falhar';
  exception when insufficient_privilege then null;
  end;
end $$;
select auth.test_logout();

-- Usuário anônimo (aparelho) não cria empresa.
select auth.test_login('00000000-0000-0000-0000-00000000000d');
do $$ begin
  if not public.is_anonymous_user() then raise exception 'claim is_anonymous deveria estar no JWT do stub'; end if;
  begin
    perform public.create_tenant('Fantasma', 'fantasma', '33.333.333/0001-33');
    raise exception 'anônimo não deveria criar tenant';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

-- Auditoria: mudança de papel e da empresa deixam rastro, sem segredos.
do $$ begin
  if (select count(*) from public.audit_log where entidade = 'memberships' and acao = 'insert' and tenant_id = current_setting('test.tenant_a')::uuid) < 2 then
    raise exception 'memberships deveria ser auditada';
  end if;
  if (select count(*) from public.audit_log where entidade = 'tenants' and acao = 'insert' and tenant_id in (current_setting('test.tenant_a')::uuid, current_setting('test.tenant_b')::uuid)) <> 2 then
    raise exception 'tenants deveria ser auditada';
  end if;
end $$;

rollback;
