-- Importação do ES: conflitos previstos viram linha-problema e a importação segue (a simulação mostra o
-- mesmo que a gravação faria): fornecedor e insumo excluídos, apelido de outro produto, SKU que é apelido,
-- unidade de consumo trocada, código do fornecedor em colisão, ciclo com ficha que já existe no Prodio.
-- E a trava dos dados de exemplo: no tenant do seed a simulação avisa e a gravação dá 55000, apontando o script de
-- limpeza certo (limpar_so_exemplo.sql quando já há conector ligado ou pedido real).
\set payload `cat ../packages/core/src/fixtures/payload-es-sintetico.json`
\o /dev/null
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000140a', 'fabio14@c.com');
select auth.test_login('00000000-0000-0000-0000-00000000140a');
select public.create_tenant('Fábrica C', 'fabrica-c14', '33.333.333/0001-33') as tenant_c \gset
select auth.test_logout();
insert into public.units (tenant_id, code, nome, kind)
select :'tenant_c', u.code, u.code, u.kind::public.unit_kind
  from (values ('un', 'unidade'), ('m', 'comprimento'), ('m2', 'area'), ('kg', 'peso'), ('g', 'peso'), ('cx', 'unidade'), ('rl', 'unidade'), ('ct', 'unidade')) u(code, kind);
select set_config('test.tenant_c', :'tenant_c', false), set_config('test.payload', :'payload', false);

-- Estado do Prodio antes da importação (como dono do banco):
insert into public.suppliers (id, tenant_id, nome, cnpj, deleted_at) values
  ('14000000-0000-0000-0000-000000000001', :'tenant_c', 'Plásticos (excluído)', '98765432000198', now()),
  ('14000000-0000-0000-0000-000000000002', :'tenant_c', 'Vidraçaria já cadastrada', '11222333000181', null);
insert into public.materials (id, tenant_id, sku, nome, unidade_compra, unidade_consumo, deleted_at) values
  ('14000000-0000-0000-0000-000000000011', :'tenant_c', 'MP9003', 'Disco (excluído)', 'un', 'un', now()),
  ('14000000-0000-0000-0000-000000000012', :'tenant_c', 'MP9006', 'Filamento em kg', 'un', 'kg', null),
  ('14000000-0000-0000-0000-000000000013', :'tenant_c', 'MPX1', 'Outro insumo da vidraçaria', 'un', 'un', null);
insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor) values
  (:'tenant_c', '14000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000013', 'CH3MM-321240');
insert into public.products (id, tenant_id, sku, nome) values
  ('14000000-0000-0000-0000-000000000021', :'tenant_c', 'OUTRO1', 'Produto que já tem o TM900002'),
  ('14000000-0000-0000-0000-000000000022', :'tenant_c', 'OUTRO2', 'Produto que tem o ED900003 como apelido');
insert into public.sku_aliases (tenant_id, product_id, sku_externo) values
  (:'tenant_c', '14000000-0000-0000-0000-000000000021', 'TM900002'),
  (:'tenant_c', '14000000-0000-0000-0000-000000000022', 'ED900003');

create function pg_temp.linha(r jsonb, e text, k text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(l), '[]') from jsonb_array_elements(r -> 'linhas') l where l ->> 'entidade' = e and l ->> 'chave' = k
$$;
create function pg_temp.checar(r jsonb, e text, k text, situacao text, trecho text) returns void language plpgsql as $$
begin
  if not exists (select 1 from jsonb_array_elements(pg_temp.linha(r, e, k)) l where l ->> 'situacao' = situacao and coalesce(l ->> 'mensagem', '') like '%' || trecho || '%') then
    raise exception '% % deveria ser % com "%": %', e, k, situacao, trecho, pg_temp.linha(r, e, k);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Simulação e gravação dão o mesmo resultado; cada conflito é uma linha, o resto entra.
-- ---------------------------------------------------------------------------
select auth.test_login('00000000-0000-0000-0000-00000000140a');
select public.import_catalog(:'tenant_c', :'payload'::jsonb, true) as r_sim \gset
select public.import_catalog(:'tenant_c', :'payload'::jsonb, false) as r \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.r_sim', :'r_sim', false);
do $$
declare
  r jsonb := current_setting('test.r')::jsonb;
  t uuid := current_setting('test.tenant_c')::uuid;
