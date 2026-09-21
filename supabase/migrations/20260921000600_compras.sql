-- 0006 · Compras: ordens de compra, recibos (recebimento manual e da NF-e, que vem na 0007), status da OC.
-- Contrato em docs/schema.md (seção 0006). Regras em docs/arquitetura.md, seção 2.
-- O status parcial/recebida da OC é sempre derivado das quantidades recebidas (refresh_purchase_order_status);
-- o cliente só cancela ou reabre.
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  numero bigint not null,
  supplier_id uuid not null,
  location_id uuid,
  status text not null default 'aberta' check (status in ('aberta', 'parcial', 'recebida', 'cancelada')),
  entrega_prevista date, condicao_pagamento int[] not null default '{0}', observacao text, total numeric(14,2) not null default 0,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, numero),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id)
);
create index if not exists purchase_orders_status_idx on public.purchase_orders(tenant_id, status, entrega_prevista);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null,
  material_id uuid not null,
  unidade_compra text, fator numeric(14,6) not null default 1 check (fator > 0),
  qtd numeric(14,4) not null check (qtd > 0), qtd_recebida numeric(14,4) not null default 0 check (qtd_recebida >= 0),
  preco numeric(14,4) not null default 0, ipi_pct numeric(8,5) not null default 0, entrega_prevista date,
  unique (tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references public.purchase_orders(tenant_id, id) on delete cascade,
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id)
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items(tenant_id, purchase_order_id);

-- receipts.nfe_id ganha a FK na 0007 (nfe_inbound nasce lá).
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nfe_id uuid, purchase_order_id uuid,
  location_id uuid not null, recebido_por uuid,
  idempotency_key text not null, observacao text, created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references public.purchase_orders(tenant_id, id),
  foreign key (tenant_id, location_id) references public.locations(tenant_id, id)
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null,
  purchase_order_item_id uuid,
  material_id uuid not null,
  qtd_compra numeric(14,4) not null default 0, qtd_consumo numeric(14,4) not null, custo_unit_consumo numeric(14,4),
  divergente boolean not null default false, motivo_divergencia text, stock_move_id uuid,
  foreign key (tenant_id, receipt_id) references public.receipts(tenant_id, id) on delete cascade,
  foreign key (tenant_id, purchase_order_item_id) references public.purchase_order_items(tenant_id, id) on delete set null (purchase_order_item_id),
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id),
  foreign key (tenant_id, stock_move_id) references public.stock_moves(tenant_id, id)
);
create index if not exists receipt_items_move_idx on public.receipt_items(tenant_id, stock_move_id);

drop trigger if exists purchase_orders_updated_at on public.purchase_orders;
create trigger purchase_orders_updated_at before update on public.purchase_orders for each row execute function public.set_updated_at();
drop trigger if exists purchase_orders_audit on public.purchase_orders;
create trigger purchase_orders_audit after insert or update or delete on public.purchase_orders for each row execute function public.audit_trigger();
drop trigger if exists receipts_audit on public.receipts;
create trigger receipts_audit after insert or update or delete on public.receipts for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- RLS e grants: leitura por tenant; escrita só por RPC. Exceção: cabeçalho da OC
-- (entrega, condição, observação) pode ser editado direto por admin/compras.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['purchase_orders', 'purchase_order_items', 'receipts', 'receipt_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated, service_role', t);
  end loop;
end $$;
drop policy if exists purchase_orders_header_update on public.purchase_orders;
create policy purchase_orders_header_update on public.purchase_orders for update to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'compras'))
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_member_role()) in ('admin', 'compras'));
grant update (entrega_prevista, condicao_pagamento, observacao) on public.purchase_orders to authenticated;

