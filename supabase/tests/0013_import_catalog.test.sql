-- Importação do ES (import_catalog): simular não grava, gravar grava, reimportar não grava nada (0 update,
-- 0 audit_log, 0 versão de ficha), 1 campo alterado = 1 atualizado, política de campos derivados, papéis,
-- isolamento entre tenants e payload inválido. O payload é o que o core gera do backup sintético.
-- Conflitos (linha excluída, apelido alheio, unidade trocada…) e dados de exemplo: 0014. Carga: 0015.
\set payload `cat ../packages/core/src/fixtures/payload-es-sintetico.json`
\o /dev/null
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000130a', 'ana13@a.com'), ('00000000-0000-0000-0000-00000000130b', 'bento13@b.com'),
  ('00000000-0000-0000-0000-00000000130c', 'carla13@a.com'), ('00000000-0000-0000-0000-00000000130d', 'davi13@a.com'),
  ('00000000-0000-0000-0000-00000000130e', 'eva13@a.com');
select auth.test_login('00000000-0000-0000-0000-00000000130a');
select public.create_tenant('Fábrica A', 'fabrica-a13', '11.111.111/0001-11') as tenant_a \gset
select auth.test_logout();
select auth.test_login('00000000-0000-0000-0000-00000000130b');
select public.create_tenant('Fábrica B', 'fabrica-b13', '22.222.222/0001-22') as tenant_b \gset
select auth.test_logout();
insert into public.memberships (tenant_id, user_id, role, accepted_at) values
  (:'tenant_a', '00000000-0000-0000-0000-00000000130c', 'compras', now()),
  (:'tenant_a', '00000000-0000-0000-0000-00000000130d', 'producao', now()),
  (:'tenant_a', '00000000-0000-0000-0000-00000000130e', 'leitura', now());
insert into public.units (tenant_id, code, nome, kind)
select t, u.code, u.code, u.kind::public.unit_kind
  from unnest(array[:'tenant_a', :'tenant_b']::uuid[]) t,
       (values ('un', 'unidade'), ('m', 'comprimento'), ('m2', 'area'), ('kg', 'peso'), ('g', 'peso'), ('cx', 'unidade'), ('rl', 'unidade'), ('ct', 'unidade')) u(code, kind);
select set_config('test.tenant_a', :'tenant_a', false), set_config('test.tenant_b', :'tenant_b', false), set_config('test.payload', :'payload', false);

-- Resumo das contagens de uma resposta: 'entidade:novos/atualizados/iguais/problemas' em ordem fixa.
create function pg_temp.resumo(r jsonb) returns text language sql as $$
  select string_agg(format('%s:%s/%s/%s/%s', e, r -> 'contagens' -> e ->> 'novos', r -> 'contagens' -> e ->> 'atualizados',
                           r -> 'contagens' -> e ->> 'iguais', r -> 'contagens' -> e ->> 'problemas'), ' ' order by o)
    from unnest(array['fornecedor', 'insumo', 'produto', 'apelido', 'vinculo', 'ficha']) with ordinality x(e, o)
$$;
-- Retrato físico do cadastro do tenant: se qualquer linha sofrer UPDATE, o ctid muda.
create function pg_temp.retrato(t uuid) returns text language sql as $$
  select concat_ws('|',
    (select string_agg(ctid::text, ',' order by id) from public.suppliers where tenant_id = t),
    (select string_agg(ctid::text, ',' order by id) from public.materials where tenant_id = t),
    (select string_agg(ctid::text, ',' order by id) from public.products where tenant_id = t),
    (select string_agg(ctid::text, ',' order by id) from public.sku_aliases where tenant_id = t),
    (select string_agg(ctid::text, ',' order by id) from public.supplier_materials where tenant_id = t),
    (select string_agg(ctid::text, ',' order by id) from public.bom_versions where tenant_id = t),
    (select count(*)::text from public.bom_lines where tenant_id = t),
    (select count(*)::text from public.audit_log where tenant_id = t))
$$;

