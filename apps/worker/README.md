# @prodio/worker

Cloudflare Worker do Prodio. Um runtime só para: conectores de pedidos (BaseLinker, Bling, Tiny), outbox de estoque de acabado, webhooks, entrada de NF-e por upload e por e-mail, auditor noturno. Regras em `docs/arquitetura.md` (§5) e contrato de banco em `docs/schema.md` (§0006).

## Variáveis (segredos)

| Nome | Uso |
| --- | --- |
| `SUPABASE_URL` | URL do projeto. |
| `SUPABASE_SERVICE_KEY` | Service role. **Só** em cron, webhook e e-mail (`src/db.ts`). |
| `SUPABASE_ANON_KEY` | Só para montar um cliente que age como o usuário (anon key + JWT dele) em `/nfe/xml` e `/connectors/*`. RLS e `assert_member` valem. |
| `CREDENTIALS_KEY` | Chave simétrica de `pgp_sym_encrypt` das credenciais de conectores (`worker_get/set_credentials`). O `state` do OAuth é assinado com uma chave **derivada** dela (`HMAC(CREDENTIALS_KEY, 'prodio.oauth.state.v1')`), não com ela própria. |
| `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` | App OAuth do Bling (global). Um tenant pode usar app próprio gravando `client_id`/`client_secret` nas credenciais do conector. |
| `TINY_CLIENT_ID` / `TINY_CLIENT_SECRET` | Fallback do app OAuth do Tiny. No Tiny o app é **privado por seller**: o normal é o cliente criar o aplicativo na conta dele e colar `client_id`/`client_secret` nas credenciais do conector; estes segredos globais só entram quando nada foi colado. |
| `PUBLIC_URL` | URL pública do worker. **Obrigatória para o OAuth do Bling e do Tiny**: dela saem o `redirect_uri` (`<PUBLIC_URL>/connectors/<plataforma>/oauth/callback`) e a URL de `/oauth/go` que a tela abre. Sem ela, `/oauth/start` responde 500 com o texto que diz o que falta. |
| `CORS_ORIGENS` | Origens que o navegador pode usar para chamar as rotas de usuário, separadas por vírgula. Sem ela, só `http://localhost:5173` e `http://localhost:4173` passam — ou seja, a interface publicada não fala com o worker. Ver "CORS" abaixo. |

Obrigatórias sempre: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `CREDENTIALS_KEY`,
`CORS_ORIGENS`. Obrigatória para conectar Bling ou Tiny: `PUBLIC_URL`. As quatro de app OAuth são
opcionais (ver a tabela acima). **Só o BaseLinker funciona sem `PUBLIC_URL`**, porque é token colado,
não OAuth.

```sh
cd apps/worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put CREDENTIALS_KEY          # ex.: openssl rand -hex 32
wrangler secret put BLING_CLIENT_ID          # opcional: app global do Bling
wrangler secret put BLING_CLIENT_SECRET
wrangler secret put TINY_CLIENT_ID           # opcional: app global do Tiny
wrangler secret put TINY_CLIENT_SECRET
```

`PUBLIC_URL` e `CORS_ORIGENS` não são segredo e ficam no bloco `[vars]` do `wrangler.toml`, não em
`secret put`. O motivo é prático: `wrangler deploy` substitui as variáveis de texto do worker pelas
do arquivo, então uma criada no painel desaparece na publicação seguinte — silenciosamente, e o
sintoma é a interface parar de falar com o worker por preflight recusado. Segredo não sofre disso:
sobrevive a qualquer deploy e passa a valer na requisição seguinte, sem republicar.

Há um ovo-e-galinha na primeira publicação: o endereço do worker só existe depois do primeiro
`wrangler deploy`, e é ele que vai em `PUBLIC_URL`. Então a ordem é **deploy primeiro, endereço
depois** — publique, anote o `https://prodio-worker.<conta>.workers.dev` que o comando imprime,
escreva os dois valores no `wrangler.toml` e publique de novo. `wrangler secret list` confere os
segredos já gravados (mostra os nomes, nunca os valores).

Para `wrangler dev`, crie `.dev.vars` com as mesmas chaves (não versionar).

## CORS

As rotas que o navegador chama levam `Authorization: Bearer <JWT do usuário>`. Por isso o worker
**nunca** responde `Access-Control-Allow-Origin: *` nelas: devolve a origem exata que chamou e só
quando ela está na lista de `CORS_ORIGENS`. Com `*` e credencial de portador, qualquer site aberto
na mesma máquina poderia chamar o worker com o token de quem está logado no Prodio.

