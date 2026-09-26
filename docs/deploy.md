# Prodio — instalar num projeto Supabase

Passo a passo para sair do zero até a interface conversando com o banco real. Foi validado contra PostgreSQL 16 com os stubs do Supabase; os itens marcados **no painel** só existem no projeto hospedado.

Gere os arquivos antes de começar:

```bash
bash supabase/build.sh                 # usa matheus@eddias.com.br como admin
bash supabase/build.sh outro@email.com # ou passe outro e-mail
```

Saem quatro arquivos em `supabase/dist/` (não versionados, são gerados):

| Arquivo | O que faz |
|---|---|
| `schema.sql` | Todas as migrations na ordem. Cria tabelas, RLS, funções e views. |
| `dados_eddias.sql` | Cria a empresa Eddias com cadastros de exemplo. Não toca em `auth.users`. |
| `limpar_exemplo.sql` | Apaga os dados de exemplo — e tudo o mais do tenant `eddias`: conectores, pedidos, OCs, NF-e, etiquetas, bipes, ledger e cadastros —, mantendo empresa, usuários, locais, unidades, perfis de etiqueta, operadores e aparelhos. Se achar sinal de uso real (conector ligado, pedido, OC, NF-e, etiqueta, bipe, movimento de estoque ou produto, insumo ou fornecedor que não são do exemplo — como os que a importação do ES grava), para sem apagar nada, mostra as contagens e indica o `limpar_so_exemplo.sql`; com conector ligado ou pedido real a mensagem diz para não forçar (forçar apagaria a integração e os pedidos). Sem integração no ar, para apagar tudo mesmo assim, ponha `set prodio.limpar_mesmo_assim = 'sim';` no começo da mesma execução. A fonte é `supabase/limpar_exemplo.sql`. |
| `limpar_so_exemplo.sql` | Apaga **só** os dados de exemplo e o que foi criado em cima deles nos testes (etiquetas, bipes, plano do dia, fila de estoque, saldos do hub, inventários e avisos do exemplo), mantendo todos os conectores, credenciais, De-Para de status, `sync_state` e pedidos reais. É o caminho de quem já ligou um conector antes de importar o cadastro. A fonte é `supabase/limpar_so_exemplo.sql`. Detalhes abaixo, em "Tirar os dados de exemplo". |

## 1. Criar o usuário administrador

**No painel**, em Authentication > Users > Add user, crie o usuário com o e-mail do administrador e uma senha. Marque como confirmado.

O cadastro público está desligado de propósito (`enable_signup = false`): num sistema de fábrica, quem entra é convidado.

## 2. Aplicar o schema

Pelo SQL Editor do painel: abra `supabase/dist/schema.sql`, cole e execute.

Ou por linha de comando, com a string de conexão em Settings > Database (use a do pooler na porta 5432, modo session):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dist/schema.sql
```

Ou com o Supabase CLI, que registra as versões e permite `db diff` depois:

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push
```

O schema é idempotente: rodar de novo não quebra nada.

Esse caminho é o da **primeira** instalação. Depois dela, migration nova entra pelo push em main (seção 10), com controle, backup e ensaio.