-- ---------------------------------------------------------------------------
-- 1. Simular (padrão) não grava nada, nem audit_log.
-- ---------------------------------------------------------------------------
select pg_temp.retrato(:'tenant_a') as antes \gset
select auth.test_login('00000000-0000-0000-0000-00000000130a');
select public.import_catalog(:'tenant_a', :'payload'::jsonb) as r \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.antes', :'antes', false);
do $$
declare r jsonb := current_setting('test.r')::jsonb;
begin
  if not (r ->> 'simulacao')::boolean then raise exception 'padrão deveria ser simulação'; end if;
  if pg_temp.resumo(r) <> 'fornecedor:3/0/0/0 insumo:8/0/0/0 produto:5/0/0/0 apelido:1/0/0/0 vinculo:6/0/0/0 ficha:5/0/0/0' then
    raise exception 'contagens da simulação: %', pg_temp.resumo(r);
  end if;
  if r -> 'exemplo' <> '{"produtos": 0, "insumos": 0, "fornecedores": 0}'::jsonb then raise exception 'exemplo: %', r -> 'exemplo'; end if;
  if jsonb_array_length(r -> 'linhas') <> 28 then raise exception 'linhas da simulação: %', jsonb_array_length(r -> 'linhas'); end if;
  if pg_temp.retrato(current_setting('test.tenant_a')::uuid) <> current_setting('test.antes') then raise exception 'a simulação gravou'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Gravar: mesmas contagens, valores convertidos e uma linha de resumo no audit_log.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000130a');
select public.import_catalog(:'tenant_a', :'payload'::jsonb, false) as r \gset
select auth.test_logout();
select set_config('test.r', :'r', false);
do $$
declare
  r jsonb := current_setting('test.r')::jsonb;
  t uuid := current_setting('test.tenant_a')::uuid;
  v record;