Valor para o Prodio hoje (uma linha, separada por vírgula):

```
https://app.prodio.com.br,https://prodio-web.pages.dev,https://*.prodio-web.pages.dev,http://localhost:5173
```

- Cada item é uma **origem exata** (`https://app.prodio.com.br`) ou um **curinga de subdomínio**
  (`https://*.prodio-web.pages.dev`). O curinga existe porque cada publicação do Cloudflare Pages
  ganha um endereço novo com hash (`https://40c39f1e.prodio-web.pages.dev`).
- O curinga casa **rótulo inteiro de host**, com protocolo e porta iguais: aceita
  `https://abc.prodio-web.pages.dev` e recusa `https://prodio-web.pages.dev.invasor.com`,
  `https://maliciosoprodio-web.pages.dev` e `http://abc.prodio-web.pages.dev`.
- O curinga **tem de ser sobre um host que a empresa controla inteiro**. `https://*.pages.dev`,
  `https://*.workers.dev`, `https://*.vercel.app` e afins são recusados pelo próprio worker
  (`cors.curingaAmploDemais` no log): qualquer pessoa cria um site debaixo desses sufixos em
  minutos, e o curinga ali valeria tanto quanto `*` — com o JWT do usuário junto. `*.prodio.com.br`
  ou `*.prodio-web.pages.dev` estão certos; o sufixo cru, não.
- Origem fora da lista **não recebe cabeçalho de CORS nenhum**. O preflight responde 204 sem
  cabeçalho (e não 403) de propósito: assim o navegador mostra "No 'Access-Control-Allow-Origin'
  header is present", que aponta o problema, em vez de esconder a causa atrás de um erro de status.
  Nos dois casos a requisição real não sai do navegador.
- Não é enviado `Access-Control-Allow-Credentials`: o token vai no header, não em cookie.
- Webhooks e cron não mandam `Origin` e seguem sem CORS — máquina não precisa. `GET /health` é a
  única rota aberta (`*`): não tem credencial nem dado de tenant.

Quando `CORS_ORIGENS` está vazia, a origem recusada aparece no log como `cors.origemRecusada` — é o
primeiro lugar para olhar quando a tela publicada começa a falhar com erro de CORS.

## Como rodar

```sh
pnpm --filter @prodio/worker dev     # wrangler dev (crons: wrangler dev --test-scheduled e GET /__scheduled?cron=*/5+*+*+*+*)
pnpm --filter @prodio/worker build   # tsc --noEmit
pnpm --filter @prodio/worker lint    # oxlint
pnpm --filter @prodio/worker test    # vitest (fetch mockado, sem rede)
pnpm deploy:worker
```

## Rotas

