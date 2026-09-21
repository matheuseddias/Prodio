# Prodio — contrato de schema

Colunas das tabelas de domínio. Quem escreve migration, repositório da web, worker ou seed segue isto. Convenções: `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null → tenants`, `created_at timestamptz default now()`, `updated_at` onde houver edição, `deleted_at timestamptz` nas tabelas de cadastro (soft delete). Chaves naturais são `unique (tenant_id, …)`. Todo `numeric` de quantidade é `numeric(14,4)`; de dinheiro é `numeric(14,2)`; de percentual é fração em `numeric(8,5)` (0.18 = 18%). A migration 0001 (`tenants`, `memberships`, `user_active_tenant`, `locations`, `units`, `doc_counters`, `audit_log`) é a referência de estilo; a 0002 traz `devices`, `operators`, `device_sessions`. Numeração das migrations: 0003 cadastros, 0004 estoque, 0005 produção, 0006 compras, 0007 NF-e, 0008 integrações, 0009 comercial e inventário (divididas para respeitar o limite de 400 linhas por arquivo; o ledger vem antes porque o bipe faz backflush nele; a NF-e vem depois dos recibos porque `receive_nfe` grava neles).

Regras transversais que toda migration segue (vêm da revisão de segurança; os testes `supabase/tests/0010–0012_seguranca_*.test.sql` cobrem cada uma):

- **Privilégios.** O Supabase concede ALL em toda tabela/função/sequência nova de `public` a `anon` e `authenticated` por default privileges. Logo depois de cada `create table` a migration faz `revoke all on table … from public, anon, authenticated` e só então concede o mínimo, inclusive por coluna (`operators.pin_hash`, `devices.pair_code`, `purchase_orders.status/total`, `notifications.texto` e `memberships.accepted_at` nunca são graváveis/legíveis pelo cliente). Sequências e funções de trigger também são revogadas. O stub de testes reproduz os default privileges, e o teste 0010 confere o catálogo inteiro contra uma lista explícita.
- **Referências entre tabelas do tenant são FKs compostas** `(tenant_id, x_id) references pai(tenant_id, id)` (todo pai tem `unique (tenant_id, id)`). Uma FK simples aceitaria o id de outro tenant em escrita direta (alias, De-Para, fornecedor padrão, local da membership) e virava oráculo de existência. `on delete set null (coluna)` (PostgreSQL 15+) quando o pai é opcional.
- **Toda RPC que recebe um id valida que ele é do tenant** (`upsert_operator`, `upsert_connector`, `reserve_label_batch`, `create_device`…); `default_location` só devolve local do tenant.
- **Namespaces das chaves de idempotência do ledger**: `manual:` (post_stock_move e recibos manuais: a chave do cliente é sempre prefixada), `nfe:`, `rcpt:`, `scan:`, `rev:`, `inv:`. `post_stock_move` também recusa `ref_type` reservado (`nfe`, `receipt`, `scan_event`, `inventory_session`). `reverse_stock_move` é idempotente pelo vínculo `reverses_id`, não pela chave.
- **Hook de token** roda como `supabase_auth_admin`: `memberships` e `user_active_tenant` têm policy de leitura para esse papel, e o hook só considera memberships aceitas (`accepted_at`), que o admin não grava; escolher o tenant em `set_active_tenant` é o aceite.
- **`production_date` é SECURITY INVOKER**: quem não é membro recebe `null` (sem oráculo de fuso/existência).

## 0002 · aparelhos e operadores

`devices` ganhou `pin_failures int` e `pin_locked_until timestamptz`. `register_device(p_pair_code)` exige sessão anônima (claim `is_anonymous` do JWT; helper `is_anonymous_user()`) e recusa usuário que já é membro com outro papel; `create_tenant` recusa anônimo. `upsert_operator` exige PIN em operador novo e recusa `p_id` de outro tenant. `set_operator(p_pin)` devolve **zero linhas** em PIN errado (conta a falha em `devices.pin_failures` e grava `audit_log` acao `pin_invalido`); na 5ª falha bloqueia o aparelho por 15 min e aí lança `28000`. `current_operator_id()` ignora operador inativo e aparelho revogado. Admin edita `devices.nome/location_id` direto.

