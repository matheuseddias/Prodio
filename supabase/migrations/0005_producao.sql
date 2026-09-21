-- 0005 · Produção: etapas, plano do dia, etiquetas, bipes com backflush multinível (usa o ledger da 0004).
-- Contrato em docs/schema.md (seção 0005). Regras em docs/arquitetura.md, seção 2.

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo text not null,
  nome text not null,
  ordem int not null default 1,
  ativa boolean not null default true,
  unique (tenant_id, codigo),
  unique (tenant_id, id)
);

-- Etapa 'final' nasce com o tenant (e para os tenants já existentes).
create or replace function public.tenant_default_stage()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stages (tenant_id, codigo, nome, ordem) values (new.id, 'final', 'Final', 1)
  on conflict (tenant_id, codigo) do nothing;
  return new;
end $$;
revoke execute on function public.tenant_default_stage() from public, anon, authenticated;
drop trigger if exists tenants_default_stage on public.tenants;
create trigger tenants_default_stage after insert on public.tenants for each row execute function public.tenant_default_stage();
insert into public.stages (tenant_id, codigo, nome, ordem)
  select t.id, 'final', 'Final', 1 from public.tenants t
  where not exists (select 1 from public.stages s where s.tenant_id = t.id and s.codigo = 'final');

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dia date not null,
  location_id uuid not null,
  product_id uuid not null,
  demanda_dia numeric(14,4) not null default 0,
  projetado numeric(14,4) not null default 0,
  carteira numeric(14,4) not null default 0,
  saldo_hub numeric(14,4) not null default 0,
  atualizado_por uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, dia, location_id, product_id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id)
);

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  serial text not null,
  product_id uuid not null,
  tipo text not null default 'unidade' check (tipo in ('unidade', 'caixa')),
  quantidade numeric(14,4) not null default 1 check (quantidade > 0),
  status text not null default 'impressa' check (status in ('reservada', 'impressa', 'anulada')),
  dia date not null,
  seq int not null,
  location_id uuid,
  reimpressa_de uuid references public.labels(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, serial),
  unique (tenant_id, dia, product_id, seq),
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id)
);

create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label_id uuid not null,
  product_id uuid not null,
  stage_id uuid not null,
  event_type text not null check (event_type in ('produzido', 'estorno', 'refugo')),
  quantidade numeric(14,4) not null default 1,
  operator_id uuid,
  device_id uuid,
  user_id uuid,
  competencia date not null,
  scanned_at timestamptz not null default now(),
  client_event_id text,
  reverses_id uuid references public.scan_events(id),
  unique nulls not distinct (tenant_id, label_id, stage_id, event_type),
  foreign key (tenant_id, label_id) references public.labels(tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id),
  foreign key (tenant_id, stage_id) references public.stages(tenant_id, id),
  foreign key (tenant_id, operator_id) references public.operators(tenant_id, id),
  foreign key (tenant_id, device_id) references public.devices(tenant_id, id)
);
create unique index if not exists scan_events_client_uidx on public.scan_events(tenant_id, client_event_id) where client_event_id is not null;
create index if not exists scan_events_competencia_idx on public.scan_events(tenant_id, competencia, product_id);

drop trigger if exists daily_plans_updated_at on public.daily_plans;
create trigger daily_plans_updated_at before update on public.daily_plans for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS e grants: leitura por tenant para todos; escrita só por RPC (stages é cadastro simples).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stages', 'daily_plans', 'labels', 'scan_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Etapas são cadastro simples: admin/producao editam direto.
drop policy if exists stages_write on public.stages;
create policy stages_write on public.stages for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'producao'))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'producao'));
grant insert, update on public.stages to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (leitura; a web usa production_date para o dia do plano)
-- ---------------------------------------------------------------------------
-- Competência: data no fuso do tenant, deslocada pela hora_virada (02:00 com virada 05:00 conta para o dia anterior).
-- SECURITY INVOKER de propósito: a RLS de tenants filtra, e quem não é membro recebe null (sem oráculo de fuso
-- ou de existência do tenant). Dentro das RPCs (definer) roda como dono e continua enxergando o tenant.
create or replace function public.production_date(p_tenant_id uuid, p_at timestamptz default now())
returns date language sql stable set search_path = '' as $$
  select ((p_at at time zone t.fuso) - t.hora_virada)::date from public.tenants t where t.id = p_tenant_id
$$;
revoke execute on function public.production_date(uuid, timestamptz) from public, anon;
grant execute on function public.production_date(uuid, timestamptz) to authenticated;

