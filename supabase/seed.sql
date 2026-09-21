-- Seed de desenvolvimento: tenant Eddias com cadastros, fichas, plano do dia, saldos, operadores e aparelho.
-- Idempotente: pode rodar várias vezes (on conflict do nothing / where not exists). Ids fixos para as fatias se referirem.
-- Roda como dono do banco (bypass de RLS); os saldos entram direto no ledger como saldo_inicial.

-- Usuários (só id e email: funciona no stub e no Supabase).
insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'matheus@eddias.com.br') on conflict (id) do nothing;
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', null) on conflict (id) do nothing;

insert into public.tenants (id, slug, nome, cnpj, regime, credita_impostos, fuso, hora_virada, dias_uteis_mes, margem_projecao, dias_cobertura, margem_alvo_padrao, exigir_projecao_para_imprimir)
values ('11111111-1111-1111-1111-111111111111', 'eddias', 'Eddias Home', '44664451000107', 'real', false, 'America/Sao_Paulo', '05:00', 22, 0.10, 15, 0.20, true)
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role, nome, accepted_at)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'admin', 'Matheus Moreno', now())
on conflict (tenant_id, user_id) do nothing;
insert into public.user_active_tenant (user_id, tenant_id)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111')
on conflict (user_id) do nothing;

insert into public.locations (id, tenant_id, nome, kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Galpão Vila Galvão', 'fabrica'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Galpão Pedro de Souza', 'fabrica')
on conflict (id) do nothing;

insert into public.units (tenant_id, code, nome, kind) values
  ('11111111-1111-1111-1111-111111111111', 'un', 'Unidade', 'unidade'),
  ('11111111-1111-1111-1111-111111111111', 'm', 'Metro', 'comprimento'),
  ('11111111-1111-1111-1111-111111111111', 'm2', 'Metro quadrado', 'area'),
  ('11111111-1111-1111-1111-111111111111', 'kg', 'Quilograma', 'peso'),
  ('11111111-1111-1111-1111-111111111111', 'g', 'Grama', 'peso'),
  ('11111111-1111-1111-1111-111111111111', 'cx', 'Caixa', 'unidade'),
  ('11111111-1111-1111-1111-111111111111', 'rl', 'Rolo', 'unidade'),
  ('11111111-1111-1111-1111-111111111111', 'ct', 'Cento', 'unidade')
on conflict (tenant_id, code) do nothing;