## 0003 · cadastros

**products** — id, tenant_id, sku text, nome text, familia text, atributos jsonb `{cor, tamanho, …}`, ean text, ncm text, status text `ativo|inativo`, peso_kg numeric, peso_cubado_kg numeric, custo_manual numeric(14,4), deleted_at, created_at, updated_at. `unique (tenant_id, sku)`.

**sku_aliases** — id, tenant_id, product_id → products, sku_externo text, canal text (opcional: nome do conector/canal), created_at. `unique (tenant_id, sku_externo)`.

**materials** (insumos) — id, tenant_id, sku, nome, ncm, unidade_compra text → units.code, unidade_consumo text → units.code, fator_conversao numeric(14,6) check > 0, minimo numeric, custo_referencia numeric(14,4), fornecedor_padrao_id → suppliers, lead_time_dias int, controla_lote boolean default false, tamanhos_padrao jsonb (lista `{nome, medida}` para contagem por peças), deleted_at, created_at, updated_at. `unique (tenant_id, sku)`. Saldo e custo médio NÃO ficam aqui (ver `stock_balances`).

**suppliers** — id, tenant_id, nome, cnpj text (só dígitos), regime text `simples|normal`, lead_time_dias int, condicao_pagamento int[] (dias das parcelas; `{0}` = à vista), contato text, email_xml text, deleted_at, created_at, updated_at. `unique (tenant_id, cnpj)`.

**supplier_materials** — id, tenant_id, supplier_id → suppliers, material_id → materials, codigo_fornecedor text (cProd do fornecedor), unidade_compra text, fator numeric(14,6), preco numeric(14,4), aliq_icms numeric(8,5), inteiro boolean (compra só em inteiros), ultimo_uso timestamptz. `unique (tenant_id, supplier_id, material_id)`, `unique (tenant_id, supplier_id, codigo_fornecedor)`. É o De-Para da NF-e.

**bom_versions** — id, tenant_id, product_id → products, versao int, ativa boolean, criado_por uuid, observacao text, created_at. `unique (tenant_id, product_id, versao)`; índice único parcial `(tenant_id, product_id) where ativa`.

**bom_lines** — id, tenant_id, bom_version_id → bom_versions, ordem int, tipo text `insumo|produto`, material_id → materials (quando insumo), component_product_id → products (quando produto), consumo numeric(14,6) check > 0, unidade text, perda_pct numeric(8,5) default 0, calc jsonb (parâmetros da calculadora por partes). `check ((tipo='insumo' and material_id is not null) or (tipo='produto' and component_product_id is not null))`.

**label_profiles** — tenant_id, familia text, prefixo text check `^[A-Z]{2,3}$`, tipos text[] (`produto|montagem|caixa`, `produto` obrigatório), unidades_por_caixa int default 1, instrucao_montagem text. `primary key (tenant_id, familia)`.

RPC: `activate_bom(p_tenant_id, p_product_id, p_linhas jsonb)` cria nova versão (versao = max+1), valida ciclo e unidade, desativa a anterior, devolve o id. Papéis: admin, producao, compras.

## 0004 · estoque · 0005 · produção

**stages** (etapas; MVP tem só a `final`) — id, tenant_id, codigo text, nome text, ordem int, ativa boolean. `unique (tenant_id, codigo)`. Seed cria `final` para todo tenant (trigger em tenants ou na RPC create_tenant).

**daily_plans** — id, tenant_id, dia date, location_id → locations, product_id → products, demanda_dia numeric, projetado numeric, carteira numeric, saldo_hub numeric, atualizado_por uuid, updated_at. `unique (tenant_id, dia, location_id, product_id)`. Impresso e bipado são derivados (contagem de labels e scan_events do dia), não colunas.

