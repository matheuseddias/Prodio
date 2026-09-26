-- Importação do ES, parte 2: fornecedores, insumos, produtos e apelidos (funções internas da import_catalog).
-- Cada função recebe a seção já validada e devolve {contagens, linhas, bloqueados}. Padrão de escrita:
--   1. problemas previstos viram linha-problema (e a chave vai para "bloqueados": as seções seguintes a ignoram);
--   2. UPDATE só das linhas em que algum valor muda (IS DISTINCT FROM já no tipo da coluna). O FROM relê a
--      própria tabela (alias o) para ter o valor de antes e dizer quais campos mudaram;
--   3. INSERT das chaves que ainda não existem.
-- Ausente no payload = "não mexe" (coalesce com o valor atual). Campos derivados (família do produto, lead
-- time do insumo) só preenchem o que está vazio. Nada é apagado, reativado ou movido.

-- ---------------------------------------------------------------------------
-- Fornecedores: chave (tenant_id, cnpj). email_xml e deleted_at não mudam.
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_suppliers(p_tenant_id uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_prob jsonb; v_bloq text[]; v_up jsonb; v_ins jsonb;
  v_n_prob int; v_n_up int; v_n_ins int;
  v_total int := jsonb_array_length(p_itens);
begin
  select coalesce(jsonb_agg(public.import_catalog_linha('fornecedor', a.cnpj, 'problema',
           'CNPJ já existe no Prodio num fornecedor excluído; a importação não reativa (resolva à mão)') order by a.cnpj), '[]'),
         coalesce(array_agg(a.cnpj), '{}'), count(*)
    into v_prob, v_bloq, v_n_prob
    from jsonb_to_recordset(p_itens) a(cnpj text)
   where exists (select 1 from public.suppliers s where s.tenant_id = p_tenant_id and s.cnpj = a.cnpj and s.deleted_at is not null);

  with a as (
    select * from jsonb_to_recordset(p_itens) r(cnpj text, nome text, regime text, lead_time_dias int, condicao_pagamento int[], contato text)
     where not (r.cnpj = any (v_bloq))
  ), up as (
    update public.suppliers t set
      nome = a.nome, regime = coalesce(a.regime, t.regime), lead_time_dias = coalesce(a.lead_time_dias, t.lead_time_dias),
      condicao_pagamento = coalesce(a.condicao_pagamento, t.condicao_pagamento), contato = coalesce(a.contato, t.contato)
      from a, public.suppliers o
     where t.tenant_id = p_tenant_id and t.cnpj = a.cnpj and t.deleted_at is null and o.id = t.id
       and (t.nome, t.regime, t.lead_time_dias, t.condicao_pagamento, t.contato) is distinct from
           (a.nome, coalesce(a.regime, t.regime), coalesce(a.lead_time_dias, t.lead_time_dias), coalesce(a.condicao_pagamento, t.condicao_pagamento),
            coalesce(a.contato, t.contato))
    returning t.cnpj, array_remove(array[
      case when o.nome is distinct from t.nome then 'nome' end, case when o.regime is distinct from t.regime then 'regime' end,
      case when o.lead_time_dias is distinct from t.lead_time_dias then 'lead_time_dias' end,
      case when o.condicao_pagamento is distinct from t.condicao_pagamento then 'condicao_pagamento' end,
      case when o.contato is distinct from t.contato then 'contato' end], null) as campos
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('fornecedor', cnpj, 'atualizado', null, campos) order by cnpj), '[]'), count(*)
    into v_up, v_n_up from up;

  with a as (
    select * from jsonb_to_recordset(p_itens) r(cnpj text, nome text, regime text, lead_time_dias int, condicao_pagamento int[], contato text)
  ), ins as (
    insert into public.suppliers (tenant_id, cnpj, nome, regime, lead_time_dias, condicao_pagamento, contato)
    select p_tenant_id, a.cnpj, a.nome, coalesce(a.regime, 'normal'), coalesce(a.lead_time_dias, 0), coalesce(a.condicao_pagamento, '{0}'), a.contato
      from a where not exists (select 1 from public.suppliers s where s.tenant_id = p_tenant_id and s.cnpj = a.cnpj)
    on conflict (tenant_id, cnpj) do nothing
    returning cnpj
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('fornecedor', cnpj, 'novo') order by cnpj), '[]'), count(*) into v_ins, v_n_ins from ins;

  return jsonb_build_object('contagens', jsonb_build_object('fornecedor', public.import_catalog_contagem(v_total, v_n_ins, v_n_up, v_n_prob)),
    'linhas', v_prob || v_ins || v_up, 'bloqueados', to_jsonb(v_bloq));