-- Helper interno: recalcula o status da OC a partir das quantidades recebidas (não mexe em cancelada).
create or replace function public.refresh_purchase_order_status(p_po_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_total numeric; v_recebido numeric; v_completa boolean;
begin
  select coalesce(sum(i.qtd), 0), coalesce(sum(least(i.qtd_recebida, i.qtd)), 0), bool_and(i.qtd_recebida >= i.qtd)
    into v_total, v_recebido, v_completa
    from public.purchase_order_items i where i.purchase_order_id = p_po_id;
  update public.purchase_orders set status = case when v_total > 0 and v_completa then 'recebida' when v_recebido > 0 then 'parcial' else 'aberta' end
   where id = p_po_id and status <> 'cancelada';
end $$;
revoke execute on function public.refresh_purchase_order_status(uuid) from public, anon, authenticated;

-- Estorno de uma entrada de recebimento (reverse_stock_move) devolve a quantidade à OC e recalcula o status.
create or replace function public.on_receipt_move_reversed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ri record;
begin
  if new.move_type <> 'estorno' or new.reverses_id is null then return new; end if;
  for ri in select r.purchase_order_item_id, r.qtd_consumo, i.fator, i.purchase_order_id
              from public.receipt_items r join public.purchase_order_items i on i.id = r.purchase_order_item_id
             where r.tenant_id = new.tenant_id and r.stock_move_id = new.reverses_id loop
    update public.purchase_order_items set qtd_recebida = greatest(0, qtd_recebida - ri.qtd_consumo / ri.fator) where id = ri.purchase_order_item_id;
    perform public.refresh_purchase_order_status(ri.purchase_order_id);
  end loop;
  return new;
end $$;
revoke execute on function public.on_receipt_move_reversed() from public, anon, authenticated;
drop trigger if exists stock_moves_receipt_reversed on public.stock_moves;
create trigger stock_moves_receipt_reversed after insert on public.stock_moves for each row execute function public.on_receipt_move_reversed();

-- RPCs de OC. p_itens: [{material_id, unidade_compra, fator, qtd, preco, ipi_pct, entrega_prevista}]
create or replace function public.create_purchase_order(p_tenant_id uuid, p_supplier_id uuid, p_location_id uuid, p_entrega_prevista date,
  p_condicao int[], p_itens jsonb, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_numero bigint; v_total numeric := 0; x jsonb; m public.materials%rowtype;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras']::public.member_role[]);
  if not exists (select 1 from public.suppliers s where s.id = p_supplier_id and s.tenant_id = p_tenant_id and s.deleted_at is null) then
    raise exception 'fornecedor não encontrado' using errcode = '22023';
  end if;
  if p_location_id is not null and not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then
    raise exception 'local não encontrado' using errcode = '22023';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'ordem precisa de ao menos um item' using errcode = '22023';
  end if;
  v_numero := public.next_doc_number(p_tenant_id, 'oc');
  insert into public.purchase_orders (tenant_id, numero, supplier_id, location_id, entrega_prevista, condicao_pagamento, observacao, created_by)
  values (p_tenant_id, v_numero, p_supplier_id, coalesce(p_location_id, public.default_location(p_tenant_id)), p_entrega_prevista, coalesce(nullif(p_condicao, '{}'), '{0}'), p_observacao, auth.uid())
  returning id into v_id;
  for x in select * from jsonb_array_elements(p_itens) loop
    select * into m from public.materials mm where mm.id = (x ->> 'material_id')::uuid and mm.tenant_id = p_tenant_id and mm.deleted_at is null;
    if m.id is null then raise exception 'insumo % não encontrado neste tenant', x ->> 'material_id' using errcode = '22023'; end if;
    if coalesce((x ->> 'qtd')::numeric, 0) <= 0 then raise exception 'quantidade deve ser maior que zero' using errcode = '22023'; end if;
    insert into public.purchase_order_items (tenant_id, purchase_order_id, material_id, unidade_compra, fator, qtd, preco, ipi_pct, entrega_prevista)
    values (p_tenant_id, v_id, m.id, coalesce(nullif(x ->> 'unidade_compra', ''), m.unidade_compra),
            coalesce(nullif((x ->> 'fator')::numeric, 0), m.fator_conversao), (x ->> 'qtd')::numeric,
            coalesce((x ->> 'preco')::numeric, 0), coalesce((x ->> 'ipi_pct')::numeric, 0), (x ->> 'entrega_prevista')::date);
    v_total := v_total + (x ->> 'qtd')::numeric * coalesce((x ->> 'preco')::numeric, 0) * (1 + coalesce((x ->> 'ipi_pct')::numeric, 0));
  end loop;
  update public.purchase_orders set total = round(v_total, 2) where id = v_id;
  return v_id;
end $$;
revoke execute on function public.create_purchase_order(uuid, uuid, uuid, date, int[], jsonb, text) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, uuid, date, int[], jsonb, text) to authenticated;

-- Só 'cancelada' (sem recebimento) e 'aberta' (reabrir uma cancelada; o status real é recalculado). parcial/recebida
-- nascem exclusivamente de receive_nfe/receive_manual.
create or replace function public.update_purchase_order_status(p_tenant_id uuid, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders%rowtype;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras']::public.member_role[]);
  if p_status not in ('aberta', 'cancelada') then raise exception 'status % só nasce de um recebimento', p_status using errcode = '22023'; end if;
  select * into po from public.purchase_orders where id = p_id and tenant_id = p_tenant_id for update;
  if po.id is null then raise exception 'ordem não encontrada' using errcode = '22023'; end if;
  if p_status = 'cancelada' and exists (select 1 from public.purchase_order_items i where i.purchase_order_id = po.id and i.qtd_recebida > 0) then
    raise exception 'ordem com recebimento não pode ser cancelada' using errcode = '22023';
  end if;
  update public.purchase_orders set status = p_status where id = po.id;
  if p_status = 'aberta' then perform public.refresh_purchase_order_status(po.id); end if;
end $$;
revoke execute on function public.update_purchase_order_status(uuid, uuid, text) from public, anon;
grant execute on function public.update_purchase_order_status(uuid, uuid, text) to authenticated;

-- Recebimento sem nota (sem_xml): p_itens [{purchase_order_item_id, qtd_compra, custo_unit (por unidade de consumo, opcional), divergente, motivo}]
-- Chave do recibo no namespace manual:; movimentos no namespace rcpt:<recibo>:<item da OC>.
create or replace function public.receive_manual(p_tenant_id uuid, p_purchase_order_id uuid, p_location_id uuid, p_itens jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders%rowtype; poi public.purchase_order_items%rowtype; x jsonb; v_receipt uuid; v_key text; v_qtd numeric; v_custo numeric; v_move uuid;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras', 'producao']::public.member_role[]);
  select * into po from public.purchase_orders where id = p_purchase_order_id and tenant_id = p_tenant_id for update;
  if po.id is null then raise exception 'ordem não encontrada' using errcode = '22023'; end if;
  if po.status = 'cancelada' then raise exception 'ordem cancelada' using errcode = '22023'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then raise exception 'local não encontrado' using errcode = '22023'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'nenhum item para receber' using errcode = '22023'; end if;
  v_key := 'manual:' || coalesce(nullif(p_idempotency_key, ''), gen_random_uuid()::text);
  select r.id into v_receipt from public.receipts r where r.tenant_id = p_tenant_id and r.idempotency_key = v_key;
  if v_receipt is not null then return v_receipt; end if;
  insert into public.receipts (tenant_id, purchase_order_id, location_id, recebido_por, idempotency_key, observacao)
  values (p_tenant_id, po.id, p_location_id, auth.uid(), v_key, 'recebimento manual') returning id into v_receipt;
  for x in select * from jsonb_array_elements(p_itens) loop
    select * into poi from public.purchase_order_items i where i.id = (x ->> 'purchase_order_item_id')::uuid and i.purchase_order_id = po.id for update;
    if poi.id is null then raise exception 'item % não pertence à OC', x ->> 'purchase_order_item_id' using errcode = '22023'; end if;
    if coalesce((x ->> 'qtd_compra')::numeric, 0) <= 0 then raise exception 'quantidade deve ser maior que zero' using errcode = '22023'; end if;
    v_qtd := (x ->> 'qtd_compra')::numeric * poi.fator;
    v_custo := round(coalesce((x ->> 'custo_unit')::numeric, poi.preco / poi.fator), 4);
    if v_custo < 0 then raise exception 'custo unitário não pode ser negativo' using errcode = '22023'; end if;
    v_custo := public.apply_stock_delta(p_tenant_id, poi.material_id, p_location_id, v_qtd, v_custo);
    insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, created_by)
    values (p_tenant_id, poi.material_id, p_location_id, 'entrada_manual', v_qtd, v_custo, round(v_qtd * v_custo, 2), 'receipt', v_receipt,
            'OC ' || po.numero || ' (recebimento manual)', 'rcpt:' || v_receipt || ':' || poi.id, auth.uid())
    returning id into v_move;
    insert into public.receipt_items (tenant_id, receipt_id, purchase_order_item_id, material_id, qtd_compra, qtd_consumo, custo_unit_consumo, divergente, motivo_divergencia, stock_move_id)
    values (p_tenant_id, v_receipt, poi.id, poi.material_id, (x ->> 'qtd_compra')::numeric, v_qtd, v_custo, coalesce((x ->> 'divergente')::boolean, false), x ->> 'motivo', v_move);
    update public.purchase_order_items set qtd_recebida = qtd_recebida + (x ->> 'qtd_compra')::numeric where id = poi.id;
  end loop;
  perform public.refresh_purchase_order_status(po.id);
  return v_receipt;
end $$;
revoke execute on function public.receive_manual(uuid, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.receive_manual(uuid, uuid, uuid, jsonb, text) to authenticated;

-- View: OCs com total, recebido_pct e fornecedor (security_invoker: herda a RLS)
create or replace view public.v_purchase_orders with (security_invoker = on) as
select po.id, po.tenant_id, po.numero, po.supplier_id, s.nome as fornecedor, po.location_id, po.status, po.entrega_prevista, po.condicao_pagamento, po.observacao,
       po.created_by, po.created_at, po.updated_at,
       coalesce(sum(i.qtd * i.preco * (1 + i.ipi_pct)), 0)::numeric(14,2) as total,
       case when coalesce(sum(i.qtd), 0) > 0 then (sum(least(i.qtd_recebida, i.qtd)) / sum(i.qtd))::numeric(8,5) else 0 end as recebido_pct,
       count(i.id)::int as itens,
       (po.status in ('aberta', 'parcial') and po.entrega_prevista < current_date) as atrasada
  from public.purchase_orders po
  join public.suppliers s on s.id = po.supplier_id
  left join public.purchase_order_items i on i.purchase_order_id = po.id
 group by po.id, s.nome;
revoke all on table public.v_purchase_orders from public, anon, authenticated;
grant select on public.v_purchase_orders to authenticated, service_role;