## 3. Criar a empresa e os dados de exemplo

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dist/dados_eddias.sql
```

Se o usuário do passo 1 não existir, o arquivo interrompe com uma mensagem dizendo isso. Ao final você tem a empresa Eddias, 11 produtos, 13 insumos, 5 fornecedores, 4 fichas técnicas, plano do dia, saldos, 6 ordens de compra, 6 notas fiscais e 3 operadores com PIN 1234, 2345 e 3456.

Os cinco conectores (BaseLinker, Bling, Tiny, Omie, Magis5) nascem **desconectados**, sem credencial e sem último sync. É de propósito: credencial é cifrada com a `CREDENTIALS_KEY` do worker e não pode ser semeada, então um conector semeado como conectado seria uma promessa falsa na tela e uma falha a cada 5 minutos no cron. Quem conecta é você, pela tela, depois do passo 8.

Quando for usar dados reais, tire o exemplo (abaixo) e importe os seus pelas telas de cadastro (ou, vindo do Eddias Suprimentos, pela importação do backup do ES: ela recusa gravar enquanto houver dado de exemplo e a tela diz qual dos dois scripts rodar).

### Tirar os dados de exemplo: `limpar_exemplo.sql` ou `limpar_so_exemplo.sql`

Os dois reconhecem o exemplo pelos ids fixos do seed (produtos `a0…`, insumos `b0…`, fornecedores `c0…`, pedidos `seed:%`, OCs `0c…`, NF-e `0e…` e assim por diante), nunca por nome ou SKU — vários SKUs do exemplo são SKUs reais da Eddias. Rode no SQL Editor do painel (como dono do banco) ou com `psql -v ON_ERROR_STOP=1 -f`. Cada um é um bloco só: ou apaga tudo o que deve, ou nada.

| Situação | Use |
|---|---|
| O Prodio ainda **não** tem uso real: nenhum conector ligado, nenhum pedido que não seja `seed:%`. | `limpar_exemplo.sql` (apaga todos os dados do tenant, menos empresa, usuários, locais, unidades, perfis, operadores e aparelhos). |
| **Já** há conector ligado ou pedido real (por exemplo: o BaseLinker do seed, `0d…01`, foi conectado e o robô já grava pedidos). | `limpar_so_exemplo.sql`. O `limpar_exemplo.sql` apagaria a integração e os pedidos — por isso ele para na trava nesse caso. |

O `limpar_so_exemplo.sql`:

- **Mantém** empresa, membros, usuários, locais, unidades, perfis de etiqueta, operadores, aparelhos, etapas, numeração de documentos, auditorias do robô, **todos** os conectores (inclusive as linhas `0d…` do seed), credenciais, De-Para de status, `sync_state`, os pedidos reais com os itens e todo cadastro, documento ou movimento que não é do exemplo. Canal do seed (`0a…`) com preço de produto real, ou editado na tela (comissão, taxas e frete são configuração de verdade), também fica. Aviso que não é do seed fica, mesmo citando SKU que também está no exemplo.
- **Apaga** o exemplo e o que pendura nele: os apelidos do seed, fichas, vínculos fornecedor-insumo, preços, saldos, pedidos `seed:%`, OCs/NF-e/recebimento/inventário do seed, avisos do seed (`09…`), e o que os testes criaram em cima dele — etiquetas e bipes de produto do exemplo, fila de estoque (outbox) desses produtos, saldos do hub, plano do dia, recebimentos de OC/NF-e do seed, inventários só com insumo do exemplo, e os movimentos de estoque de insumo do exemplo que vêm do seed, de bipe, de inventário ou de recebimento do seed (com os estornos). Inventário conta como teste: a contagem é de um insumo que vai sumir, e o insumo importado nasce com saldo zero.
- **Item de pedido real** que apontava para produto do exemplo fica com `product_id` nulo e o `sku_externo` intacto. A importação do ES religa (mesma regra do robô: apelido, depois SKU principal) e a prévia mostra quantos.
- **Ledger:** `stock_moves` é append-only. Os movimentos dos insumos do exemplo não podem ser estornados (o insumo precisa sair), então o gatilho `stock_moves_append_only` é desligado só em volta desse `DELETE` e religado em seguida, dentro da mesma transação — como no `limpar_exemplo.sql`. Movimento de insumo que não é do exemplo nunca é apagado.
- **Trava:** para sem apagar nada, e mostra as contagens, quando acha dado que não é do exemplo ligado ao exemplo e pode ser real: OC ou NF-e fora dos ids do seed com fornecedor ou insumo do exemplo, recebimento fora do seed com insumo do exemplo, movimento de insumo do exemplo lançado à mão ou por nota de verdade, baixa de insumo real feita por bipe/NF-e/recebimento do exemplo, ficha de produto real usando insumo ou produto do exemplo e De-Para de SKU feito na tela do conector num produto do exemplo (qualquer apelido fora dos cinco pares do seed; a mensagem lista os pares `SKU do pedido → SKU do produto`). Confira; para apagar mesmo assim, ponha `set prodio.limpar_mesmo_assim = 'sim';` no começo da mesma execução (vale para uma execução só). Com a confirmação, a OC do fornecedor do exemplo sai, a NF-e real fica sem o vínculo, a baixa de insumo real fica (acerte o saldo no inventário) e o De-Para sai com o produto — o resultado lista os pares, e os SKUs voltam para a lista do De-Para do conector para você refazer depois da importação.
- Termina listando, tabela por tabela, quantas linhas saíram e quantas ficaram (em `NOTICE` e na consulta do fim). Rodar de novo não apaga nada; rodar depois da importação do ES também não (o catálogo importado não tem os ids do exemplo).

### Correções pontuais (`supabase/correcoes/`)

São arquivos SQL avulsos para consertar um banco que já recebeu uma versão anterior dos dados. Não são migrations (não mudam schema) e não entram no `build.sh`: você roda à mão, uma vez, e só se o caso for o seu. Todos são seguros de rodar duas vezes.

| Arquivo | Quando rodar |
|---|---|
| `20260922_conector_fantasma.sql` | Se você aplicou `dados_eddias.sql` **antes de 22/09/2026**. Aquela versão semeava o BaseLinker como conectado, com último sync, cursor, fila de estoque, saldos de hub e um `inventory_id` inventado — tudo sem credencial. Rode **antes de publicar o worker** (passo 8): é ele que descobre o problema, tentando sincronizar de 5 em 5 minutos um conector que nunca existiu. |

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/correcoes/20260922_conector_fantasma.sql
```

