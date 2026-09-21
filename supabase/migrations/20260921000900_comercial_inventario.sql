-- 0009 · Comercial e inventário: canais de venda, preços por canal, sessões de inventário, avisos.
-- Contrato em docs/schema.md (seção 0009). Regras em docs/arquitetura.md, seção 2.

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null,
  preset text check (preset is null or preset in ('mercadolivre', 'shopee', 'amazon', 'tiktok', 'magalu', 'loja', 'atacado')),
  ativo boolean not null default true,
  comissao_pct numeric(8,5) not null default 0,
  taxa_fixa numeric(14,2) not null default 0,
  taxa_fixa_abaixo_de numeric(14,2),
  frete_vendedor jsonb not null default '[]'::jsonb,
  frete_gratis_acima_de numeric(14,2),
  imposto_venda_pct numeric(8,5) not null default 0,
  ads_pct numeric(8,5) not null default 0,
  parcelamento_pct numeric(8,5) not null default 0,
  outros_pct numeric(8,5) not null default 0,
  observacao text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
-- Nome único entre canais vivos: soft delete permite recriar um canal com o mesmo nome.
create unique index if not exists channels_nome_uidx on public.channels(tenant_id, nome) where deleted_at is null;

create table if not exists public.product_prices (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  channel_id uuid not null,
  preco numeric(14,2) not null check (preco >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, product_id, channel_id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_id) references public.channels(tenant_id, id) on delete cascade
);

create table if not exists public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  aberta_por uuid,
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz,
  observacao text,
  unique (tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id)
);
create index if not exists inventory_sessions_tenant_idx on public.inventory_sessions(tenant_id, status, aberta_em desc);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null,
  material_id uuid not null,
  saldo_sistema numeric(14,4) not null default 0,
  contado numeric(14,4) not null default 0,
  pecas jsonb not null default '[]'::jsonb,
  motivo text,
  stock_move_id uuid,
  unique (tenant_id, session_id, material_id),
  foreign key (tenant_id, session_id) references public.inventory_sessions(tenant_id, id) on delete cascade,
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id),
  foreign key (tenant_id, stock_move_id) references public.stock_moves(tenant_id, id)
);

create table if not exists public.notification_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  config jsonb not null default '{"eventos": {}, "webhooks": []}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('minimo', 'oc_atrasada', 'nfe', 'conector', 'cadastro', 'inventario', 'sistema')),
  texto text not null,
  lida boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_tenant_idx on public.notifications(tenant_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['channels', 'notification_settings'] loop
    execute format('drop trigger if exists %1$s_updated_at on public.%1$I', t);
    execute format('create trigger %1$s_updated_at before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['channels', 'inventory_sessions'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$I', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS e grants: leitura por tenant. Escrita direta só em notifications.lida (qualquer membro) e
-- notification_settings (admin). O resto passa por RPC.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['channels', 'product_prices', 'inventory_sessions', 'inventory_items', 'notification_settings', 'notifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated, service_role', t);
  end loop;
end $$;
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
grant update (lida) on public.notifications to authenticated;
drop policy if exists notification_settings_write on public.notification_settings;
create policy notification_settings_write on public.notification_settings for all to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) = 'admin');
grant insert, update on public.notification_settings to authenticated;
grant insert on public.notifications to service_role;