-- Explosão multinível da ficha ativa até os insumos-raiz (consumo × (1 + perda), com proteção de ciclo).
create or replace function public.explode_bom(p_tenant_id uuid, p_product_id uuid, p_qtd numeric)
returns table (material_id uuid, qtd numeric) language sql stable set search_path = '' as $$
  with recursive x as (
    select l.tipo, l.material_id, l.component_product_id, (p_qtd * l.consumo * (1 + l.perda_pct))::numeric as qtd, array[p_product_id] as path, 1 as depth
      from public.bom_versions v join public.bom_lines l on l.bom_version_id = v.id
     where v.tenant_id = p_tenant_id and v.product_id = p_product_id and v.ativa
    union all
    select l.tipo, l.material_id, l.component_product_id, x.qtd * l.consumo * (1 + l.perda_pct), x.path || x.component_product_id, x.depth + 1
      from x
      join public.bom_versions v on v.tenant_id = p_tenant_id and v.product_id = x.component_product_id and v.ativa
      join public.bom_lines l on l.bom_version_id = v.id
     where x.tipo = 'produto' and not (x.component_product_id = any (x.path)) and x.depth < 20
  )
  select x.material_id, sum(x.qtd) from x where x.tipo = 'insumo' group by x.material_id
$$;
revoke execute on function public.explode_bom(uuid, uuid, numeric) from public, anon;
grant execute on function public.explode_bom(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- p_linhas: [{product_id, demanda_dia, projetado, carteira, saldo_hub}]
create or replace function public.set_daily_plan(p_tenant_id uuid, p_dia date, p_location_id uuid, p_linhas jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao']::public.member_role[]);
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then
    raise exception 'local não encontrado' using errcode = '22023';
  end if;
  insert into public.daily_plans (tenant_id, dia, location_id, product_id, demanda_dia, projetado, carteira, saldo_hub, atualizado_por)
  select p_tenant_id, p_dia, p_location_id, (x ->> 'product_id')::uuid,
         coalesce((x ->> 'demanda_dia')::numeric, 0), coalesce((x ->> 'projetado')::numeric, 0),
         coalesce((x ->> 'carteira')::numeric, 0), coalesce((x ->> 'saldo_hub')::numeric, 0), auth.uid()
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x
    join public.products p on p.id = (x ->> 'product_id')::uuid and p.tenant_id = p_tenant_id
  on conflict (tenant_id, dia, location_id, product_id) do update
    set demanda_dia = excluded.demanda_dia, projetado = excluded.projetado, carteira = excluded.carteira,
        saldo_hub = excluded.saldo_hub, atualizado_por = excluded.atualizado_por, updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.set_daily_plan(uuid, date, uuid, jsonb) from public, anon;
grant execute on function public.set_daily_plan(uuid, date, uuid, jsonb) to authenticated;

-- Serial = prefixo do perfil + sku (em maiúsculas, como o bipe compara) + AAMMDD + seq(4). Sequência por (tenant, dia, produto).
drop function if exists public.reserve_label_batch(uuid, uuid, int, text, uuid);
create or replace function public.reserve_label_batch(p_tenant_id uuid, p_product_id uuid, p_quantidade int, p_tipo text default 'unidade', p_location_id uuid default null)
returns table (label_id uuid, serial text, dia date, seq int)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  p public.products%rowtype;
  v_prefixo text;
  v_por_caixa int;
  v_dia date;
  v_seq int;
  v_loc uuid;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao']::public.member_role[]);
  if p_quantidade is null or p_quantidade < 1 or p_quantidade > 5000 then raise exception 'quantidade entre 1 e 5000' using errcode = '22023'; end if;
  if p_tipo not in ('unidade', 'caixa') then raise exception 'tipo inválido' using errcode = '22023'; end if;
  if p_location_id is not null and not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then
    raise exception 'local não encontrado' using errcode = '22023';
  end if;
  v_dia := public.production_date(p_tenant_id, now());
  v_loc := coalesce(p_location_id, public.default_location(p_tenant_id));
  select * into p from public.products pr where pr.id = p_product_id and pr.tenant_id = p_tenant_id and pr.deleted_at is null;
  if p.id is null then raise exception 'produto não encontrado' using errcode = '22023'; end if;
  if (select t.exigir_projecao_para_imprimir from public.tenants t where t.id = p_tenant_id)
     and not exists (select 1 from public.daily_plans d where d.tenant_id = p_tenant_id and d.dia = v_dia and d.product_id = p_product_id and d.projetado > 0) then
    raise exception 'Sem projeção do dia' using errcode = 'P0001';
  end if;
  select lp.prefixo, lp.unidades_por_caixa into v_prefixo, v_por_caixa
    from public.label_profiles lp where lp.tenant_id = p_tenant_id and lp.familia = p.familia;
  v_prefixo := coalesce(v_prefixo, 'ET');
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_product_id::text || v_dia::text));
  select coalesce(max(l.seq), 0) into v_seq from public.labels l where l.tenant_id = p_tenant_id and l.dia = v_dia and l.product_id = p_product_id;
  return query
    insert into public.labels (tenant_id, serial, product_id, tipo, quantidade, status, dia, seq, location_id)
    select p_tenant_id, v_prefixo || upper(trim(p.sku)) || to_char(v_dia, 'YYMMDD') || lpad((v_seq + g)::text, 4, '0'), p_product_id, p_tipo,
           case when p_tipo = 'caixa' then coalesce(v_por_caixa, 1) else 1 end, 'impressa', v_dia, v_seq + g, v_loc
      from generate_series(1, p_quantidade) g
    returning labels.id, labels.serial, labels.dia, labels.seq;
