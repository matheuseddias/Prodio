-- Testes dos cadastros: RLS cruzada, escrita por papel, auditoria, updated_at, activate_bom (ciclo, unidade, versão).
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000002a', 'ana2@a.com'),
  ('00000000-0000-0000-0000-00000000002b', 'bento2@b.com'),
  ('00000000-0000-0000-0000-00000000002c', 'carla2@a.com');

select auth.test_login('00000000-0000-0000-0000-00000000002a');
select public.create_tenant('Fábrica A', 'fabrica-a2', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000002b');
select public.create_tenant('Fábrica B', 'fabrica-b2', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false);
-- Carla é leitura no tenant A.
insert into public.memberships (tenant_id, user_id, role, accepted_at) values (:'tenant_a', '00000000-0000-0000-0000-00000000002c', 'leitura', now());
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_a') where id in ('00000000-0000-0000-0000-00000000002a', '00000000-0000-0000-0000-00000000002c');
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', :'tenant_b') where id = '00000000-0000-0000-0000-00000000002b';

-- ---------------------------------------------------------------------------
-- Ana (admin de A) cadastra unidades, fornecedor, insumos e produtos por escrita direta.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000002a');
insert into public.units (tenant_id, code, nome, kind) values (:'tenant_a', 'un', 'Unidade', 'unidade'), (:'tenant_a', 'm2', 'Metro quadrado', 'area');
insert into public.suppliers (id, tenant_id, nome, cnpj, regime) values ('10000000-0000-0000-0000-000000000001', :'tenant_a', 'Vidros', '12345678000190', 'normal');
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo, fator_conversao, minimo, fornecedor_padrao_id) values
  ('20000000-0000-0000-0000-000000000001', :'tenant_a', 'MP01', 'Chapa', 'un', 'm2', 7.7, 10, '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', :'tenant_a', 'MP02', 'Parafuso', 'un', 'un', 1, 100, null);
insert into public.products (id, tenant_id, sku, nome, familia, updated_at) values
  ('30000000-0000-0000-0000-000000000001', :'tenant_a', 'PA', 'Produto A', 'Espelho', now() - interval '1 day'),
  ('30000000-0000-0000-0000-000000000002', :'tenant_a', 'PB', 'Produto B', 'Espelho', now()),
  ('30000000-0000-0000-0000-000000000003', :'tenant_a', 'PC', 'Produto C', 'Espelho', now());
insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (:'tenant_a', '30000000-0000-0000-0000-000000000001', 'ED-PA');
insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor) values (:'tenant_a', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'CH3MM');
insert into public.label_profiles (tenant_id, familia, prefixo) values (:'tenant_a', 'Espelho', 'EH');

do $$
declare v_before timestamptz; v_after timestamptz;
begin
  -- auditoria gravou os inserts
  if (select count(*) from public.audit_log where tenant_id = current_setting('test.tenant_a')::uuid and entidade = 'products' and acao = 'insert') <> 3 then
    raise exception 'audit_log deveria ter 3 inserts de products';
  end if;
  -- updated_at muda no update (now() é fixo na transação: o insert gravou ontem de propósito)
  select updated_at into v_before from public.products where sku = 'PA';
  update public.products set nome = 'Produto A2' where sku = 'PA';
  select updated_at into v_after from public.products where sku = 'PA';
  if v_after <= v_before or v_after <> now() then raise exception 'updated_at deveria avançar'; end if;
  -- chave natural única
  begin
    insert into public.products (tenant_id, sku, nome) values (current_setting('test.tenant_a')::uuid, 'PA', 'dup');
    raise exception 'sku duplicado deveria falhar';
  exception when unique_violation then null; end;
  -- unidade inexistente é rejeitada pela FK
  begin
    insert into public.materials (tenant_id, sku, nome, unidade_compra, unidade_consumo) values (current_setting('test.tenant_a')::uuid, 'MPX', 'x', 'kg', 'kg');
    raise exception 'unidade inexistente deveria falhar';
  exception when foreign_key_violation then null; end;
  -- escrita cruzada no tenant B falha
  begin
    insert into public.products (tenant_id, sku, nome) values (current_setting('test.tenant_b')::uuid, 'INV', 'Invasão');
    raise exception 'escrita cruzada deveria falhar';
  exception when insufficient_privilege or check_violation then null; end;
  -- bom_lines só via RPC, mesmo para admin
  begin
    insert into public.bom_lines (tenant_id, bom_version_id, tipo, material_id, consumo) values (current_setting('test.tenant_a')::uuid, gen_random_uuid(), 'insumo', '20000000-0000-0000-0000-000000000001', 1);
    raise exception 'insert direto em bom_lines deveria falhar';
  exception when insufficient_privilege then null; end;
  -- sem DELETE em produtos (soft delete)
  begin
    delete from public.products where sku = 'PC';
    raise exception 'delete direto em products deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- activate_bom
-- ---------------------------------------------------------------------------
select public.activate_bom(:'tenant_a', '30000000-0000-0000-0000-000000000001',
  '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":0.16,"unidade":"m2","perda_pct":0.08}]') as bom_v1 \gset
