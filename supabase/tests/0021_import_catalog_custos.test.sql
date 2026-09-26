-- Importação do ES, custos (26/09): a regra antiga mandava o custo médio do ES como custo de referência — insumo
-- sem custo e a Bolha Inflável cobrada por rolo em cada unidade da ficha do espelho 60cm (R$ 1.603,16 numa linha).
-- Aqui: grava o payload da regra ANTIGA (fixtures/payload-es-custos-antigo.json, congelado da lógica anterior) e
-- reimporta o mesmo backup com a regra nova (fixtures/payload-es-custos.json, snapshot do core). A prévia tem de
-- mostrar "atualizado" só em custo_referencia, a gravação conserta os custos e não mexe em mais nada (produtos,
-- fichas, unidades e fator ficam como estavam; nenhuma versão de ficha nova), e reimportar de novo não faz nada.
\set antigo `cat ../packages/core/src/fixtures/payload-es-custos-antigo.json`
\set novo `cat ../packages/core/src/fixtures/payload-es-custos.json`
\o /dev/null
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000190a', 'ana19@a.com');
select auth.test_login('00000000-0000-0000-0000-00000000190a');
select public.create_tenant('Fábrica Custos', 'fabrica-custos19', '19.191.919/0001-19') as tenant \gset
select auth.test_logout();
insert into public.units (tenant_id, code, nome, kind)
select :'tenant', u.code, u.code, u.kind::public.unit_kind
  from (values ('un', 'unidade'), ('m', 'comprimento'), ('m2', 'area'), ('kg', 'peso'), ('g', 'peso'), ('cx', 'unidade'), ('rl', 'unidade'), ('ct', 'unidade')) u(code, kind);
select set_config('test.tenant', :'tenant', false);

create function pg_temp.resumo(r jsonb) returns text language sql as $$
  select string_agg(format('%s:%s/%s/%s/%s', e, r -> 'contagens' -> e ->> 'novos', r -> 'contagens' -> e ->> 'atualizados',
                           r -> 'contagens' -> e ->> 'iguais', r -> 'contagens' -> e ->> 'problemas'), ' ' order by o)
    from unnest(array['fornecedor', 'insumo', 'produto', 'apelido', 'vinculo', 'ficha']) with ordinality x(e, o)
$$;
-- Tudo do cadastro menos o custo de referência (e updated_at): o que a correção não pode mexer.
create function pg_temp.sem_custo(t uuid) returns text language sql as $$
  select concat_ws('|',
    (select string_agg(concat_ws(',', sku, nome, unidade_compra, unidade_consumo, fator_conversao, minimo, ncm, fornecedor_padrao_id, lead_time_dias), ';' order by sku)
       from public.materials where tenant_id = t),
    (select string_agg(concat_ws(',', sku, nome, familia, atributos::text, status, custo_manual, ctid), ';' order by sku) from public.products where tenant_id = t),
    (select string_agg(concat_ws(',', product_id, versao, ativa, ctid), ';' order by product_id, versao) from public.bom_versions where tenant_id = t),
    (select string_agg(concat_ws(',', bom_version_id, material_id, component_product_id, consumo, unidade, perda_pct), ';' order by bom_version_id, ordem)
       from public.bom_lines where tenant_id = t))
$$;
-- Custo por unidade do produto pela ficha ativa, com o custo de referência (como a web mostra sem custo médio do ledger).
create function pg_temp.custo_ficha(t uuid, p_sku text) returns numeric language sql as $$
  with recursive arvore(product_id, fator) as (
    select id, 1::numeric from public.products where tenant_id = t and sku = p_sku
    union all
    select l.component_product_id, a.fator * l.consumo
      from arvore a join public.bom_versions v on v.tenant_id = t and v.product_id = a.product_id and v.ativa
      join public.bom_lines l on l.bom_version_id = v.id and l.tipo = 'produto')
  select round(sum(a.fator * l.consumo * coalesce(m.custo_referencia, 0)), 2)
    from arvore a join public.bom_versions v on v.tenant_id = t and v.product_id = a.product_id and v.ativa
    join public.bom_lines l on l.bom_version_id = v.id and l.tipo = 'insumo'
    join public.materials m on m.id = l.material_id
$$;
create function pg_temp.custos(t uuid) returns jsonb language sql as $$
  select jsonb_object_agg(sku, custo_referencia) from public.materials where tenant_id = t
$$;