| Método e caminho | Autenticação | O que faz |
| --- | --- | --- |
| `GET /health` | nenhuma | `{ok:true}` |
| `POST /nfe/xml` | `Authorization: Bearer <JWT do usuário>` | Corpo `text/xml` ou multipart (campo `xml`). Roda `parseNfeXml` do core, chama `upsert_nfe_inbound` **como o usuário** e só então guarda o XML em Storage `nfe-xml/<tenant>/<chave>.xml`. Tenant vem da claim `app_metadata.tenant_id`; `?tenant_id=` ou campo `tenant_id` sobrescreve. |
| `POST /connectors/:id/credentials` | JWT do usuário (admin) | Confere pelo próprio JWT (RLS em `connectors` + `current_member_role() = 'admin'`), depois cifra via `worker_set_credentials`. Responde `{ok:true, campos}` com os nomes gravados (nunca os valores). Campos aceitos por plataforma em `CHAVES_PERMITIDAS` (`src/rotas/credenciais.ts`) — o que a **tela** manda está em `apps/web/src/pages/sistema/ConectorCampos.ts`, e o teste `apps/web/src/pages/sistema/contrato.test.ts` prende os dois lados: **BaseLinker** `token` (obrigatório); **Tiny** `client_id` + `client_secret` (o app do Tiny é do próprio cliente); **Bling** nada — o app é do Prodio, o segredo está no env do worker e a tela vai direto para o OAuth (aceitar `client_id`/`client_secret` aqui só serve para um tenant usar app próprio). `access_token`/`refresh_token`/`expires_at` de Bling e Tiny são gravados por esta mesma RPC, mas pelo callback do OAuth, não pela tela. Endereçamento (`inventory_id`, `warehouse_id`, `deposito_id`) é recusado com 400 explicando que ele mora em `connectors.config`. |
| `POST /connectors/:id/test` | JWT do usuário (admin) | Botão "Testar conexão". Mesma autorização das credenciais. Monta o adaptador com a credencial guardada e faz **uma** chamada barata e somente-leitura (BaseLinker `getInventories`; Tiny e Bling, uma página de um produto). Responde `{ok:true, detalhe}` com algo que prova a conexão (nome e id do inventário, total de produtos) e grava `status = 'conectado'`. Erro da plataforma vira instrução em português (`{ok:false, erro}`, 502) e grava `status = 'erro'` com o mesmo texto. Conector sem credencial devolve 400 e vira `desconectado`. Credencial nunca sai na resposta nem no log. |
| `POST /connectors/:id/sync` | JWT do usuário (admin) | Botão "Sincronizar agora" do cartão do conector. Mesma autorização das credenciais e do teste. Roda a **mesma** `sincronizarConector` do cron (`src/jobs/syncPedidos.ts`, `origem: 'manual'`) na hora, com o mesmo teto de páginas por rodada, e responde `{ok:true, pedidos, detalhe}` com uma frase para humano — zero pedidos é sucesso ("a conta respondeu, nenhum pedido novo desde a última leitura"), não erro; leitura que parou no teto diz que ainda há fila. Falha da plataforma vira instrução em português (`{ok:false, erro}`, 502) e grava o mesmo texto no cartão. Conector sem credencial devolve 400 e vira `desconectado`. **Não escreve nada em `sync_state`**: nem cursor (o dono do cursor é o cron, senão as duas execuções gravariam cursores diferentes a partir da mesma leitura e a atrasada poderia pular pedidos; o custo é o cron reler a janela, e o upsert é idempotente), nem pulso, nem `last_ok_at` (senão um clique com o cron morto faria o robô parecer vivo). O resultado vai só para o cartão, direto em `connectors` (`Db.marcarRodadaManual`). A execução vai para `ctx.waitUntil` **assim que começa**, não só quando o prazo estoura: senão o dono fechar a aba no meio cancelaria a leitura e o cartão ganharia um erro que não existiu. Se a leitura passar de 20 s, a resposta sai na hora dizendo que continua rodando (e que é preciso recarregar a página para ver o resultado — a tela não relê sozinha). Dois cliques seguidos entram na mesma execução; o registro dessa execução expira em 60 s, para uma leitura que nunca termina não deixar o botão preso em "Sincronizando…" para sempre. Detalhes e justificativas em `src/rotas/sincronizar.ts`. |
| `POST /connectors/:id/:plataforma/oauth/start` | JWT do usuário (admin) | `:plataforma` é `bling` ou `tiny`. Devolve `{url}` — e essa URL é do **próprio worker** (`/oauth/go`), não da plataforma: é lá que o cookie de vínculo é gravado. O `state` é assinado com uma chave derivada de `CREDENTIALS_KEY` e vale 10 min. |
| `GET /connectors/:plataforma/oauth/go?state` | `state` assinado | Grava o cookie de vínculo (`prodio_oauth`, HttpOnly/Secure/SameSite=Lax, Path=/connectors) e redireciona para o consentimento da plataforma. Roda sem JWT: é navegação de janela, e quem a autoriza é o `state`, que só `/oauth/start` (admin) emite. |
| `GET /connectors/:plataforma/oauth/callback?code&state` | `state` assinado **+ cookie de vínculo** | Troca o code por tokens e grava cifrado. Limpa o `ultimo_erro` e tira o conector de 'erro' (`Db.marcarCredencialNova`), mas não grava `ultimo_sync` nem `sync_state`: autorizar não é sincronizar (antes chamava `worker_set_sync_state(ok)`, e o cartão dizia "O robô está sincronizando sozinho" sem o robô ter rodado). Cadastre **esta** URL como redirect no app da plataforma (não a `/oauth/go`). Bling: Basic `client_id:client_secret` + `enable-jwt: 1`. Tiny: Keycloak, credenciais no corpo, com `redirect_uri`. |
| `POST /webhooks/bling/:connectorId` | `X-Bling-Signature-256` | HMAC-SHA256 do corpo cru com o `client_secret`. Responde 200 na hora, processa em `ctx.waitUntil`. Eventos de pedido buscam o pedido e fazem `worker_upsert_orders` (idempotente por `external_id`). |