begin
  if (r ->> 'simulacao')::boolean then raise exception 'deveria gravar'; end if;
  if pg_temp.resumo(r) <> 'fornecedor:3/0/0/0 insumo:8/0/0/0 produto:5/0/0/0 apelido:1/0/0/0 vinculo:6/0/0/0 ficha:5/0/0/0' then
    raise exception 'contagens da gravação: %', pg_temp.resumo(r);
  end if;
  select * into v from public.suppliers where tenant_id = t and cnpj = '12345678000195';
  if v.nome <> 'Tecidos Modelo Ind. e Com.' or v.lead_time_dias <> 12 or v.condicao_pagamento <> '{30,60}' or v.regime <> 'normal' then raise exception 'fornecedor: %', row_to_json(v); end if;
  select * into v from public.suppliers where tenant_id = t and cnpj = '98765432000198';
  if v.regime <> 'simples' or v.condicao_pagamento <> '{0}' or v.lead_time_dias <> 0 or v.contato <> 'vendas@exemplo.invalid' then raise exception 'fornecedor simples: %', row_to_json(v); end if;
  select m.*, s.cnpj into v from public.materials m left join public.suppliers s on s.id = m.fornecedor_padrao_id where m.tenant_id = t and m.sku = 'MP9001';
  if v.unidade_compra <> 'un' or v.unidade_consumo <> 'm2' or v.fator_conversao <> 7.704 or v.custo_referencia <> 29.1837 or v.minimo <> 30.8
     or v.cnpj <> '11222333000181' or v.lead_time_dias <> 7 or v.ncm <> '7009.91.00' then raise exception 'insumo MP9001: %', row_to_json(v); end if;
  if (select fornecedor_padrao_id from public.materials where tenant_id = t and sku = 'MP9005') is not null then raise exception 'MP9005 sem fornecedor padrão'; end if;
  select * into v from public.products where tenant_id = t and sku = 'ED900001';
  if v.familia <> 'Espelho' or v.atributos ->> 'cor' <> 'Preto' or v.atributos ->> 'tamanho' <> '40cm' or v.ean <> '2000000000015'
     or v.peso_cubado_kg <> 2.025 or v.custo_manual is not null then raise exception 'produto ED900001: %', row_to_json(v); end if;
  if (select status from public.products where tenant_id = t and sku = 'TM900001') <> 'inativo' then raise exception 'TM900001 deveria ser inativo'; end if;
  if (select p.sku from public.sku_aliases a join public.products p on p.id = a.product_id where a.tenant_id = t and a.sku_externo = 'TM900002') <> 'ED900001' then
    raise exception 'apelido TM900002 → ED900001';
  end if;
  select sm.* into v from public.supplier_materials sm join public.materials m on m.id = sm.material_id where sm.tenant_id = t and m.sku = 'MP9001';
  if v.codigo_fornecedor <> 'CH3MM-321240' or v.fator <> 7.704 or v.preco <> 300 or v.aliq_icms <> 0.12 or not v.inteiro then raise exception 'vínculo MP9001: %', row_to_json(v); end if;
  -- fichas: 5 versões ativas marcadas, perda sempre 0, componente e kit, calc guardado
  if (select count(*) from public.bom_versions where tenant_id = t and ativa and observacao = 'importado do ES' and criado_por = '00000000-0000-0000-0000-00000000130a') <> 5 then
    raise exception 'fichas ativas importadas';
  end if;
  if exists (select 1 from public.bom_lines where tenant_id = t and perda_pct <> 0) then raise exception 'perda_pct deveria ser 0 (o consumo do ES já inclui a perda)'; end if;
  if (select count(*) from public.v_bom_active where tenant_id = t and product_sku = 'ED900001') <> 6 then raise exception 'ficha ED900001 com 6 linhas'; end if;
  if not exists (select 1 from public.v_bom_active where tenant_id = t and product_sku = 'ED900004' and component_sku = 'ED900003' and consumo = 2) then raise exception 'kit sem componente'; end if;
  if (select calc -> 'perda' from public.v_bom_active where tenant_id = t and product_sku = 'ED900001' and material_sku = 'MP9001') <> '{"tipo": "pct", "valor": 0.1}' then
    raise exception 'calc da chapa';
  end if;
  if (select count(*) from public.audit_log where tenant_id = t and entidade = 'import_catalog' and acao = 'importacao_es') <> 1 then raise exception 'resumo no audit_log'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Reimportar o mesmo payload: tudo igual, nenhum UPDATE, nenhuma linha no audit_log, nenhuma versão.
-- ---------------------------------------------------------------------------
select pg_temp.retrato(:'tenant_a') as antes \gset
select auth.test_login('00000000-0000-0000-0000-00000000130a');
select public.import_catalog(:'tenant_a', :'payload'::jsonb, false) as r \gset
select public.import_catalog(:'tenant_a', :'payload'::jsonb, true) as r_sim \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.r_sim', :'r_sim', false), set_config('test.antes', :'antes', false);
do $$
declare r jsonb := current_setting('test.r')::jsonb;
begin
  if pg_temp.resumo(r) <> 'fornecedor:0/0/3/0 insumo:0/0/8/0 produto:0/0/5/0 apelido:0/0/1/0 vinculo:0/0/6/0 ficha:0/0/5/0' then
    raise exception 'reimportação deveria ser toda igual: %', pg_temp.resumo(r);
  end if;
  if r -> 'linhas' <> '[]' then raise exception 'reimportação não deveria ter linhas: %', r -> 'linhas'; end if;
  if pg_temp.resumo(current_setting('test.r_sim')::jsonb) <> pg_temp.resumo(r) then raise exception 'simulação da reimportação difere'; end if;
  if pg_temp.retrato(current_setting('test.tenant_a')::uuid) <> current_setting('test.antes') then raise exception 'a reimportação regravou linhas'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Um campo alterado = 1 atualizado. Campos derivados e o que o Prodio aprendeu não são sobrescritos.