Ele só mexe em conector **sem credencial salva** — integração que comprovadamente nunca foi conectada. Conector conectado de verdade passa intacto. Não apaga pedidos, produtos, insumos, estoque, ordens de compra nem notas. Ao final imprime a lista de conectores: todos têm que aparecer como `desconectado` enquanto `tem_credencial` for `f`. Rodar de novo devolve zero alterações.

## 4. Ligar o gatilho de token

**No painel**, em Authentication > Hooks > Custom Access Token, aponte para a função `public.custom_access_token_hook` e ative.

Sem isso nada funciona: é esse gatilho que coloca a empresa e o papel dentro do token, e todas as políticas de segurança leem dali. O sintoma de esquecer é entrar no sistema e não ver nada.

## 5. Ligar a sessão anônima

**No painel**, em Authentication > Providers > Anonymous sign-ins, ative.

É como o celular do chão de fábrica entra sem e-mail: ele abre uma sessão anônima, o administrador registra o aparelho com um código de pareamento e só então ele vira um membro do tipo dispositivo, preso a um local.

## 6. Criar o balde de arquivos

**No painel**, em Storage, crie um balde privado chamado `nfe-xml`. É onde o worker guarda o XML das notas recebidas.

## 7. Apontar a interface para o banco

```bash
cp apps/web/.env.example apps/web/.env
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Settings > API). Sem essas duas variáveis a interface continua rodando com dados de exemplo em memória, o que é útil para demonstração.

```bash
pnpm dev
```

Entre com o e-mail e a senha do passo 1.

## 8. Subir o worker (quando for conectar hub ou receber XML)

Antes de publicar: se o banco recebeu os dados de exemplo antes de 22/09/2026, rode
`supabase/correcoes/20260922_conector_fantasma.sql` (seção 3). Sem isso o cron acorda com um conector
marcado como conectado e sem credencial, e passa a falhar de 5 em 5 minutos.

`PUBLIC_URL` e `CORS_ORIGENS` não são segredo e moram em `[vars]` do `apps/worker/wrangler.toml`: vão
junto em todo `wrangler deploy`. Não grave os dois como segredo nem como variável no painel (o
`wrangler deploy` substitui a lista de variáveis pela do arquivo). Numa conta nova, troque em
`[vars]` o endereço do worker e a lista de origens da interface antes de publicar. Segredo passa a
valer na requisição seguinte, sem publicar de novo.

```bash
cd apps/worker
wrangler login
wrangler deploy          # anote o https://prodio-worker.<conta>.workers.dev que ele imprime
```

```bash
# obrigatórios sempre
wrangler secret put SUPABASE_URL          # https://xxxx.supabase.co
wrangler secret put SUPABASE_SERVICE_KEY  # Supabase > Settings > API > service_role
wrangler secret put SUPABASE_ANON_KEY     # a anon/public key do mesmo lugar
wrangler secret put CREDENTIALS_KEY       # openssl rand -hex 32 — guarde: girar esta chave
                                          # invalida toda credencial de conector já cifrada

# opcionais: app OAuth global. No Tiny o app é privado por seller, então o normal é o
# cliente colar client_id/client_secret na própria tela de Conectores e pular estes dois.
wrangler secret put BLING_CLIENT_ID
wrangler secret put BLING_CLIENT_SECRET
wrangler secret put TINY_CLIENT_ID
wrangler secret put TINY_CLIENT_SECRET

