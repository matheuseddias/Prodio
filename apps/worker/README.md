# @prodio/worker

Cloudflare Worker do Prodio. Um runtime só para: conectores de pedidos (BaseLinker, Bling), outbox de estoque de acabado, webhooks, entrada de NF-e por upload e por e-mail, auditor noturno. Regras em `docs/arquitetura.md` (§5) e contrato de banco em `docs/schema.md` (§0006).

## Variáveis (segredos)

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto. |
| `SUPABASE_SERVICE_KEY` | Service role. **Só** em cron, webhook e e-mail (`src/db.ts`). |
| `SUPABASE_ANON_KEY` | Só para montar um cliente que age como o usuário (anon key + JWT dele) em `/nfe/xml` e `/connectors/*`. RLS e `assert_member` valem. |
| `CREDENTIALS_KEY` | Chave simétrica de `pgp_sym_encrypt` das credenciais de conectores (`worker_get/set_credentials`). Também assina o `state` do OAuth. |
| `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` | App OAuth do Bling (global). Um tenant pode usar app próprio gravando `client_id`/`client_secret` nas credenciais do conector. |
| `PUBLIC_URL` | Opcional; URL pública do worker (documentação do redirect do OAuth). |

```sh
cd apps/worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put CREDENTIALS_KEY          # ex.: openssl rand -hex 32
wrangler secret put BLING_CLIENT_ID
wrangler secret put BLING_CLIENT_SECRET
```

Para `wrangler dev`, crie `.dev.vars` com as mesmas chaves (não versionar).

## Como rodar

```sh
pnpm --filter @prodio/worker dev     # wrangler dev (crons: wrangler dev --test-scheduled e GET /__scheduled?cron=*/5+*+*+*+*)
pnpm --filter @prodio/worker build   # tsc --noEmit
pnpm --filter @prodio/worker lint    # oxlint
pnpm --filter @prodio/worker test    # vitest (fetch mockado, sem rede)
pnpm --filter @prodio/worker deploy
```

## Rotas

| Método e caminho | Autenticação | O que faz |
| --- | --- | --- |
| `GET /health` | nenhuma | `{ok:true}` |
| `POST /nfe/xml` | `Authorization: Bearer <JWT do usuário>` | Corpo `text/xml` ou multipart (campo `xml`). Roda `parseNfeXml` do core, chama `upsert_nfe_inbound` **como o usuário** e só então guarda o XML em Storage `nfe-xml/<tenant>/<chave>.xml`. Tenant vem da claim `app_metadata.tenant_id`; `?tenant_id=` ou campo `tenant_id` sobrescreve. |
| `POST /connectors/:id/credentials` | JWT do usuário (admin) | Confere pelo próprio JWT (RLS em `connectors` + `current_member_role() = 'admin'`), depois cifra via `worker_set_credentials`. Campos por plataforma: BaseLinker `token`; Bling `client_id`, `client_secret` (tokens vêm do OAuth). |
| `POST /connectors/:id/bling/oauth/start` | JWT do usuário (admin) | Devolve `{url}` do consentimento no Bling com `state` assinado (HMAC com `CREDENTIALS_KEY`, 15 min). |
| `GET /connectors/bling/oauth/callback?code&state` | `state` assinado | Troca o code por tokens (Basic `client_id:client_secret`, `enable-jwt: 1`) e grava cifrado. Cadastre esta URL como redirect no app do Bling. |
| `POST /webhooks/bling/:connectorId` | `X-Bling-Signature-256` | HMAC-SHA256 do corpo cru com o `client_secret`. Responde 200 na hora, processa em `ctx.waitUntil`. Eventos de pedido buscam o pedido e fazem `worker_upsert_orders` (idempotente por `external_id`). |

## Crons (`wrangler.toml`)

- `*/5 * * * *` → `syncPedidos` (pullOrders incremental por `sync_state.cursor`, com sobreposição) e depois `aplicarOutbox`.
- `0 3 * * *` → `auditor` (saldo do hub por produto → `hub_stock_snapshots`; divergência = hub − (snapshot anterior + bipes do dia) → `audit_runs`).