end $$;

-- ---------------------------------------------------------------------------
-- Insumos: chave (tenant_id, sku). Unidade de consumo não muda (saldo e fichas do Prodio estão nela).
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_materials(p_tenant_id uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_prob jsonb; v_bloq text[]; v_up jsonb; v_ins jsonb; v_avisos jsonb;
  v_n_prob int; v_n_up int; v_n_ins int;
  v_total int := jsonb_array_length(p_itens);
begin
  with a as (select * from jsonb_to_recordset(p_itens) r(sku text, unidade_compra text, unidade_consumo text)),
  p as (
    select a.sku, case
      when m.deleted_at is not null then 'SKU já existe no Prodio num insumo excluído; a importação não reativa (resolva à mão)'
      when not exists (select 1 from public.units u where u.tenant_id = p_tenant_id and u.code = a.unidade_compra)
        then format('unidade %s não está cadastrada no Prodio (Configurações > Unidades)', a.unidade_compra)
      when not exists (select 1 from public.units u where u.tenant_id = p_tenant_id and u.code = a.unidade_consumo)
        then format('unidade %s não está cadastrada no Prodio (Configurações > Unidades)', a.unidade_consumo)
      when m.unidade_consumo <> a.unidade_consumo
        then format('a unidade de consumo mudou de %s para %s: o insumo não é atualizado e as fichas que o usam ficam de fora (saldo e fichas do Prodio estão em %s)',
                    m.unidade_consumo, a.unidade_consumo, m.unidade_consumo)
      end as msg
      from a left join public.materials m on m.tenant_id = p_tenant_id and m.sku = a.sku
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('insumo', sku, 'problema', msg) order by sku), '[]'), coalesce(array_agg(sku), '{}'), count(*)
    into v_prob, v_bloq, v_n_prob from p where msg is not null;

  -- Fornecedor padrão pelo CNPJ: fora do Prodio (ou excluído) vira aviso e não mexe no atual.
  select coalesce(jsonb_agg(public.import_catalog_linha('insumo', r.sku, 'aviso',
           format('fornecedor padrão %s não está no Prodio; o fornecedor padrão não foi alterado', r.fornecedor_padrao_cnpj)) order by r.sku), '[]')
    into v_avisos
    from jsonb_to_recordset(p_itens) r(sku text, fornecedor_padrao_cnpj text)
   where r.fornecedor_padrao_cnpj is not null and not (r.sku = any (v_bloq))
     and not exists (select 1 from public.suppliers s where s.tenant_id = p_tenant_id and s.cnpj = r.fornecedor_padrao_cnpj and s.deleted_at is null);

  with a as (
    select r.sku, r.nome, r.ncm, r.unidade_compra, r.unidade_consumo, r.fator_conversao::numeric(14,6) as fator_conversao,
           r.minimo::numeric(14,4) as minimo, r.custo_referencia::numeric(14,4) as custo_referencia, r.lead_time_dias,
           (select s.id from public.suppliers s where s.tenant_id = p_tenant_id and s.cnpj = r.fornecedor_padrao_cnpj and s.deleted_at is null) as forn_id
      from jsonb_to_recordset(p_itens) r(sku text, nome text, ncm text, unidade_compra text, unidade_consumo text, fator_conversao numeric, minimo numeric,
                                          custo_referencia numeric, fornecedor_padrao_cnpj text, lead_time_dias int)
     where not (r.sku = any (v_bloq))
  ), up as (
    update public.materials t set
      nome = a.nome, ncm = coalesce(a.ncm, t.ncm), unidade_compra = a.unidade_compra, fator_conversao = a.fator_conversao,
      minimo = coalesce(a.minimo, t.minimo), custo_referencia = coalesce(a.custo_referencia, t.custo_referencia),
      fornecedor_padrao_id = coalesce(a.forn_id, t.fornecedor_padrao_id),
      lead_time_dias = case when t.lead_time_dias = 0 then coalesce(a.lead_time_dias, 0) else t.lead_time_dias end
      from a, public.materials o
     where t.tenant_id = p_tenant_id and t.sku = a.sku and t.deleted_at is null and o.id = t.id
       and (t.nome, t.ncm, t.unidade_compra, t.fator_conversao, t.minimo, t.custo_referencia, t.fornecedor_padrao_id, t.lead_time_dias) is distinct from
           (a.nome, coalesce(a.ncm, t.ncm), a.unidade_compra, a.fator_conversao, coalesce(a.minimo, t.minimo), coalesce(a.custo_referencia, t.custo_referencia),
            coalesce(a.forn_id, t.fornecedor_padrao_id), case when t.lead_time_dias = 0 then coalesce(a.lead_time_dias, 0) else t.lead_time_dias end)
    returning t.sku, array_remove(array[
      case when o.nome is distinct from t.nome then 'nome' end, case when o.ncm is distinct from t.ncm then 'ncm' end,
      case when o.unidade_compra is distinct from t.unidade_compra then 'unidade_compra' end,
      case when o.fator_conversao is distinct from t.fator_conversao then 'fator_conversao' end,
      case when o.minimo is distinct from t.minimo then 'minimo' end,
      case when o.custo_referencia is distinct from t.custo_referencia then 'custo_referencia' end,
      case when o.fornecedor_padrao_id is distinct from t.fornecedor_padrao_id then 'fornecedor_padrao' end,
      case when o.lead_time_dias is distinct from t.lead_time_dias then 'lead_time_dias' end], null) as campos
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('insumo', sku, 'atualizado', null, campos) order by sku), '[]'), count(*) into v_up, v_n_up from up;

  with a as (
    select r.*, (select s.id from public.suppliers s where s.tenant_id = p_tenant_id and s.cnpj = r.fornecedor_padrao_cnpj and s.deleted_at is null) as forn_id
      from jsonb_to_recordset(p_itens) r(sku text, nome text, ncm text, unidade_compra text, unidade_consumo text, fator_conversao numeric, minimo numeric,
                                          custo_referencia numeric, fornecedor_padrao_cnpj text, lead_time_dias int)
     where not (r.sku = any (v_bloq))
  ), ins as (
    insert into public.materials (tenant_id, sku, nome, ncm, unidade_compra, unidade_consumo, fator_conversao, minimo, custo_referencia, fornecedor_padrao_id, lead_time_dias)
    select p_tenant_id, a.sku, a.nome, a.ncm, a.unidade_compra, a.unidade_consumo, a.fator_conversao, coalesce(a.minimo, 0), a.custo_referencia, a.forn_id,
           coalesce(a.lead_time_dias, 0)
      from a where not exists (select 1 from public.materials m where m.tenant_id = p_tenant_id and m.sku = a.sku)
    on conflict (tenant_id, sku) do nothing
    returning sku
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('insumo', sku, 'novo') order by sku), '[]'), count(*) into v_ins, v_n_ins from ins;

  return jsonb_build_object('contagens', jsonb_build_object('insumo', public.import_catalog_contagem(v_total, v_n_ins, v_n_up, v_n_prob)),
    'linhas', v_prob || v_ins || v_up || v_avisos, 'bloqueados', to_jsonb(v_bloq));