-- Produtos (ids a0000000-…-01 a 11, na ordem de apps/web/src/domain/mock.ts).
insert into public.products (id, tenant_id, sku, nome, familia, atributos, ean, ncm, status, peso_kg, peso_cubado_kg) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'TM000076', 'Espelho Redondo Adnet 40cm', 'Espelho', '{"cor":"Preto","tamanho":"40cm"}', '7898676461347', '7009.91.00', 'ativo', 1.9, 2.4),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'TM000073', 'Espelho Redondo Adnet 50cm', 'Espelho', '{"cor":"Preto","tamanho":"50cm"}', '7898676463402', '7009.91.00', 'ativo', 2.8, 3.6),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'TM000079', 'Espelho Redondo Adnet 60cm', 'Espelho', '{"cor":"Preto","tamanho":"60cm"}', null, null, 'ativo', 3.9, 5.1),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'TM000091', 'Espelho Redondo Adnet 40cm', 'Espelho', '{"cor":"Caramelo","tamanho":"40cm"}', null, null, 'ativo', 1.9, 2.4),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'ED000001', 'Mouse Pad Desk Pad 90x40', 'Mousepad', '{"cor":"Preto","tamanho":"90x40"}', '7898676460951', '5603.94.10', 'ativo', 0.45, 0.9),
  ('a0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'ED000008', 'Mouse Pad Desk Pad 90x40', 'Mousepad', '{"cor":"Caramelo","tamanho":"90x40"}', null, null, 'ativo', 0.45, 0.9),
  ('a0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'ED000002', 'Mouse Pad Desk Pad 90x40', 'Mousepad', '{"cor":"Grafite","tamanho":"90x40"}', null, null, 'ativo', 0.45, 0.9),
  ('a0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'ED000010', 'Mouse Pad 20x20', 'Mousepad', '{"cor":"Caramelo","tamanho":"20x20"}', null, null, 'ativo', 0.08, 0.2),
  ('a0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'TM000120', 'Espelho Orgânico Nuvem 50cm', 'Espelho', '{"cor":"Off White","tamanho":"50cm"}', null, null, 'ativo', null, null),
  ('a0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'ED000707', 'Kit Jogo Americano 4 peças', 'Mesa', '{"cor":"Preto"}', null, null, 'ativo', null, null),
  ('a0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'TM000200', 'Bandeja Espelhada 30cm', 'Bandeja', '{"cor":"Dourado","tamanho":"30cm"}', null, null, 'inativo', null, null)
on conflict (id) do nothing;

insert into public.sku_aliases (tenant_id, product_id, sku_externo) values
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 'ED000130'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 'ED000127'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000003', 'ED000215'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000004', 'ED000240'),
  ('11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000009', 'ED000376')
on conflict (tenant_id, sku_externo) do nothing;

-- Fornecedores (c0000000-…-01 a 05).
insert into public.suppliers (id, tenant_id, nome, cnpj, regime, lead_time_dias, condicao_pagamento, contato) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Vidros Guarulhos Ltda', '12345678000190', 'normal', 7, '{28,42}', 'Marcos'),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Montana Tecidos Sintéticos', '23456789000101', 'normal', 12, '{30,60}', 'Renata'),
  ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Embalagens Paulista', '34567890000112', 'simples', 5, '{21}', 'Sérgio'),
  ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Promabonde Adesivos', '45678901000123', 'normal', 10, '{30}', 'Luciana'),
  ('c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Ferragens & Cia', '56789012000134', 'simples', 3, '{0}', 'Paulo')
on conflict (id) do nothing;

-- Insumos (b0000000-…-01 a 13). custo_referencia = custo médio do mock.
insert into public.materials (id, tenant_id, sku, nome, ncm, unidade_compra, unidade_consumo, fator_conversao, minimo, custo_referencia, fornecedor_padrao_id, lead_time_dias) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'MP0078', 'Chapa espelho 3mm 3,21x2,4', '7009.91.00', 'un', 'm2', 7.7, 40, 33.43, 'c0000000-0000-0000-0000-000000000001', 7),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'MP0040', 'Montana Rockl Preto', null, 'rl', 'm2', 70, 30, 29.53, 'c0000000-0000-0000-0000-000000000002', 12),
  ('b0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'MP0117', 'EBF Montave Caramelo 1,7mm', null, 'rl', 'm', 50, 60, 22.07, 'c0000000-0000-0000-0000-000000000002', 12),
  ('b0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'MP0068', 'EBF Montave Preto 1,7mm', null, 'rl', 'm', 50, 80, 22.07, 'c0000000-0000-0000-0000-000000000002', 12),
  ('b0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'MP0064', 'Caixa embalagem espelho 40cm', null, 'cx', 'un', 25, 300, 2.54, 'c0000000-0000-0000-0000-000000000003', 5),
  ('b0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'MP0063', 'Caixa embalagem espelho 50cm', null, 'cx', 'un', 20, 200, 3.66, 'c0000000-0000-0000-0000-000000000003', 5),
  ('b0000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'MP0072', 'Cola Promabonde 793 (cx 100 tubos)', null, 'cx', 'cx', 1, 2, 411.51, 'c0000000-0000-0000-0000-000000000004', 10),
  ('b0000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'MP0056', 'Disco MDF 470x470x8', null, 'un', 'un', 1, 400, 1.07, 'c0000000-0000-0000-0000-000000000001', 7),
  ('b0000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'MP0059', 'Disco MDF 370x370x8', null, 'un', 'un', 1, 400, 0.52, 'c0000000-0000-0000-0000-000000000001', 7),
  ('b0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'MP0061', 'Parafuso chipboard 4,0x40', null, 'ct', 'un', 100, 2000, 0.10, 'c0000000-0000-0000-0000-000000000005', 3),
  ('b0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'MP0067', 'Bucha plástica S6', null, 'ct', 'un', 100, 2000, 0.02, 'c0000000-0000-0000-0000-000000000005', 3),
  ('b0000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'MP0017', 'Suede Leggero Preto', null, 'rl', 'm', 50, 100, 8.28, 'c0000000-0000-0000-0000-000000000002', 12),
  ('b0000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'MP0033', 'Filamento PETG 1kg Preto', null, 'un', 'kg', 1, 4, 51.31, 'c0000000-0000-0000-0000-000000000005', 3)
on conflict (id) do nothing;

-- De-Para da NF-e (código do produto no fornecedor).
insert into public.supplier_materials (tenant_id, supplier_id, material_id, codigo_fornecedor, unidade_compra, fator, preco, aliq_icms, inteiro)
select '11111111-1111-1111-1111-111111111111', s.id, m.id, x.codigo, m.unidade_compra, m.fator_conversao, x.preco, x.icms, true
  from (values
    ('MP0078', 'c0000000-0000-0000-0000-000000000001', 'CH3MM-321', 257.40, 0.18),
    ('MP0056', 'c0000000-0000-0000-0000-000000000001', 'MDF470', 1.07, 0.18),
    ('MP0059', 'c0000000-0000-0000-0000-000000000001', 'MDF370', 0.52, 0.18),
    ('MP0040', 'c0000000-0000-0000-0000-000000000002', 'ROCKL-PT', 2067.10, 0.12),
    ('MP0117', 'c0000000-0000-0000-0000-000000000002', 'MONTAVE-CA', 1103.50, 0.12),
    ('MP0068', 'c0000000-0000-0000-0000-000000000002', 'MONTAVE-PT', 1103.50, 0.12),
    ('MP0017', 'c0000000-0000-0000-0000-000000000002', 'SUEDE-PT', 414.00, 0.12),
    ('MP0064', 'c0000000-0000-0000-0000-000000000003', 'CX-ESP-40', 63.50, 0.00),
    ('MP0063', 'c0000000-0000-0000-0000-000000000003', 'CX-ESP-50', 73.20, 0.00),
    ('MP0072', 'c0000000-0000-0000-0000-000000000004', '793-CX100', 553.00, 0.18),
    ('MP0061', 'c0000000-0000-0000-0000-000000000005', 'PAR-4040', 10.00, 0.00),
    ('MP0067', 'c0000000-0000-0000-0000-000000000005', 'BUCHA-S6', 2.31, 0.00),
    ('MP0033', 'c0000000-0000-0000-0000-000000000005', 'PETG-1KG', 51.31, 0.00)
  ) as x(sku, supplier_id, codigo, preco, icms)
  join public.materials m on m.tenant_id = '11111111-1111-1111-1111-111111111111' and m.sku = x.sku
  join public.suppliers s on s.id = x.supplier_id::uuid
on conflict (tenant_id, supplier_id, material_id) do nothing;

-- Fichas técnicas (4, ativas). perda_pct em fração (0.08 = 8%).
insert into public.bom_versions (id, tenant_id, product_id, versao, ativa, criado_por, observacao) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000001', 3, true, '22222222-2222-2222-2222-222222222222', 'seed'),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000002', 2, true, '22222222-2222-2222-2222-222222222222', 'seed'),
  ('d0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000005', 1, true, '22222222-2222-2222-2222-222222222222', 'seed'),
  ('d0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-000000000006', 1, true, '22222222-2222-2222-2222-222222222222', 'seed')
on conflict (id) do nothing;

insert into public.bom_lines (tenant_id, bom_version_id, ordem, tipo, material_id, consumo, unidade, perda_pct)
select '11111111-1111-1111-1111-111111111111', x.versao::uuid, x.ordem, 'insumo', m.id, x.consumo, m.unidade_consumo, x.perda
  from (values
    ('d0000000-0000-0000-0000-000000000001', 1, 'MP0059', 2, 0), ('d0000000-0000-0000-0000-000000000001', 2, 'MP0078', 0.16, 0.08),
    ('d0000000-0000-0000-0000-000000000001', 3, 'MP0040', 0.043, 0.05), ('d0000000-0000-0000-0000-000000000001', 4, 'MP0072', 0.00025, 0),
    ('d0000000-0000-0000-0000-000000000001', 5, 'MP0064', 1, 0), ('d0000000-0000-0000-0000-000000000001', 6, 'MP0061', 1, 0),
    ('d0000000-0000-0000-0000-000000000001', 7, 'MP0067', 1, 0), ('d0000000-0000-0000-0000-000000000001', 8, 'MP0033', 0.00416, 0),
    ('d0000000-0000-0000-0000-000000000002', 1, 'MP0056', 2, 0), ('d0000000-0000-0000-0000-000000000002', 2, 'MP0078', 0.25, 0.08),
    ('d0000000-0000-0000-0000-000000000002', 3, 'MP0040', 0.05, 0.05), ('d0000000-0000-0000-0000-000000000002', 4, 'MP0072', 0.00025, 0),
    ('d0000000-0000-0000-0000-000000000002', 5, 'MP0063', 1, 0), ('d0000000-0000-0000-0000-000000000002', 6, 'MP0061', 1, 0),
    ('d0000000-0000-0000-0000-000000000002', 7, 'MP0067', 1, 0),
    ('d0000000-0000-0000-0000-000000000005', 1, 'MP0068', 0.334, 0.03), ('d0000000-0000-0000-0000-000000000005', 2, 'MP0017', 0.309, 0.03),
    ('d0000000-0000-0000-0000-000000000006', 1, 'MP0117', 0.334, 0.03), ('d0000000-0000-0000-0000-000000000006', 2, 'MP0017', 0.309, 0.03)
  ) as x(versao, ordem, sku, consumo, perda)
  join public.materials m on m.tenant_id = '11111111-1111-1111-1111-111111111111' and m.sku = x.sku
 where not exists (select 1 from public.bom_lines l where l.bom_version_id = x.versao::uuid);

insert into public.label_profiles (tenant_id, familia, prefixo, tipos, unidades_por_caixa, instrucao_montagem) values
  ('11111111-1111-1111-1111-111111111111', 'Espelho', 'EH', '{produto,montagem}', 6, 'Fixar alça a 118 mm da borda · conferir lapidação'),
  ('11111111-1111-1111-1111-111111111111', 'Mousepad', 'ED', '{produto}', 20, null),
  ('11111111-1111-1111-1111-111111111111', 'Bandeja', 'EH', '{produto,caixa}', 4, null),
  ('11111111-1111-1111-1111-111111111111', 'Mesa', 'ED', '{produto}', 10, null)
on conflict (tenant_id, familia) do nothing;

-- Plano do dia (hoje) para 8 SKUs no Galpão Vila Galvão.
insert into public.daily_plans (tenant_id, dia, location_id, product_id, demanda_dia, projetado, carteira, saldo_hub, atualizado_por)
select '11111111-1111-1111-1111-111111111111', current_date, 'aaaaaaaa-0000-0000-0000-000000000001', p.id, x.demanda, x.projetado, x.carteira, x.hub, '22222222-2222-2222-2222-222222222222'
  from (values
    ('TM000076', 74, 80, 58, 212), ('TM000073', 71, 70, 49, 96), ('TM000079', 22, 25, 30, 14), ('TM000091', 18, 18, 12, 140),
    ('ED000001', 46, 50, 31, 388), ('ED000008', 24, 24, 9, 120), ('ED000002', 12, 12, 3, 77), ('ED000010', 5, 0, 0, 260)
  ) as x(sku, demanda, projetado, carteira, hub)
  join public.products p on p.tenant_id = '11111111-1111-1111-1111-111111111111' and p.sku = x.sku
on conflict (tenant_id, dia, location_id, product_id) do nothing;

-- Saldos iniciais: um movimento saldo_inicial por insumo + saldo consolidado.
insert into public.stock_moves (tenant_id, material_id, location_id, move_type, delta, custo_unit, valor, motivo, idempotency_key, created_by)
select '11111111-1111-1111-1111-111111111111', m.id, 'aaaaaaaa-0000-0000-0000-000000000001', 'saldo_inicial', x.saldo, x.custo, round(x.saldo * x.custo, 2), 'Saldo inicial (seed)', 'seed:saldo_inicial:' || m.sku, '22222222-2222-2222-2222-222222222222'
  from (values
    ('MP0078', 61.4, 33.43), ('MP0040', 18.5, 29.53), ('MP0117', 122, 22.07), ('MP0068', 41, 22.07), ('MP0064', 875, 2.54),
    ('MP0063', 140, 3.66), ('MP0072', 3.4, 411.51), ('MP0056', 1210, 1.07), ('MP0059', 380, 0.52), ('MP0061', 6400, 0.10),
    ('MP0067', 1900, 0.02), ('MP0017', 260, 8.28), ('MP0033', 6.2, 51.31)
  ) as x(sku, saldo, custo)
  join public.materials m on m.tenant_id = '11111111-1111-1111-1111-111111111111' and m.sku = x.sku
on conflict (tenant_id, idempotency_key) do nothing;

insert into public.stock_balances (tenant_id, material_id, location_id, saldo, custo_medio)
select mv.tenant_id, mv.material_id, mv.location_id, mv.delta, mv.custo_unit
  from public.stock_moves mv
 where mv.tenant_id = '11111111-1111-1111-1111-111111111111' and mv.idempotency_key like 'seed:saldo_inicial:%'
on conflict (tenant_id, material_id, location_id) do nothing;

-- Operadores (PIN 1234 / 2345 / 3456) e aparelho registrado a um usuário anônimo fixo.
insert into public.operators (id, tenant_id, nome, pin_hash) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Thiago', extensions.crypt('1234', extensions.gen_salt('bf'))),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Sérgio', extensions.crypt('2345', extensions.gen_salt('bf'))),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Lucas', extensions.crypt('3456', extensions.gen_salt('bf')))
on conflict (id) do nothing;

insert into public.devices (id, tenant_id, nome, location_id, device_user_id, registered_at)
values ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Celular linha 1', 'aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', now())
on conflict (id) do nothing;
insert into public.memberships (tenant_id, user_id, role, location_id, nome, accepted_at)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'dispositivo', 'aaaaaaaa-0000-0000-0000-000000000001', 'Celular linha 1', now())
on conflict (tenant_id, user_id) do nothing;
insert into public.user_active_tenant (user_id, tenant_id)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111')
on conflict (user_id) do nothing;