wrangler secret list                      # confere os nomes gravados (nunca mostra valores)
```

Se `CORS_ORIGENS` em `[vars]` não tiver o endereço da interface, ela falha com erro de CORS em tudo
que fala com o worker (só `localhost` passa). Se `PUBLIC_URL` estiver errado, `/oauth/start` responde
500 e o botão "Conectar o Tiny" não sai do lugar. A lista completa, com o que cada variável faz, está em `apps/worker/README.md`.

Depois preencha `VITE_WORKER_URL` com esse mesmo endereço: no `.env` da interface para o build local, e nas **Variables** do GitHub (seção 10) para o site publicado — variável `VITE_*` é lida no build, então o site só enxerga o worker depois de uma publicação nova. O detalhe de cada rota e do e-mail de entrada está em `apps/worker/README.md`.

Confira que o worker respondeu e que ele aceita a origem da interface:

```bash
curl -s https://prodio-worker.<conta>.workers.dev/health
# {"ok":true,"servico":"prodio-worker"}

curl -s -o /dev/null -D - -X OPTIONS \
  -H 'Origin: https://prodio-web.pages.dev' -H 'Access-Control-Request-Method: POST' \
  https://prodio-worker.<conta>.workers.dev/connectors/x/test | grep -i '^access-control'
# esperado: access-control-allow-origin: https://prodio-web.pages.dev  (e não "*", e não vazio)
```

Com o worker no ar, conecte as plataformas em Configurações > Conectores. Só nesse momento o conector sai de `desconectado`: é o worker que cifra a credencial e grava o status. Antes de ligar o envio de estoque do BaseLinker, informe o depósito (`warehouse_id`) — sem ele o envio é recusado com erro, de propósito, para o Prodio não escrever saldo no inventário errado.

**De-Para de status (pendência).** A RPC `set_status_map` existe e funciona, mas nenhuma tela chama. Enquanto isso, todo pedido importado entra como `demanda` — nada vira `carteira`, `enviado` nem `cancelado`, então cancelado conta como demanda e a projeção fica alta. Não cadastre o mapa "na mão" com nomes em inglês: BaseLinker, Tiny e Bling devolvem o status como código numérico da conta, e um mapa que não casa faz o pedido entrar com significado nulo e sumir da demanda em silêncio — pior que não ter mapa.

## 9. O robô de 5 minutos: como saber se está vivo

O cron do worker (`*/5 * * * *`) lê os pedidos novos de cada conector conectado. Em 25/09/2026 ele passou um dia sem gravar nada — nem sucesso, nem erro — enquanto o botão "Sincronizar agora" funcionava. Causa (reproduzida em 26/09 contra um PostgREST 12.2.3 com as migrations deste repositório; em produção, o log `sync.listar` daquele dia traz "Could not embed because more than one relationship was found"): a consulta que lista os conectores pedia o tenant junto (embed `tenants(slug, fuso)`), o PostgREST recusava com `PGRST201` e o worker só registrava `sync.listar` no log. Nenhum conector era tentado — nem pedidos, nem envio de estoque, nem o auditor da madrugada. A consulta foi trocada por duas simples, e uma falha dela agora aparece no cartão ("O robô não está rodando", com o código do erro). Além disso, por prevenção, o robô:

- **grava o progresso a cada página** de pedidos (100 no BaseLinker): primeiro os pedidos, depois o ponto de onde continuar. Se uma rodada morrer na página 4, a próxima começa na 4, não na 1;
- **lê poucas páginas por rodada** (`paginas_por_rodada`, padrão 2 = até 200 pedidos a cada 5 minutos). Um atraso grande — a primeira carga, ou um robô que ficou parado — é drenado sozinho em várias rodadas;
- **grava o pulso antes de ler**: `sync_state.last_run_at` é o início da última tentativa do robô. O botão "Sincronizar agora" não mexe em `sync_state` (nem no pulso, nem no cursor), para não fazer um robô parado parecer vivo;
- **guarda os logs** no painel da Cloudflare (`[observability]` no `wrangler.toml`), sem precisar de `wrangler tail`.

Publicar esta versão **não pede SQL nenhum**: é só publicar o worker (`pnpm deploy:worker`, ou `cd apps/worker && wrangler deploy`). Em até 5 minutos o pulso aparece; a fila atrasada entra ao longo das rodadas seguintes.

### Conferir pelo banco (SQL Editor)

```sql
select c.nome, c.status, c.ultimo_erro,
       s.last_run_at as ultima_tentativa_do_robo,
       s.last_ok_at  as ultimo_sucesso_do_robo,
       c.ultimo_sync as ultimo_sucesso,            -- do robô ou do botão
       s.runs, s.cursor
  from public.connectors c
  left join public.sync_state s on s.connector_id = c.id
 where c.status <> 'desconectado';
