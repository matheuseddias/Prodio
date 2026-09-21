-- 0003 · Cadastros: produtos, aliases, insumos, fornecedores, De-Para, fichas técnicas (BOM), perfis de etiqueta.
-- Contrato em docs/schema.md (seção 0003). Regras em docs/arquitetura.md, seção 2.
-- Toda referência entre tabelas do tenant é FK composta (tenant_id, x_id) → (tenant_id, id): a policy garante o
-- tenant_id da linha, e a FK composta garante que o alvo é do mesmo tenant (uma FK simples aceitaria id alheio).

-- ---------------------------------------------------------------------------
-- Helper genérico de updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null,
  nome text not null,
  familia text,
  atributos jsonb not null default '{}'::jsonb,
  ean text,
  ncm text,
  status text not null default 'ativo' check (status in ('ativo', 'inativo')),
  peso_kg numeric(14,4),
  peso_cubado_kg numeric(14,4),
  custo_manual numeric(14,4),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, id)
);

create table if not exists public.sku_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  sku_externo text not null,
  canal text,
  created_at timestamptz not null default now(),
  unique (tenant_id, sku_externo),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete cascade
);
create index if not exists sku_aliases_product_idx on public.sku_aliases(tenant_id, product_id);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  cnpj text not null check (cnpj ~ '^\d{11,14}$'),
  regime text not null default 'normal' check (regime in ('simples', 'normal')),
  lead_time_dias int not null default 0 check (lead_time_dias >= 0),
  condicao_pagamento int[] not null default '{0}',
  contato text,
  email_xml text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, cnpj),
  unique (tenant_id, id)
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sku text not null,
  nome text not null,
  ncm text,
  unidade_compra text not null,
  unidade_consumo text not null,
  fator_conversao numeric(14,6) not null default 1 check (fator_conversao > 0),
  minimo numeric(14,4) not null default 0,
  custo_referencia numeric(14,4),
  fornecedor_padrao_id uuid,
  lead_time_dias int not null default 0 check (lead_time_dias >= 0),
  controla_lote boolean not null default false,
  tamanhos_padrao jsonb not null default '[]'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, id),
  foreign key (tenant_id, unidade_compra) references public.units(tenant_id, code),
  foreign key (tenant_id, unidade_consumo) references public.units(tenant_id, code),
  foreign key (tenant_id, fornecedor_padrao_id) references public.suppliers(tenant_id, id) on delete set null (fornecedor_padrao_id)
);

-- De-Para da NF-e: código do produto no fornecedor → insumo.
create table if not exists public.supplier_materials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null,
  material_id uuid not null,
  codigo_fornecedor text,
  unidade_compra text,
  fator numeric(14,6) check (fator is null or fator > 0),
  preco numeric(14,4),
  aliq_icms numeric(8,5),
  inteiro boolean not null default false,
  ultimo_uso timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, supplier_id, material_id),
  unique (tenant_id, supplier_id, codigo_fornecedor),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id) on delete cascade,
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id) on delete cascade
);

create table if not exists public.bom_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  versao int not null check (versao > 0),
  ativa boolean not null default false,
  criado_por uuid,
  observacao text,
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id, versao),
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete cascade
);
create unique index if not exists bom_versions_ativa_uidx on public.bom_versions(tenant_id, product_id) where ativa;

create table if not exists public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bom_version_id uuid not null,
  ordem int not null default 0,
  tipo text not null check (tipo in ('insumo', 'produto')),
  material_id uuid,
  component_product_id uuid,
  consumo numeric(14,6) not null check (consumo > 0),
  unidade text,
  perda_pct numeric(8,5) not null default 0 check (perda_pct >= 0),
  calc jsonb,
  check ((tipo = 'insumo' and material_id is not null) or (tipo = 'produto' and component_product_id is not null)),
  foreign key (tenant_id, bom_version_id) references public.bom_versions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id),
  foreign key (tenant_id, component_product_id) references public.products(tenant_id, id)
);
create index if not exists bom_lines_version_idx on public.bom_lines(tenant_id, bom_version_id);