## Crons (`wrangler.toml`)

- `*/5 * * * *` → `syncPedidos` (pedidos incrementais por `sync_state.cursor`, com sobreposição) e depois `aplicarOutbox`.

`scheduled()` **devolve** a promessa do trabalho (`executarCron` em `src/index.ts`); não usa `ctx.waitUntil`. Com
waitUntil e retorno imediato, a Cloudflare corta o trabalho 30 s depois do fim da invocação, sem passar por catch
nenhum — foi assim que o robô passou 24 h sem gravar nada em 25/09/2026. O CPU por execução continua limitado (10 ms
no Free, 30 s no pago), e por isso cada rodada é curta e grava o progresso aos pedaços:

- **Página por página.** Adaptador com `pullOrdersPagina` (hoje o BaseLinker) é lido uma página por vez: os pedidos
  vão para `worker_upsert_orders` e só depois o cursor daquela página é gravado em `sync_state` (`Db.gravarCursor`).
  Morrer na página 4 faz a próxima rodada começar na 4. Bling e Tiny (sem leitura por página) continuam numa página
  única por rodada; o Tiny tem teto próprio (`max_pedidos`).
- **Teto por rodada.** `connectors.config.paginas_por_rodada` (padrão 2, de 1 a 20). Atraso grande é drenado em
  várias rodadas de 5 minutos; cada rodada que chega ao teto fecha como sucesso e grava onde parou.
- **Cursor que nunca pula pedido** (BaseLinker, `pullOrdersPagina`): página cheia continua do maior `date_confirmed`
  lido, inclusive (o "+1 segundo" da documentação pularia os pedidos que dividem o segundo da borda); página
  incompleta volta 2 h do maior lido; página vazia não mexe; `dias_iniciais` só vale sem cursor (cursor antigo é
  drenado inteiro, sem salto). Segundo com 100 ou mais pedidos confirmados (importação em massa): o cursor ganha
  `id_from` e o robô percorre aquele segundo por número de pedido (`baselinker.segundoCheio` no log, warn), sem pular
  nenhum. Só se a API ignorar `id_from` o robô anda +1 para não ficar preso (`baselinker.segundoLotado`, error): aí
  pode ter ficado pedido daquele segundo para trás, e o log diz qual segundo conferir.
- **Pulso.** Antes de decifrar a credencial e de falar com a plataforma, `sync_state.last_run_at` recebe o início da
  tentativa (`Db.marcarPulso`, upsert direto, sem RPC). `worker_set_sync_state` regrava a coluna com o fim da rodada,
  e o job devolve o início logo depois. Contrato para a interface: `last_run_at` = início da última tentativa do
  robô; `last_ok_at` = fim da última tentativa do robô que deu certo; `connectors.ultimo_sync` = último sucesso (robô
  ou botão). `last_run_at > last_ok_at` = a última tentativa não terminou bem. Como conferir: `docs/deploy.md` §9.
- **Logs persistidos.** `[observability] enabled = true` no `wrangler.toml` (Workers Logs, vale no Free).
- **Sem pedido cru.** Os adaptadores não mandam mais o pedido inteiro da plataforma para `orders.raw`: ninguém lê a
  coluna, e serializar o pedido cru custava CPU a cada rodada. A chave `raw` só vai quando há anotação (o webhook do
  Bling anota o id do evento); ausente, o banco mantém o que já havia.
- `0 3 * * *` → `auditor` (saldo do hub por produto → `hub_stock_snapshots`; divergência = hub − (snapshot anterior + bipes do dia) → `audit_runs`).

Erro em um conector grava `ultimo_erro` via `worker_set_sync_state(id, null, false, erro)` e não interrompe os outros tenants.
O texto gravado ali é o MESMO funil das rotas (`src/conectores/mensagens.ts`: `mensagemDaFalhaDeSync` + `redigirSegredos`),
nunca `e.message` cru: o cartão do conector mostra essa coluna, e `connectors` é legível por qualquer membro do tenant
(policy `connectors_select`), inclusive a sessão anônima do tablet do chão. A mensagem crua fica só no log, e mesmo lá redigida.

