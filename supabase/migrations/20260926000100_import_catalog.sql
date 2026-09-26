-- Importação do cadastro do Eddias Suprimentos (ES), parte 1: helpers e validação do payload.
-- Parte 2 (20260926000200): fornecedores, insumos, produtos e apelidos. Parte 3 (20260926000300): vínculos,
-- fichas e a RPC pública import_catalog. Três arquivos por causa do limite de 400 linhas.
-- O payload é montado no navegador pelo core (@prodio/core/importacaoEs); aqui ele é conferido de novo.
-- Regras: tudo casa por chave natural dentro do tenant (nenhum uuid vem do cliente); ausente = "não mexe";
-- nada é apagado, inativado, reativado ou movido; reimportar o mesmo payload não grava nada (UPDATE só
-- quando algum valor difere, comparado já no tipo da coluna). As funções daqui são internas: só a
-- import_catalog (SECURITY DEFINER, admin) as chama.

-- ---------------------------------------------------------------------------
-- Helpers de validação (internos). São SQL puro, IMMUTABLE e sem SET search_path de propósito: o SET impede
-- o inline e custa uma troca de GUC por chamada (a validação de 3.000 linhas de ficha levava ~1 s). Não abre
-- brecha: todo nome é qualificado, o EXECUTE é revogado de todo mundo e o único chamador é a import_catalog,
-- SECURITY DEFINER com search_path = '' (o inline e as chamadas herdam esse search_path).
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_txt(p_v jsonb, p_max int)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(p_v) = 'string' and length(p_v #>> '{}') between 1 and p_max, false)
$$;

create or replace function public.import_catalog_num(p_v jsonb, p_min numeric, p_max numeric, p_inteiro boolean default false)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(p_v) = 'number' then
    (p_v #>> '{}')::numeric >= p_min and (p_v #>> '{}')::numeric < p_max
    and (not p_inteiro or (p_v #>> '{}')::numeric = trunc((p_v #>> '{}')::numeric))
  else false end
$$;

create or replace function public.import_catalog_chaves(p_obj jsonb, p_permitidas text[], p_obrigatorias text[])
returns boolean language sql immutable as $$
  select case when jsonb_typeof(p_obj) = 'object' then (p_obj - p_permitidas) = '{}'::jsonb and p_obj ?& p_obrigatorias else false end
$$;

create or replace function public.import_catalog_sku(p_v jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(p_v) = 'string' and (p_v #>> '{}') ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$', false)
$$;

-- Opcional: ausente ou válido.
create or replace function public.import_catalog_opc(p_obj jsonb, p_chave text, p_ok boolean)
returns boolean language sql immutable as $$
  select not (p_obj ? p_chave) or coalesce(p_ok, false)
$$;

-- calc da linha de ficha: formato do BomCalc do core (tipo, partes, larguraRoloM, perda).
create or replace function public.import_catalog_calc(p_c jsonb)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(p_c) = 'object' and octet_length(p_c::text) <= 8000 then
    public.import_catalog_chaves(p_c, array['tipo', 'partes', 'larguraRoloM', 'perda'], array['tipo', 'partes'])
    and p_c ->> 'tipo' in ('area', 'rolo', 'comprimento', 'peso', 'unidade')
    and public.import_catalog_opc(p_c, 'larguraRoloM', public.import_catalog_num(p_c -> 'larguraRoloM', 0.000001, 1000))
    and public.import_catalog_opc(p_c, 'perda', case when jsonb_typeof(p_c -> 'perda') = 'object' then
          public.import_catalog_chaves(p_c -> 'perda', array['tipo', 'valor'], array['tipo', 'valor'])
          and p_c -> 'perda' ->> 'tipo' in ('pct', 'fixa') and public.import_catalog_num(p_c -> 'perda' -> 'valor', 0, 1000000) end)
    and case when jsonb_typeof(p_c -> 'partes') = 'array' and jsonb_array_length(p_c -> 'partes') <= 50 then
      not exists (select 1 from jsonb_array_elements(p_c -> 'partes') pt
        where not public.import_catalog_chaves(pt, array['nome', 'qtd', 'largCm', 'altCm', 'compCm', 'pesoG', 'un'], '{}')
           or not public.import_catalog_opc(pt, 'nome', public.import_catalog_txt(pt -> 'nome', 80))
           or exists (select 1 from jsonb_each(pt) c where c.key <> 'nome' and not public.import_catalog_num(c.value, 0, 1000000000)))
    else false end
  else false end
$$;

-- ---------------------------------------------------------------------------
-- Validação do payload inteiro: formato, chaves conhecidas, limites e unicidade. Erro = 22023.
-- ---------------------------------------------------------------------------
create or replace function public.import_catalog_validate(p_payload jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  v_secao text;
  v_erro text;
  v_forn jsonb := coalesce(p_payload -> 'fornecedores', '[]');
  v_ins jsonb := coalesce(p_payload -> 'insumos', '[]');
  v_prod jsonb := coalesce(p_payload -> 'produtos', '[]');
  v_vinc jsonb := coalesce(p_payload -> 'vinculos', '[]');
  v_fichas jsonb := coalesce(p_payload -> 'fichas', '[]');
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload inválido: precisa ser um objeto' using errcode = '22023';
  end if;
  if octet_length(p_payload::text) > 5 * 1024 * 1024 then
    raise exception 'payload inválido: acima de 5 MB' using errcode = '22023';
  end if;
  if not public.import_catalog_chaves(p_payload, array['versao', 'origem', 'fornecedores', 'insumos', 'produtos', 'vinculos', 'fichas'], array['versao', 'origem']) then
    raise exception 'payload inválido: chave desconhecida ou faltando no topo' using errcode = '22023';
  end if;
  if p_payload -> 'versao' <> '1'::jsonb or p_payload -> 'origem' <> '"es"'::jsonb then
    raise exception 'payload inválido: versão ou origem não suportada' using errcode = '22023';
  end if;
  foreach v_secao in array array['fornecedores', 'insumos', 'produtos', 'vinculos', 'fichas'] loop
    if p_payload ? v_secao and (jsonb_typeof(p_payload -> v_secao) <> 'array' or jsonb_array_length(p_payload -> v_secao) > 5000) then
      raise exception 'payload inválido: % precisa ser uma lista de até 5000 itens', v_secao using errcode = '22023';
    end if;
  end loop;

  select format('fornecedores[%s]', t.i - 1) into v_erro
    from jsonb_array_elements(v_forn) with ordinality t(e, i)
   where not coalesce(public.import_catalog_chaves(t.e, array['cnpj', 'nome', 'regime', 'lead_time_dias', 'condicao_pagamento', 'contato'], array['cnpj', 'nome'])
     and jsonb_typeof(t.e -> 'cnpj') = 'string' and (t.e ->> 'cnpj') ~ '^\d{11,14}$'
     and public.import_catalog_txt(t.e -> 'nome', 200)
     and public.import_catalog_opc(t.e, 'regime', t.e -> 'regime' in ('"simples"', '"normal"'))
     and public.import_catalog_opc(t.e, 'lead_time_dias', public.import_catalog_num(t.e -> 'lead_time_dias', 0, 3651, true))
     and public.import_catalog_opc(t.e, 'condicao_pagamento', case when jsonb_typeof(t.e -> 'condicao_pagamento') = 'array'
           and jsonb_array_length(t.e -> 'condicao_pagamento') between 1 and 24 then
           not exists (select 1 from jsonb_array_elements(t.e -> 'condicao_pagamento') d where not public.import_catalog_num(d, 0, 366, true)) end)
     and public.import_catalog_opc(t.e, 'contato', public.import_catalog_txt(t.e -> 'contato', 500)), false)
   order by t.i limit 1;
  if v_erro is null then
    select format('insumos[%s]', t.i - 1) into v_erro
      from jsonb_array_elements(v_ins) with ordinality t(e, i)
     where not coalesce(public.import_catalog_chaves(t.e, array['sku', 'nome', 'ncm', 'unidade_compra', 'unidade_consumo', 'fator_conversao', 'minimo',
             'custo_referencia', 'fornecedor_padrao_cnpj', 'lead_time_dias'], array['sku', 'nome', 'unidade_compra', 'unidade_consumo', 'fator_conversao'])
       and public.import_catalog_sku(t.e -> 'sku') and public.import_catalog_txt(t.e -> 'nome', 200)
       and public.import_catalog_opc(t.e, 'ncm', public.import_catalog_txt(t.e -> 'ncm', 20))
       and public.import_catalog_txt(t.e -> 'unidade_compra', 10) and public.import_catalog_txt(t.e -> 'unidade_consumo', 10)
       and public.import_catalog_num(t.e -> 'fator_conversao', 0.000001, 100000000)
       and public.import_catalog_opc(t.e, 'minimo', public.import_catalog_num(t.e -> 'minimo', 0, 10000000000))
       and public.import_catalog_opc(t.e, 'custo_referencia', public.import_catalog_num(t.e -> 'custo_referencia', 0, 10000000000))
       and public.import_catalog_opc(t.e, 'fornecedor_padrao_cnpj', jsonb_typeof(t.e -> 'fornecedor_padrao_cnpj') = 'string' and (t.e ->> 'fornecedor_padrao_cnpj') ~ '^\d{11,14}$')
       and public.import_catalog_opc(t.e, 'lead_time_dias', public.import_catalog_num(t.e -> 'lead_time_dias', 0, 3651, true)), false)
     order by t.i limit 1;
  end if;
  if v_erro is null then
    select format('produtos[%s]', t.i - 1) into v_erro
      from jsonb_array_elements(v_prod) with ordinality t(e, i)
     where not coalesce(public.import_catalog_chaves(t.e, array['sku', 'nome', 'familia', 'atributos', 'ean', 'ncm', 'status', 'peso_kg', 'peso_cubado_kg',
             'custo_manual', 'apelidos'], array['sku', 'nome', 'atributos', 'status', 'apelidos'])
       and public.import_catalog_sku(t.e -> 'sku') and public.import_catalog_txt(t.e -> 'nome', 200)
       and public.import_catalog_opc(t.e, 'familia', public.import_catalog_txt(t.e -> 'familia', 60))
       and case when jsonb_typeof(t.e -> 'atributos') = 'object' then
         (select count(*) <= 50 and coalesce(bool_and(length(a.key) between 1 and 60 and public.import_catalog_txt(a.value, 200)), true) from jsonb_each(t.e -> 'atributos') a) end
       and public.import_catalog_opc(t.e, 'ean', jsonb_typeof(t.e -> 'ean') = 'string' and (t.e ->> 'ean') ~ '^\d{8,14}$')
       and public.import_catalog_opc(t.e, 'ncm', public.import_catalog_txt(t.e -> 'ncm', 20))
       and t.e -> 'status' in ('"ativo"', '"inativo"')
       and public.import_catalog_opc(t.e, 'peso_kg', public.import_catalog_num(t.e -> 'peso_kg', 0, 10000000000))
       and public.import_catalog_opc(t.e, 'peso_cubado_kg', public.import_catalog_num(t.e -> 'peso_cubado_kg', 0, 10000000000))
       and public.import_catalog_opc(t.e, 'custo_manual', public.import_catalog_num(t.e -> 'custo_manual', 0, 10000000000))
       and case when jsonb_typeof(t.e -> 'apelidos') = 'array' and jsonb_array_length(t.e -> 'apelidos') <= 50 then
         not exists (select 1 from jsonb_array_elements(t.e -> 'apelidos') ap where not public.import_catalog_sku(ap)) end, false)
     order by t.i limit 1;
  end if;
  if v_erro is null then
    select format('vinculos[%s]', t.i - 1) into v_erro
      from jsonb_array_elements(v_vinc) with ordinality t(e, i)
     where not coalesce(public.import_catalog_chaves(t.e, array['fornecedor_cnpj', 'insumo_sku', 'codigo_fornecedor', 'unidade_compra', 'fator', 'preco',
             'aliq_icms', 'inteiro'], array['fornecedor_cnpj', 'insumo_sku'])
       and jsonb_typeof(t.e -> 'fornecedor_cnpj') = 'string' and (t.e ->> 'fornecedor_cnpj') ~ '^\d{11,14}$'
       and public.import_catalog_sku(t.e -> 'insumo_sku')
       and public.import_catalog_opc(t.e, 'codigo_fornecedor', public.import_catalog_txt(t.e -> 'codigo_fornecedor', 60))
       and public.import_catalog_opc(t.e, 'unidade_compra', public.import_catalog_txt(t.e -> 'unidade_compra', 20))
       and public.import_catalog_opc(t.e, 'fator', public.import_catalog_num(t.e -> 'fator', 0.000001, 100000000))
       and public.import_catalog_opc(t.e, 'preco', public.import_catalog_num(t.e -> 'preco', 0, 10000000000))
       and public.import_catalog_opc(t.e, 'aliq_icms', public.import_catalog_num(t.e -> 'aliq_icms', 0, 1.000001))
       and public.import_catalog_opc(t.e, 'inteiro', jsonb_typeof(t.e -> 'inteiro') = 'boolean'), false)
     order by t.i limit 1;
  end if;
  if v_erro is null then
    select format('fichas[%s]', t.i - 1) into v_erro
      from jsonb_array_elements(v_fichas) with ordinality t(e, i)
     where not coalesce(public.import_catalog_chaves(t.e, array['produto_sku', 'linhas'], array['produto_sku', 'linhas'])
       and public.import_catalog_sku(t.e -> 'produto_sku')
       and case when jsonb_typeof(t.e -> 'linhas') = 'array' and jsonb_array_length(t.e -> 'linhas') between 1 and 200 then
         not exists (select 1 from jsonb_array_elements(t.e -> 'linhas') l
           where not coalesce(public.import_catalog_chaves(l, array['tipo', 'insumo_sku', 'componente_sku', 'consumo', 'unidade', 'perda_pct', 'calc'],
                   array['tipo', 'consumo', 'unidade', 'perda_pct'])
             and case l ->> 'tipo'
                   when 'insumo' then public.import_catalog_sku(l -> 'insumo_sku') and not l ? 'componente_sku'
                   when 'produto' then public.import_catalog_sku(l -> 'componente_sku') and not l ? 'insumo_sku' end
             and public.import_catalog_num(l -> 'consumo', 0.000001, 100000000)
             and public.import_catalog_txt(l -> 'unidade', 10)
             and l -> 'perda_pct' = '0'::jsonb
             and public.import_catalog_opc(l, 'calc', public.import_catalog_calc(l -> 'calc')), false)) end, false)
     order by t.i limit 1;
  end if;
  if v_erro is not null then
    raise exception 'payload inválido: % fora do formato', v_erro using errcode = '22023';
  end if;

  -- Unicidade dentro do payload (o core garante; aqui é a última barreira para as contagens baterem).
  if (select count(*) <> count(distinct e ->> 'cnpj') from jsonb_array_elements(v_forn) e)
     or (select count(*) <> count(distinct e ->> 'sku') from jsonb_array_elements(v_ins) e)
     or (select count(*) <> count(distinct e ->> 'sku') from jsonb_array_elements(v_prod) e)
     or (select count(*) <> count(distinct s) from (select e ->> 'sku' s from jsonb_array_elements(v_prod) e
           union all select a from jsonb_array_elements(v_prod) e, jsonb_array_elements_text(e -> 'apelidos') a) x)
     or (select count(*) <> count(distinct (e ->> 'fornecedor_cnpj', e ->> 'insumo_sku')) from jsonb_array_elements(v_vinc) e)
     or (select count(e ->> 'codigo_fornecedor') <> count(distinct (e ->> 'fornecedor_cnpj', e ->> 'codigo_fornecedor')) filter (where e ? 'codigo_fornecedor')
           from jsonb_array_elements(v_vinc) e)
     or (select count(*) <> count(distinct e ->> 'produto_sku') from jsonb_array_elements(v_fichas) e) then
    raise exception 'payload inválido: chave repetida (CNPJ, SKU, apelido, vínculo, código do fornecedor ou ficha)' using errcode = '22023';
  end if;
end $$;

-- Linha da resposta.
create or replace function public.import_catalog_linha(p_entidade text, p_chave text, p_situacao text, p_mensagem text default null, p_campos text[] default null)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('entidade', p_entidade, 'chave', p_chave, 'situacao', p_situacao, 'mensagem', p_mensagem,
    'campos', case when cardinality(p_campos) > 0 then to_jsonb(p_campos) end))
$$;

create or replace function public.import_catalog_contagem(p_total int, p_novos int, p_atualizados int, p_problemas int)
returns jsonb language sql immutable as $$
  select jsonb_build_object('novos', p_novos, 'atualizados', p_atualizados, 'iguais', greatest(p_total - p_novos - p_atualizados - p_problemas, 0), 'problemas', p_problemas)
$$;

revoke execute on function public.import_catalog_txt(jsonb, int), public.import_catalog_num(jsonb, numeric, numeric, boolean),
  public.import_catalog_chaves(jsonb, text[], text[]), public.import_catalog_sku(jsonb), public.import_catalog_opc(jsonb, text, boolean),
  public.import_catalog_calc(jsonb), public.import_catalog_validate(jsonb), public.import_catalog_linha(text, text, text, text, text[]),
  public.import_catalog_contagem(int, int, int, int)
  from public, anon, authenticated;
