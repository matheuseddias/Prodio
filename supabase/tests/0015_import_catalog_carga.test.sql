-- Importação do ES · carga: 50 fornecedores, 400 insumos, 400 produtos (com apelido), 400 vínculos e 400 fichas
-- de 8 linhas (7 insumos + 1 componente) numa chamada só. O Supabase corta o comando do authenticated em 8 s;
-- aqui reprova acima de 6 s. A reimportação (tudo igual, nenhuma versão nova) também é medida.
\o /dev/null
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000150a', 'gil15@d.com');
select auth.test_login('00000000-0000-0000-0000-00000000150a');
select public.create_tenant('Fábrica D', 'fabrica-d15', '44.444.444/0001-44') as tenant_d \gset
select auth.test_logout();
insert into public.units (tenant_id, code, nome, kind)
select :'tenant_d', u.code, u.code, u.kind::public.unit_kind
  from (values ('un', 'unidade'), ('m', 'comprimento'), ('m2', 'area'), ('g', 'peso')) u(code, kind);

select jsonb_build_object(
  'versao', 1, 'origem', 'es',
  'fornecedores', (select jsonb_agg(jsonb_build_object('cnpj', (10000000000000 + f)::text, 'nome', 'Fornecedor ' || f, 'regime', 'normal',
                     'lead_time_dias', f % 20, 'condicao_pagamento', jsonb_build_array(30, 60))) from generate_series(1, 50) f),
  'insumos', (select jsonb_agg(jsonb_build_object('sku', 'MP' || lpad(i::text, 4, '0'), 'nome', 'Insumo ' || i, 'unidade_compra', 'un',
                'unidade_consumo', (array['un', 'm', 'm2', 'g'])[1 + i % 4], 'fator_conversao', 1 + i % 7, 'minimo', i, 'custo_referencia', i / 10.0,
                'fornecedor_padrao_cnpj', (10000000000000 + 1 + i % 50)::text, 'ncm', '7009.91.00')) from generate_series(1, 400) i),
  'produtos', (select jsonb_agg(jsonb_build_object('sku', 'ED' || lpad(p::text, 6, '0'), 'nome', 'Produto ' || p || ' - Preto', 'familia', 'Família ' || p % 5,
                 'atributos', jsonb_build_object('cor', 'Preto', 'tamanho', (p % 90) || 'cm'), 'status', 'ativo', 'peso_kg', 1.5,
                 'apelidos', jsonb_build_array('TM' || lpad(p::text, 6, '0')))) from generate_series(1, 400) p),
  'vinculos', (select jsonb_agg(jsonb_build_object('fornecedor_cnpj', (10000000000000 + 1 + i % 50)::text, 'insumo_sku', 'MP' || lpad(i::text, 4, '0'),
                 'codigo_fornecedor', 'COD-' || i, 'fator', 1 + i % 7, 'preco', i, 'aliq_icms', 0.12, 'inteiro', true)) from generate_series(1, 400) i),
  'fichas', (select jsonb_agg(jsonb_build_object('produto_sku', 'ED' || lpad(p::text, 6, '0'), 'linhas',
               (select jsonb_agg(l order by o) from (
                  select k as o, jsonb_build_object('tipo', 'insumo', 'insumo_sku', 'MP' || lpad((1 + (p * 7 + k) % 400)::text, 4, '0'), 'consumo', 0.1 + k,
                           'unidade', (array['un', 'm', 'm2', 'g'])[1 + (1 + (p * 7 + k) % 400) % 4], 'perda_pct', 0,
                           'calc', jsonb_build_object('tipo', 'unidade', 'partes', jsonb_build_array(jsonb_build_object('qtd', 1, 'un', 0.1 + k)))) as l
                    from generate_series(0, 6) k
                  union all
                  select 7, jsonb_build_object('tipo', 'produto', 'componente_sku', 'ED' || lpad((1 + (p - 1) / 8)::text, 6, '0'), 'consumo', 2, 'unidade', 'un', 'perda_pct', 0)
                   where p > 8) x)))
             from generate_series(1, 400) p)
) as carga \gset
select set_config('test.tenant_d', :'tenant_d', false), set_config('test.carga', :'carga', false);

select auth.test_login('00000000-0000-0000-0000-00000000150a');
do $$
declare
  t uuid := current_setting('test.tenant_d')::uuid;
  p jsonb := current_setting('test.carga')::jsonb;
  inicio timestamptz;
  r jsonb;
  primeira interval;
  segunda interval;
begin
  inicio := clock_timestamp();
  r := public.import_catalog(t, p, false);
  primeira := clock_timestamp() - inicio;
  if r -> 'contagens' -> 'ficha' <> '{"novos": 400, "atualizados": 0, "iguais": 0, "problemas": 0}'
     or r -> 'contagens' -> 'insumo' ->> 'novos' <> '400' or r -> 'contagens' -> 'produto' ->> 'novos' <> '400'
     or r -> 'contagens' -> 'apelido' ->> 'novos' <> '400' or r -> 'contagens' -> 'vinculo' ->> 'novos' <> '400' then
    raise exception 'carga: contagens inesperadas %', r -> 'contagens';
  end if;
  if primeira > interval '6 seconds' then raise exception 'carga: primeira importação levou % (limite 6 s; o Supabase corta em 8 s)', primeira; end if;

  inicio := clock_timestamp();
  r := public.import_catalog(t, p, false);
  segunda := clock_timestamp() - inicio;
  if r -> 'contagens' -> 'ficha' <> '{"novos": 0, "atualizados": 0, "iguais": 400, "problemas": 0}' or r -> 'linhas' <> '[]' then
    raise exception 'carga: reimportação deveria ser toda igual %', r -> 'contagens';
  end if;
  if segunda > interval '6 seconds' then raise exception 'carga: reimportação levou %', segunda; end if;
  raise warning 'carga de importação: primeira % · reimportação %', date_trunc('milliseconds', primeira), date_trunc('milliseconds', segunda);
end $$;
select auth.test_logout();
do $$ begin
  if (select count(*) from public.bom_lines where tenant_id = current_setting('test.tenant_d')::uuid) <> 400 * 8 - 8 then
    raise exception 'carga: linhas de ficha gravadas';
  end if;
  if (select count(*) from public.bom_versions where tenant_id = current_setting('test.tenant_d')::uuid) <> 400 then raise exception 'carga: versões'; end if;
end $$;

rollback;