begin
  if (r - 'simulacao') <> (current_setting('test.r_sim')::jsonb - 'simulacao') then raise exception 'a simulação deveria prever exatamente a gravação'; end if;
  -- linha excluída: não reativa
  perform pg_temp.checar(r, 'fornecedor', '98765432000198', 'problema', 'fornecedor excluído');
  perform pg_temp.checar(r, 'insumo', 'MP9003', 'problema', 'insumo excluído');
  if (select deleted_at from public.suppliers where id = '14000000-0000-0000-0000-000000000001') is null then raise exception 'fornecedor foi reativado'; end if;
  if (select deleted_at from public.materials where id = '14000000-0000-0000-0000-000000000011') is null then raise exception 'insumo foi reativado'; end if;
  -- insumos do fornecedor excluído entram sem fornecedor padrão (aviso); vínculos dele são problema
  perform pg_temp.checar(r, 'insumo', 'MP9004', 'aviso', 'fornecedor padrão 98765432000198 não está no Prodio');
  perform pg_temp.checar(r, 'vinculo', '98765432000198|MP9004', 'problema', 'fornecedor 98765432000198');
  -- unidade de consumo trocada: o insumo não muda e a ficha que o usa fica de fora
  perform pg_temp.checar(r, 'insumo', 'MP9006', 'problema', 'mudou de kg para g');
  if (select unidade_consumo from public.materials where id = '14000000-0000-0000-0000-000000000012') <> 'kg' then raise exception 'unidade trocada'; end if;
  perform pg_temp.checar(r, 'ficha', 'ED900002', 'problema', 'insumo MP9006');
  -- apelido de outro produto: não é movido
  perform pg_temp.checar(r, 'apelido', 'TM900002', 'problema', 'já é de OUTRO1');
  if (select product_id from public.sku_aliases where tenant_id = t and sku_externo = 'TM900002') <> '14000000-0000-0000-0000-000000000021' then raise exception 'apelido movido'; end if;
  if not exists (select 1 from public.products where tenant_id = t and sku = 'ED900001') then raise exception 'ED900001 deveria entrar'; end if;
  -- SKU principal que é apelido de outro produto: produto e fichas que dependem dele ficam de fora
  perform pg_temp.checar(r, 'produto', 'ED900003', 'problema', 'é apelido de OUTRO2');
  if exists (select 1 from public.products where tenant_id = t and sku = 'ED900003') then raise exception 'ED900003 não deveria ser criado'; end if;
  perform pg_temp.checar(r, 'ficha', 'ED900003', 'problema', 'ED900003');
  perform pg_temp.checar(r, 'ficha', 'ED900004', 'problema', 'componente ED900003');
  -- ficha com insumo excluído fica de fora inteira
  perform pg_temp.checar(r, 'ficha', 'ED900001', 'problema', 'insumo MP9003');
  if exists (select 1 from public.bom_versions v join public.products p on p.id = v.product_id where v.tenant_id = t and p.sku in ('ED900001', 'ED900002', 'ED900003', 'ED900004')) then
    raise exception 'ficha com problema entrou pela metade';
  end if;
  -- código do fornecedor já usado por outro insumo: vínculo gravado sem código, com aviso
  perform pg_temp.checar(r, 'vinculo', '11222333000181|MP9001', 'aviso', 'já é do insumo MPX1');
  perform pg_temp.checar(r, 'vinculo', '11222333000181|MP9001', 'novo', '');
  if (select codigo_fornecedor from public.supplier_materials sm join public.materials m on m.id = sm.material_id where sm.tenant_id = t and m.sku = 'MP9001') is not null then
    raise exception 'vínculo em colisão deveria ficar sem código';
  end if;
  -- o fornecedor que já existia é atualizado (nome do ES), e a ficha que não depende de nada disso entra
  perform pg_temp.checar(r, 'fornecedor', '11222333000181', 'atualizado', '');
  perform pg_temp.checar(r, 'ficha', 'TM900001', 'novo', '');
  if r -> 'contagens' -> 'ficha' <> '{"novos": 1, "atualizados": 0, "iguais": 0, "problemas": 4}' then raise exception 'contagens de ficha: %', r -> 'contagens' -> 'ficha'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ciclo com ficha que já existe no Prodio: a ficha nova que fecharia o ciclo vira problema.
--    (usa o tenant C depois de resolver os conflitos à mão)
-- ---------------------------------------------------------------------------
update public.sku_aliases set sku_externo = 'OUTRO2-ALT' where tenant_id = :'tenant_c' and sku_externo = 'ED900003';
update public.materials set unidade_consumo = 'g' where id = '14000000-0000-0000-0000-000000000012';
update public.materials set deleted_at = null where id = '14000000-0000-0000-0000-000000000011';
select auth.test_login('00000000-0000-0000-0000-00000000140a');
select public.import_catalog(:'tenant_c', :'payload'::jsonb, false) as r \gset
select auth.test_logout();
select (select id from public.products where tenant_id = :'tenant_c' and sku = 'ED900002') as pino,
       (select id from public.products where tenant_id = :'tenant_c' and sku = 'ED900004') as kit \gset