Erro em um conector grava `ultimo_erro` via `worker_set_sync_state(id, null, false, erro)` e não interrompe os outros tenants.

### Outbox e freio

`worker_claim_outbox` devolve o lote agrupado por SKU. O adaptador aplica em série e **para na primeira falha**; o job então marca: aplicados → `aplicado`; o que falhou → `erro` com a mensagem; o restante volta a `pendente` (`worker_apply_outbox_result(ids, false, null)`, sem contar tentativa). Com `config.dry_run = true` nada é escrito na plataforma e o lote inteiro volta a `pendente` (o outbox não é consumido; ao desligar o dry run, os deltas acumulados são aplicados).

BaseLinker: `updateInventoryProductsStock` é absoluto. O adaptador lê `getInventoryProductsStock` antes, soma o delta e grava, um produto por chamada. Precisa de `config.warehouse_id` (ex.: `bl_1234`) e opcionalmente `inventory_id`.
Bling: `POST /estoques` é por delta (`E`/`S`). Precisa de `config.deposito_id`.

## Config do conector (`connectors.config`)

`{ push_estoque: bool, dry_run: bool, dias_iniciais: 3, inventory_id, warehouse_id (BaseLinker), deposito_id (Bling) }`.

## E-mail de XML (Email Routing)

1. No painel da Cloudflare, ative Email Routing no domínio `prodio.app` (ou use um subdomínio dedicado) e crie a regra catch-all ou por endereço `xml@<slug>.prodio.app` → **Send to a Worker** → `prodio-worker`. Para muitos tenants use uma regra catch-all e deixe o handler resolver o slug.
2. O handler `email` em `src/email.ts` lê `message.to`, extrai o slug (`xml@<slug>.prodio.app`), resolve o tenant, abre anexos `.xml` e `.xml` dentro de `.zip` (`src/zip.ts`, sem dependência), roda o parser do core, guarda o XML no Storage e chama `upsert_nfe_inbound` com origem `email` via service role.
3. Anexos que não são NF-e modelo 55 são ignorados com log; destinatário sem tenant é rejeitado (`setReject`).

## Contrato esperado do banco (migration 0008)

Além do que está em `docs/schema.md`, o worker assume (ver cabeçalho de `src/db.ts`):

- `worker_set_credentials(p_tenant_id, p_connector_id, p_payload jsonb, p_key)`;
- `worker_set_sync_state(p_connector_id, p_cursor jsonb, p_ok, p_erro)`: cursor nulo mantém o anterior; `p_ok=false` grava `connectors.ultimo_erro`;
- `worker_claim_outbox` devolve `[{product_id, sku, delta, ids}]`;
- `worker_apply_outbox_result(p_ids, false, null)` devolve a `pendente` sem contar tentativa;
- `worker_upsert_hub_stock(p_tenant_id, p_connector_id, p_itens [{sku, saldo}])`, `worker_record_audit(p_tenant_id, p_connector_id, p_divergencias)`;
- `upsert_nfe_inbound` aceita `auth.role() = 'service_role'` (sem membership) quando `origem = 'email'`;
- bucket de Storage `nfe-xml` (privado).

## Estrutura

```
src/index.ts            roteador, cron dispatcher, health, handler de e-mail
src/env.ts              tipagem das variáveis
src/http.ts             cliente HTTP: fila por conta, backoff em 429/5xx, log
src/db.ts               Supabase (service role) + cliente do usuário; RPCs worker_*
src/conectores/tipos.ts interface Conector e PedidoNormalizado
src/conectores/baselinker.ts, bling.ts, index.ts (fábrica)
src/jobs/syncPedidos.ts, aplicarOutbox.ts, auditor.ts
src/rotas/webhooks.ts, nfe.ts, credenciais.ts, util.ts
src/email.ts, src/zip.ts, src/nfe-mapa.ts, src/cron.ts
```