**labels** (etiquetas) — id, tenant_id, serial text, product_id → products, tipo text `unidade|caixa`, quantidade numeric default 1, status text `reservada|impressa|anulada`, dia date, seq int, location_id, reimpressa_de uuid → labels, created_at. `unique (tenant_id, serial)`, `unique (tenant_id, dia, product_id, seq)`.

**scan_events** — id, tenant_id, label_id → labels, product_id, stage_id → stages, event_type text `produzido|estorno|refugo`, quantidade numeric, operator_id → operators, device_id → devices, user_id uuid, competencia date, scanned_at timestamptz, client_event_id text (idempotência do aparelho offline), reverses_id uuid → scan_events. `unique (tenant_id, label_id, stage_id, event_type) nulls not distinct`; `unique (tenant_id, client_event_id)` parcial where not null.

Tabelas da 0004: `stock_moves`, `stock_balances`, `connectors` (mínima; a 0008 completa) e `integration_outbox`. Tabelas da 0005: `stages`, `daily_plans`, `labels`, `scan_events`.

**stock_moves** (ledger, append-only) — id, tenant_id, material_id → materials, location_id → locations, move_type text `entrada_nfe|entrada_manual|baixa_producao|ajuste|perda|estorno|saldo_inicial|transferencia`, delta numeric (sinalizado, unidade de consumo), custo_unit numeric(14,4), valor numeric(14,2), ref_type text, ref_id uuid, motivo text, idempotency_key text, reverses_id uuid → stock_moves, created_by uuid, created_at. `unique (tenant_id, idempotency_key)`. Trigger que bloqueia UPDATE e DELETE.

**stock_balances** — tenant_id, material_id, location_id, saldo numeric, custo_medio numeric(14,4), updated_at. `primary key (tenant_id, material_id, location_id)`. Só a RPC escreve.

RPCs (todas `SECURITY DEFINER` com `assert_member`):
- `set_daily_plan(p_tenant_id, p_dia, p_location_id, p_linhas jsonb)` — upsert das linhas.
- `reserve_label_batch(p_tenant_id, p_product_id, p_quantidade int, p_tipo default 'unidade', p_location_id default null)` → devolve `table (label_id, serial, dia, seq)` das etiquetas geradas como `impressa` (`label_id`, não `id`: o nome colidia com a coluna dentro da função; sem perfil para a família o prefixo é `ET`) (serial = prefixo do perfil + sku em maiúsculas + AAMMDD + seq com 4 dígitos; `p_location_id` precisa ser do tenant; seq por `(tenant, dia, product)`; se `exigir_projecao_para_imprimir` e não houver `daily_plans` com projetado > 0 para o dia, erro `P0001` com mensagem "Sem projeção do dia").
- `annul_label(p_tenant_id, p_label_id)`.
- `register_scan(p_tenant_id, p_serial, p_client_event_id, p_stage_codigo default 'final')` → `jsonb {ok, motivo, scan_id, label_id, competencia, product {id, sku, nome, familia}, quantidade, bipado_hoje, projetado_hoje}`. Motivos sem erro: `serial_desconhecido`, `anulada`, `nao_impressa`, `sem_operador`, `ja_bipado`. Regras: label deve existir e estar `impressa`; operador vem de `current_operator_id()` quando o papel é `dispositivo`, senão `auth.uid()`; competência = data em `tenants.fuso` ajustada pela `hora_virada`; grava scan_event; faz backflush: explode a BOM ativa (multinível) e insere `stock_moves` tipo `baixa_producao` com `idempotency_key = 'scan:' || scan_id || ':' || material_id`, atualiza `stock_balances` com `for update`; enfileira `integration_outbox` (delta +quantidade) para cada conector ativo com `push_estoque`; conflito de unicidade devolve `{ok:false, motivo:'ja_bipado'}` sem erro.
- `reverse_scan(p_tenant_id, p_scan_id)` — scan_event tipo `estorno`, movimentos contrários com `idempotency_key = 'rev:' || scan_id || ':' || material_id`, outbox negativo.
- `post_stock_move(p_tenant_id, p_material_id, p_location_id, p_move_type, p_delta, p_custo_unit, p_motivo, p_ref_type, p_ref_id, p_idempotency_key)` — entrada manual, ajuste, perda, saldo inicial; recalcula custo médio na entrada (média ponderada), mantém na saída. A chave gravada é `'manual:' || p_idempotency_key` (ou `manual:<uuid>`).
- `reverse_stock_move(p_tenant_id, p_move_id, p_motivo)` — chave `'rev:' || move_id`, idempotente pelo `reverses_id`; não estorna estorno nem `baixa_producao` (usar `reverse_scan`). Estornar a entrada de um recibo devolve a quantidade a `purchase_order_items.qtd_recebida` e recalcula o status da OC (trigger `stock_moves_receipt_reversed`, 0006).
- Helpers de leitura expostos a `authenticated`: `production_date(p_tenant_id, p_at)` (competência) e `explode_bom(p_tenant_id, p_product_id, p_qtd)`.