end $$;
revoke execute on function public.reserve_label_batch(uuid, uuid, int, text, uuid) from public, anon;
grant execute on function public.reserve_label_batch(uuid, uuid, int, text, uuid) to authenticated;

create or replace function public.annul_label(p_tenant_id uuid, p_label_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao']::public.member_role[]);
  if exists (select 1 from public.scan_events s where s.tenant_id = p_tenant_id and s.label_id = p_label_id and s.event_type = 'produzido'
               and not exists (select 1 from public.scan_events e where e.reverses_id = s.id)) then
    raise exception 'etiqueta já bipada: estorne o bipe antes de anular' using errcode = '22023';
  end if;
  update public.labels set status = 'anulada' where id = p_label_id and tenant_id = p_tenant_id and status <> 'anulada';
  if not found then raise exception 'etiqueta não encontrada' using errcode = '22023'; end if;
end $$;
revoke execute on function public.annul_label(uuid, uuid) from public, anon;
grant execute on function public.annul_label(uuid, uuid) to authenticated;

-- Bipe: grava o evento, faz o backflush multinível e enfileira o outbox. Nunca lança por duplicidade.
create or replace function public.register_scan(p_tenant_id uuid, p_serial text, p_client_event_id text default null, p_stage_codigo text default 'final')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.labels%rowtype;
  v_role public.member_role;
  v_stage uuid;
  v_operator uuid;
  v_device uuid;
  v_loc uuid;
  v_comp date;
  v_scan uuid;
  v_ok boolean := true;
  v_motivo text;
  r record;
  v_custo numeric;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao', 'dispositivo']::public.member_role[]);
  v_role := (select m.role from public.memberships m where m.tenant_id = p_tenant_id and m.user_id = auth.uid());
  select * into l from public.labels where tenant_id = p_tenant_id and serial = upper(trim(p_serial)) for update;
  if l.id is null then return jsonb_build_object('ok', false, 'motivo', 'serial_desconhecido'); end if;
  select s.id into v_stage from public.stages s where s.tenant_id = p_tenant_id and s.codigo = coalesce(p_stage_codigo, 'final') and s.ativa;
  if v_stage is null then raise exception 'etapa % não encontrada', p_stage_codigo using errcode = '22023'; end if;
  if v_role = 'dispositivo' then
    v_operator := public.current_operator_id();
    select d.id into v_device from public.devices d where d.device_user_id = auth.uid() and d.revoked_at is null;
    if v_operator is null then v_ok := false; v_motivo := 'sem_operador'; end if;
  end if;
  if v_ok and l.status = 'anulada' then v_ok := false; v_motivo := 'anulada'; end if;
  if v_ok and l.status = 'reservada' then v_ok := false; v_motivo := 'nao_impressa'; end if;
  v_comp := public.production_date(p_tenant_id, now());
  if v_ok then
    begin
      insert into public.scan_events (tenant_id, label_id, product_id, stage_id, event_type, quantidade, operator_id, device_id, user_id, competencia, scanned_at, client_event_id)
      values (p_tenant_id, l.id, l.product_id, v_stage, 'produzido', l.quantidade, v_operator, v_device, auth.uid(), v_comp, now(), nullif(p_client_event_id, ''))
      returning id into v_scan;
    exception when unique_violation then
      v_ok := false; v_motivo := 'ja_bipado';
    end;
  end if;
  if v_ok then
    v_loc := coalesce(l.location_id, public.default_location(p_tenant_id));
    if v_loc is null then raise exception 'tenant sem local de estoque' using errcode = '22023'; end if;
    for r in select * from public.explode_bom(p_tenant_id, l.product_id, l.quantidade) loop
      v_custo := public.apply_stock_delta(p_tenant_id, r.material_id, v_loc, -r.qtd, null);
      insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, idempotency_key, created_by)
      values (p_tenant_id, r.material_id, v_loc, 'baixa_producao', -r.qtd, v_custo, round(-r.qtd * v_custo, 2), 'scan_event', v_scan, 'scan:' || v_scan || ':' || r.material_id, auth.uid())
      on conflict (tenant_id, idempotency_key) do nothing;
    end loop;
    perform public.enqueue_outbox(p_tenant_id, l.product_id, l.quantidade, 'scan:' || v_scan);
    if v_device is not null then update public.devices set last_scan_at = now() where id = v_device; end if;
  end if;
  return jsonb_build_object('ok', v_ok, 'motivo', v_motivo, 'scan_id', v_scan, 'label_id', l.id, 'competencia', v_comp,
    'product', (select jsonb_build_object('id', p.id, 'sku', p.sku, 'nome', p.nome, 'familia', p.familia) from public.products p where p.id = l.product_id),
    'quantidade', l.quantidade,
    'bipado_hoje', (select coalesce(sum(case when s.event_type = 'produzido' then s.quantidade else -s.quantidade end), 0)
                      from public.scan_events s where s.tenant_id = p_tenant_id and s.product_id = l.product_id and s.competencia = v_comp and s.event_type in ('produzido', 'estorno')),
    'projetado_hoje', (select coalesce(sum(d.projetado), 0) from public.daily_plans d where d.tenant_id = p_tenant_id and d.product_id = l.product_id and d.dia = v_comp));