**Conector ativo sem credencial nenhuma** é o único erro que não se repete: os três jobs marcam
`status = 'desconectado'` com `ultimo_erro = "sem credenciais: reconecte em Conectores"` e param de
tentar (`src/jobs/semCredenciais.ts`), porque `listarConectoresAtivos` só olha `conectado` e `erro`.
É o caso do seed, que cria o conector do BaseLinker conectado e sem credencial (credencial é
cifrada, não dá para semear) — sem isso o cron gravaria a mesma falha a cada 5 minutos para sempre.
Salvar a credencial ou concluir o OAuth reativa. Token expirado e queda de rede **não** entram
aqui: continuam tentando na rodada seguinte, que é exatamente quando o refresh acontece.

### Outbox e freio

`worker_claim_outbox` devolve o lote agrupado por SKU. O adaptador aplica em série e **para na primeira falha**; o job então marca: aplicados → `aplicado`; o que falhou → `erro` com a mensagem; o restante volta a `pendente` (`worker_apply_outbox_result(ids, false, null)`, sem contar tentativa). Com `config.dry_run = true` nada é escrito na plataforma e o lote inteiro volta a `pendente` (o outbox não é consumido; ao desligar o dry run, os deltas acumulados são aplicados).

BaseLinker: `updateInventoryProductsStock` é absoluto. O adaptador lê `getInventoryProductsStock` antes, soma o delta e grava, um produto por chamada. Precisa de `config.warehouse_id` (ex.: `bl_1234`) e opcionalmente `inventory_id`.
Bling: `POST /estoques` é por delta (`E`/`S`). Precisa de `config.deposito_id`.
Tiny: `POST /estoque/{idProduto}` é por delta (`tipo` `E`/`S`). `config.deposito_id` é opcional — sem ele o Tiny lança no depósito padrão da conta. O Tiny não tem busca de produto por lote de SKU: até 25 SKUs o adaptador resolve um a um (`GET /produtos?codigo=<sku>&limit=1`); acima disso lê o catálogo inteiro paginado e guarda o de-para em memória pelo tempo do job. Movimento de estoque **não é repetido automaticamente** em 5xx nem em queda de rede (`repetivel: false` no cliente HTTP): a chamada pode ter sido aplicada do outro lado e repetir dobraria o saldo. Só 429, que é recusa garantida, é repetido.

## Config do conector (`connectors.config`)

`{ push_estoque: bool, dry_run: bool, dias_iniciais: 3, inventory_id, warehouse_id (BaseLinker), deposito_id (Bling e Tiny), dias_nfe: 60 (Tiny), max_pedidos: 150 (Tiny), max_produtos: 250 (Tiny) }`.

`max_pedidos` e `max_produtos` são tetos **por execução** do Tiny: cada detalhe de pedido e cada saldo custa uma chamada a 1,1 s, e o cron de pedidos roda de 5 em 5 min. Sem teto, uma primeira carga grande estoura a janela, morre no meio e o cursor nunca avança — o conector ficaria parado para sempre. Quando o teto corta a fila, o adaptador processa os pedidos mais antigos primeiro e devolve o cursor só até onde chegou (`tiny.pullOrders.teto` no log); a rodada seguinte continua de lá.

## Tiny (Olist) — validar os endpoints antes do primeiro uso em produção

O adaptador (`src/conectores/tiny.ts`) fala a **API v3** do Tiny, autenticada por OAuth2 sobre
Keycloak (`accounts.tiny.com.br/realms/tiny`). Access token ~4 h; refresh ~24 h e **rotativo**:
cada renovação invalida o refresh anterior, por isso o novo par é persistido na hora
(`worker_set_credentials`). Três cuidados que vêm daí, todos cobertos por teste:

- resposta de token sem `refresh_token` novo **não apaga** o que está gravado (`mesclarCredenciaisTiny`);
- antes de renovar, o adaptador **relê as credenciais** do banco e adota o par mais novo: duas
  execuções do cron renovando juntas queimariam uma o token da outra;
- quando não há mais o que fazer sem o dono (refresh vencido, `invalid_grant`, 401 depois de
  renovar), o erro sai com `codigo: 'reauth'` e a mensagem "reconecte o Tiny em Sistema ›
  Conectores" — é o texto que a tela deve mostrar.

A v3 **não tem webhooks**: `verifyWebhook` devolve `unsupported` e os pedidos vêm só por polling do cron.