## 0006 · compras · 0007 · NF-e

Tabelas da 0006: `purchase_orders`, `purchase_order_items`, `receipts`, `receipt_items`. Tabelas da 0007: `nfe_inbound`, `nfe_inbound_items`, `nfe_po_links` (a FK `receipts.nfe_id` é adicionada na 0007).

**purchase_orders** — id, tenant_id, numero bigint (de `next_doc_number(tenant,'oc')`), supplier_id, location_id, status text `aberta|parcial|recebida|cancelada`, entrega_prevista date, condicao_pagamento int[], observacao, total numeric(14,2), created_by, created_at, updated_at. `unique (tenant_id, numero)`.

**purchase_order_items** — id, tenant_id, purchase_order_id, material_id, unidade_compra text, fator numeric(14,6), qtd numeric, qtd_recebida numeric default 0, preco numeric(14,4), ipi_pct numeric(8,5), entrega_prevista date. `check (qtd_recebida >= 0)`.

**nfe_inbound** — chave text (44 dígitos) + tenant_id como `primary key (tenant_id, chave)`, id uuid unique, numero int, serie int, cnpj_emitente text, emitente text, supplier_id → suppliers, emissao date, valor_total numeric(14,2), valor_frete, valor_desconto, valor_outros numeric(14,2), origem text `upload|email|erp|dfe|sem_xml`, status text `aguardando_xml|pendente|conferida|recebida|ignorada`, motivo_ignorada text, xml_path text (Storage), cstat text, fin_nfe text, raw jsonb (cabeçalho normalizado), created_at, updated_at.

**nfe_inbound_items** — id, tenant_id, nfe_id → nfe_inbound(id), n_item int, c_prod text, x_prod text, ncm text, cfop text, u_com text, q_com numeric, v_un_com numeric(14,6), v_prod numeric(14,2), u_trib text, q_trib numeric, v_icms, v_icms_st, v_ipi, v_pis, v_cofins, v_ibs, v_cbs numeric(14,2), classificacao text `compra|manual|ignorar`, material_id → materials, fator numeric(14,6), qtd_consumo numeric, purchase_order_item_id → purchase_order_items. `unique (tenant_id, nfe_id, n_item)`.

**nfe_po_links** — tenant_id, nfe_id, purchase_order_id. `primary key (tenant_id, nfe_id, purchase_order_id)`.

**receipts** — id, tenant_id, nfe_id (nullable: recebimento manual), purchase_order_id (nullable), location_id, recebido_por uuid, idempotency_key text, observacao, created_at. `unique (tenant_id, idempotency_key)`.

**receipt_items** — id, tenant_id, receipt_id, purchase_order_item_id, material_id, qtd_compra numeric, qtd_consumo numeric, custo_unit_consumo numeric(14,4), divergente boolean, motivo_divergencia text, stock_move_id → stock_moves.

