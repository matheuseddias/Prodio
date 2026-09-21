-- Testes de aparelhos e operadores: pareamento só por sessão anônima, pair_code invisível, PIN errado sem erro e com
-- bloqueio por tentativas, operador de outro tenant intocável, PIN obrigatório, revogação.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000001a', 'ana1@a.com'),
  ('00000000-0000-0000-0000-00000000001b', 'bento1@b.com'),
  ('00000000-0000-0000-0000-00000000001c', 'carla1@a.com'),
  ('00000000-0000-0000-0000-00000000001d', null);
update auth.users set is_anonymous = true where id = '00000000-0000-0000-0000-00000000001d';

select auth.test_login('00000000-0000-0000-0000-00000000001a');
select public.create_tenant('Fábrica A', 'fabrica-a1', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000001b');
select public.create_tenant('Fábrica B', 'fabrica-b1', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
insert into public.memberships (tenant_id, user_id, role, accepted_at) values (:'tenant_a', '00000000-0000-0000-0000-00000000001c', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000001c');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000001b';
insert into public.locations (id, tenant_id, nome) values ('40000000-0000-0000-0000-00000000001a', :'tenant_a', 'Galpão A'), ('40000000-0000-0000-0000-00000000001b', :'tenant_b', 'Galpão B');

-- Bento (B) cadastra um operador em B.
select auth.test_login('00000000-0000-0000-0000-00000000001b');
select public.upsert_operator(:'tenant_b', null, 'Operador de B', '5555') as op_b \gset
select auth.test_logout();
select set_config('test.op_b', :'op_b', false);

-- Ana (A) cria o aparelho e o operador; não alcança o operador de B; PIN é obrigatório no cadastro.
select auth.test_login('00000000-0000-0000-0000-00000000001a');
select device_id, pair_code from public.create_device(:'tenant_a', 'Celular linha 1', '40000000-0000-0000-0000-00000000001a') \gset
select set_config('test.device', :'device_id', false);
select public.upsert_operator(:'tenant_a', null, 'Thiago', '1234') as op_a \gset
select set_config('test.op_a', :'op_a', false);
do $$
declare v uuid;
begin
  -- exploit sec_01: upsert_operator com p_id de operador de outro tenant
  begin
    perform public.upsert_operator(current_setting('test.tenant_a')::uuid, current_setting('test.op_b')::uuid, 'HACKEADO POR A', '1111');
    raise exception 'upsert_operator não deveria alcançar operador de B';
  exception when invalid_parameter_value then null; end;
  -- exploit sec_10: operador novo sem PIN
  begin
    perform public.upsert_operator(current_setting('test.tenant_a')::uuid, null, 'Sem PIN', null);
    raise exception 'operador novo sem PIN deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- edição do próprio operador sem PIN mantém o hash
  v := public.upsert_operator(current_setting('test.tenant_a')::uuid, current_setting('test.op_a')::uuid, 'Thiago S.', null);
  if v <> current_setting('test.op_a')::uuid then raise exception 'upsert deveria manter o id'; end if;
  -- aparelho com local de outro tenant é recusado
  begin
    perform public.create_device(current_setting('test.tenant_a')::uuid, 'Invasor', '40000000-0000-0000-0000-00000000001b');
    raise exception 'create_device com local de B deveria falhar';
  exception when invalid_parameter_value then null; end;
  -- exploit sec_02: pair_code não sai pela tabela (nem para o admin)
  begin
    perform pair_code from public.devices;
    raise exception 'pair_code deveria ser inacessível';
  exception when insufficient_privilege then null; end;
  begin
    perform pair_code_expires_at from public.devices;
    raise exception 'pair_code_expires_at deveria ser inacessível';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.devices where nome = 'Celular linha 1') <> 1 then raise exception 'admin deveria ver o aparelho'; end if;
  -- admin edita nome/local do aparelho direto (colunas permitidas), mas não o dono nem o código
  update public.devices set nome = 'Celular linha 2' where id = current_setting('test.device')::uuid;
  if (select nome from public.devices where id = current_setting('test.device')::uuid) <> 'Celular linha 2' then raise exception 'admin deveria renomear o aparelho'; end if;
  begin
    update public.devices set device_user_id = auth.uid() where id = current_setting('test.device')::uuid;
    raise exception 'device_user_id não deveria ser editável';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();
-- O dono do banco confirma que o operador de B ficou intacto.
do $$ begin
  if (select nome from public.operators where id = current_setting('test.op_b')::uuid) <> 'Operador de B' then raise exception 'operador de B foi alterado'; end if;
  if (select pin_hash = extensions.crypt('1111', pin_hash) from public.operators where id = current_setting('test.op_b')::uuid) then raise exception 'PIN de B foi trocado'; end if;
  if (select pin_hash = extensions.crypt('1234', pin_hash) from public.operators where id = current_setting('test.op_a')::uuid) is not true then raise exception 'PIN de Thiago deveria continuar 1234'; end if;
  if exists (select 1 from public.audit_log where entidade in ('operators', 'devices') and (depois ? 'pin_hash' or depois ? 'pair_code' or antes ? 'pin_hash')) then
    raise exception 'audit_log não pode guardar pin_hash/pair_code';
  end if;
end $$;

-- Carla (leitura, não anônima) tem o código na mão (exploit sec_02), mas não vira dispositivo.
select set_config('test.pair', :'pair_code', false);
select auth.test_login('00000000-0000-0000-0000-00000000001c');
do $$ begin
  begin
    perform public.register_device(current_setting('test.pair'));
    raise exception 'não anônimo com o código certo não deveria parear';
  exception when insufficient_privilege then null; end;
  if (select role from public.memberships where user_id = auth.uid()) <> 'leitura' then raise exception 'papel de Carla não pode mudar'; end if;
end $$;
select auth.test_logout();

-- Aparelho anônimo pareia; PIN errado devolve zero linhas e conta; 5 erros bloqueiam por 15 min; PIN certo depois do bloqueio expirar.
select auth.test_login('00000000-0000-0000-0000-00000000001d');
select public.register_device(:'pair_code') as registered \gset
select auth.test_logout();
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id = '00000000-0000-0000-0000-00000000001d';
select auth.test_login('00000000-0000-0000-0000-00000000001d');
do $$
declare i int; n int;
begin
  if (select public.current_member_role()) <> 'dispositivo' then raise exception 'aparelho deveria ser membro dispositivo'; end if;
  if (select count(*) from public.set_operator('9999')) <> 0 then raise exception 'PIN errado deveria devolver zero linhas'; end if;
  if (select pin_failures from public.devices where id = current_setting('test.device')::uuid) <> 1 then raise exception 'falha deveria contar'; end if;
  if (select nome from public.set_operator('1234')) <> 'Thiago S.' then raise exception 'PIN certo deveria logar Thiago'; end if;
  if (select pin_failures from public.devices where id = current_setting('test.device')::uuid) <> 0 then raise exception 'acerto deveria zerar a contagem'; end if;
  if (select public.current_operator_id()) is null then raise exception 'operador corrente vazio'; end if;
  -- exploit sec_10: força bruta. Depois de 5 erros a 6ª chamada é recusada mesmo com o PIN certo.
  for i in 1..5 loop
    if (select count(*) from public.set_operator(lpad(i::text, 4, '0'))) <> 0 then raise exception 'PIN % deveria falhar', i; end if;
  end loop;
  if (select pin_locked_until from public.devices where id = current_setting('test.device')::uuid) is null then raise exception 'aparelho deveria estar bloqueado'; end if;
  begin
    perform public.set_operator('1234');
    raise exception 'aparelho bloqueado deveria recusar até o PIN certo';
  exception when invalid_authorization_specification then null; end;
  -- Aparelho não pode ler pin_hash nem criar locais.
  begin
    perform pin_hash from public.operators limit 1;
    raise exception 'pin_hash deveria ser inacessível';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.locations (tenant_id, nome) values ((select public.current_tenant_id()), 'X');
    raise exception 'dispositivo não deveria criar local';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();
do $$ begin
  if (select count(*) from public.audit_log where entidade = 'devices' and acao = 'pin_invalido' and tenant_id = current_setting('test.tenant_a')::uuid) <> 6 then
    raise exception 'cada falha deveria ir para o audit_log';
  end if;
end $$;
-- Bloqueio expirado: volta a aceitar. Operador desativado encerra a sessão.
update public.devices set pin_locked_until = now() - interval '1 minute' where id = :'device_id';
select auth.test_login('00000000-0000-0000-0000-00000000001d');
do $$ begin
  if (select nome from public.set_operator('1234')) <> 'Thiago S.' then raise exception 'bloqueio expirado deveria aceitar o PIN'; end if;
  if (select public.current_operator_id()) is null then raise exception 'sessão deveria existir'; end if;
end $$;
select auth.test_logout();
update public.operators set ativo = false where id = :'op_a';
select auth.test_login('00000000-0000-0000-0000-00000000001d');
do $$ begin
  if (select public.current_operator_id()) is not null then raise exception 'operador desativado não deveria ter sessão'; end if;
end $$;
select auth.test_logout();

-- Revogação apaga a membership do aparelho.
select auth.test_login('00000000-0000-0000-0000-00000000001a');
select public.revoke_device(:'device_id');
do $$ begin
  if exists (select 1 from public.memberships where user_id = '00000000-0000-0000-0000-00000000001d') then
    raise exception 'membership do aparelho deveria sumir';
  end if;
end $$;
select auth.test_logout();

rollback;
