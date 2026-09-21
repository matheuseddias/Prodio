-- 0007 · NF-e de entrada: notas, itens, vínculos OC×NF-e e o recebimento pela nota (usa recibos da 0006).
-- Contrato em docs/schema.md (seção 0007). Regras em docs/arquitetura.md, seção 2.
-- O status 'recebida' só nasce de receive_nfe: nem cliente nem worker gravam esse status pelo upsert.
create table if not exists public.nfe_inbound (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chave text not null check (chave ~ '^\d{44}$'),
  id uuid not null unique default gen_random_uuid(),
  numero int, serie int, cnpj_emitente text, emitente text,
  supplier_id uuid,
  emissao date,
  valor_total numeric(14,2) not null default 0, valor_frete numeric(14,2) not null default 0,
  valor_desconto numeric(14,2) not null default 0, valor_outros numeric(14,2) not null default 0,
  origem text not null default 'upload' check (origem in ('upload', 'email', 'erp', 'dfe', 'sem_xml')),
  status text not null default 'pendente' check (status in ('aguardando_xml', 'pendente', 'conferida', 'recebida', 'ignorada')),
  motivo_ignorada text, xml_path text, cstat text, fin_nfe text, raw jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (tenant_id, chave),
  unique (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id)
);

create table if not exists public.nfe_inbound_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nfe_id uuid not null,
  n_item int not null, c_prod text, x_prod text, ncm text, cfop text, u_com text,
  q_com numeric(14,4) not null default 0, v_un_com numeric(14,6) not null default 0, v_prod numeric(14,2) not null default 0,
  u_trib text, q_trib numeric(14,4),
  v_icms numeric(14,2) not null default 0, v_icms_st numeric(14,2) not null default 0, v_ipi numeric(14,2) not null default 0,
  v_pis numeric(14,2) not null default 0, v_cofins numeric(14,2) not null default 0, v_ibs numeric(14,2) not null default 0, v_cbs numeric(14,2) not null default 0,
  classificacao text not null default 'compra' check (classificacao in ('compra', 'manual', 'ignorar')),
  material_id uuid, fator numeric(14,6) check (fator is null or fator > 0), qtd_consumo numeric(14,4),
  purchase_order_item_id uuid,
  unique (tenant_id, nfe_id, n_item),
  foreign key (tenant_id, nfe_id) references public.nfe_inbound(tenant_id, id) on delete cascade,
  foreign key (tenant_id, material_id) references public.materials(tenant_id, id),
  foreign key (tenant_id, purchase_order_item_id) references public.purchase_order_items(tenant_id, id) on delete set null (purchase_order_item_id)
);

create table if not exists public.nfe_po_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nfe_id uuid not null,
  purchase_order_id uuid not null,
  primary key (tenant_id, nfe_id, purchase_order_id),
  foreign key (tenant_id, nfe_id) references public.nfe_inbound(tenant_id, id) on delete cascade,
  foreign key (tenant_id, purchase_order_id) references public.purchase_orders(tenant_id, id) on delete cascade
);

alter table public.receipts
  drop constraint if exists receipts_nfe_fk,
  add constraint receipts_nfe_fk foreign key (tenant_id, nfe_id) references public.nfe_inbound(tenant_id, id);

drop trigger if exists nfe_inbound_updated_at on public.nfe_inbound;
create trigger nfe_inbound_updated_at before update on public.nfe_inbound for each row execute function public.set_updated_at();
drop trigger if exists nfe_inbound_audit on public.nfe_inbound;
create trigger nfe_inbound_audit after insert or update or delete on public.nfe_inbound for each row execute function public.audit_trigger();

