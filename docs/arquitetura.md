# Prodio — arquitetura e convenções

Este documento é a fonte de verdade para quem escreve código no Prodio. As regras aqui vêm de três meses de incidentes do sistema anterior (Eddias Suprimentos) e das críticas ao plano de fundação. Não são preferências de estilo.

## 1. Peças

```
apps/web        interface (Vite + React 19 + TypeScript + Tailwind v4), PWA
apps/worker     Cloudflare Worker: conectores, outbox, webhooks, e-mail de XML, cron
packages/core   regras de negócio puras em TypeScript, com testes (vitest)
supabase/       Postgres: migrations, RPCs, RLS, seed, testes de banco
```

Fluxo de dependência: `web` e `worker` dependem de `core`. `core` não depende de nada (nem React, nem Supabase, nem rede).

## 2. Banco: regras inegociáveis

1. **Toda tabela de domínio tem `tenant_id uuid not null` com FK para `tenants` e RLS habilitada na mesma migration que a cria.** Sem exceção. Uma tabela sem RLS é um vazamento entre clientes.
2. **A policy padrão** é `tenant_id = (select public.current_tenant_id())`. A função `current_tenant_id()` é `STABLE`, lê a claim `tenant_id` do JWT e confirma a `membership` do usuário. O `(select …)` faz o Postgres cachear por statement.
3. **Leitura direta pelo cliente é permitida** (RLS protege). **Escrita que move estoque, reserva serial, numera documento, aponta produção ou recebe nota nunca é feita por INSERT/UPDATE direto.** Essas tabelas não têm GRANT de escrita para `authenticated`. A escrita passa por RPC.
4. **RPCs de escrita são `SECURITY DEFINER`** com, obrigatoriamente: `SET search_path = ''`, `REVOKE EXECUTE ON FUNCTION … FROM public, anon`, `GRANT EXECUTE … TO authenticated`, e a primeira instrução do corpo é `PERFORM public.assert_member(p_tenant_id, ARRAY['admin', …])`. Nomes de tabela sempre qualificados com `public.`.
5. **Service role só no worker, por cron ou webhook.** Nunca em caminho acionado por usuário. Nunca no navegador. A anon key só serve para login.
6. **Idempotência é chave única, não lógica de aplicação.** `scan_events(tenant_id, label_id, stage_id, event_type)` com `NULLS NOT DISTINCT`; `stock_moves.idempotency_key` único por tenant; `receipts.idempotency_key`; `integration_outbox(tenant_id, connector_id, dedupe_key)`.
7. **Ledger é append-only.** `stock_moves` nunca sofre UPDATE ou DELETE. Estorno é um movimento contrário com `reverses_id`. Saldo e custo médio ficam em `stock_balances`, mantidos pela RPC dentro da transação com `SELECT … FOR UPDATE`.
8. **Numeração de documento** vem de `doc_counters` com `UPDATE … RETURNING` dentro da mesma transação que cria o documento. Nunca é calculada no cliente.
9. **Exclusão** é `deleted_at` (soft delete) nas tabelas de cadastro. Nada de DELETE em massa vindo do cliente. Importação substitui por escopo explícito, nunca por diferença de memória.
10. **Claim de tenant** vem do hook `custom_access_token_hook`, que lê `user_active_tenant`. JWT expira em 15 minutos. Trocar de tenant é RPC `set_active_tenant` seguida de `refreshSession()` no cliente. Remover alguém de um tenant apaga a `membership`, e a policy deixa de valer no próximo statement porque `current_tenant_id()` confere a membership, não só a claim.
11. **Operador de chão de fábrica** não tem e-mail: o aparelho faz sign-in anônimo, o admin registra o aparelho (vira `membership` com papel `dispositivo` e local), e o operador entra com PIN via RPC `set_operator(pin)`, que grava `device_sessions.operator_id`. `register_scan` lê o operador da sessão do aparelho.
12. **Credenciais de conectores** ficam em `connector_credentials` cifradas com `pgp_sym_encrypt` e a chave `CREDENTIALS_KEY` do worker. Nunca em env global, nunca em texto.
13. **Migrations são a única forma de mudar o schema.** Nada criado pelo painel. Cada migration é idempotente onde possível (`create … if not exists`, `create or replace function`).
14. **Datas** em `timestamptz`. Competência de produção é `date` calculada pelo fuso do tenant e pela `hora_virada` (ex.: bipe às 02:00 conta para o dia anterior).

### Modelo de tabelas (nomes em inglês, snake_case)