-- ---------------------------------------------------------------------------
update public.materials set lead_time_dias = 30 where tenant_id = :'tenant_a' and sku = 'MP9002';
update public.products set familia = 'Espelhos Premium', atributos = atributos || '{"acabamento": "bisotê"}' where tenant_id = :'tenant_a' and sku = 'ED900001';
update public.supplier_materials set preco = 310 where tenant_id = :'tenant_a' and codigo_fornecedor = 'CH3MM-321240';
select pg_temp.retrato(:'tenant_a') as antes \gset
select auth.test_login('00000000-0000-0000-0000-00000000130a');
select public.import_catalog(:'tenant_a', jsonb_set(:'payload'::jsonb, '{fornecedores,0,nome}', '"Vidraçaria Exemplo Ltda - Matriz"'), false) as r \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.antes', :'antes', false);
do $$
declare r jsonb := current_setting('test.r')::jsonb; t uuid := current_setting('test.tenant_a')::uuid;
begin
  if pg_temp.resumo(r) <> 'fornecedor:0/1/2/0 insumo:0/0/8/0 produto:0/0/5/0 apelido:0/0/1/0 vinculo:0/0/6/0 ficha:0/0/5/0' then
    raise exception '1 campo alterado: %', pg_temp.resumo(r);
  end if;
  if r -> 'linhas' <> '[{"entidade": "fornecedor", "chave": "11222333000181", "situacao": "atualizado", "campos": ["nome"]}]' then raise exception 'linha: %', r -> 'linhas'; end if;
  if (select lead_time_dias from public.materials where tenant_id = t and sku = 'MP9002') <> 30 then raise exception 'lead time derivado foi sobrescrito'; end if;
  if (select familia from public.products where tenant_id = t and sku = 'ED900001') <> 'Espelhos Premium' then raise exception 'família derivada foi sobrescrita'; end if;
  if (select atributos ->> 'acabamento' from public.products where tenant_id = t and sku = 'ED900001') <> 'bisotê' then raise exception 'atributo só do Prodio sumiu'; end if;
  if (select preco from public.supplier_materials where tenant_id = t and codigo_fornecedor = 'CH3MM-321240') <> 310 then raise exception 'preço aprendido foi sobrescrito'; end if;
  if (select count(*) from public.audit_log where tenant_id = t and entidade = 'import_catalog') <> 2 then raise exception 'resumo da 2ª gravação'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Papéis e tenants: só admin do próprio tenant; anon nem executa.
-- ---------------------------------------------------------------------------
do $$
declare u text; papel text;
begin
  foreach u in array array['00000000-0000-0000-0000-00000000130c', '00000000-0000-0000-0000-00000000130d', '00000000-0000-0000-0000-00000000130e',
                           '00000000-0000-0000-0000-00000000130b'] loop
    perform auth.test_login(u::uuid);
    begin
      perform public.import_catalog(current_setting('test.tenant_a')::uuid, current_setting('test.payload')::jsonb, true);
      raise exception 'usuário % deveria receber 42501', u;
    exception when insufficient_privilege then null;
    end;
    perform auth.test_logout();
  end loop;
  -- Bento é admin de B: no próprio tenant a simulação roda.
  perform auth.test_login('00000000-0000-0000-0000-00000000130b');
  papel := public.import_catalog(current_setting('test.tenant_b')::uuid, current_setting('test.payload')::jsonb) -> 'contagens' -> 'produto' ->> 'novos';
  if papel <> '5' then raise exception 'admin de B deveria simular no próprio tenant'; end if;
  perform auth.test_logout();
end $$;
set local role anon;
do $$ begin
  perform public.import_catalog(current_setting('test.tenant_a')::uuid, current_setting('test.payload')::jsonb, true);
  raise exception 'anon não deveria executar';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$ begin
  if has_function_privilege('authenticated', 'public.import_catalog_products(uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.import_catalog_validate(jsonb)', 'execute') then
    raise exception 'funções internas da importação expostas';
  end if;
  if exists (select 1 from public.products where tenant_id = current_setting('test.tenant_b')::uuid) then raise exception 'simulação em B gravou'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Payload inválido: 22023, nada gravado.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000130a');