create table if not exists public.label_profiles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  familia text not null,
  prefixo text not null check (prefixo ~ '^[A-Z]{2,3}$'),
  tipos text[] not null default '{produto}' check ('produto' = any (tipos) and tipos <@ array['produto', 'montagem', 'caixa']),
  unidades_por_caixa int not null default 1 check (unidades_por_caixa > 0),
  instrucao_montagem text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, familia)
);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at e auditoria nas tabelas de cadastro
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['products', 'suppliers', 'materials', 'supplier_materials', 'label_profiles'] loop
    execute format('drop trigger if exists %1$s_updated_at on public.%1$I', t);
    execute format('create trigger %1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['products', 'sku_aliases', 'suppliers', 'materials', 'supplier_materials', 'bom_versions', 'label_profiles'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS e grants. Leitura para todo papel do tenant; escrita direta para admin/compras/producao
-- nas tabelas de cadastro. bom_versions e bom_lines só mudam pela RPC activate_bom.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['products', 'sku_aliases', 'suppliers', 'materials', 'supplier_materials', 'bom_versions', 'bom_lines', 'label_profiles'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
  end loop;
  foreach t in array array['products', 'sku_aliases', 'suppliers', 'materials', 'supplier_materials', 'label_profiles'] loop
    execute format('drop policy if exists %1$s_write on public.%1$I', t);
    execute format($p$create policy %1$s_write on public.%1$I for all to authenticated
      using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'compras', 'producao'))
      with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'compras', 'producao'))$p$, t);
  end loop;
end $$;

revoke all on table public.products, public.sku_aliases, public.suppliers, public.materials, public.supplier_materials,
  public.bom_versions, public.bom_lines, public.label_profiles from public, anon, authenticated;
grant select on public.products, public.sku_aliases, public.suppliers, public.materials, public.supplier_materials,
  public.bom_versions, public.bom_lines, public.label_profiles to authenticated;