do $$
declare t text;
begin
  foreach t in array array['nfe_inbound', 'nfe_inbound_items', 'nfe_po_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated, service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- upsert_nfe_inbound: idempotente por (tenant, chave). Cliente (admin/compras/producao/dispositivo) e worker (service_role).
-- p_nfe: colunas de nfe_inbound + po_ids (uuid[]; quando presente substitui os vínculos). p_itens: colunas de nfe_inbound_items.
-- Status aceito de fora: aguardando_xml, pendente, conferida, ignorada ('recebida' é exclusivo de receive_nfe).
-- xml_path só dentro da pasta do tenant no bucket ('<tenant_id>/…').
-- Sugere material_id/fator/qtd_consumo pelo De-Para supplier_materials (cnpj do emitente + cProd). Nota recebida não muda.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_nfe_inbound(p_tenant_id uuid, p_nfe jsonb, p_itens jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_chave text := regexp_replace(coalesce(p_nfe ->> 'chave', ''), '\D', '', 'g'); v_cnpj text; v_supplier uuid; v_id uuid; v_status text; x jsonb;
  v_novo_status text := nullif(p_nfe ->> 'status', ''); v_xml_path text := nullif(p_nfe ->> 'xml_path', '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.assert_member(p_tenant_id, array['admin', 'compras', 'producao', 'dispositivo']::public.member_role[]);
  end if;
  if v_chave !~ '^\d{44}$' then raise exception 'chave da NF-e inválida' using errcode = '22023'; end if;
  if v_novo_status is not null and v_novo_status not in ('aguardando_xml', 'pendente', 'conferida', 'ignorada') then
    raise exception 'status % não pode ser gravado pelo upsert (recebida só por receive_nfe)', v_novo_status using errcode = '22023';
  end if;
  if v_xml_path is not null and (v_xml_path not like p_tenant_id::text || '/%' or v_xml_path like '%..%') then
    raise exception 'xml_path fora da pasta do tenant' using errcode = '22023';
  end if;
  v_cnpj := nullif(regexp_replace(coalesce(p_nfe ->> 'cnpj_emitente', ''), '\D', '', 'g'), '');
  v_supplier := (p_nfe ->> 'supplier_id')::uuid;
  if v_supplier is not null and not exists (select 1 from public.suppliers s where s.id = v_supplier and s.tenant_id = p_tenant_id) then v_supplier := null; end if;
  if v_supplier is null and v_cnpj is not null then
    select s.id into v_supplier from public.suppliers s where s.tenant_id = p_tenant_id and s.cnpj = v_cnpj and s.deleted_at is null limit 1;
  end if;
  select n.id, n.status into v_id, v_status from public.nfe_inbound n where n.tenant_id = p_tenant_id and n.chave = v_chave for update;
  if v_status = 'recebida' then return v_id; end if;
  insert into public.nfe_inbound (tenant_id, chave, numero, serie, cnpj_emitente, emitente, supplier_id, emissao, valor_total, valor_frete, valor_desconto, valor_outros,
                                  origem, status, motivo_ignorada, xml_path, cstat, fin_nfe, raw)
  values (p_tenant_id, v_chave, (p_nfe ->> 'numero')::int, (p_nfe ->> 'serie')::int, v_cnpj, p_nfe ->> 'emitente', v_supplier, (p_nfe ->> 'emissao')::date,
          coalesce((p_nfe ->> 'valor_total')::numeric, 0), coalesce((p_nfe ->> 'valor_frete')::numeric, 0), coalesce((p_nfe ->> 'valor_desconto')::numeric, 0),
          coalesce((p_nfe ->> 'valor_outros')::numeric, 0), coalesce(p_nfe ->> 'origem', 'upload'), coalesce(v_novo_status, 'pendente'),
          p_nfe ->> 'motivo_ignorada', v_xml_path, p_nfe ->> 'cstat', p_nfe ->> 'fin_nfe', p_nfe -> 'raw')
  on conflict (tenant_id, chave) do update set
    numero = coalesce(excluded.numero, nfe_inbound.numero), serie = coalesce(excluded.serie, nfe_inbound.serie),
    cnpj_emitente = coalesce(excluded.cnpj_emitente, nfe_inbound.cnpj_emitente), emitente = coalesce(excluded.emitente, nfe_inbound.emitente),
    supplier_id = coalesce(excluded.supplier_id, nfe_inbound.supplier_id), emissao = coalesce(excluded.emissao, nfe_inbound.emissao),
    valor_total = case when p_nfe ? 'valor_total' then excluded.valor_total else nfe_inbound.valor_total end,
    valor_frete = case when p_nfe ? 'valor_frete' then excluded.valor_frete else nfe_inbound.valor_frete end,
    valor_desconto = case when p_nfe ? 'valor_desconto' then excluded.valor_desconto else nfe_inbound.valor_desconto end,
    valor_outros = case when p_nfe ? 'valor_outros' then excluded.valor_outros else nfe_inbound.valor_outros end,
    origem = case when nfe_inbound.origem = 'sem_xml' then excluded.origem else nfe_inbound.origem end,
    status = coalesce(v_novo_status, nfe_inbound.status),
    motivo_ignorada = coalesce(excluded.motivo_ignorada, nfe_inbound.motivo_ignorada), xml_path = coalesce(excluded.xml_path, nfe_inbound.xml_path),
    cstat = coalesce(excluded.cstat, nfe_inbound.cstat), fin_nfe = coalesce(excluded.fin_nfe, nfe_inbound.fin_nfe), raw = coalesce(excluded.raw, nfe_inbound.raw)
  returning id into v_id;

  for x in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    insert into public.nfe_inbound_items (tenant_id, nfe_id, n_item, c_prod, x_prod, ncm, cfop, u_com, q_com, v_un_com, v_prod, u_trib, q_trib,
                                          v_icms, v_icms_st, v_ipi, v_pis, v_cofins, v_ibs, v_cbs, classificacao, material_id, fator, qtd_consumo, purchase_order_item_id)
    values (p_tenant_id, v_id, (x ->> 'n_item')::int, x ->> 'c_prod', x ->> 'x_prod', x ->> 'ncm', x ->> 'cfop', x ->> 'u_com',
            coalesce((x ->> 'q_com')::numeric, 0), coalesce((x ->> 'v_un_com')::numeric, 0), coalesce((x ->> 'v_prod')::numeric, 0), x ->> 'u_trib', (x ->> 'q_trib')::numeric,
            coalesce((x ->> 'v_icms')::numeric, 0), coalesce((x ->> 'v_icms_st')::numeric, 0), coalesce((x ->> 'v_ipi')::numeric, 0), coalesce((x ->> 'v_pis')::numeric, 0),
            coalesce((x ->> 'v_cofins')::numeric, 0), coalesce((x ->> 'v_ibs')::numeric, 0), coalesce((x ->> 'v_cbs')::numeric, 0), coalesce(x ->> 'classificacao', 'compra'),
            (select mm.id from public.materials mm where mm.id = (x ->> 'material_id')::uuid and mm.tenant_id = p_tenant_id),
            nullif((x ->> 'fator')::numeric, 0), (x ->> 'qtd_consumo')::numeric,
            (select i.id from public.purchase_order_items i where i.id = (x ->> 'purchase_order_item_id')::uuid and i.tenant_id = p_tenant_id))
    on conflict (tenant_id, nfe_id, n_item) do update set
      c_prod = coalesce(excluded.c_prod, nfe_inbound_items.c_prod), x_prod = coalesce(excluded.x_prod, nfe_inbound_items.x_prod),
      ncm = coalesce(excluded.ncm, nfe_inbound_items.ncm), cfop = coalesce(excluded.cfop, nfe_inbound_items.cfop), u_com = coalesce(excluded.u_com, nfe_inbound_items.u_com),
      q_com = excluded.q_com, v_un_com = excluded.v_un_com, v_prod = excluded.v_prod, u_trib = coalesce(excluded.u_trib, nfe_inbound_items.u_trib),
      q_trib = coalesce(excluded.q_trib, nfe_inbound_items.q_trib), v_icms = excluded.v_icms, v_icms_st = excluded.v_icms_st, v_ipi = excluded.v_ipi,
      v_pis = excluded.v_pis, v_cofins = excluded.v_cofins, v_ibs = excluded.v_ibs, v_cbs = excluded.v_cbs,
      classificacao = coalesce(x ->> 'classificacao', nfe_inbound_items.classificacao),
      material_id = coalesce(excluded.material_id, nfe_inbound_items.material_id), fator = coalesce(excluded.fator, nfe_inbound_items.fator),
      qtd_consumo = coalesce(excluded.qtd_consumo, nfe_inbound_items.qtd_consumo),
      purchase_order_item_id = coalesce(excluded.purchase_order_item_id, nfe_inbound_items.purchase_order_item_id);
  end loop;

  -- De-Para sugerido pelo cProd do fornecedor; fator/qtd_consumo derivados quando faltam.
  if v_supplier is not null then
    update public.nfe_inbound_items it set material_id = sm.material_id, fator = coalesce(sm.fator, m.fator_conversao), qtd_consumo = it.q_com * coalesce(sm.fator, m.fator_conversao)
      from public.supplier_materials sm join public.materials m on m.id = sm.material_id
     where it.nfe_id = v_id and it.material_id is null and it.c_prod is not null and sm.tenant_id = p_tenant_id and sm.supplier_id = v_supplier
       and sm.codigo_fornecedor = it.c_prod and m.deleted_at is null;
  end if;
  update public.nfe_inbound_items it set fator = coalesce(it.fator, m.fator_conversao), qtd_consumo = coalesce(it.qtd_consumo, it.q_com * coalesce(it.fator, m.fator_conversao))
    from public.materials m where it.nfe_id = v_id and it.material_id = m.id and (it.fator is null or it.qtd_consumo is null);

  if p_nfe ? 'po_ids' and jsonb_typeof(p_nfe -> 'po_ids') = 'array' then
    delete from public.nfe_po_links where nfe_id = v_id;
    insert into public.nfe_po_links (tenant_id, nfe_id, purchase_order_id)
    select p_tenant_id, v_id, po.id from jsonb_array_elements_text(p_nfe -> 'po_ids') j join public.purchase_orders po on po.id = j::uuid and po.tenant_id = p_tenant_id
    on conflict do nothing;
  end if;
  return v_id;
end $$;
revoke execute on function public.upsert_nfe_inbound(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.upsert_nfe_inbound(uuid, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- receive_nfe: transação de recebimento. p_itens: [{item_id, material_id, fator, qtd_consumo, purchase_order_item_id, divergente, motivo}]
-- custo = (v_prod + rateio de frete/outros − rateio de desconto) / qtd_consumo, rateado pelo v_prod de todos os itens da nota.
-- Recibo idempotente por 'nfe:<chave>' (a nota só é recebida uma vez; nota já recebida devolve o recibo existente sem erro).
-- p_idempotency_key é aceito por compatibilidade, mas a chave da nota manda.
-- ---------------------------------------------------------------------------
create or replace function public.receive_nfe(p_tenant_id uuid, p_nfe_id uuid, p_location_id uuid, p_itens jsonb, p_idempotency_key text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare n public.nfe_inbound%rowtype; it public.nfe_inbound_items%rowtype; poi public.purchase_order_items%rowtype; x jsonb; mv public.stock_moves%rowtype;
  v_receipt uuid; v_key text; v_base numeric; v_extra numeric; v_qtd numeric; v_fator numeric; v_custo numeric; v_move uuid; v_material uuid; v_po uuid;
begin
  perform public.assert_member(p_tenant_id, array['admin', 'compras', 'producao']::public.member_role[]);
  select * into n from public.nfe_inbound where id = p_nfe_id and tenant_id = p_tenant_id for update;
  if n.id is null then raise exception 'NF-e não encontrada' using errcode = '22023'; end if;
  if n.status = 'recebida' then
    select r.id into v_receipt from public.receipts r where r.tenant_id = p_tenant_id and r.nfe_id = n.id order by r.created_at limit 1;
    if v_receipt is null then raise exception 'NF-e marcada como recebida sem recibo: corrija pelo banco' using errcode = '22023'; end if;
    return v_receipt;
  end if;
  if n.status = 'ignorada' then raise exception 'NF-e ignorada não pode ser recebida' using errcode = '22023'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.tenant_id = p_tenant_id) then raise exception 'local não encontrado' using errcode = '22023'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'nenhum item para receber' using errcode = '22023'; end if;
  v_key := 'nfe:' || n.chave;
  select r.id into v_receipt from public.receipts r where r.tenant_id = p_tenant_id and r.idempotency_key = v_key;
  if v_receipt is not null then return v_receipt; end if;
  select coalesce(sum(i.v_prod), 0) into v_base from public.nfe_inbound_items i where i.nfe_id = n.id;
  v_extra := n.valor_frete + n.valor_outros - n.valor_desconto;
  insert into public.receipts (tenant_id, nfe_id, location_id, recebido_por, idempotency_key)
  values (p_tenant_id, n.id, p_location_id, auth.uid(), v_key) returning id into v_receipt;

  for x in select * from jsonb_array_elements(p_itens) loop
    select * into it from public.nfe_inbound_items i where i.id = (x ->> 'item_id')::uuid and i.nfe_id = n.id;
    if it.id is null then raise exception 'item % não pertence à NF-e', x ->> 'item_id' using errcode = '22023'; end if;
    v_material := coalesce((x ->> 'material_id')::uuid, it.material_id);
    if v_material is null or not exists (select 1 from public.materials m where m.id = v_material and m.tenant_id = p_tenant_id) then
      raise exception 'item % sem De-Para de insumo', it.n_item using errcode = '22023';
    end if;
    v_fator := coalesce(nullif((x ->> 'fator')::numeric, 0), it.fator, (select m.fator_conversao from public.materials m where m.id = v_material));
    v_qtd := coalesce(nullif((x ->> 'qtd_consumo')::numeric, 0), it.qtd_consumo, it.q_com * v_fator);
    if v_qtd is null or v_qtd <= 0 then raise exception 'item % com quantidade de consumo inválida', it.n_item using errcode = '22023'; end if;
    v_custo := round((it.v_prod + case when v_base > 0 then v_extra * it.v_prod / v_base else 0 end) / v_qtd, 4);
    if v_custo < 0 then raise exception 'item % com custo unitário negativo (desconto maior que o valor)', it.n_item using errcode = '22023'; end if;
    select * into poi from public.purchase_order_items i where i.id = coalesce((x ->> 'purchase_order_item_id')::uuid, it.purchase_order_item_id) and i.tenant_id = p_tenant_id for update;
    if poi.id is not null and poi.material_id <> v_material then raise exception 'item % da OC é de outro insumo', poi.id using errcode = '22023'; end if;

    insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, created_by)
    values (p_tenant_id, v_material, p_location_id, 'entrada_nfe', v_qtd, v_custo, round(v_qtd * v_custo, 2), 'nfe', n.id, 'NF-e ' || coalesce(n.numero::text, n.chave), 'nfe:' || n.chave || ':' || it.n_item, auth.uid())
    on conflict (tenant_id, idempotency_key) do nothing returning id into v_move;
    if v_move is not null then
      perform public.apply_stock_delta(p_tenant_id, v_material, p_location_id, v_qtd, v_custo);
    else
      -- Só aceita um movimento pré-existente se ele for de fato a entrada desta nota (nunca um movimento manual com a chave).
      select * into mv from public.stock_moves where tenant_id = p_tenant_id and idempotency_key = 'nfe:' || n.chave || ':' || it.n_item;
      if mv.ref_type is distinct from 'nfe' or mv.ref_id is distinct from n.id or mv.move_type <> 'entrada_nfe' then
        raise exception 'chave de idempotência do item % já usada por outro movimento', it.n_item using errcode = '23505';
      end if;
      v_move := mv.id;
    end if;
    update public.nfe_inbound_items set material_id = v_material, fator = v_fator, qtd_consumo = v_qtd, purchase_order_item_id = poi.id where id = it.id;
    insert into public.receipt_items (tenant_id, receipt_id, purchase_order_item_id, material_id, qtd_compra, qtd_consumo, custo_unit_consumo, divergente, motivo_divergencia, stock_move_id)
    values (p_tenant_id, v_receipt, poi.id, v_material, it.q_com, v_qtd, v_custo, coalesce((x ->> 'divergente')::boolean, false), x ->> 'motivo', v_move);
    if poi.id is not null then
      update public.purchase_order_items set qtd_recebida = qtd_recebida + v_qtd / poi.fator where id = poi.id;
      insert into public.nfe_po_links (tenant_id, nfe_id, purchase_order_id) values (p_tenant_id, n.id, poi.purchase_order_id) on conflict do nothing;
    end if;
    -- Aprende o De-Para: o cProd deste fornecedor passa a apontar para o insumo recebido.
    if n.supplier_id is not null and it.c_prod is not null then
      delete from public.supplier_materials where tenant_id = p_tenant_id and supplier_id = n.supplier_id and codigo_fornecedor = it.c_prod and material_id <> v_material;
      insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor, unidade_compra, fator, preco, ultimo_uso)
      values (p_tenant_id, n.supplier_id, v_material, it.c_prod, it.u_com, v_fator, it.v_un_com, now())
      on conflict (tenant_id, supplier_id, material_id) do update set codigo_fornecedor = excluded.codigo_fornecedor, unidade_compra = excluded.unidade_compra,
        fator = excluded.fator, preco = excluded.preco, ultimo_uso = now();
    end if;
  end loop;
  for v_po in select l.purchase_order_id from public.nfe_po_links l where l.nfe_id = n.id loop
    perform public.refresh_purchase_order_status(v_po);
  end loop;
  update public.nfe_inbound set status = 'recebida' where id = n.id;
  return v_receipt;
end $$;
revoke execute on function public.receive_nfe(uuid, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.receive_nfe(uuid, uuid, uuid, jsonb, text) to authenticated;