do $$
declare
  p jsonb := current_setting('test.payload')::jsonb;
  ruins jsonb[] := array[
    p || '{"usuarios": []}', p || '{"versao": 2}', p || '{"origem": "planilha"}', p || '{"produtos": {}}',
    jsonb_set(p, '{produtos,0,token}', '"x"'), jsonb_set(p, '{produtos,0,sku}', '"ed900001"'),
    jsonb_set(p, '{fornecedores,0,cnpj}', '"11.222.333/0001-81"'), jsonb_set(p, '{fichas,0,linhas,0,perda_pct}', '0.1'),
    jsonb_set(p, '{fichas,0,linhas,1,consumo}', '0'), jsonb_set(p, '{fichas,0,linhas,1,calc,partes,0,segredo}', '1'),
    jsonb_set(p, '{insumos,1,sku}', '"MP9001"'), jsonb_set(p, '{produtos,1,apelidos}', '["TM900002"]'),
    jsonb_set(p, '{vinculos,0,aliq_icms}', '12'), jsonb_set(p, '{insumos,0,minimo}', '"10"'), jsonb_set(p, '{produtos,0,atributos,cor}', '1'),
    jsonb_build_object('versao', 1, 'origem', 'es', 'insumos', (select jsonb_agg(p -> 'insumos' -> 0) from generate_series(1, 5001)))];
  x jsonb;
begin
  foreach x in array ruins loop
    begin
      perform public.import_catalog(current_setting('test.tenant_a')::uuid, x, false);
      raise exception 'payload inválido aceito: %', left(x::text, 200);
    exception when invalid_parameter_value then null;
    end;
  end loop;
end $$;
select auth.test_logout();

-- ---------------------------------------------------------------------------
-- 7. Itens de pedido sem produto: a importação liga pela regra do robô (worker_upsert_orders): apelido primeiro,
--    depois SKU de produto não excluído, comparação exata (sem trim nem maiúsculas). Só mexe em product_id nulo,
--    conta também na simulação (sem gravar) e reimportar religa 0. Outro tenant não é tocado.
-- ---------------------------------------------------------------------------
insert into public.connectors (id, tenant_id, plataforma, nome, status) values
  ('13000000-0000-0000-0000-0000000000c1', :'tenant_a', 'baselinker', 'Base', 'conectado'),
  ('13000000-0000-0000-0000-0000000000c2', :'tenant_b', 'baselinker', 'Base', 'conectado');
insert into public.products (id, tenant_id, sku, nome, deleted_at) values
  ('13000000-0000-0000-0000-0000000000a1', :'tenant_a', 'ED9DEL', 'Excluído', now()),
  ('13000000-0000-0000-0000-0000000000a2', :'tenant_a', 'DUPLA', 'Dono do SKU', null),
  ('13000000-0000-0000-0000-0000000000a3', :'tenant_a', 'OUTRO13', 'Dono do apelido', null);
insert into public.sku_aliases (tenant_id, product_id, sku_externo) values (:'tenant_a', '13000000-0000-0000-0000-0000000000a3', 'DUPLA');
insert into public.orders (id, tenant_id, connector_id, external_id, significado) values
  ('13000000-0000-0000-0000-0000000000b1', :'tenant_a', '13000000-0000-0000-0000-0000000000c1', 'p1', 'demanda'),
  ('13000000-0000-0000-0000-0000000000b2', :'tenant_a', '13000000-0000-0000-0000-0000000000c1', 'p2', 'demanda'),
  ('13000000-0000-0000-0000-0000000000b3', :'tenant_b', '13000000-0000-0000-0000-0000000000c2', 'p1', 'demanda');
insert into public.order_items (tenant_id, order_id, sku_externo, product_id, quantidade)
select :'tenant_a', '13000000-0000-0000-0000-0000000000b1', x, null, 1
  from unnest(array['ED900001', 'TM900002', 'DUPLA', 'ed900001', ' ED900001', 'ED900001 ', 'ED9DEL', 'ZZZ', null]) x;