-- Cadastros com deleted_at: sem DELETE pelo cliente (soft delete). Relacionais sem deleted_at podem ser apagados.
grant insert, update on public.products, public.suppliers, public.materials to authenticated;
grant insert, update, delete on public.sku_aliases, public.supplier_materials, public.label_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- RPC activate_bom: nova versão (max+1), valida unidade e ciclo multinível, desativa a anterior.
-- p_linhas: [{tipo, material_id, component_product_id, consumo, unidade, perda_pct, calc, ordem}]
-- ---------------------------------------------------------------------------
create or replace function public.activate_bom(p_tenant_id uuid, p_product_id uuid, p_linhas jsonb)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_versao int;
  v_linha jsonb;
  v_tipo text;
  v_material uuid;
  v_component uuid;
  v_unidade text;
  v_unidade_consumo text;
  v_ordem int := 0;
  v_ciclo boolean;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao', 'compras']::public.member_role[]);
  if not exists (select 1 from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id) then
    raise exception 'produto não encontrado' using errcode = '22023';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'ficha precisa de ao menos uma linha' using errcode = '22023';
  end if;

  -- Validação linha a linha antes de gravar.
  for v_linha in select * from jsonb_array_elements(p_linhas) loop
    v_tipo := v_linha ->> 'tipo';
    v_unidade := nullif(v_linha ->> 'unidade', '');
    if coalesce((v_linha ->> 'consumo')::numeric, 0) <= 0 then
      raise exception 'consumo deve ser maior que zero' using errcode = '22023';
    end if;
    if v_tipo = 'insumo' then
      v_material := (v_linha ->> 'material_id')::uuid;
      select m.unidade_consumo into v_unidade_consumo
        from public.materials m where m.id = v_material and m.tenant_id = p_tenant_id and m.deleted_at is null;
      if v_unidade_consumo is null then
        raise exception 'insumo % não encontrado neste tenant', v_material using errcode = '22023';
      end if;
      if v_unidade is not null and v_unidade <> v_unidade_consumo then
        raise exception 'unidade % da linha difere da unidade de consumo % do insumo', v_unidade, v_unidade_consumo using errcode = '22023';
      end if;
    elsif v_tipo = 'produto' then
      v_component := (v_linha ->> 'component_product_id')::uuid;
      if v_component = p_product_id then
        raise exception 'componente não pode ser o próprio produto' using errcode = '22023';
      end if;
      if not exists (select 1 from public.products p where p.id = v_component and p.tenant_id = p_tenant_id and p.deleted_at is null) then
        raise exception 'componente % não encontrado neste tenant', v_component using errcode = '22023';
      end if;
      -- Ciclo multinível: o produto não pode aparecer na árvore ativa do componente.
      with recursive arvore as (
        select l.component_product_id, array[v_component] as path, 1 as depth
          from public.bom_versions v join public.bom_lines l on l.bom_version_id = v.id
         where v.tenant_id = p_tenant_id and v.product_id = v_component and v.ativa and l.tipo = 'produto'
        union all
        select l.component_product_id, a.path || a.component_product_id, a.depth + 1
          from arvore a
          join public.bom_versions v on v.tenant_id = p_tenant_id and v.product_id = a.component_product_id and v.ativa
          join public.bom_lines l on l.bom_version_id = v.id and l.tipo = 'produto'
         where not (a.component_product_id = any (a.path)) and a.depth < 20
      )
      select exists (select 1 from arvore where component_product_id = p_product_id) into v_ciclo;
      if v_ciclo then
        raise exception 'ciclo na ficha: o produto aparece na árvore do componente %', v_component using errcode = '22023';
      end if;
    else
      raise exception 'tipo de linha inválido: %', v_tipo using errcode = '22023';
    end if;
  end loop;

  select coalesce(max(v.versao), 0) + 1 into v_versao
    from public.bom_versions v where v.tenant_id = p_tenant_id and v.product_id = p_product_id;
  update public.bom_versions set ativa = false where tenant_id = p_tenant_id and product_id = p_product_id and ativa;
  insert into public.bom_versions (tenant_id, product_id, versao, ativa, criado_por)
    values (p_tenant_id, p_product_id, v_versao, true, auth.uid()) returning id into v_version_id;

  for v_linha in select * from jsonb_array_elements(p_linhas) loop
    v_ordem := v_ordem + 1;
    v_tipo := v_linha ->> 'tipo';
    v_material := case when v_tipo = 'insumo' then (v_linha ->> 'material_id')::uuid end;
    v_component := case when v_tipo = 'produto' then (v_linha ->> 'component_product_id')::uuid end;
    select m.unidade_consumo into v_unidade_consumo from public.materials m where m.id = v_material;
    insert into public.bom_lines (tenant_id, bom_version_id, ordem, tipo, material_id, component_product_id, consumo, unidade, perda_pct, calc)
    values (p_tenant_id, v_version_id, coalesce((v_linha ->> 'ordem')::int, v_ordem), v_tipo, v_material, v_component,
            (v_linha ->> 'consumo')::numeric,
            coalesce(nullif(v_linha ->> 'unidade', ''), v_unidade_consumo, 'un'),
            coalesce((v_linha ->> 'perda_pct')::numeric, 0),
            v_linha -> 'calc');
  end loop;
  return v_version_id;
end $$;
revoke execute on function public.activate_bom(uuid, uuid, jsonb) from public, anon;
grant execute on function public.activate_bom(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- View: ficha ativa com linhas (herda RLS das tabelas).
-- ---------------------------------------------------------------------------
create or replace view public.v_bom_active with (security_invoker = on) as
select v.tenant_id, v.product_id, p.sku as product_sku, v.id as bom_version_id, v.versao, v.created_at as ativada_em,
       l.id as line_id, l.ordem, l.tipo, l.material_id, m.sku as material_sku, m.nome as material_nome,
       l.component_product_id, cp.sku as component_sku, cp.nome as component_nome,
       l.consumo, l.unidade, l.perda_pct, l.calc
  from public.bom_versions v
  join public.products p on p.id = v.product_id
  join public.bom_lines l on l.bom_version_id = v.id
  left join public.materials m on m.id = l.material_id
  left join public.products cp on cp.id = l.component_product_id
 where v.ativa;
revoke all on table public.v_bom_active from public, anon, authenticated;
grant select on public.v_bom_active to authenticated;