-- No Prodio, o pino (ED900002) passa a usar o kit (ED900004) como componente; o arquivo não traz a ficha do pino
-- e traz o kit usando o pino: fecharia ED900004 → ED900002 → ED900004.
select auth.test_login('00000000-0000-0000-0000-00000000140a');
select public.activate_bom(:'tenant_c', :'pino', jsonb_build_array(jsonb_build_object('tipo', 'produto', 'component_product_id', :'kit'::uuid, 'consumo', 1)));
select public.import_catalog(:'tenant_c', jsonb_set(jsonb_set(:'payload'::jsonb, '{fichas}',
         (select jsonb_agg(f) from jsonb_array_elements(:'payload'::jsonb -> 'fichas') f where f ->> 'produto_sku' <> 'ED900002')),
         '{fichas,2,linhas}', (:'payload'::jsonb #> '{fichas,3,linhas}') || '[{"tipo": "produto", "componente_sku": "ED900002", "consumo": 1, "unidade": "un", "perda_pct": 0}]'),
       false) as r2 \gset
select auth.test_logout();
select set_config('test.r', :'r', false), set_config('test.r2', :'r2', false);
do $$
declare r jsonb := current_setting('test.r')::jsonb; r2 jsonb := current_setting('test.r2')::jsonb;
begin
  if r -> 'contagens' -> 'ficha' ->> 'problemas' <> '0' then raise exception 'depois de resolver, as fichas deveriam entrar: %', r -> 'linhas'; end if;
  perform pg_temp.checar(r2, 'ficha', 'ED900004', 'problema', 'ciclo');
  if r2 -> 'contagens' -> 'ficha' ->> 'problemas' <> '1' then raise exception 'só o kit deveria cair: %', r2 -> 'linhas'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Dados de exemplo (tenant do seed): simular mostra a contagem; gravar é recusado com 55000.
-- ---------------------------------------------------------------------------
select auth.test_login('22222222-2222-2222-2222-222222222222');
do $$
declare r jsonb;
begin
  r := public.import_catalog('11111111-1111-1111-1111-111111111111', current_setting('test.payload')::jsonb, true);
  if r -> 'exemplo' <> '{"produtos": 11, "insumos": 13, "fornecedores": 5}' then raise exception 'exemplo: %', r -> 'exemplo'; end if;
  if r -> 'uso_real' <> '{"conectores_ligados": 0, "pedidos_reais": 0}' then raise exception 'uso_real do seed: %', r -> 'uso_real'; end if;
  -- Sem uso real, o caminho é o limpar_exemplo.sql.
  begin
    perform public.import_catalog('11111111-1111-1111-1111-111111111111', current_setting('test.payload')::jsonb, false);
    raise exception 'gravar com dados de exemplo deveria falhar';
  exception when object_not_in_prerequisite_state then
    if sqlerrm not like '%limpar_exemplo.sql%' or sqlerrm like '%limpar_so_exemplo%' then raise exception 'mensagem sem uso real: %', sqlerrm; end if;
  end;
  -- p_dry_run nulo (PostgREST manda null quando o cliente manda null) é simulação: não grava nem fura a trava.
  r := public.import_catalog('11111111-1111-1111-1111-111111111111', current_setting('test.payload')::jsonb, null);
  if (r ->> 'simulacao') is distinct from 'true' then raise exception 'p_dry_run nulo deveria simular: %', r ->> 'simulacao'; end if;
end $$;
select auth.test_logout();
-- Com conector ligado (uso real), limpar_exemplo.sql apagaria a integração: a recusa aponta o limpar_so_exemplo.sql.
update public.connectors set status = 'conectado' where id = '0d000000-0000-0000-0000-000000000001';
select auth.test_login('22222222-2222-2222-2222-222222222222');
do $$
declare r jsonb;
begin
  r := public.import_catalog('11111111-1111-1111-1111-111111111111', current_setting('test.payload')::jsonb, true);
  if r -> 'uso_real' ->> 'conectores_ligados' <> '1' then raise exception 'uso_real com conector ligado: %', r -> 'uso_real'; end if;
  begin
    perform public.import_catalog('11111111-1111-1111-1111-111111111111', current_setting('test.payload')::jsonb, false);
    raise exception 'gravar com dados de exemplo deveria falhar';
  exception when object_not_in_prerequisite_state then
    if sqlerrm not like '%limpar_so_exemplo.sql%' then raise exception 'mensagem com uso real: %', sqlerrm; end if;
  end;
end $$;
select auth.test_logout();
do $$ begin
  if exists (select 1 from public.products where tenant_id = '11111111-1111-1111-1111-111111111111' and sku like 'ED9000%') then raise exception 'exemplo: nada deveria ser gravado'; end if;
end $$;

rollback;