insert into public.order_items (tenant_id, order_id, sku_externo, product_id, quantidade) values
  (:'tenant_a', '13000000-0000-0000-0000-0000000000b2', 'ED900002', '13000000-0000-0000-0000-0000000000a2', 1),
  (:'tenant_b', '13000000-0000-0000-0000-0000000000b3', 'ED900001', null, 1);
select auth.test_login('00000000-0000-0000-0000-00000000130a');
select public.import_catalog(:'tenant_a', :'payload'::jsonb, true) as r_sim \gset
select public.import_catalog(:'tenant_a', :'payload'::jsonb, false) as r \gset
select public.import_catalog(:'tenant_a', :'payload'::jsonb, false) as r2 \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.r_sim', :'r_sim', false), set_config('test.r2', :'r2', false);
do $$
declare
  t uuid := current_setting('test.tenant_a')::uuid;
  sim jsonb := current_setting('test.r_sim')::jsonb;
  r jsonb := current_setting('test.r')::jsonb;
  esperado jsonb := jsonb_build_object('ED900001', (select id from public.products where tenant_id = t and sku = 'ED900001'),
    'TM900002', (select id from public.products where tenant_id = t and sku = 'ED900001'), 'DUPLA', '13000000-0000-0000-0000-0000000000a3');
  atual jsonb;
begin
  if sim -> 'itens_pedido_religados' <> '3' or r -> 'itens_pedido_religados' <> '3' then
    raise exception 'religados: simulação %, gravação %', sim -> 'itens_pedido_religados', r -> 'itens_pedido_religados';
  end if;
  if r -> 'uso_real' <> '{"conectores_ligados": 1, "pedidos_reais": 2}' then raise exception 'uso_real: %', r -> 'uso_real'; end if;
  if current_setting('test.r2')::jsonb -> 'itens_pedido_religados' <> '0' then raise exception 'reimportar deveria religar 0'; end if;
  select jsonb_object_agg(sku_externo, product_id) filter (where product_id is not null) into atual
    from public.order_items where order_id = '13000000-0000-0000-0000-0000000000b1';
  if atual <> esperado then raise exception 'religação: % (esperado %)', atual, esperado; end if;
  if (select product_id from public.order_items where order_id = '13000000-0000-0000-0000-0000000000b2') <> '13000000-0000-0000-0000-0000000000a2' then
    raise exception 'item já ligado não pode mudar de produto';
  end if;
  if (select product_id from public.order_items where order_id = '13000000-0000-0000-0000-0000000000b3') is not null then raise exception 'outro tenant foi religado'; end if;
  if (select depois ->> 'itens_pedido_religados' from public.audit_log where tenant_id = t and entidade = 'import_catalog' order by id desc limit 1) <> '3' then
    raise exception 'resumo da importação no audit_log sem os itens religados';
  end if;
  perform set_config('test.esperado', atual::text, false);
end $$;
-- O robô, regravando o mesmo pedido, chega aos mesmos produtos: a regra é a mesma.
select auth.test_login('00000000-0000-0000-0000-00000000130f', 'service_role');
select public.worker_upsert_orders(:'tenant_a', '13000000-0000-0000-0000-0000000000c1', jsonb_build_array(jsonb_build_object('external_id', 'p1',
  'itens', (select jsonb_agg(jsonb_build_object('sku_externo', x, 'quantidade', 1))
              from unnest(array['ED900001', 'TM900002', 'DUPLA', 'ed900001', ' ED900001', 'ED900001 ', 'ED9DEL', 'ZZZ', null]) x))));
select auth.test_logout();
do $$ begin
  if (select jsonb_object_agg(sku_externo, product_id) filter (where product_id is not null) from public.order_items
       where order_id = '13000000-0000-0000-0000-0000000000b1') <> current_setting('test.esperado')::jsonb then
    raise exception 'a importação e o robô casam diferente';
  end if;
end $$;

rollback;