```

| O que aparece | O que quer dizer |
|---|---|
| `ultima_tentativa_do_robo` vazia ou com mais de 15 minutos | **O robô não está rodando.** Worker não publicado, cron desligado, ou o worker cai antes de chegar ao conector (segredo `SUPABASE_URL` ou `SUPABASE_SERVICE_KEY` errado, ou a lista de conectores não pôde ser lida: `ultimo_erro` começa com `cron:` e traz o código). Veja os logs (`sync.listar`, `cron.falha`). |
| tentativa recente, `ultimo_sucesso_do_robo` bem mais antigo, `status` conectado e `ultimo_erro` vazio | **O robô roda e morre antes de terminar** (CPU ou tempo da Cloudflare). O cursor ainda anda página a página; se ele não mudar entre uma rodada e outra, baixe `paginas_por_rodada` para 1 e veja os logs. |
| tentativa recente e `status` = erro | Falhou e disse por quê: o motivo está em `ultimo_erro`, o mesmo texto do cartão. |
| `ultima_tentativa_do_robo` anterior a `ultimo_sucesso_do_robo` | Tudo certo: a última tentativa terminou bem. |

No BaseLinker o `cursor` é `{"date_confirmed_from": <segundos unix>}`, o ponto de onde o robô continua. Com o robô em dia ele fica cerca de 2 h antes do último pedido lido: é a sobreposição que pega pedido que aparece atrasado. Relê-se de propósito; o banco não duplica pedido.

### Conferir pelos logs (painel da Cloudflare)

Workers & Pages > prodio-worker > aba **Logs** (ou **Observability**). Ficam 3 dias no plano Free e 7 no pago. O que procurar:

- `cron.inicio` a cada 5 minutos: o cron está disparando;
- `sync.ok` com `pedidos`, `paginas` e `emDia` (`false` = ainda drenando a fila, é normal na primeira carga);
- `sync.falha`, `cron.falha`, `sync.listar`, `sync.pulso`: o motivo de uma falha. `sync.listar` (e `outbox.listar`, `auditor.listar`) traz `codigo`, `detalhes` e `dica` do PostgREST — `PGRST201` foi o do incidente;
- execução com resultado `exceededCpu` ("Exceeded CPU Limit"): a rodada estourou o CPU do plano — baixe `paginas_por_rodada`;
- `baselinker.segundoLotado`: mais de 100 pedidos confirmados no mesmo segundo. É o único caso em que o robô avança sem ler tudo daquele segundo (senão ficaria preso nele para sempre); se aparecer, avise.

As últimas 100 execuções do cron também aparecem em Workers & Pages > prodio-worker > Settings > Trigger Events > **View events**.

### Mudar o número de páginas por rodada

```sql
update public.connectors
   set config = config || '{"paginas_por_rodada": 5}'::jsonb
 where plataforma = 'baselinker';
```

Vale de 1 a 20; valor inválido volta ao padrão 2. No plano Free (10 ms de CPU por execução do cron) fique em 1 ou 2. No pago (30 s de CPU para crons de 5 minutos), 5 a 10 drena uma fila grande mais depressa. Regra prática: páginas × 100 acima do número de pedidos que a conta recebe em 2 horas. Abaixo disso nada se perde, só o pedido novo leva uma ou duas rodadas a mais para entrar.

## 10. Publicação automática (GitHub Actions)

A partir daqui, publicar é fazer push, como no ES: **push em `main` = produção**; push em qualquer outro branch = uma **prévia** só da interface, com o link no resumo do run. Em main, nesta ordem, cada passo só se o anterior deu certo: migrations pendentes (backup cifrado → ensaio → aplicar) → worker → interface. Se qualquer teste falhar, nada é publicado. O mecanismo, as provas e os limites estão em `docs/publicacao-automatica.md`.

### O que cadastrar no GitHub (uma vez, pelo navegador)

Repositório `matheuseddias/Prodio` > **Settings** > **Secrets and variables** > **Actions**. O nome tem de ser exatamente este.

| Aba | Nome | O que é |
|---|---|---|
| Secrets | `CLOUDFLARE_API_TOKEN` | token da Cloudflare do passo 1 |
| Secrets | `CLOUDFLARE_ACCOUNT_ID` | id da conta Cloudflare (passo 2) |
| Secrets | `SUPABASE_DB_URL` | connection string do **Session pooler** (passo 3) |
| Secrets | `BACKUP_SENHA` | senha dos backups, gerada e guardada por você (passo 4) |
| Variables | `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` (Supabase > Settings > API) |
| Variables | `VITE_SUPABASE_ANON_KEY` | a anon/public key do mesmo lugar |
| Variables | `VITE_WORKER_URL` | `https://prodio-worker.matheus-ea1.workers.dev` |
| Variables | `VITE_DOMINIO_EMAIL_XML` | opcional: `prodio.com.br` |