`tenants`, `memberships`, `user_active_tenant`, `locations`, `units`, `doc_counters`, `audit_log`,
`products`, `sku_aliases`, `materials`, `suppliers`, `supplier_materials`, `bom_versions`, `bom_lines`,
`label_profiles`, `daily_plans`, `labels`, `stages`, `scan_events`, `stock_moves`, `stock_balances`,
`purchase_orders`, `purchase_order_items`, `nfe_inbound`, `nfe_inbound_items`, `receipts`, `receipt_items`,
`connectors`, `connector_credentials`, `connector_status_map`, `sync_state`, `integration_outbox`, `hub_stock_snapshots`,
`channels`, `product_prices`, `inventory_sessions`, `inventory_items`, `devices`, `operators`, `device_sessions`, `notifications`, `notification_settings`.

### RPCs de escrita (nomes em inglês)

`set_active_tenant`, `next_doc_number` (interna), `register_device`, `set_operator`,
`reserve_label_batch`, `annul_label`, `register_scan`, `reverse_scan`, `set_daily_plan`,
`post_stock_move`, `reverse_stock_move`, `create_purchase_order`, `update_purchase_order_status`,
`receive_nfe`, `close_inventory_session`, `activate_bom`, `enqueue_outbox` (interna), `apply_outbox_result` (worker).

## 3. Regras de negócio no `core`

Tudo que calcula fica em `packages/core`, como função pura com teste:

- `ficha.ts` explosão multinível com proteção de ciclo, custo recursivo, calculadora de consumo por partes.
- `custeio.ts` custo médio ponderado móvel; crédito por tributo a partir dos valores destacados no XML, filtrado pelo regime do comprador e pelo CFOP, com tabela de tributos e vigência (CBS/IBS a partir de 2027). Nunca alíquota fixa.
- `projecao.ts` demanda diária por SKU, projetado = max(0, demanda × cobertura − saldo no hub − em produção), elevação à carteira.
- `necessidade.ts` necessidade de compra em dois modos (métrica do mês e por saldo), lead time aprendido, cobertura, folga, comprar até.
- `etiquetas.ts` serial (prefixo + SKU + AAMMDD + sequência), perfis por família.
- `nfe.ts` validação de chave (dígito verificador módulo 11), decomposição da chave, parser do XML (modelo 55, cStat, série, finNFe, CFOP do emitente, vDesc/vFrete/vSeg/vOutro, ICMS-ST, PIS/COFINS, IBS/CBS, uCom e uTrib), classificação por CFOP.
- `precificacao.ts` preço por margem alvo por canal.
- `unidades.ts` conversão compra → consumo.

## 4. Interface

- Páginas leem do store; o store fala com um `Repo`. Há duas implementações: `MemoryRepo` (dados de exemplo, usada sem variáveis de ambiente) e `SupabaseRepo`. A escolha é por `VITE_SUPABASE_URL`.
- Toda escrita crítica chama uma RPC. Leituras usam `supabase.from(...)` com RLS.
- Chão de fábrica funciona sem rede: fila de bipes em IndexedDB, conjunto local de seriais lidos para responder "já bipado" offline, replay em ordem tratando conflito de unicidade como sucesso.

## 5. Worker

- Um runtime só. Cron a cada 5 minutos: para cada tenant com conector ativo, `pullOrders` incremental por cursor com sobreposição e `applyOutbox` em lote por SKU com dry-run opcional. Cron diário: auditor compara saldo do hub com o Prodio e registra divergências.
- Webhooks em `/webhooks/{plataforma}/{tenant_id}/{token}`: verificar assinatura quando existir (Bling), dedupe por id de evento, responder 200 imediato, processar depois.
- `POST /nfe/xml` recebe XML (upload ou e-mail), roda o parser do core e grava `nfe_inbound` via service role, validando o tenant pelo endereço de destino ou pelo token.
- Interface de conector: `pullOrders(cursor)`, `pullCatalog()`, `pullFinishedStock()`, `pushFinishedStock(deltas)`, `findInboundNfe(chave)`, `pullPurchaseOrders()`, `verifyWebhook(req)`. Adaptadores declaram capacidades; o que não suportam devolve `unsupported`.

## 6. Testes

- `core`: vitest, casos reais da Eddias como fixtures (fichas, XMLs anonimizados).
- Banco: `supabase/tests/*.test.sql` rodam contra Postgres 16 em CI com stubs do schema `auth`. Um teste obrigatório: para cada tabela e RPC, o usuário do tenant B não lê nem escreve dado do tenant A.
- Web: build e lint verdes; smoke em Chromium nas rotas.
