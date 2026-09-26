-- Segurança · privilégios. O stub reproduz os default privileges do Supabase (ALL em tabelas/funções/sequências novas
-- para anon e authenticated). Este teste confere, pelo catálogo, que as migrations revogaram tudo o que não foi
-- concedido de propósito (achado sec_05), que o hook de token funciona como supabase_auth_admin (sec_04) e que
-- TRUNCATE/DELETE/UPDATE fora do permitido são negados na prática.
begin;

-- 1. O ambiente é hostil de verdade: uma tabela criada sem revoke nasce escrevível por authenticated.
create table public.zz_prova_default_privileges (id int);
do $$ begin
  if not has_table_privilege('authenticated', 'public.zz_prova_default_privileges', 'insert') then
    raise exception 'stub não reproduz os default privileges do Supabase: o teste de privilégios não prova nada';
  end if;
end $$;
drop table public.zz_prova_default_privileges;

-- 2. anon: nenhum privilégio em tabela, view, função ou sequência de public.
do $$
declare r record;
begin
  for r in select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') loop
    if has_table_privilege('anon', r.rel, 'select') or has_table_privilege('anon', r.rel, 'insert') or has_table_privilege('anon', r.rel, 'update')
       or has_table_privilege('anon', r.rel, 'delete') or has_table_privilege('anon', r.rel, 'truncate') then
      raise exception 'anon tem privilégio em %', r.rel;
    end if;
  end loop;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    if has_function_privilege('anon', r.oid, 'execute') then raise exception 'anon executa %', r.oid::regprocedure; end if;
  end loop;
  for r in select c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S' loop
    if has_sequence_privilege('anon', r.rel, 'usage') or has_sequence_privilege('authenticated', r.rel, 'usage') or has_sequence_privilege('authenticated', r.rel, 'update') then
      raise exception 'sequência % exposta', r.rel;
    end if;
  end loop;
end $$;

-- 3. authenticated: TRUNCATE em nada; escrita só na lista explícita (o resto é só-RPC ou só leitura).
do $$
declare r record; v_priv text; v_ok boolean;
  -- tabela => privilégios de escrita permitidos (a nível de tabela; grants por coluna aparecem como false aqui)
  v_permitido jsonb := '{
    "tenants": ["update"], "memberships": ["delete"], "locations": ["insert","update","delete"], "units": ["insert","update","delete"],
    "products": ["insert","update"], "suppliers": ["insert","update"], "materials": ["insert","update"],
    "sku_aliases": ["insert","update","delete"], "supplier_materials": ["insert","update","delete"], "label_profiles": ["insert","update","delete"],
    "stages": ["insert","update"], "notification_settings": ["insert","update"]
  }'::jsonb;
begin
  for r in select c.relname, c.oid::regclass as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'p') loop
    if has_table_privilege('authenticated', r.rel, 'truncate') then raise exception 'authenticated pode TRUNCATE %', r.rel; end if;
    foreach v_priv in array array['insert', 'update', 'delete'] loop
      v_ok := coalesce(v_permitido -> r.relname ? v_priv, false);
      if has_table_privilege('authenticated', r.rel, v_priv) <> v_ok then
        raise exception 'privilégio % em % deveria ser %', v_priv, r.rel, v_ok;
      end if;
    end loop;
  end loop;
end $$;

-- 4. Colunas sensíveis e grants por coluna.
do $$ begin
  if has_column_privilege('authenticated', 'public.operators', 'pin_hash', 'select') then raise exception 'pin_hash legível'; end if;
  if has_column_privilege('authenticated', 'public.devices', 'pair_code', 'select') then raise exception 'pair_code legível'; end if;
  if has_column_privilege('authenticated', 'public.devices', 'pair_code_expires_at', 'select') then raise exception 'pair_code_expires_at legível'; end if;
  if has_column_privilege('authenticated', 'public.devices', 'device_user_id', 'update') then raise exception 'device_user_id editável'; end if;
  if has_column_privilege('authenticated', 'public.connector_credentials', 'payload', 'select') then raise exception 'payload de credenciais legível'; end if;
  if has_column_privilege('authenticated', 'public.purchase_orders', 'status', 'update') then raise exception 'status da OC editável direto'; end if;
  if has_column_privilege('authenticated', 'public.purchase_orders', 'total', 'update') then raise exception 'total da OC editável direto'; end if;
  if not has_column_privilege('authenticated', 'public.purchase_orders', 'observacao', 'update') then raise exception 'observacao da OC deveria ser editável'; end if;
  if has_column_privilege('authenticated', 'public.notifications', 'texto', 'update') then raise exception 'texto do aviso editável'; end if;
  if not has_column_privilege('authenticated', 'public.notifications', 'lida', 'update') then raise exception 'lida deveria ser editável'; end if;
  if has_column_privilege('authenticated', 'public.memberships', 'accepted_at', 'update') or has_column_privilege('authenticated', 'public.memberships', 'accepted_at', 'insert') then
    raise exception 'accepted_at gravável pelo cliente';
  end if;
  if not has_column_privilege('authenticated', 'public.memberships', 'role', 'update') then raise exception 'role deveria ser editável pelo admin (RLS)'; end if;