RPCs: `create_purchase_order(p_tenant_id, p_supplier_id, p_location_id, p_entrega_prevista, p_condicao int[], p_itens jsonb, p_observacao)` → id (usa `next_doc_number`); `update_purchase_order_status(p_tenant_id, p_id, p_status)` aceita só `cancelada` (sem recebimento) e `aberta` (reabrir; o status real é recalculado) — `parcial`/`recebida` nascem exclusivamente de um recebimento; `upsert_nfe_inbound(p_tenant_id, p_nfe jsonb, p_itens jsonb)` (usada pelo cliente no upload e pelo worker no e-mail, que chama como `service_role` sem membership; idempotente por chave; `p_nfe.po_ids` substitui os vínculos em `nfe_po_links`; sugere De-Para por `supplier_materials`; `status` aceito: `aguardando_xml|pendente|conferida|ignorada`, nunca `recebida`; `xml_path` precisa começar por `<tenant_id>/`); `receive_nfe(p_tenant_id, p_nfe_id, p_location_id, p_itens jsonb [{item_id, material_id, fator, qtd_consumo, purchase_order_item_id, divergente, motivo}], p_idempotency_key)` → grava receipt (chave `'nfe:' || chave`; `p_idempotency_key` é ignorado porque a nota só é recebida uma vez), `stock_moves` tipo `entrada_nfe` com `idempotency_key = 'nfe:' || chave || ':' || n_item` (um movimento pré-existente com essa chave só é aceito se for de fato a entrada desta nota), custo médio ponderado com custo = (v_prod + rateio de frete/outros − desconto) / qtd_consumo (custo negativo é erro; créditos não entram no custo neste MVP; ficam registrados nos itens), baixa `qtd_recebida` das OCs vinculadas e atualiza status parcial/recebida, grava `supplier_materials` (De-Para aprendido), marca a nota `recebida`; `receive_manual(p_tenant_id, p_purchase_order_id, p_location_id, p_itens jsonb, p_idempotency_key)` (recibo com chave `'manual:' || p_idempotency_key`, movimentos `rcpt:<recibo>:<item da OC>`).

## 0008 · integrações

**connectors** — id, tenant_id, plataforma text `baselinker|bling|tiny|omie|magis5`, nome text, status text `conectado|erro|desconectado`, config jsonb (`{inventory_id, warehouse_id, deposito_id, push_estoque bool, modo_estoque, dry_run bool, intervalo_min}`), ultimo_sync timestamptz, ultimo_erro text, created_at, updated_at. `unique (tenant_id, plataforma)`.

**connector_credentials** — connector_id pk → connectors, tenant_id, payload bytea (pgp_sym_encrypt do JSON com token/client_id/secret/refresh_token), updated_at. RPCs: `set_connector_credentials(p_tenant_id, p_connector_id, p_payload jsonb, p_key text)` (cliente chama sem a chave? NÃO: a chave fica só no worker; o cliente grava por um endpoint do worker `/connectors/{id}/credentials` que cifra e insere via service role). `worker_get_credentials(p_connector_id, p_key)` só para service_role (`revoke from authenticated`).

**connector_status_map** — tenant_id, connector_id, status_externo text, significado text `ignorar|demanda|carteira|enviado|cancelado`. `primary key (tenant_id, connector_id, status_externo)`.

**sync_state** — connector_id pk, tenant_id, cursor jsonb, last_run_at, last_ok_at, runs int, updated_at.

**orders** (pedidos importados, para demanda) — id, tenant_id, connector_id, external_id text, external_status text, significado text, confirmed_at timestamptz, updated_at_external timestamptz, total numeric(14,2), raw jsonb, created_at. `unique (tenant_id, connector_id, external_id)`.

**order_items** — id, tenant_id, order_id, sku_externo text, product_id → products (via sku_aliases ou sku), quantidade numeric, preco numeric(14,4).

**integration_outbox** — id bigint identity, tenant_id, connector_id, product_id, delta numeric, dedupe_key text, status text `pendente|em_processamento|aplicado|erro|ignorado`, tentativas int default 0, erro text, created_at, applied_at. `unique (tenant_id, connector_id, dedupe_key)`.

**hub_stock_snapshots** — tenant_id, connector_id, product_id, saldo_hub numeric, capturado_em timestamptz. `primary key (tenant_id, connector_id, product_id)`.