-- ---------------------------------------------------------------------------
-- 1. Produção hoje: o cadastro gravado com a regra antiga.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000190a');
select public.import_catalog(:'tenant', :'antigo'::jsonb, false) as r \gset
select auth.test_logout();
select set_config('test.r', :'r', false);
do $$
declare t uuid := current_setting('test.tenant')::uuid;
begin
  if pg_temp.resumo(current_setting('test.r')::jsonb) <> 'fornecedor:0/0/0/0 insumo:8/0/0/0 produto:3/0/0/0 apelido:0/0/0/0 vinculo:0/0/0/0 ficha:3/0/0/0' then
    raise exception 'gravação antiga: %', pg_temp.resumo(current_setting('test.r')::jsonb);
  end if;
  if pg_temp.custos(t) <> '{"MP9101": 29.1837, "MP9133": 0.0398, "MP9140": null, "MP9145": 400.79, "MP9163": null, "MP9172": 280, "MP9180": 85, "MP9190": null}'::jsonb then
    raise exception 'custos antigos: %', pg_temp.custos(t);
  end if;
  if pg_temp.custo_ficha(t, 'ED900124') <> 1615.15 then raise exception 'ficha antiga do espelho 60: %', pg_temp.custo_ficha(t, 'ED900124'); end if;
  perform set_config('test.retrato', pg_temp.sem_custo(t), false);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Prévia da reimportação com a regra nova: "atualizado" só em custo_referencia, e nada gravado.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000190a');
select public.import_catalog(:'tenant', :'novo'::jsonb, true) as r \gset
select auth.test_logout();
select set_config('test.r', :'r', false);
do $$
declare
  r jsonb := current_setting('test.r')::jsonb;
  t uuid := current_setting('test.tenant')::uuid;
  atualizados jsonb;
begin
  if pg_temp.resumo(r) <> 'fornecedor:0/0/0/0 insumo:0/6/2/0 produto:0/0/3/0 apelido:0/0/0/0 vinculo:0/0/0/0 ficha:0/0/3/0' then
    raise exception 'prévia: %', pg_temp.resumo(r);
  end if;
  select jsonb_object_agg(l ->> 'chave', l -> 'campos') into atualizados
    from jsonb_array_elements(r -> 'linhas') l where l ->> 'situacao' = 'atualizado';
  if atualizados <> '{"MP9101": ["custo_referencia"], "MP9133": ["custo_referencia"], "MP9140": ["custo_referencia"], "MP9145": ["custo_referencia"],
                      "MP9163": ["custo_referencia"], "MP9172": ["custo_referencia"]}'::jsonb then
    raise exception 'linhas atualizadas na prévia: %', atualizados;
  end if;
  if pg_temp.custos(t) ->> 'MP9145' <> '400.7900' then raise exception 'a prévia gravou'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Gravar conserta os custos e não mexe em mais nada; reimportar de novo não faz nada.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000190a');
select public.import_catalog(:'tenant', :'novo'::jsonb, false) as r \gset
select public.import_catalog(:'tenant', :'novo'::jsonb, false) as r2 \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.r2', :'r2', false);
do $$
declare t uuid := current_setting('test.tenant')::uuid;
begin
  if pg_temp.resumo(current_setting('test.r')::jsonb) <> 'fornecedor:0/0/0/0 insumo:0/6/2/0 produto:0/0/3/0 apelido:0/0/0/0 vinculo:0/0/0/0 ficha:0/0/3/0' then
    raise exception 'gravação nova: %', pg_temp.resumo(current_setting('test.r')::jsonb);
  end if;
  if pg_temp.custos(t) <> '{"MP9101": 31.0981, "MP9133": 0.0582, "MP9140": 20.5354, "MP9145": 4.0079, "MP9163": 4.3905, "MP9172": 411.515, "MP9180": 85, "MP9190": null}'::jsonb then
    raise exception 'custos novos: %', pg_temp.custos(t);
  end if;
  if pg_temp.sem_custo(t) <> current_setting('test.retrato') then raise exception 'a correção mexeu em outra coisa além do custo'; end if;
  if pg_temp.custo_ficha(t, 'ED900124') <> 36.23 then raise exception 'ficha nova do espelho 60: %', pg_temp.custo_ficha(t, 'ED900124'); end if;
  if pg_temp.resumo(current_setting('test.r2')::jsonb) <> 'fornecedor:0/0/0/0 insumo:0/0/8/0 produto:0/0/3/0 apelido:0/0/0/0 vinculo:0/0/0/0 ficha:0/0/3/0' then
    raise exception 'reimportar de novo: %', pg_temp.resumo(current_setting('test.r2')::jsonb);
  end if;
  if (select count(*) from public.audit_log where tenant_id = t and entidade = 'materials' and acao = 'update') <> 6 then
    raise exception 'audit_log de materials: % updates (esperado 6)', (select count(*) from public.audit_log where tenant_id = t and entidade = 'materials' and acao = 'update');
  end if;
end $$;

rollback;