end $$;

-- 5. Funções: as internas e as do worker não executam para authenticated.
do $$
declare f text;
begin
  foreach f in array array['next_doc_number(uuid,text)', 'apply_stock_delta(uuid,uuid,uuid,numeric,numeric)', 'enqueue_outbox(uuid,uuid,numeric,text)', 'default_location(uuid)',
    'refresh_purchase_order_status(uuid)', 'on_receipt_move_reversed()', 'notify(uuid,text,text)', 'assert_service_role()', 'custom_access_token_hook(jsonb)',
    'audit_trigger()', 'set_updated_at()', 'forbid_change()', 'tenant_default_stage()',
    'worker_set_credentials(uuid,uuid,jsonb,text)', 'worker_get_credentials(uuid,text)', 'worker_upsert_orders(uuid,uuid,jsonb)', 'worker_claim_outbox(uuid,int)',
    'worker_apply_outbox_result(bigint[],boolean,text)', 'worker_set_sync_state(uuid,jsonb,boolean,text)', 'worker_upsert_hub_stock(uuid,uuid,jsonb)', 'worker_record_audit(uuid,uuid,jsonb)',
    -- importação do ES: só a import_catalog (admin) é pública; validação e seções são internas
    'import_catalog_txt(jsonb,int)', 'import_catalog_num(jsonb,numeric,numeric,boolean)', 'import_catalog_chaves(jsonb,text[],text[])', 'import_catalog_sku(jsonb)',
    'import_catalog_opc(jsonb,text,boolean)', 'import_catalog_calc(jsonb)', 'import_catalog_validate(jsonb)', 'import_catalog_linha(text,text,text,text,text[])',
    'import_catalog_contagem(int,int,int,int)', 'import_catalog_suppliers(uuid,jsonb)', 'import_catalog_materials(uuid,jsonb)', 'import_catalog_products(uuid,jsonb)',
    'import_catalog_links(uuid,jsonb)', 'import_catalog_boms(uuid,jsonb)', 'import_catalog_order_items(uuid)'] loop
    if has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute') then raise exception 'authenticated executa %', f; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.import_catalog(uuid,jsonb,boolean)', 'execute') then raise exception 'import_catalog deveria ser executável'; end if;
end $$;

-- 6. Hook de token como supabase_auth_admin (papel do Auth): a RLS precisa deixar o hook ler memberships.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000010a', 'ana10@a.com');
select auth.test_login('00000000-0000-0000-0000-00000000010a');
select public.create_tenant('Fábrica A', 'fabrica-a10', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false);
set local role supabase_auth_admin;
do $$
declare v jsonb;
begin
  v := public.custom_access_token_hook(jsonb_build_object('user_id', '00000000-0000-0000-0000-00000000010a', 'claims', '{}'::jsonb));
  if (v -> 'claims' -> 'app_metadata' ->> 'tenant_id')::uuid is distinct from current_setting('test.tenant_a')::uuid then
    raise exception 'hook como supabase_auth_admin não resolveu o tenant: %', v;
  end if;
  if (v -> 'claims' -> 'app_metadata' ->> 'role') <> 'admin' then raise exception 'hook não resolveu o papel: %', v; end if;
end $$;
reset role;

-- 7. Na prática: TRUNCATE do ledger, DELETE físico e edição de aviso são negados.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000010b', 'bento10@b.com'), ('00000000-0000-0000-0000-00000000010c', 'carla10@a.com');
select auth.test_login('00000000-0000-0000-0000-00000000010b');
select public.create_tenant('Fábrica B', 'fabrica-b10', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
insert into public.memberships (tenant_id, user_id, role, accepted_at) values (:'tenant_a', '00000000-0000-0000-0000-00000000010c', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000010a', '00000000-0000-0000-0000-00000000010c');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000010b';
insert into public.notifications (tenant_id, tipo, texto) values (:'tenant_a', 'sistema', 'original');
select auth.test_login('00000000-0000-0000-0000-00000000010b');
do $$ begin
  begin
    truncate public.stock_moves cascade;
    raise exception 'TRUNCATE do ledger deveria ser negado';
  exception when insufficient_privilege then null; end;
  begin
    truncate public.tenants cascade;
    raise exception 'TRUNCATE de tenants deveria ser negado';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000010c');
do $$ begin
  begin
    update public.notifications set texto = 'alterado pela leitura' where tenant_id = current_setting('test.tenant_a')::uuid;
    raise exception 'leitura não deveria editar o texto do aviso';
  exception when insufficient_privilege then null; end;
  update public.notifications set lida = true where tenant_id = current_setting('test.tenant_a')::uuid;
end $$;
select auth.test_logout();
do $$ begin
  if (select texto from public.notifications where tenant_id = current_setting('test.tenant_a')::uuid) <> 'original' then raise exception 'texto do aviso mudou'; end if;
end $$;

rollback;