**audit_runs** (auditor noturno) — id, tenant_id, connector_id, executado_em, divergencias jsonb.

RPCs: `upsert_connector(p_tenant_id, p_id, p_plataforma, p_nome, p_config)` (`p_config.status` vai para `connectors.status`); `set_status_map(p_tenant_id, p_connector_id, p_map [{status_externo, significado}])`; `disconnect_connector(p_tenant_id, p_connector_id)`; `retry_outbox(p_tenant_id, p_id)` (admin: item em `erro` volta a `pendente`); `demand_for_projection(p_tenant_id, p_dias)` e view `v_demand_by_sku`; para o worker (service_role): `worker_upsert_orders(p_tenant_id, p_connector_id, p_orders jsonb)`, `worker_claim_outbox(p_connector_id, p_limit)` → marca `em_processamento` e devolve lote agrupado por produto, `worker_apply_outbox_result(p_ids bigint[], p_ok bool, p_erro text)`, `worker_set_sync_state(p_connector_id, p_cursor, p_ok, p_erro)`, `worker_upsert_hub_stock(p_tenant_id, p_connector_id, p_itens [{sku, saldo}])`, `worker_record_audit(p_tenant_id, p_connector_id, p_divergencias)`, `worker_get_credentials(p_connector_id, p_key)`, `worker_set_credentials(p_tenant_id, p_connector_id, p_payload, p_key)`. Todas com `revoke execute from authenticated` e checagem `auth.role() = 'service_role'`.

## 0009 · comercial e inventário

**channels** — id, tenant_id, nome, preset text, ativo boolean, comissao_pct, taxa_fixa numeric(14,2), taxa_fixa_abaixo_de numeric(14,2), frete_vendedor jsonb (`[{ateKg, valor}]`), frete_gratis_acima_de numeric(14,2), imposto_venda_pct, ads_pct, parcelamento_pct, outros_pct (todos numeric(8,5)), observacao, deleted_at, created_at, updated_at. Índice único parcial `(tenant_id, nome) where deleted_at is null` (soft delete permite recriar canal com o mesmo nome).

**product_prices** — tenant_id, product_id, channel_id, preco numeric(14,2), updated_at. `primary key (tenant_id, product_id, channel_id)`.

**inventory_sessions** — id, tenant_id, location_id, status text `aberta|fechada`, aberta_por uuid, aberta_em, fechada_em, observacao. **inventory_items** — id, tenant_id, session_id, material_id, saldo_sistema numeric, contado numeric, pecas jsonb (`[{nome, medida, qtd}]`), motivo text, stock_move_id → stock_moves. `unique (tenant_id, session_id, material_id)`.

**notification_settings** — tenant_id pk, config jsonb (`{eventos: {evento: {email: bool, chat: webhook_id}}, webhooks: [{id, nome, url}]}`). **notifications** — id, tenant_id, tipo text, texto text, lida boolean, created_at.

RPCs: `upsert_channel(p_tenant_id, p_id, p_channel jsonb)`, `remove_channel(p_tenant_id, p_id)`, `set_product_price(p_tenant_id, p_product_id, p_channel_id, p_preco)`, `open_inventory_session(p_tenant_id, p_location_id, p_observacao)`, `save_inventory_item(p_tenant_id, p_session_id, p_material_id, p_contado, p_pecas, p_motivo)`, `close_inventory_session(p_tenant_id, p_session_id)` gera `stock_moves` tipo `ajuste` (`idempotency_key = 'inv:' || session_id || ':' || material_id`) só para itens divergentes; `notify(p_tenant_id, p_tipo, p_texto)` é interna (service_role e RPCs).

## Views para a interface

`v_stock` (materials + stock_balances agregado por tenant/material com `abaixo_do_minimo`), `v_daily_plan` (daily_plans + impresso + bipado do dia), `v_bom_active` (bom_versions ativa + linhas), `v_purchase_orders` (com total, recebido_pct, fornecedor). Views herdam RLS das tabelas (`security_invoker = on`).
