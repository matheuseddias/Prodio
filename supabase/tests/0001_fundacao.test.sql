-- Testes da fundação: claim de tenant, isolamento entre tenants, aparelhos e PIN.
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
select auth.test_logout();

-- Bento não vê o local de A.
select auth.test_login('00000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.locations) <> 0 then raise exception 'bento não deveria ver locais de A'; end if;
end $$;
-- Bento não consegue trocar para o tenant A.
do $$ begin
  begin
    perform public.set_active_tenant(current_setting('test.tenant_a')::uuid);
    raise exception 'set_active_tenant cruzado deveria falhar';
  exception when insufficient_privilege then null;
  end;
end $$;
select auth.test_logout();

-- Aparelho: Ana cria, aparelho anônimo registra, operador entra com PIN.
select auth.test_login('00000000-0000-0000-0000-00000000000a');
select device_id, pair_code from public.create_device(:'tenant_a', 'Celular linha 1', null) \gset
select public.upsert_operator(:'tenant_a', null, 'Thiago', '1234');
select auth.test_logout();

select auth.test_login('00000000-0000-0000-0000-00000000000d');
select public.register_device(:'pair_code') as registered \gset
select auth.test_logout();
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000000d';
select auth.test_login('00000000-0000-0000-0000-00000000000d');
do $$ begin
  if (select public.current_member_role()) <> 'dispositivo' then raise exception 'aparelho deveria ser membro dispositivo'; end if;
  begin
    perform public.set_operator('9999');
    raise exception 'PIN errado deveria falhar';
  exception when invalid_authorization_specification then null;
  end;
  if (select nome from public.set_operator('1234')) <> 'Thiago' then raise exception 'PIN certo deveria logar Thiago'; end if;
  if (select public.current_operator_id()) is null then raise exception 'operador corrente vazio'; end if;
  -- Aparelho não pode ler pin_hash nem criar locais.
  begin
    perform pin_hash from public.operators limit 1;
    raise exception 'pin_hash deveria ser inacessível';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.locations (tenant_id, nome) values ((select public.current_tenant_id()), 'X');
    raise exception 'dispositivo não deveria criar local';
  exception when insufficient_privilege then null;
  end;
end $$;
select auth.test_logout();

-- Revogação apaga a membership do aparelho.
select auth.test_login('00000000-0000-0000-0000-00000000000a');
select public.revoke_device(:'device_id');
do $$ begin
  if exists (select 1 from public.memberships where user_id = '00000000-0000-0000-0000-00000000000d') then
    raise exception 'membership do aparelho deveria sumir';
  end if;
end $$;
select auth.test_logout();

rollback;