select public.activate_bom(:'tenant_a', '30000000-0000-0000-0000-000000000001',
  '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":0.2},
    {"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000002","consumo":2},
    {"tipo":"produto","component_product_id":"30000000-0000-0000-0000-000000000002","consumo":1}]') as bom_v2 \gset
select set_config('test.bom_v1', :'bom_v1', false), set_config('test.bom_v2', :'bom_v2', false);

do $$
declare v_ativa boolean; v_versao int;
begin
  select ativa into v_ativa from public.bom_versions where id = current_setting('test.bom_v1')::uuid;
  if v_ativa then raise exception 'versão anterior deveria ser desativada'; end if;
  select ativa, versao into v_ativa, v_versao from public.bom_versions where id = current_setting('test.bom_v2')::uuid;
  if not v_ativa or v_versao <> 2 then raise exception 'versão 2 deveria estar ativa'; end if;
  if (select count(*) from public.v_bom_active where product_id = '30000000-0000-0000-0000-000000000001') <> 3 then
    raise exception 'v_bom_active deveria mostrar 3 linhas da versão ativa';
  end if;
  -- unidade herdada do insumo quando omitida; produto vira 'un'
  if (select unidade from public.bom_lines where bom_version_id = current_setting('test.bom_v2')::uuid and ordem = 1) <> 'm2' then
    raise exception 'unidade deveria vir do insumo';
  end if;
  if (select unidade from public.bom_lines where bom_version_id = current_setting('test.bom_v2')::uuid and ordem = 3) <> 'un' then
    raise exception 'componente produto deveria ter unidade un';
  end if;
  -- ciclo A→B→A: B com A como componente é rejeitado
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"produto","component_product_id":"30000000-0000-0000-0000-000000000001","consumo":1}]');
    raise exception 'ciclo A→B→A deveria ser rejeitado';
  exception when invalid_parameter_value then null; end;
  -- ciclo em 3 níveis: C → A (A tem B); depois B → C fecha A→B→C→A
  perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000003',
    '[{"tipo":"produto","component_product_id":"30000000-0000-0000-0000-000000000001","consumo":1}]');
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"produto","component_product_id":"30000000-0000-0000-0000-000000000003","consumo":1}]');
    raise exception 'ciclo A→B→C→A deveria ser rejeitado';
  exception when invalid_parameter_value then null; end;
  -- componente = próprio produto
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"produto","component_product_id":"30000000-0000-0000-0000-000000000002","consumo":1}]');
    raise exception 'componente igual ao produto deveria ser rejeitado';
  exception when invalid_parameter_value then null; end;
  -- unidade diferente da unidade de consumo
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":1,"unidade":"un"}]');
    raise exception 'unidade incompatível deveria ser rejeitada';
  exception when invalid_parameter_value then null; end;
  -- consumo zero
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":0}]');
    raise exception 'consumo zero deveria ser rejeitado';
  exception when invalid_parameter_value then null; end;
  -- nada das falhas ficou gravado para B
  if exists (select 1 from public.bom_versions where product_id = '30000000-0000-0000-0000-000000000002') then
    raise exception 'ficha rejeitada não deveria criar versão';
  end if;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Carla (leitura) lê mas não escreve; não chama activate_bom.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000002c');
do $$ begin
  if (select count(*) from public.products) <> 3 then raise exception 'leitura deveria ver os 3 produtos'; end if;
  if (select count(*) from public.v_bom_active) < 3 then raise exception 'leitura deveria ver a view da ficha'; end if;
  begin
    insert into public.products (tenant_id, sku, nome) values (current_setting('test.tenant_a')::uuid, 'PX', 'x');
    raise exception 'leitura não deveria inserir produto';
  exception when insufficient_privilege then null; end;
  begin
    update public.products set nome = 'hack' where sku = 'PA';
    if found then raise exception 'leitura não deveria alterar produto'; end if;
  exception when insufficient_privilege then null; end;
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":1}]');
    raise exception 'leitura não deveria ativar ficha';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- Bento (tenant B) não vê nem escreve nada de A, em todas as tabelas de cadastro.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000002b');
do $$
declare t text; n bigint;
begin
  foreach t in array array['products', 'sku_aliases', 'suppliers', 'materials', 'supplier_materials', 'bom_versions', 'bom_lines', 'label_profiles', 'v_bom_active'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> 0 then raise exception 'tenant B não deveria ver % linhas de %', n, t; end if;
  end loop;
  foreach t in array array['products', 'sku_aliases', 'suppliers', 'materials', 'supplier_materials', 'bom_versions', 'bom_lines', 'label_profiles'] loop
    begin
      execute format('update public.%I set tenant_id = tenant_id where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'tenant B alterou % linhas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
    begin
      execute format('delete from public.%I where tenant_id = $1', t) using current_setting('test.tenant_a')::uuid;
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'tenant B apagou % linhas de %', n, t; end if;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.activate_bom(current_setting('test.tenant_a')::uuid, '30000000-0000-0000-0000-000000000002',
      '[{"tipo":"insumo","material_id":"20000000-0000-0000-0000-000000000001","consumo":1}]');
    raise exception 'activate_bom cruzado deveria falhar';
  exception when insufficient_privilege then null; end;
end $$;
select auth.test_logout();

rollback;
