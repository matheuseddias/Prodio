# @prodio/worker

Cloudflare Worker do Prodio. Um runtime só para: conectores de pedidos (BaseLinker, Bling, Tiny), outbox de estoque de acabado, webhooks, entrada de NF-e por upload e por e-mail, auditor noturno. Regras em `docs/arquitetura.md` (§5) e contrato de banco em `docs/schema.md` (§0006).

## Variáveis (segredos)

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto. |
| `SUPABASE_SERVICE_KEY` | Service role. **Só** em cron, webhook e e-mail (`src/db.ts`). |
| `SUPABASE_ANON_KEY` | Só para montar um cliente que age como o usuário (anon key + JWT dele) em `/nfe/xml` e `/connectors/*`. RLS e `assert_member` valem. |
| `CREDENTIALS_KEY` | Chave simétrica de `pgp_sym_encrypt` das credenciais de conectores (`worker_get/set_credentials`). Também assina o `state` do OAuth. |
| `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` | App OAuth do Bling (global). Um tenant pode usar app próprio gravando `client_id`/`client_secret` nas credenciais do conector. |
| `TINY_CLIENT_ID` / `TINY_CLIENT_SECRET` | Fallback do app OAuth do Tiny. No Tiny o app é **privado por seller**: o normal é o cliente criar o aplicativo na conta dele e colar `client_id`/`client_secret` nas credenciais do conector; estes segredos globais só entram quando nada foi colado. |
| `PUBLIC_URL` | URL pública do worker. **Obrigatória para o OAuth do Tiny**: o `redirect_uri` é montado como `<PUBLIC_URL>/connectors/tiny/oauth/callback`. |

```sh
cd apps/worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put CREDENTIALS_KEY          # ex.: openssl rand -hex 32
wrangler secret put BLING_CLIENT_ID
wrangler secret put BLING_CLIENT_SECRET
wrangler secret put TINY_CLIENT_ID           # opcional: app global do Tiny
wrangler secret put TINY_CLIENT_SECRET
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
| `POST /connectors/:id/:plataforma/oauth/start` | JWT do usuário (admin) | `:plataforma` é `bling` ou `tiny`. Devolve `{url}` do consentimento com `state` assinado (HMAC com `CREDENTIALS_KEY`, 15 min). No Tiny o `redirect_uri` vai junto. |
| `GET /connectors/:plataforma/oauth/callback?code&state` | `state` assinado | Troca o code por tokens e grava cifrado. Cadastre esta URL como redirect no app da plataforma. Bling: Basic `client_id:client_secret` + `enable-jwt: 1`. Tiny: Keycloak, credenciais no corpo, com `redirect_uri`. |
| `POST /webhooks/bling/:connectorId` | `X-Bling-Signature-256` | HMAC-SHA256 do corpo cru com o `client_secret`. Responde 200 na hora, processa em `ctx.waitUntil`. Eventos de pedido buscam o pedido e fazem `worker_upsert_orders` (idempotente por `external_id`). |

## Crons (`wrangler.toml`)

- `*/5 * * * *` → `syncPedidos` (pullOrders incremental por `sync_state.cursor`, com sobreposição) e depois `aplicarOutbox`.
- `0 3 * * *` → `auditor` (saldo do hub por produto → `hub_stock_snapshots`; divergência = hub − (snapshot anterior + bipes do dia) → `audit_runs`).

Erro em um conector grava `ultimo_erro` via `worker_set_sync_state(id, null, false, erro)` e não interrompe os outros tenants.

### Outbox e freio

`worker_claim_outbox` devolve o lote agrupado por SKU. O adaptador aplica em série e **para na primeira falha**; o job então marca: aplicados → `aplicado`; o que falhou → `erro` com a mensagem; o restante volta a `pendente` (`worker_apply_outbox_result(ids, false, null)`, sem contar tentativa). Com `config.dry_run = true` nada é escrito na plataforma e o lote inteiro volta a `pendente` (o outbox não é consumido; ao desligar o dry run, os deltas acumulados são aplicados).

BaseLinker: `updateInventoryProductsStock` é absoluto. O adaptador lê `getInventoryProductsStock` antes, soma o delta e grava, um produto por chamada. Precisa de `config.warehouse_id` (ex.: `bl_1234`) e opcionalmente `inventory_id`.
Bling: `POST /estoques` é por delta (`E`/`S`). Precisa de `config.deposito_id`.
Tiny: `POST /estoque/{idProduto}` é por delta (`tipo` `E`/`S`). `config.deposito_id` é opcional — sem ele o Tiny lança no depósito padrão da conta. O Tiny não tem busca de produto por lote de SKU: até 25 SKUs o adaptador resolve um a um (`GET /produtos?codigo=<sku>&limit=1`); acima disso lê o catálogo inteiro paginado e guarda o de-para em memória pelo tempo do job.

## Config do conector (`connectors.config`)

`{ push_estoque: bool, dry_run: bool, dias_iniciais: 3, inventory_id, warehouse_id (BaseLinker), deposito_id (Bling e Tiny), dias_nfe: 60 (Tiny) }`.

## Tiny (Olist) — validar os endpoints antes do primeiro uso em produção

O adaptador (`src/conectores/tiny.ts`) fala a **API v3** do Tiny, autenticada por OAuth2 sobre
Keycloak (`accounts.tiny.com.br/realms/tiny`). Access token ~4 h; refresh ~24 h e **rotativo**:
cada renovação invalida o refresh anterior, por isso o novo par é persistido na hora
(`worker_set_credentials`). Se o cliente ficar mais de um dia sem sync, o refresh morre e a tela
precisa mandar o admin reautorizar (`codigo: 'reauth'` no `ErroConector`). A v3 **não tem
webhooks**: `verifyWebhook` devolve `unsupported` e os pedidos vêm só por polling do cron.

> **Pendência conhecida.** Os caminhos de endpoint, nomes de parâmetro e nomes de campo foram
> montados a partir da documentação pública e de integrações abertas — a rede da máquina onde o
> adaptador foi escrito **não alcança `tiny.com.br` nem o portal de documentação**, então nada
> disso foi conferido contra uma conta real. Antes do primeiro sync em produção, rode a checagem
> abaixo com credenciais do cliente. Tudo o que precisa de conserto está em **um arquivo só**:
> `src/conectores/tinyMapa.ts` (objeto `MAPA_TINY` + as interfaces de payload logo abaixo dele).
> `tiny.ts` nunca escreve um caminho ou um nome de campo na mão.

O que conferir, com `Authorization: Bearer <access_token>` e base `https://api.tiny.com.br/public-api/v3`:

| Uso no Prodio | Chamada esperada | Confira |
| --- | --- | --- |
| `pullOrders` | `GET /pedidos?dataAtualizacao=AAAA-MM-DD&limit=100&offset=0` | o nome do filtro incremental (`dataAtualizacao`), o formato da data e o envelope `{itens, paginacao}`. |
| `pullOrders` / `pullOrder` | `GET /pedidos/{id}` | onde está o SKU do item (`itens[].produto.sku`? `itens[].codigo`?), `valorUnitario` vs `valor`, e o campo de valor total (`valorTotalPedido`). |
| `pullCatalog` | `GET /produtos?limit=100&offset=0` | se o SKU vem em `sku` ou `codigo`, e o nome do produto (`descricao`). |
| `pullFinishedStock` | `GET /estoque/{idProduto}` | `saldo`, `disponivel` e o formato de `depositos[]` (o depósito vem plano ou aninhado em `deposito`?). |
| `pushFinishedStock` | `POST /estoque/{idProduto}` com `{tipo:'E'\|'S', quantidade, deposito:{id}, observacoes}` | os nomes do corpo e se `tipo` aceita mesmo `E`/`S` (há também `B`, de balanço/absoluto). |
| `findInboundNfe` | `GET /notas?tipo=E&dataInicial&dataFinal` → `GET /notas/{id}` → `GET /notas/{id}/xml` | se a listagem traz `chaveAcesso` (é por ela que o Prodio casa a nota, já que a v3 não filtra por chave) e em que formato o XML volta (cru, `{xml}` ou base64 — os três já são tratados). |

Um jeito rápido de validar tudo de uma vez é apontar o `ClienteHttp` para a conta real num script
de scratch e rodar `pullCatalog()` → `pullFinishedStock([sku])` → `pushFinishedStock([...], {dryRun:true})`
→ `pullOrders(null)`. Enquanto a validação não acontecer, deixe `config.dry_run = true` no conector
do Tiny: o outbox não é consumido e nada é escrito na conta do cliente.

Limite de chamadas: ~60 req/min **por conta do Tiny**, compartilhado entre todos os aplicativos
ativos dela. O cliente HTTP do conector espaça as chamadas em 1,1 s e faz backoff em 429/5xx.

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
src/conectores/baselinker.ts, bling.ts, tiny.ts + tinyMapa.ts, index.ts (fábrica)
src/jobs/syncPedidos.ts, aplicarOutbox.ts, auditor.ts
src/rotas/webhooks.ts, nfe.ts, credenciais.ts, util.ts
src/email.ts, src/zip.ts, src/nfe-mapa.ts, src/cron.ts
```