Secrets ninguém lê de volta (nem você: só dá para trocar). Variables são públicas por desenho: as `VITE_*` vão dentro do JavaScript do site (`docs/deploy-web.md`, passo 1). A `service_role`, a `CREDENTIALS_KEY` e os `client_secret` **não** vão para o GitHub: continuam como segredo do worker na Cloudflare (passo 8), e sobrevivem a toda publicação.

Enquanto os dois da Cloudflare não existirem, o workflow só testa e avisa "publicação pulada". Com eles e sem `SUPABASE_DB_URL`, main não publica nada (sem ler o banco não dá para saber se há migration pendente).

Depois de cadastrar tudo, para publicar sem esperar um push novo: **Actions** > **Publicar** > o run mais recente de `main` > **Re-run all jobs** (funciona no navegador do celular e no app do GitHub). Re-run de um run que **não** é o mais recente de main não publica nada, de propósito: poria código velho no ar.

**1. Token da Cloudflare.** Em dash.cloudflare.com > ícone do perfil > **My Profile** > **API Tokens** > **Create Token** > **Custom token** > **Get started**. Nome: `GitHub Actions Prodio`. Em **Permissions**, duas linhas: `Account` · `Workers Scripts` · `Edit` e `Account` · `Cloudflare Pages` · `Edit`. Em **Account Resources**: `Include` · a sua conta. Nada de Zone, nada de filtro de IP (os IPs do GitHub mudam). **Continue to summary** > **Create Token**, copie (aparece uma vez só) e cadastre como `CLOUDFLARE_API_TOKEN`.
Por que só essas duas: `wrangler deploy` do worker (código, crons, `[vars]`, `[observability]` e o endereço `workers.dev`) só usa endpoints `/workers/scripts/…` e `/workers/subdomain`, todos cobertos por *Workers Scripts: Edit* (esquema da API da Cloudflare, github.com/cloudflare/api-schemas); `wrangler pages deploy` usa *Cloudflare Pages: Edit* (developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration). O modelo pronto "Edit Cloudflare Workers" (developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions) também funciona, mas dá KV, R2, rotas de zona e mais. Com `CLOUDFLARE_ACCOUNT_ID` definido o wrangler não precisa listar contas, então não é preciso permissão de usuário.

**2. Account ID.** dash.cloudflare.com > **Workers & Pages**: o **Account ID** aparece na coluna da direita (32 letras e números; é o mesmo que vem depois de `dash.cloudflare.com/` na barra de endereço). Cadastre como `CLOUDFLARE_ACCOUNT_ID`.

**3. Connection string do Supabase.** No projeto do Supabase, botão **Connect** (topo) > **Session pooler**. Tem a forma `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-<n>-<região>.pooler.supabase.com:5432/postgres`. Troque `[YOUR-PASSWORD]` pela senha do banco (se não souber: Settings > Database > **Reset database password**; o worker e a interface não usam essa senha, usam as chaves da API). Se a senha tiver `@ : / ? #`, gere outra só com letras e números. Cadastre como `SUPABASE_DB_URL`.
Por que o Session pooler: os runners do GitHub não têm IPv6 (github.com/actions/runner-images/issues/668), e a conexão direta `db.<ref>.supabase.co` é só IPv6 sem o add-on pago de IPv4; o pooler compartilhado é IPv4 em todos os planos, e o modo sessão (porta 5432) mantém a sessão inteira, que o `pg_dump` e a trava do aplicador precisam (supabase.com/docs/guides/database/connecting-to-postgres). A porta 6543 (transaction) é recusada pelo aplicador.

