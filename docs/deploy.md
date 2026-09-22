# Prodio — instalar num projeto Supabase

Passo a passo para sair do zero até a interface conversando com o banco real. Foi validado contra PostgreSQL 16 com os stubs do Supabase; os itens marcados **no painel** só existem no projeto hospedado.

Gere os arquivos antes de começar:

```bash
bash supabase/build.sh                 # usa matheus@eddias.com.br como admin
bash supabase/build.sh outro@email.com # ou passe outro e-mail
```

Saem três arquivos em `supabase/dist/` (não versionados, são gerados):

| Arquivo | O que faz |
|---|---|
| `schema.sql` | As 9 migrations na ordem. Cria tabelas, RLS, funções e views. |
| `dados_eddias.sql` | Cria a empresa Eddias com cadastros de exemplo. Não toca em `auth.users`. |
| `limpar_exemplo.sql` | Apaga só os dados de exemplo, mantendo empresa, usuários, locais, unidades, perfis de etiqueta e operadores. |

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

## 3. Criar a empresa e os dados de exemplo

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dist/dados_eddias.sql
```

Se o usuário do passo 1 não existir, o arquivo interrompe com uma mensagem dizendo isso. Ao final você tem a empresa Eddias, 11 produtos, 13 insumos, 5 fornecedores, 4 fichas técnicas, plano do dia, saldos, 6 ordens de compra, 6 notas fiscais e 3 operadores com PIN 1234, 2345 e 3456.

Os cinco conectores (BaseLinker, Bling, Tiny, Omie, Magis5) nascem **desconectados**, sem credencial e sem último sync. É de propósito: credencial é cifrada com a `CREDENTIALS_KEY` do worker e não pode ser semeada, então um conector semeado como conectado seria uma promessa falsa na tela e uma falha a cada 5 minutos no cron. Quem conecta é você, pela tela, depois do passo 8.

Quando for usar dados reais, rode `limpar_exemplo.sql` e importe os seus pelas telas de cadastro.

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

Publique primeiro e grave os segredos depois: dois deles (`PUBLIC_URL` e `CORS_ORIGENS`) precisam do
endereço que só existe depois do primeiro `wrangler deploy`. Segredo passa a valer na requisição
seguinte, sem publicar de novo.

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
wrangler secret put CORS_ORIGENS          # origens da interface, separadas por vírgula:
# https://app.prodio.com.br,https://prodio-web.pages.dev,https://*.prodio-web.pages.dev,http://localhost:5173

# obrigatório para conectar Bling ou Tiny (OAuth). O BaseLinker é token colado e não precisa.
wrangler secret put PUBLIC_URL            # o endereço do worker, sem barra no fim

# opcionais: app OAuth global. No Tiny o app é privado por seller, então o normal é o
# cliente colar client_id/client_secret na própria tela de Conectores e pular estes dois.
wrangler secret put BLING_CLIENT_ID
wrangler secret put BLING_CLIENT_SECRET
wrangler secret put TINY_CLIENT_ID
wrangler secret put TINY_CLIENT_SECRET

wrangler secret list                      # confere os nomes gravados (nunca mostra valores)
```

Sem `CORS_ORIGENS` a interface publicada falha com erro de CORS em tudo que fala com o worker (só
`localhost` passa). Sem `PUBLIC_URL`, `/oauth/start` responde 500 e o botão "Conectar o Tiny" não sai
do lugar. A lista completa, com o que cada variável faz, está em `apps/worker/README.md`.

Depois preencha `VITE_WORKER_URL` com esse mesmo endereço: no `.env` da interface para o build local, e **no painel** do Cloudflare Pages (Settings > Variables and Secrets, em Production **e** em Preview) para o site publicado — variável `VITE_*` é lida no build, então o site só enxerga o worker depois de uma publicação nova (`docs/deploy-web.md`, passo 3). O detalhe de cada rota e do e-mail de entrada está em `apps/worker/README.md`.

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
