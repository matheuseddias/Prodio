-- Seed de compras, integrações e comercial para o tenant Eddias (roda depois de seed.sql; dados de apps/web/src/domain/mock.ts).
-- Idempotente: ids fixos + on conflict do nothing; movimentos de estoque só atualizam o saldo quando inseridos de fato.
-- Ids: OCs 0c000000-…-0N, itens de OC 0c100000-…-0N, NF-es 0e000000-…-0N, itens de NF-e 0e100000-…-NN, conectores 0d000000-…-0N,
-- canais 0a000000-…-0N, sessão de inventário 0b000000-…-01, recibo 0f000000-…-01, avisos 09000000-…-0N.

-- ---------------------------------------------------------------------------
-- Ordens de compra (numeração já usada: contador salta para 1044)
-- ---------------------------------------------------------------------------
insert into public.purchase_orders (id, tenant_id, numero, supplier_id, location_id, status, entrega_prevista, condicao_pagamento, observacao, total, created_by, created_at) values
  ('0c000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1041, 'c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aberta', current_date, '{28,42}', null, 3813.68, '22222222-2222-2222-2222-222222222222', now() - interval '6 days'),
  ('0c000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1042, 'c0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aberta', current_date, '{21}', null, 2525.40, '22222222-2222-2222-2222-222222222222', now() - interval '4 days'),
  ('0c000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 1039, 'c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'parcial', current_date - 2, '{30,60}', 'Entrega parcial combinada com a Renata', 11056.70, '22222222-2222-2222-2222-222222222222', now() - interval '14 days'),
  ('0c000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 1043, 'c0000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'aberta', current_date + 2, '{0}', null, 92.40, '22222222-2222-2222-2222-222222222222', now() - interval '1 day'),
  ('0c000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 1035, 'c0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'recebida', current_date - 12, '{30}', null, 1659.00, '22222222-2222-2222-2222-222222222222', now() - interval '25 days'),
  ('0c000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 1030, 'c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'cancelada', null, '{30,60}', 'Cancelada: fornecedor sem estoque', 828.00, '22222222-2222-2222-2222-222222222222', now() - interval '40 days')
on conflict (id) do nothing;

insert into public.purchase_order_items (id, tenant_id, purchase_order_id, material_id, unidade_compra, fator, qtd, qtd_recebida, preco, ipi_pct) values
  ('0c100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'un', 7.7, 12, 0, 257.40, 0.10),
  ('0c100000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000009', 'un', 1, 800, 0, 0.52, 0),
  ('0c100000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000006', 'cx', 20, 30, 0, 73.20, 0.15),
  ('0c100000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'rl', 70, 3, 1, 2067.10, 0),
  ('0c100000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004', 'rl', 50, 4, 4, 1103.50, 0.10),
  ('0c100000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000011', 'ct', 100, 40, 0, 2.31, 0),
  ('0c100000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000007', 'cx', 1, 3, 3, 553.00, 0),
  ('0c100000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '0c000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000012', 'rl', 50, 2, 0, 414.00, 0)
on conflict (id) do nothing;

insert into public.doc_counters (tenant_id, kind, next_value) values ('11111111-1111-1111-1111-111111111111', 'oc', 1044)
on conflict (tenant_id, kind) do update set next_value = greatest(public.doc_counters.next_value, excluded.next_value);

-- ---------------------------------------------------------------------------
-- NF-es de entrada
-- ---------------------------------------------------------------------------
insert into public.nfe_inbound (id, tenant_id, chave, numero, serie, cnpj_emitente, emitente, supplier_id, emissao, valor_total, valor_frete, origem, status, motivo_ignorada, fin_nfe, cstat, created_at) values
  ('0e000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '35260912345678000190550010000482111000482119', 48211, 1, '12345678000190', 'Vidros Guarulhos Ltda', 'c0000000-0000-0000-0000-000000000001', current_date - 1, 3504.80, 0, 'email', 'pendente', null, '1', '100', now() - interval '1 day'),
  ('0e000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '35260934567890000112550010000091020000091025', 9102, 1, '34567890000112', 'Embalagens Paulista', 'c0000000-0000-0000-0000-000000000003', current_date, 2196.00, 0, 'upload', 'pendente', null, '1', '100', now() - interval '3 hours'),
  ('0e000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '35260923456789000101550020000007740000007741', 774, 2, '23456789000101', 'Montana Tecidos Sintéticos', 'c0000000-0000-0000-0000-000000000002', current_date - 2, 4134.20, 0, 'erp', 'pendente', null, '1', '100', now() - interval '2 days'),
  ('0e000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '35260956789012000134550010000120330000120338', 12033, 1, '56789012000134', 'Ferragens & Cia', 'c0000000-0000-0000-0000-000000000005', current_date, 92.40, 0, 'sem_xml', 'aguardando_xml', null, null, null, now() - interval '1 hour'),
  ('0e000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '35260945678901000123550010000031100000031104', 3110, 1, '45678901000123', 'Promabonde Adesivos', 'c0000000-0000-0000-0000-000000000004', current_date - 13, 1659.00, 0, 'email', 'recebida', null, '1', '100', now() - interval '13 days'),
  ('0e000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '35260912345678000190550010000481900000481905', 48190, 1, '12345678000190', 'Vidros Guarulhos Ltda', 'c0000000-0000-0000-0000-000000000001', current_date - 3, 120.00, 0, 'email', 'ignorada', 'Remessa para conserto (CFOP 5915), não é compra', '1', '100', now() - interval '3 days')
on conflict (tenant_id, chave) do nothing;

insert into public.nfe_inbound_items (id, tenant_id, nfe_id, n_item, c_prod, x_prod, ncm, cfop, u_com, q_com, v_un_com, v_prod, v_icms, v_ipi, classificacao, material_id, fator, qtd_consumo, purchase_order_item_id) values
  ('0e100000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000001', 1, 'CH3MM-321', 'CHAPA ESPELHO 3MM 3210X2400', '70099100', '5401', 'PC', 12, 257.40, 3088.80, 555.98, 308.88, 'compra', 'b0000000-0000-0000-0000-000000000001', 7.7, 92.4, '0c100000-0000-0000-0000-000000000001'),
  ('0e100000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000001', 2, 'MDF370', 'DISCO MDF 370X370X8MM', '44111400', '5102', 'UN', 800, 0.52, 416.00, 74.88, 0, 'compra', 'b0000000-0000-0000-0000-000000000009', 1, 800, '0c100000-0000-0000-0000-000000000002'),
  ('0e100000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000002', 1, 'CX-ESP-50', 'CAIXA PAPELAO ESPELHO 50', '48191000', '5102', 'CX', 30, 73.20, 2196.00, 0, 0, 'compra', 'b0000000-0000-0000-0000-000000000006', 20, 600, '0c100000-0000-0000-0000-000000000003'),
  ('0e100000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000003', 1, 'ROCKL-PT-140', 'TECIDO SINTETICO ROCKL PRETO 1,40', '59031000', '6102', 'RL', 2, 2067.10, 4134.20, 496.10, 0, 'compra', null, null, null, null),
  ('0e100000-0000-0000-0000-000000000051', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000005', 1, '793-CX100', 'ADESIVO PROMABONDE 793 CX 100', '35069190', '5102', 'CX', 3, 553.00, 1659.00, 298.62, 0, 'compra', 'b0000000-0000-0000-0000-000000000007', 1, 3, '0c100000-0000-0000-0000-000000000007'),
  ('0e100000-0000-0000-0000-000000000061', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000006', 1, 'SERV-CORTE', 'REMESSA PARA CONSERTO', '70099100', '5915', 'UN', 1, 120.00, 120.00, 0, 0, 'ignorar', null, null, null, null)
on conflict (id) do nothing;

insert into public.nfe_po_links (tenant_id, nfe_id, purchase_order_id) values
  ('11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000001', '0c000000-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000002', '0c000000-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000003', '0c000000-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000004', '0c000000-0000-0000-0000-000000000004'),
  ('11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000005', '0c000000-0000-0000-0000-000000000005')
on conflict do nothing;

-- Recebimento da NF-e 3110 (13 dias atrás): entrada no ledger + saldo (só quando o movimento é inserido de fato).
with mv as (
  insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, created_by, created_at)
  values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', 'entrada_nfe', 3, 553.00, 1659.00, 'nfe', '0e000000-0000-0000-0000-000000000005', 'NF-e 3110', 'nfe:35260945678901000123550010000031100000031104:1', '22222222-2222-2222-2222-222222222222', now() - interval '13 days')
  on conflict (tenant_id, idempotency_key) do nothing
  returning tenant_id, material_id, location_id, delta, custo_unit)
update public.stock_balances b set saldo = b.saldo + mv.delta,
  custo_medio = case when b.saldo + mv.delta > 0 then round((b.saldo * b.custo_medio + mv.delta * mv.custo_unit) / (b.saldo + mv.delta), 4) else b.custo_medio end, updated_at = now()
  from mv where b.tenant_id = mv.tenant_id and b.material_id = mv.material_id and b.location_id = mv.location_id;

insert into public.receipts (id, tenant_id, nfe_id, purchase_order_id, location_id, recebido_por, idempotency_key, created_at)
values ('0f000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '0e000000-0000-0000-0000-000000000005', '0c000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'nfe:35260945678901000123550010000031100000031104:1', now() - interval '13 days')
on conflict (id) do nothing;
insert into public.receipt_items (tenant_id, receipt_id, purchase_order_item_id, material_id, qtd_compra, qtd_consumo, custo_unit_consumo, stock_move_id)
select '11111111-1111-1111-1111-111111111111', '0f000000-0000-0000-0000-000000000001', '0c100000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000007', 3, 3, 553.00, m.id
  from public.stock_moves m where m.tenant_id = '11111111-1111-1111-1111-111111111111' and m.idempotency_key = 'nfe:35260945678901000123550010000031100000031104:1'
   and not exists (select 1 from public.receipt_items r where r.receipt_id = '0f000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Conectores: BaseLinker conectado (config + mapa de status + sync_state + outbox + hub + auditoria); os demais desconectados.
-- ---------------------------------------------------------------------------
insert into public.connectors (id, tenant_id, plataforma, nome, status, config, ultimo_sync) values
  ('0d000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'baselinker', 'Base.com (BaseLinker)', 'conectado', '{"inventory_id": 24384, "warehouse_id": "bl_1", "push_estoque": true, "modo_estoque": "delta", "dry_run": false, "intervalo_min": 5, "pedidos_24h": 412}', now() - interval '4 minutes'),
  ('0d000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'bling', 'Bling', 'desconectado', '{"push_estoque": true}', null),
  ('0d000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'tiny', 'Tiny / Olist', 'desconectado', '{"push_estoque": true}', null),
  ('0d000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'omie', 'Omie', 'desconectado', '{"push_estoque": true}', null),
  ('0d000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'magis5', 'Magis5', 'desconectado', '{"push_estoque": false}', null)
on conflict (id) do nothing;

insert into public.connector_status_map (tenant_id, connector_id, status_externo, significado) values
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'new', 'demanda'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'paid', 'demanda'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'confirmed', 'carteira'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'packed', 'carteira'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'shipped', 'enviado'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'delivered', 'enviado'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'cancelled', 'cancelado'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'returned', 'ignorar')
on conflict do nothing;

insert into public.sync_state (connector_id, tenant_id, cursor, last_run_at, last_ok_at, runs)
values ('0d000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', jsonb_build_object('date_confirmed_from', extract(epoch from now() - interval '10 minutes')::bigint), now() - interval '4 minutes', now() - interval '4 minutes', 288)
on conflict (connector_id) do nothing;

insert into public.integration_outbox (tenant_id, connector_id, product_id, delta, dedupe_key, status, erro, tentativas, created_at, applied_at) values
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 12, 'seed:ob1', 'pendente', null, 0, now() - interval '25 minutes', null),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 3, 'seed:ob2', 'pendente', null, 0, now() - interval '24 minutes', null),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 8, 'seed:ob3', 'pendente', null, 0, now() - interval '23 minutes', null),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 20, 'seed:ob4', 'aplicado', null, 1, now() - interval '90 minutes', now() - interval '85 minutes'),
  ('11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 5, 'seed:ob5', 'erro', 'SKU não encontrado no inventário 24384', 1, now() - interval '2 hours', null)
on conflict (tenant_id, connector_id, dedupe_key) do nothing;

-- Pedidos dos últimos 14 dias (1 por dia; os 2 mais recentes ainda em carteira) com itens dos principais SKUs.
insert into public.orders (tenant_id, connector_id, external_id, external_status, significado, confirmed_at, updated_at_external, total, raw)
select '11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', 'seed:bl:' || d,
       case when d < 2 then 'confirmed' else 'paid' end, case when d < 2 then 'carteira' else 'demanda' end,
       now() - make_interval(days => d, hours => 3), now() - make_interval(days => d, hours => 2), 2890 + (d * 137) % 900, jsonb_build_object('seed', true)
  from generate_series(0, 13) d
on conflict (tenant_id, connector_id, external_id) do nothing;
insert into public.order_items (tenant_id, order_id, sku_externo, product_id, quantidade, preco)
select o.tenant_id, o.id, x.sku, p.id, x.qtd + (extract(day from o.confirmed_at)::int * x.salto) % 7, x.preco
  from public.orders o
  join (values ('ED000130', 'TM000076', 20, 3, 129.90), ('ED000127', 'TM000073', 15, 2, 169.90), ('ED000215', 'TM000079', 5, 1, 229.90),
               ('ED000001', 'ED000001', 12, 4, 49.90), ('ED000008', 'ED000008', 6, 2, 49.90)) as x(sku, product_sku, qtd, salto, preco) on true
  join public.products p on p.tenant_id = o.tenant_id and p.sku = x.product_sku
 where o.tenant_id = '11111111-1111-1111-1111-111111111111' and o.external_id like 'seed:bl:%'
   and not exists (select 1 from public.order_items i where i.order_id = o.id);

insert into public.hub_stock_snapshots (tenant_id, connector_id, product_id, saldo_hub, capturado_em)
select '11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', p.id, x.saldo, now() - interval '6 hours'
  from (values ('TM000076', 212), ('TM000073', 96), ('TM000079', 14), ('TM000091', 140), ('ED000001', 388), ('ED000008', 120), ('ED000002', 77), ('ED000010', 260)) as x(sku, saldo)
  join public.products p on p.tenant_id = '11111111-1111-1111-1111-111111111111' and p.sku = x.sku
on conflict (tenant_id, connector_id, product_id) do nothing;

insert into public.audit_runs (id, tenant_id, connector_id, executado_em, divergencias) values
  ('0d100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '0d000000-0000-0000-0000-000000000001', now() - interval '6 hours',
   '[{"sku": "ED000002", "product_id": "a0000000-0000-0000-0000-000000000007", "saldo_hub": 77, "saldo_anterior": 80, "bipado_hoje": 2, "esperado": 82, "diferenca": -5}]')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Canais de venda e preços por canal (percentuais em fração)
-- ---------------------------------------------------------------------------
insert into public.channels (id, tenant_id, nome, preset, ativo, comissao_pct, taxa_fixa, taxa_fixa_abaixo_de, frete_vendedor, frete_gratis_acima_de, imposto_venda_pct, ads_pct, parcelamento_pct, outros_pct, observacao) values
  ('0a000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Mercado Livre · Clássico', 'mercadolivre', true, 0.12, 6, 79, '[{"ateKg":0.3,"valor":0},{"ateKg":0.5,"valor":21.9},{"ateKg":1,"valor":23.9},{"ateKg":2,"valor":25.9},{"ateKg":3,"valor":27.9},{"ateKg":5,"valor":33.9},{"ateKg":9,"valor":51.9}]', 79, 0.06, 0.03, 0, 0, 'Reputação verde. Confira a tabela vigente de Custo dos Envios.'),
  ('0a000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Shopee', 'shopee', true, 0.20, 4, null, '[]', null, 0.06, 0.02, 0, 0, 'Comissão + programa de frete grátis. Taxa fixa por item vendido.'),
  ('0a000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Amazon · FBA', 'amazon', true, 0.15, 0, null, '[{"ateKg":0.5,"valor":14.9},{"ateKg":1,"valor":17.9},{"ateKg":2,"valor":21.9},{"ateKg":5,"valor":29.9}]', null, 0.06, 0.04, 0, 0, 'Tarifa FBA por peso faturável.'),
  ('0a000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'TikTok Shop', 'tiktok', false, 0.08, 0, null, '[]', null, 0.06, 0.05, 0, 0, null),
  ('0a000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Atacado · loja própria', 'atacado', true, 0, 0, null, '[]', null, 0.06, 0, 0.025, 0.01, 'Cliente retira. Parcelamento no cartão.')
on conflict (id) do nothing;

insert into public.product_prices (tenant_id, product_id, channel_id, preco)
select '11111111-1111-1111-1111-111111111111', p.id, x.canal::uuid, x.preco
  from (values
    ('TM000076', '0a000000-0000-0000-0000-000000000001', 129.90), ('TM000076', '0a000000-0000-0000-0000-000000000002', 119.90),
    ('TM000073', '0a000000-0000-0000-0000-000000000001', 169.90), ('TM000073', '0a000000-0000-0000-0000-000000000002', 159.90),
    ('TM000079', '0a000000-0000-0000-0000-000000000001', 229.90), ('TM000091', '0a000000-0000-0000-0000-000000000001', 134.90),
    ('ED000001', '0a000000-0000-0000-0000-000000000001', 49.90), ('ED000001', '0a000000-0000-0000-0000-000000000002', 44.90), ('ED000001', '0a000000-0000-0000-0000-000000000003', 54.90),
    ('ED000008', '0a000000-0000-0000-0000-000000000001', 49.90), ('ED000008', '0a000000-0000-0000-0000-000000000002', 44.90),
    ('ED000002', '0a000000-0000-0000-0000-000000000001', 49.90), ('ED000010', '0a000000-0000-0000-0000-000000000002', 14.90)
  ) as x(sku, canal, preco)
  join public.products p on p.tenant_id = '11111111-1111-1111-1111-111111111111' and p.sku = x.sku
on conflict (tenant_id, product_id, channel_id) do nothing;

-- ---------------------------------------------------------------------------
-- Inventário fechado há 7 dias: MP0078 bateu, MP0059 contou 4 a menos (ajuste), MP0067 bateu.
-- ---------------------------------------------------------------------------
insert into public.inventory_sessions (id, tenant_id, location_id, status, aberta_por, aberta_em, fechada_em, observacao)
values ('0b000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'fechada', '22222222-2222-2222-2222-222222222222', now() - interval '7 days 2 hours', now() - interval '7 days', 'Contagem semanal de chapas e discos')
on conflict (id) do nothing;
with mv as (
  insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, ref_type, ref_id, motivo, idempotency_key, created_by, created_at)
  values ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'ajuste', -4, 0.52, -2.08, 'inventory_session', '0b000000-0000-0000-0000-000000000001', 'Inventário: 4 discos trincados', 'inv:0b000000-0000-0000-0000-000000000001:b0000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', now() - interval '7 days')
  on conflict (tenant_id, idempotency_key) do nothing
  returning tenant_id, material_id, location_id, delta)
update public.stock_balances b set saldo = b.saldo + mv.delta, updated_at = now()
  from mv where b.tenant_id = mv.tenant_id and b.material_id = mv.material_id and b.location_id = mv.location_id;
insert into public.inventory_items (tenant_id, session_id, material_id, saldo_sistema, contado, pecas, motivo, stock_move_id)
select '11111111-1111-1111-1111-111111111111', '0b000000-0000-0000-0000-000000000001', m.id, x.saldo, x.contado, '[]', x.motivo,
       (select mv.id from public.stock_moves mv where mv.tenant_id = '11111111-1111-1111-1111-111111111111' and mv.idempotency_key = 'inv:0b000000-0000-0000-0000-000000000001:' || m.id)
  from (values ('MP0078', 61.4, 61.4, null), ('MP0059', 380, 376, '4 discos trincados'), ('MP0067', 1900, 1900, null)) as x(sku, saldo, contado, motivo)
  join public.materials m on m.tenant_id = '11111111-1111-1111-1111-111111111111' and m.sku = x.sku
on conflict (tenant_id, session_id, material_id) do nothing;

-- ---------------------------------------------------------------------------
-- Avisos e configuração de avisos
-- ---------------------------------------------------------------------------
insert into public.notifications (id, tenant_id, tipo, texto, lida, created_at) values
  ('09000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'minimo', 'Montana Rockl Preto cruzou o mínimo (18,5 m² de 30)', false, date_trunc('day', now()) + interval '9 hours 2 minutes'),
  ('09000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'minimo', 'Caixa embalagem espelho 50cm cruzou o mínimo (140 de 200)', false, now() - interval '1 day'),
  ('09000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'oc_atrasada', 'OC 1039 (Montana) atrasada há 2 dias, 1 de 3 rolos recebidos', false, now() - interval '1 day 4 hours'),
  ('09000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'nfe', 'NF-e 774 (Montana) tem 1 item sem De-Para', true, now() - interval '2 days'),
  ('09000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'conector', 'Base.com: 1 item do outbox com erro (SKU ED000002)', false, now() - interval '2 hours'),
  ('09000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'cadastro', 'Espelho Orgânico Nuvem 50cm vendeu 34 un e não tem ficha', true, now() - interval '5 hours'),
  ('09000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'inventario', 'Inventário do Galpão Vila Galvão fechado com 1 ajuste', true, now() - interval '7 days')
on conflict (id) do nothing;

insert into public.notification_settings (tenant_id, config)
values ('11111111-1111-1111-1111-111111111111', '{"eventos": {"minimo": {"email": true}, "oc_atrasada": {"email": true}, "nfe": {"email": false}, "conector": {"email": true}, "cadastro": {"email": false}}, "webhooks": []}')
on conflict (tenant_id) do nothing;