-- ---------------------------------------------------------------------------
-- Avisos: chamada interna (outras RPCs e o worker). Sem execute para authenticated.
-- ---------------------------------------------------------------------------
create or replace function public.notify(p_tenant_id uuid, p_tipo text, p_texto text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.notifications (tenant_id, tipo, texto) values (p_tenant_id, p_tipo, p_texto) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.notify(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Canais e preços (admin, compras)
-- ---------------------------------------------------------------------------
-- p_channel: colunas de channels (percentuais em fração: 0.12 = 12%).
create or replace function public.upsert_channel(p_tenant_id uuid, p_id uuid, p_channel jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_nome text := nullif(trim(coalesce(p_channel ->> 'nome', '')), '');
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras']::public.member_role[]);
  if v_nome is null then raise exception 'nome do canal obrigatório' using errcode = '22023'; end if;
  if p_id is not null and not exists (select 1 from public.channels c where c.id = p_id and c.tenant_id = p_tenant_id) then
    raise exception 'canal não encontrado' using errcode = '22023';
  end if;
  insert into public.channels (id, tenant_id, nome, preset, ativo, comissao_pct, taxa_fixa, taxa_fixa_abaixo_de, frete_vendedor, frete_gratis_acima_de,
                               imposto_venda_pct, ads_pct, parcelamento_pct, outros_pct, observacao)
  values (v_id, p_tenant_id, v_nome, nullif(p_channel ->> 'preset', ''), coalesce((p_channel ->> 'ativo')::boolean, true),
          coalesce((p_channel ->> 'comissao_pct')::numeric, 0), coalesce((p_channel ->> 'taxa_fixa')::numeric, 0), (p_channel ->> 'taxa_fixa_abaixo_de')::numeric,
          coalesce(p_channel -> 'frete_vendedor', '[]'::jsonb), (p_channel ->> 'frete_gratis_acima_de')::numeric,
          coalesce((p_channel ->> 'imposto_venda_pct')::numeric, 0), coalesce((p_channel ->> 'ads_pct')::numeric, 0),
          coalesce((p_channel ->> 'parcelamento_pct')::numeric, 0), coalesce((p_channel ->> 'outros_pct')::numeric, 0), p_channel ->> 'observacao')
  on conflict (id) do update set nome = excluded.nome, preset = excluded.preset, ativo = excluded.ativo, comissao_pct = excluded.comissao_pct,
    taxa_fixa = excluded.taxa_fixa, taxa_fixa_abaixo_de = excluded.taxa_fixa_abaixo_de, frete_vendedor = excluded.frete_vendedor,
    frete_gratis_acima_de = excluded.frete_gratis_acima_de, imposto_venda_pct = excluded.imposto_venda_pct, ads_pct = excluded.ads_pct,
    parcelamento_pct = excluded.parcelamento_pct, outros_pct = excluded.outros_pct, observacao = excluded.observacao, deleted_at = null;
  return v_id;
end $$;
revoke execute on function public.upsert_channel(uuid, uuid, jsonb) from public, anon;
grant execute on function public.upsert_channel(uuid, uuid, jsonb) to authenticated;

-- Soft delete do canal e limpeza dos preços (os preços não fazem sentido sem o canal).
create or replace function public.remove_channel(p_tenant_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras']::public.member_role[]);
  update public.channels set deleted_at = now(), ativo = false where id = p_id and tenant_id = p_tenant_id and deleted_at is null;
  if not found then raise exception 'canal não encontrado' using errcode = '22023'; end if;
  delete from public.product_prices where tenant_id = p_tenant_id and channel_id = p_id;
end $$;
revoke execute on function public.remove_channel(uuid, uuid) from public, anon;
grant execute on function public.remove_channel(uuid, uuid) to authenticated;

-- Preço nulo apaga o preço do canal.
create or replace function public.set_product_price(p_tenant_id uuid, p_product_id uuid, p_channel_id uuid, p_preco numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras']::public.member_role[]);
  if not exists (select 1 from public.products p where p.id = p_product_id and p.tenant_id = p_tenant_id) then raise exception 'produto não encontrado' using errcode = '22023'; end if;
  if not exists (select 1 from public.channels c where c.id = p_channel_id and c.tenant_id = p_tenant_id and c.deleted_at is null) then raise exception 'canal não encontrado' using errcode = '22023'; end if;
  if p_preco is null then
    delete from public.product_prices where tenant_id = p_tenant_id and product_id = p_product_id and channel_id = p_channel_id;
  else
    if p_preco < 0 then raise exception 'preço não pode ser negativo' using errcode = '22023'; end if;
    insert into public.product_prices (tenant_id, product_id, channel_id, preco) values (p_tenant_id, p_product_id, p_channel_id, round(p_preco, 2))
    on conflict (tenant_id, product_id, channel_id) do update set preco = excluded.preco, updated_at = now();
  end if;
end $$;
revoke execute on function public.set_product_price(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.set_product_price(uuid, uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Inventário (admin, producao, compras)
-- ---------------------------------------------------------------------------
create or replace function public.open_inventory_session(p_tenant_id uuid, p_location_id uuid, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao', 'compras']::public.member_role[]);
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then raise exception 'local não encontrado' using errcode = '22023'; end if;
  select s.id into v_id from public.inventory_sessions s where s.tenant_id = p_tenant_id and s.location_id = p_location_id and s.status = 'aberta';
  if v_id is not null then return v_id; end if;
  insert into public.inventory_sessions (tenant_id, location_id, aberta_por, observacao) values (p_tenant_id, p_location_id, auth.uid(), p_observacao) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.open_inventory_session(uuid, uuid, text) from public, anon;
grant execute on function public.open_inventory_session(uuid, uuid, text) to authenticated;

-- Contagem: p_contado direto ou p_pecas [{nome, medida, qtd}] (contado = soma de medida × qtd). saldo_sistema é o saldo no local na hora.
create or replace function public.save_inventory_item(p_tenant_id uuid, p_session_id uuid, p_material_id uuid, p_contado numeric default null, p_pecas jsonb default null, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.inventory_sessions%rowtype; v_id uuid; v_contado numeric; v_saldo numeric;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao', 'compras']::public.member_role[]);
  select * into s from public.inventory_sessions where id = p_session_id and tenant_id = p_tenant_id;
  if s.id is null then raise exception 'sessão não encontrada' using errcode = '22023'; end if;
  if s.status <> 'aberta' then raise exception 'sessão já fechada' using errcode = '22023'; end if;
  if not exists (select 1 from public.materials m where m.id = p_material_id and m.tenant_id = p_tenant_id and m.deleted_at is null) then raise exception 'insumo não encontrado' using errcode = '22023'; end if;
  v_contado := coalesce(p_contado, (select sum(coalesce((x ->> 'medida')::numeric, 0) * coalesce((x ->> 'qtd')::numeric, 0)) from jsonb_array_elements(coalesce(p_pecas, '[]'::jsonb)) x), 0);
  if v_contado < 0 then raise exception 'contagem não pode ser negativa' using errcode = '22023'; end if;
  select coalesce(b.saldo, 0) into v_saldo from public.stock_balances b where b.tenant_id = p_tenant_id and b.material_id = p_material_id and b.location_id = s.location_id;
  insert into public.inventory_items (tenant_id, session_id, material_id, saldo_sistema, contado, pecas, motivo)
  values (p_tenant_id, s.id, p_material_id, coalesce(v_saldo, 0), v_contado, coalesce(p_pecas, '[]'::jsonb), p_motivo)
  on conflict (tenant_id, session_id, material_id) do update set saldo_sistema = excluded.saldo_sistema, contado = excluded.contado, pecas = excluded.pecas, motivo = excluded.motivo
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.save_inventory_item(uuid, uuid, uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.save_inventory_item(uuid, uuid, uuid, numeric, jsonb, text) to authenticated;

-- Fecha a sessão: ajuste só para itens divergentes (saldo recalculado no fechamento), chave 'inv:<sessão>:<insumo>'.
-- Sessão já fechada devolve 0 sem erro.
create or replace function public.close_inventory_session(p_tenant_id uuid, p_session_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.inventory_sessions%rowtype; it record; v_saldo numeric; v_delta numeric; v_custo numeric; v_move uuid; v_n int := 0;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'producao', 'compras']::public.member_role[]);
  select * into s from public.inventory_sessions where id = p_session_id and tenant_id = p_tenant_id for update;
  if s.id is null then raise exception 'sessão não encontrada' using errcode = '22023'; end if;
  if s.status = 'fechada' then return 0; end if;
  for it in select * from public.inventory_items i where i.session_id = s.id order by i.material_id loop
    select coalesce(b.saldo, 0) into v_saldo from public.stock_balances b where b.tenant_id = p_tenant_id and b.material_id = it.material_id and b.location_id = s.location_id;
    v_saldo := coalesce(v_saldo, 0);
    v_delta := it.contado - v_saldo;
    update public.inventory_items set saldo_sistema = v_saldo where id = it.id;
    if v_delta = 0 then continue; end if;
    select m.id into v_move from public.stock_moves m where m.tenant_id = p_tenant_id and m.idempotency_key = 'inv:' || s.id || ':' || it.material_id;
    if v_move is null then
      v_custo := public.apply_stock_delta(p_tenant_id, it.material_id, s.location_id, v_delta, null);
      insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, created_by)
      values (p_tenant_id, it.material_id, s.location_id, 'ajuste', v_delta, v_custo, round(v_delta * v_custo, 2), 'inventory_session', s.id, coalesce(it.motivo, 'inventário'), 'inv:' || s.id || ':' || it.material_id, auth.uid())
      returning id into v_move;
    end if;
    update public.inventory_items set stock_move_id = v_move where id = it.id;
    v_n := v_n + 1;
  end loop;
  update public.inventory_sessions set status = 'fechada', fechada_em = now() where id = s.id;
  perform public.notify(p_tenant_id, 'inventario', 'Inventário fechado com ' || v_n || ' ajuste(s)');
  return v_n;
end $$;
revoke execute on function public.close_inventory_session(uuid, uuid) from public, anon;
grant execute on function public.close_inventory_session(uuid, uuid) to authenticated;
