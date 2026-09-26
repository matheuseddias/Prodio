-- Trava do limpar_exemplo.sql (supabase/limpar_exemplo.sql, copiado para dist/ pelo build.sh): o script apaga TUDO do tenant eddias, então
-- só roda sozinho quando o que existe é o exemplo do seed. Com sinal de uso real ele para sem apagar nada;
-- `set prodio.limpar_mesmo_assim = 'sim'` passa por cima. O arquivo é executado como está.
\set limpar `cat limpar_exemplo.sql`
\o /dev/null
begin;
select set_config('test.limpar', :'limpar', false);

create function pg_temp.conta(t text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where tenant_id = %L', t, '11111111-1111-1111-1111-111111111111') into n;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Só o exemplo do seed: a trava deixa passar; some o exemplo, ficam empresa, usuários, locais, unidades,
--    perfis de etiqueta, operadores e aparelhos.
-- ---------------------------------------------------------------------------
savepoint so_seed;
do $$ begin execute current_setting('test.limpar'); end $$;
do $$ begin
  if pg_temp.conta('products') + pg_temp.conta('materials') + pg_temp.conta('suppliers') + pg_temp.conta('orders') + pg_temp.conta('stock_moves')
     + pg_temp.conta('purchase_orders') + pg_temp.conta('nfe_inbound') + pg_temp.conta('connectors') > 0 then
    raise exception 'limpar_exemplo deveria apagar o exemplo';
  end if;
  if not exists (select 1 from public.tenants where slug = 'eddias') or pg_temp.conta('memberships') <> 2 or pg_temp.conta('units') <> 8
     or pg_temp.conta('locations') <> 2 or pg_temp.conta('label_profiles') <> 4 or pg_temp.conta('operators') <> 3 or pg_temp.conta('devices') <> 1 then
    raise exception 'limpar_exemplo apagou o que deveria manter';
  end if;
end $$;
rollback to savepoint so_seed;

-- ---------------------------------------------------------------------------
-- 2. Sinais de uso real: cada um sozinho para o script, que não apaga nada e diz o que achou.
-- ---------------------------------------------------------------------------
do $$
declare
  sinal record;
begin
  for sinal in select * from (values
    ('pedidos importados', 'insert into public.orders (tenant_id, connector_id, external_id, significado) values (''11111111-1111-1111-1111-111111111111'', ''0d000000-0000-0000-0000-000000000001'', ''bl:998877'', ''demanda'')'),
    ('conectores ligados', 'update public.connectors set status = ''conectado'' where id = ''0d000000-0000-0000-0000-000000000002'''),
    ('movimentos de estoque', 'insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, idempotency_key) values (''11111111-1111-1111-1111-111111111111'', ''b0000000-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'', ''ajuste'', -1, ''manual:contagem-real'')'),
    ('ordens de compra', 'insert into public.purchase_orders (tenant_id, numero, supplier_id, location_id) values (''11111111-1111-1111-1111-111111111111'', 5001, ''c0000000-0000-0000-0000-000000000001'', ''aaaaaaaa-0000-0000-0000-000000000001'')'),
    -- cadastro real (feito à mão ou vindo da importação do ES): rodar o script depois de importar apagava o catálogo inteiro
    ('produtos fora do exemplo', 'insert into public.products (tenant_id, sku, nome) values (''11111111-1111-1111-1111-111111111111'', ''ED900999'', ''Produto real'')'),
    ('insumos fora do exemplo', 'insert into public.materials (tenant_id, sku, nome, unidade_compra, unidade_consumo) values (''11111111-1111-1111-1111-111111111111'', ''MP9999'', ''Insumo real'', ''un'', ''un'')'),
    ('fornecedores fora do exemplo', 'insert into public.suppliers (tenant_id, nome, cnpj) values (''11111111-1111-1111-1111-111111111111'', ''Fornecedor real'', ''11222333000181'')')
  ) s(nome, comando) loop
    begin
      execute sinal.comando;
      begin
        execute current_setting('test.limpar');
        raise exception 'a trava não parou o script com %', sinal.nome;
      exception when raise_exception then
        if sqlerrm not like '%uso real%' || sinal.nome || '%' then raise exception 'mensagem da trava (%): %', sinal.nome, sqlerrm; end if;
      end;
      if pg_temp.conta('products') < 11 or pg_temp.conta('materials') < 13 or pg_temp.conta('suppliers') < 5 then raise exception 'a trava deixou apagar (%)', sinal.nome; end if;
      raise exception using errcode = 'PRD02'; -- desfaz o sinal antes do próximo
    exception when sqlstate 'PRD02' then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. `set prodio.limpar_mesmo_assim = 'sim'` passa por cima da trava.
-- ---------------------------------------------------------------------------
insert into public.orders (tenant_id, connector_id, external_id, significado)
values ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'bl:998877', 'demanda');
set local prodio.limpar_mesmo_assim = 'sim';
do $$ begin execute current_setting('test.limpar'); end $$;
do $$ begin
  if pg_temp.conta('products') + pg_temp.conta('orders') > 0 then raise exception 'com a confirmação, o script deveria apagar'; end if;
end $$;

rollback;