end $$;

-- ---------------------------------------------------------------------------
-- Produtos e apelidos: chave (tenant_id, sku principal) e (tenant_id, sku_externo). O apelido vence o SKU
-- nos pedidos e no hub, por isso nada que mexa na rota de um pedido é feito aqui: não se move apelido,
-- não se renomeia SKU e não se cria produto cujo SKU já é apelido de outro.
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_products(p_tenant_id uuid, p_itens jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_prob jsonb; v_bloq text[]; v_up jsonb; v_ins jsonb; v_ap jsonb;
  v_n_prob int; v_n_up int; v_n_ins int; v_ap_novos int; v_ap_prob int;
  v_total int := jsonb_array_length(p_itens);
  v_ap_total int;
begin
  with a as (select * from jsonb_to_recordset(p_itens) r(sku text, apelidos jsonb)),
  p as (
    select a.sku, case
      when exists (select 1 from public.products x where x.tenant_id = p_tenant_id and x.sku = a.sku and x.deleted_at is not null)
        then 'SKU já existe no Prodio num produto excluído; a importação não reativa (resolva à mão)'
      else (select format('o SKU %s é apelido de %s no Prodio (o apelido vence o SKU nos pedidos); resolva à mão', a.sku, pp.sku)
              from public.sku_aliases al join public.products pp on pp.id = al.product_id
             where al.tenant_id = p_tenant_id and al.sku_externo = a.sku and pp.sku <> a.sku limit 1)
      end as msg,
      (select format('%s já existe como produto no Prodio; a importação não renomeia SKU (resolva à mão)', string_agg(x.sku, ', ' order by x.sku))
         from jsonb_array_elements_text(a.apelidos) ap join public.products x on x.tenant_id = p_tenant_id and x.sku = ap
       having count(*) > 0) as msg_apelido
      from a
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('produto', sku, 'problema', coalesce(msg, msg_apelido)) order by sku), '[]'),
         coalesce(array_agg(sku), '{}'), count(*)
    into v_prob, v_bloq, v_n_prob from p where coalesce(msg, msg_apelido) is not null;

  with a as (
    select r.sku, r.nome, r.familia, r.atributos, r.ean, r.ncm, r.status, r.peso_kg::numeric(14,4) as peso_kg,
           r.peso_cubado_kg::numeric(14,4) as peso_cubado_kg, r.custo_manual::numeric(14,4) as custo_manual
      from jsonb_to_recordset(p_itens) r(sku text, nome text, familia text, atributos jsonb, ean text, ncm text, status text, peso_kg numeric,
                                          peso_cubado_kg numeric, custo_manual numeric)
     where not (r.sku = any (v_bloq))
  ), up as (
    update public.products t set
      nome = a.nome,
      familia = case when coalesce(t.familia, '') in ('', 'Sem família') then coalesce(a.familia, t.familia) else t.familia end,
      atributos = t.atributos || a.atributos, ean = coalesce(a.ean, t.ean), ncm = coalesce(a.ncm, t.ncm), status = a.status,
      peso_kg = coalesce(a.peso_kg, t.peso_kg), peso_cubado_kg = coalesce(a.peso_cubado_kg, t.peso_cubado_kg),
      custo_manual = coalesce(a.custo_manual, t.custo_manual)
      from a, public.products o
     where t.tenant_id = p_tenant_id and t.sku = a.sku and t.deleted_at is null and o.id = t.id
       and (t.nome, t.familia, t.atributos, t.ean, t.ncm, t.status, t.peso_kg, t.peso_cubado_kg, t.custo_manual) is distinct from
           (a.nome, case when coalesce(t.familia, '') in ('', 'Sem família') then coalesce(a.familia, t.familia) else t.familia end,
            t.atributos || a.atributos, coalesce(a.ean, t.ean), coalesce(a.ncm, t.ncm), a.status, coalesce(a.peso_kg, t.peso_kg),
            coalesce(a.peso_cubado_kg, t.peso_cubado_kg), coalesce(a.custo_manual, t.custo_manual))
    returning t.sku, array_remove(array[
      case when o.nome is distinct from t.nome then 'nome' end, case when o.familia is distinct from t.familia then 'familia' end,
      case when o.atributos is distinct from t.atributos then 'atributos' end, case when o.ean is distinct from t.ean then 'ean' end,
      case when o.ncm is distinct from t.ncm then 'ncm' end, case when o.status is distinct from t.status then 'status' end,
      case when o.peso_kg is distinct from t.peso_kg then 'peso_kg' end, case when o.peso_cubado_kg is distinct from t.peso_cubado_kg then 'peso_cubado_kg' end,
      case when o.custo_manual is distinct from t.custo_manual then 'custo_manual' end], null) as campos
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('produto', sku, 'atualizado', null, campos) order by sku), '[]'), count(*) into v_up, v_n_up from up;

  with a as (
    select * from jsonb_to_recordset(p_itens) r(sku text, nome text, familia text, atributos jsonb, ean text, ncm text, status text, peso_kg numeric,
                                                 peso_cubado_kg numeric, custo_manual numeric)
     where not (r.sku = any (v_bloq))
  ), ins as (
    insert into public.products (tenant_id, sku, nome, familia, atributos, ean, ncm, status, peso_kg, peso_cubado_kg, custo_manual)
    select p_tenant_id, a.sku, a.nome, coalesce(a.familia, 'Sem família'), a.atributos, a.ean, a.ncm, a.status, a.peso_kg, a.peso_cubado_kg, a.custo_manual
      from a where not exists (select 1 from public.products x where x.tenant_id = p_tenant_id and x.sku = a.sku)
    on conflict (tenant_id, sku) do nothing
    returning sku
  )
  select coalesce(jsonb_agg(public.import_catalog_linha('produto', sku, 'novo') order by sku), '[]'), count(*) into v_ins, v_n_ins from ins;

  -- Apelidos: só acrescenta. Já do mesmo produto = igual; de outro produto = problema (não move).
  with a as (
    select r.sku, ap from jsonb_to_recordset(p_itens) r(sku text, apelidos jsonb), jsonb_array_elements_text(r.apelidos) ap
  ), x as (
    select a.sku, a.ap, p.id as product_id, al.product_id as dono_atual, dono.sku as dono_sku,
           exists (select 1 from public.products y where y.tenant_id = p_tenant_id and y.sku = a.ap) as eh_sku
      from a
      left join public.products p on p.tenant_id = p_tenant_id and p.sku = a.sku and p.deleted_at is null and not (a.sku = any (v_bloq))
      left join public.sku_aliases al on al.tenant_id = p_tenant_id and al.sku_externo = a.ap
      left join public.products dono on dono.id = al.product_id
  ), ins as (
    insert into public.sku_aliases (tenant_id, product_id, sku_externo)
    select p_tenant_id, x.product_id, x.ap from x where x.product_id is not null and x.dono_atual is null and not x.eh_sku
    on conflict (tenant_id, sku_externo) do nothing
    returning sku_externo
  ), linhas as (
    select public.import_catalog_linha('apelido', ins.sku_externo, 'novo') as l, ins.sku_externo as k, 0 as prob from ins
    union all
    select public.import_catalog_linha('apelido', x.ap, 'problema', case
             when x.product_id is null then format('o produto %s ficou de fora; o apelido não entra', x.sku)
             when x.dono_atual is not null then format('o apelido %s já é de %s no Prodio; não é movido (move a rota dos pedidos)', x.ap, x.dono_sku)
             else format('%s já é SKU de um produto no Prodio', x.ap) end), x.ap, 1
      from x where x.product_id is null or (x.dono_atual is not null and x.dono_atual <> x.product_id) or (x.dono_atual is null and x.eh_sku)
  )
  select coalesce(jsonb_agg(l order by k), '[]'), count(*) filter (where prob = 0), count(*) filter (where prob = 1)
    into v_ap, v_ap_novos, v_ap_prob from linhas;
  select count(*) into v_ap_total from jsonb_to_recordset(p_itens) r(apelidos jsonb), jsonb_array_elements(r.apelidos);

  return jsonb_build_object(
    'contagens', jsonb_build_object('produto', public.import_catalog_contagem(v_total, v_n_ins, v_n_up, v_n_prob),
                                    'apelido', public.import_catalog_contagem(v_ap_total, v_ap_novos, 0, v_ap_prob)),
    'linhas', v_prob || v_ins || v_up || v_ap, 'bloqueados', to_jsonb(v_bloq));
end $$;

revoke execute on function public.import_catalog_suppliers(uuid, jsonb), public.import_catalog_materials(uuid, jsonb),
  public.import_catalog_products(uuid, jsonb) from public, anon, authenticated;