**4. `BACKUP_SENHA`.** Gere você mesmo, no gerenciador de senhas (gerador de senha, 32 caracteres ou mais; o backup recusa menos de 20). Salve lá com o nome "Prodio — senha dos backups do GitHub" e cadastre a mesma como `BACKUP_SENHA`. Sem ela nenhum backup abre — nem por você, nem pelo GitHub, nem por mim. Não mande essa senha em chat.

**5. Branch de produção do Pages = `main`.** O projeto `prodio-web` é de envio direto, e nesse tipo de projeto o painel não tem onde trocar a branch de produção: ela é a escolhida na criação (`wrangler pages project create prodio-web --production-branch main`). Para conferir: Workers & Pages > prodio-web > **Deployments**: o bloco **Production** mostra o branch da versão no ar. O workflow confere pela API antes de cada envio e para com a mensagem "a branch de produção do prodio-web … não é main" se estiver errado. Para corrigir (de um computador, com o mesmo token do passo 1; o painel não tem esse campo em projeto de envio direto):

```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/pages/projects/prodio-web" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data '{"production_branch": "main"}'
```

As variáveis do painel do Pages (Settings > Variables and Secrets) não valem para envio direto: as `VITE_*` do build agora vêm das Variables do GitHub.

### O que acontece no primeiro push em main

Produção tem as `20260921*` aplicadas à mão e nenhum controle. A primeira execução reaplica as 13 migrations, cada uma na sua transação, e só grava cada uma se **nenhuma linha** de `public` mudar (a prova está em `docs/publicacao-automatica.md`, seção 3). Migration criada depois delas entra normalmente, mesmo que a primeira execução só aconteça semanas depois. Antes disso sai o backup cifrado e roda o ensaio. Daí em diante só roda o que for novo.

### Baixar e restaurar um backup

Cada run que aplicou migration tem, em **Actions** > o run > **Artifacts**, um `backup-producao-AAAAMMDD-HHMMSS-<commit>` guardado 14 dias. Ele fica no repositório privado e só abre com a `BACKUP_SENHA`. Para conferir que presta, restaure num Postgres de teste:

```bash
unzip backup-producao-*.zip
docker run --rm -d --name prodio-teste -p 5433:5432 -e POSTGRES_PASSWORD=teste postgres:17
TESTE_URL=postgres://postgres:teste@localhost:5433/postgres bash supabase/migracoes/restaurar-teste.sh backup-producao-*.dump.gpg
```

O gpg pede a senha e o script mostra quantas linhas cada tabela tem. Restaurar em produção é outra coisa (nunca por cima; tabela por tabela, com o fundador): `docs/publicacao-automatica.md`, seção 5.

### Plano B: à mão

Tudo continua funcionando sem o GitHub: `pnpm deploy:worker`, `pnpm deploy:web` (confira o `.env` antes) e, para o banco, `BANCO_URL='<session pooler>' pnpm db:aplicar --simular` e depois sem `--simular` (o mesmo aplicador, com controle e trava; o backup à mão é `BANCO_URL=… BACKUP_SENHA=… bash supabase/migracoes/backup.sh <pasta> <nome>`). Não cole mais migration no SQL Editor: o controle não fica sabendo, e a próxima publicação roda o arquivo de novo (é por isso que toda migration tem de ser reexecutável).

## Conferir se ficou de pé

```sql
-- no SQL Editor
select nome, slug from public.tenants;
select count(*) as tabelas_sem_rls
  from pg_tables t
  left join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public' and not c.relrowsecurity;  -- tem que dar 0
```

Na interface: o painel mostra a linha do dia com oito produtos, e a tela de estoque mostra treze insumos com saldo.

Para provar o ciclo inteiro: em Produção > Etiquetas, imprima algumas etiquetas; abra `/chao` em outro aparelho ou em outra aba, pareie com o código gerado em Configurações > Dispositivos, entre com o PIN e bipe. O bipe tem que aparecer na linha do dia e baixar os insumos no estoque, tudo numa transação só.

## Cuidados

- O projeto do Prodio é separado do Supabase do Eddias Suprimentos. Nada aqui lê ou escreve lá.
- A chave de serviço (`service_role`) só vai para o worker. Nunca para a interface, nunca para o navegador.
- Troque os PINs de exemplo antes de usar na fábrica de verdade.
- Ligue o backup contínuo (Point in Time Recovery) antes do primeiro dia de operação real.