end $$;
revoke execute on function public.register_scan(uuid, text, text, text) from public, anon;
grant execute on function public.register_scan(uuid, text, text, text) to authenticated;

create or replace function public.reverse_scan(p_tenant_id uuid, p_scan_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.scan_events%rowtype;
  v_rev uuid;
  m record;
  v_custo numeric;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao']::public.member_role[]);
  select * into s from public.scan_events where id = p_scan_id and tenant_id = p_tenant_id for update;
  if s.id is null then raise exception 'bipe não encontrado' using errcode = '22023'; end if;
  if s.event_type <> 'produzido' then raise exception 'só bipes de produção podem ser estornados' using errcode = '22023'; end if;
  if exists (select 1 from public.scan_events e where e.reverses_id = s.id) then raise exception 'bipe já estornado' using errcode = '22023'; end if;
  insert into public.scan_events (tenant_id, label_id, product_id, stage_id, event_type, quantidade, operator_id, device_id, user_id, competencia, reverses_id)
  values (p_tenant_id, s.label_id, s.product_id, s.stage_id, 'estorno', s.quantidade, s.operator_id, s.device_id, auth.uid(), public.production_date(p_tenant_id, now()), s.id)
  returning id into v_rev;
  for m in select * from public.stock_moves where tenant_id = p_tenant_id and ref_type = 'scan_event' and ref_id = s.id loop
    v_custo := public.apply_stock_delta(p_tenant_id, m.material_id, m.location_id, -m.delta, m.custo_unit);
    insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, reverses_id, created_by)
    values (p_tenant_id, m.material_id, m.location_id, 'estorno', -m.delta, v_custo, round(-m.delta * v_custo, 2), 'scan_event', v_rev, 'estorno de bipe', 'rev:' || s.id || ':' || m.material_id, m.id, auth.uid())
    on conflict (tenant_id, idempotency_key) do nothing;
  end loop;
  perform public.enqueue_outbox(p_tenant_id, s.product_id, -s.quantidade, 'rev:' || s.id);
  return v_rev;
end $$;
revoke execute on function public.reverse_scan(uuid, uuid) from public, anon;
grant execute on function public.reverse_scan(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Views (security_invoker: herdam a RLS das tabelas)
-- ---------------------------------------------------------------------------
create or replace view public.v_daily_plan with (security_invoker = on) as
select d.id, d.tenant_id, d.dia, d.location_id, d.product_id, p.sku, p.nome, p.familia,
       d.demanda_dia, d.projetado, d.carteira, d.saldo_hub, d.atualizado_por, d.updated_at,
       (select coalesce(sum(l.quantidade), 0) from public.labels l
         where l.tenant_id = d.tenant_id and l.dia = d.dia and l.product_id = d.product_id and l.status = 'impressa'
           and (l.location_id is null or l.location_id = d.location_id))::numeric(14,4) as impresso,
       (select coalesce(sum(case when s.event_type = 'produzido' then s.quantidade else -s.quantidade end), 0) from public.scan_events s
         where s.tenant_id = d.tenant_id and s.competencia = d.dia and s.product_id = d.product_id and s.event_type in ('produzido', 'estorno'))::numeric(14,4) as bipado
  from public.daily_plans d
  join public.products p on p.id = d.product_id;
revoke all on table public.v_daily_plan from public, anon, authenticated;
grant select on public.v_daily_plan to authenticated;