> **Pendência conhecida.** A rede da máquina onde o adaptador foi escrito **não alcança
> `tiny.com.br` nem o portal de documentação**, então nada foi exercitado contra uma conta real.
> O mapa foi conferido linha a linha contra o swagger da v3 e contra integrações abertas em
> produção (ver a coluna "situação"), mas a primeira conexão de verdade ainda é o teste.
> Tudo o que precisa de conserto está em **um arquivo só**: `src/conectores/tinyMapa.ts`
> (objeto `MAPA_TINY` + as interfaces de payload logo abaixo dele). `tiny.ts` nunca escreve um
> caminho ou um nome de campo na mão.

O que conferir, com `Authorization: Bearer <access_token>` e base `https://api.tiny.com.br/public-api/v3`:

| Uso no Prodio | Chamada esperada | Situação |
| --- | --- | --- |
| `pullOrders` | `GET /pedidos?dataAtualizacao=AAAA-MM-DD&limit=100&offset=0` | **conferido** contra o swagger e duas integrações em produção: `dataAtualizacao` existe e aceita **só data pura** (com hora a v3 responde 400); envelope `{itens, paginacao}`; `limit`/`offset`. |
| `pullOrders` / `pullOrder` | `GET /pedidos/{id}` | **conferido**: `itens[].produto.{id,sku,descricao}`, `quantidade`, `valorUnitario`, `valorTotalPedido`/`valorTotalProdutos`, `situacao` numérica. |
| `pullCatalog` | `GET /produtos?limit=100&offset=0` | **conferido**: SKU volta em `sku` e o filtro por SKU é `codigo`. |
| `pullFinishedStock` | `GET /estoque/{idProduto}` | **conferido**: `saldo`, `reservado` e `depositos[].{id,nome,saldo}` (há integração que também lê `depositos[].deposito.id` — os dois formatos são tratados). Resposta sem saldo nenhum é **pulada**, não vira zero. |
| `pushFinishedStock` | `POST /estoque/{idProduto}` com `{tipo:'E'\|'S', quantidade, deposito:{id}, observacoes}` | **conferido** (`tipo` aceita `E`, `S` e `B`, de balanço/absoluto). Confirme o depósito antes de tirar o `dry_run`. |
| `findInboundNfe` | `GET /notas?tipo=E&dataInicial&dataFinal` → `GET /notas/{id}` → `GET /notas/{id}/xml` | **parcial**: `dataInicial`/`dataFinal` (AAAA-MM-DD) e `chaveAcesso`/`tipo`/`numero`/`serie` no detalhe estão conferidos; **falta confirmar** se o filtro `tipo` vale na listagem, se a listagem devolve `chaveAcesso` (é por ela que o Prodio casa a nota) e o formato de `/notas/{id}/xml` (cru, `{xml}` ou base64 — os três são tratados). |

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
- service_role com INSERT/UPDATE em `sync_state` (pulso e cursor por página, upsert direto) e UPDATE em `connectors` (status do teste e resultado do botão) — travado em `supabase/tests/0008_integracoes.test.sql`;
- `worker_claim_outbox` devolve `[{product_id, sku, delta, ids}]`;
- `worker_apply_outbox_result(p_ids, false, null)` devolve a `pendente` sem contar tentativa;
- `worker_upsert_hub_stock(p_tenant_id, p_connector_id, p_itens [{sku, saldo}])`, `worker_record_audit(p_tenant_id, p_connector_id, p_divergencias)`;
- `upsert_nfe_inbound` aceita `auth.role() = 'service_role'` (sem membership) quando `origem = 'email'`;
- bucket de Storage `nfe-xml` (privado).

## Estrutura

```
src/index.ts            roteador, cron dispatcher, health, handler de e-mail
src/cors.ts             lista de origens permitidas, preflight e cabeçalhos
src/env.ts              tipagem das variáveis
src/http.ts             cliente HTTP: fila por execução, espaçamento por conta, prazo por chamada, backoff em 429/5xx, log
src/db.ts               Supabase (service role) + cliente do usuário; RPCs worker_*
src/conectores/tipos.ts interface Conector e PedidoNormalizado
src/conectores/baselinker.ts, bling.ts, tiny.ts (+ tinyMapa.ts, tinyAuth.ts, tinyNfe.ts), index.ts (fábrica)
src/jobs/syncPedidos.ts, aplicarOutbox.ts, auditor.ts, semCredenciais.ts
src/rotas/webhooks.ts, nfe.ts, credenciais.ts, testar.ts, util.ts
src/email.ts, src/zip.ts, src/nfe-mapa.ts, src/cron.ts (expressão desconhecida roda o ciclo curto, nunca fica em silêncio)
```
