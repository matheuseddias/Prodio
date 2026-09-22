# Prodio — publicar a interface na internet

Passo a passo para sair do `localhost:5173` até `https://app.prodio.com.br`. Os itens marcados **no painel** são cliques no painel da Cloudflare ou do Supabase; o resto é linha de comando.

## Antes de tudo: o Supabase não publica a interface

**Não**, o projeto do Supabase (`xxxx.supabase.co`) não deixa ninguém acessar o Prodio de fora: o Supabase hospeda **banco, autenticação e API**, não a interface. O `apps/web` é uma SPA (arquivos estáticos: HTML, JS e CSS) e precisa de um host estático próprio. Enquanto não for publicada, ela só existe na máquina onde você roda `pnpm dev`.

Quem publica aqui é o **Cloudflare Pages**: o worker já é Cloudflare, então fica tudo numa conta só, e o Pages dá um domínio gratuito `*.pages.dev` na hora.

Repartição final:

| Parte | Onde mora | Endereço |
|---|---|---|
| Interface (`apps/web`) | Cloudflare Pages | `prodio-web.pages.dev`, depois `app.prodio.com.br` |
| Banco, login, API | Supabase | `xxxx.supabase.co` |
| Conectores, XML, cron (`apps/worker`) | Cloudflare Workers | `prodio-worker.<conta>.workers.dev` |

## 1. Entender as variáveis `VITE_*` antes de buildar

As variáveis `VITE_*` são lidas **no momento do build** e ficam **embutidas dentro do JavaScript** que o navegador baixa. Não são lidas em tempo de execução: mudar uma variável exige um build novo.

Duas consequências práticas:

- A `VITE_SUPABASE_ANON_KEY` vai para o bundle e qualquer pessoa consegue lê-la. **Isso é normal e seguro.** A anon key só diz "sou um cliente deste projeto"; quem decide o que cada um enxerga é a RLS, que lê o tenant e o papel do token (`docs/arquitetura.md`, seção 2).
- A `service_role` key **nunca** pode entrar numa variável `VITE_*`. Ela ignora a RLS. O lugar dela é `wrangler secret put SUPABASE_SERVICE_KEY` no worker, e só lá. O mesmo vale para `CREDENTIALS_KEY` e para qualquer `client_secret` de conector.

Regra curta: se vazar e der problema, não é `VITE_*`.

Para o build local, o arquivo é `apps/web/.env` (copiado de `.env.example`). Para o build remoto do Pages, são as variáveis do passo 3.

## 2. Publicar pela linha de comando (caminho mais rápido)

Uma vez, para autorizar a máquina e criar o projeto:

```bash
pnpm --filter @prodio/web exec wrangler login
pnpm --filter @prodio/web exec wrangler pages project create prodio-web --production-branch main
```

Depois, a cada publicação:

```bash
pnpm deploy:web
```

O script builda e sobe `apps/web/dist`. Em alguns segundos o site está em `https://prodio-web.pages.dev` — esse é o domínio gratuito, já com HTTPS. Para subir sem virar a versão de produção (link temporário para testar), use `pnpm --filter @prodio/web deploy:preview`.

O build usa o `apps/web/.env` da sua máquina. Se ele estiver vazio, você publica o Prodio em **modo memória**, com dados de exemplo e sem login — bom para demonstração, inútil para a fábrica. Confira antes de subir.

Três arquivos fazem o Pages se comportar (estão em `apps/web/public/` e vão para o `dist` no build):

| Arquivo | Para quê |
|---|---|
| `_redirects` | `/* /index.html 200`. Sem isso, dar F5 em `/producao/etiquetas` devolve 404: o Pages procura um arquivo com esse nome e não acha. A regra reescreve (200, não 301) para o `index.html` e o React Router resolve a rota. Arquivo estático que existe continua sendo servido normalmente. |
| `_headers` | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (com `camera=(self)`, que o `/chao` precisa para ler QR code) e o cache: `assets/*` imutável por um ano, `index.html` e `sw.js` sempre revalidados. |
| `wrangler.toml` | Nome do projeto e `pages_build_output_dir = "dist"`. É por isso que `wrangler pages deploy` funciona sem argumento. |

Não há CSP de propósito: a URL do Supabase muda por projeto e uma `connect-src` errada derruba o login sem mensagem de erro clara. Se for ligar, faça **no painel**, em Rules > Transform Rules, com a URL do projeto na lista.

## 3. Ligar o repositório para publicar sozinho a cada push (opcional)

**No painel** da Cloudflare, em Workers & Pages > prodio-web > Settings > Builds, conecte o repositório do GitHub e preencha:

| Campo | Valor |
|---|---|
| Production branch | `main` |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @prodio/web build` |
| Build output directory | `apps/web/dist` |
| Root directory | deixe na raiz do repositório (é um monorepo) |

**No painel**, em Settings > Variables and Secrets, adicione as variáveis do build — uma vez em **Production** e outra em **Preview**:

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` (Supabase > Settings > API) |
| `VITE_SUPABASE_ANON_KEY` | a anon/public key do mesmo lugar |
| `VITE_WORKER_URL` | `https://prodio-worker.<conta>.workers.dev`, quando o worker estiver no ar |
| `VITE_DOMINIO_EMAIL_XML` | `prodio.com.br`, se o Email Routing de XML já estiver configurado |

Se o build reclamar da versão do pnpm, adicione também `PNPM_VERSION = 10.33.0`.

Lembre da regra do passo 1: alterar uma dessas variáveis **no painel** não muda o site publicado. É preciso disparar um build novo (Deployments > Retry deployment, ou um push).

## 4. Avisar o Supabase do novo endereço

Sem isso o login por link mágico manda o usuário de volta para `localhost`.

**No painel do Supabase**, em Authentication > URL Configuration:

- **Site URL**: `https://app.prodio.com.br` (enquanto não houver domínio próprio, `https://prodio-web.pages.dev`).
- **Redirect URLs**: adicione as três, uma por linha:
  - `https://app.prodio.com.br/**`
  - `https://prodio-web.pages.dev/**`
  - `http://localhost:5173/**`

## 5. Apontar `app.prodio.com.br`

O domínio `prodio.com.br` é registrado no Registro.br. Há dois caminhos; o primeiro é o recomendado porque deixa DNS, Pages, Workers e Email Routing na mesma conta.

### 5a. Com o DNS na Cloudflare (recomendado)

1. **No painel** da Cloudflare, em Add a site, adicione `prodio.com.br`. A Cloudflare mostra dois servidores de nomes, algo como `xxx.ns.cloudflare.com` e `yyy.ns.cloudflare.com`.
2. **No Registro.br**, abra o domínio, vá em Alterar servidores DNS e troque os atuais pelos dois da Cloudflare. A propagação costuma levar de minutos a algumas horas.
3. **No painel** da Cloudflare, em Workers & Pages > prodio-web > Custom domains > Set up a custom domain, digite `app.prodio.com.br` e confirme. A Cloudflare cria o registro sozinha e emite o certificado.

### 5b. Mantendo o DNS onde está

**No painel** de DNS do seu provedor (Registro.br ou outro), crie um registro:

| Tipo | Nome | Conteúdo | TTL |
|---|---|---|---|
| `CNAME` | `app` | `prodio-web.pages.dev` | padrão (ou 3600) |

O nome é só `app`: a maioria dos painéis completa o domínio sozinha, resultando em `app.prodio.com.br`. Não use `A` nem IP fixo — o endereço do Pages muda. Não aponte o domínio raiz (`prodio.com.br`) por CNAME: DNS não permite CNAME na raiz.

Depois de criar o registro, volte **no painel** da Cloudflare, em Workers & Pages > prodio-web > Custom domains, e adicione `app.prodio.com.br`. Ela valida o CNAME e emite o certificado (alguns minutos).

Quando `app.prodio.com.br` estiver no ar, volte ao passo 4 e ajuste o Site URL do Supabase.

## 6. Conferir se deu certo

```bash
# a rota profunda tem que voltar 200 e HTML, não 404
curl -sI https://app.prodio.com.br/producao/etiquetas | head -3

# o CNAME tem que apontar para o projeto do Pages
dig +short app.prodio.com.br

# o _headers tem que estar valendo: index.html no-cache (senão o PWA trava numa versão velha)
curl -sI https://app.prodio.com.br/index.html | grep -i 'cache-control\|x-content-type'
```

No navegador, em uma aba anônima:

1. `https://app.prodio.com.br` cai no login (não no modo memória: se aparecer o Painel com dados sem pedir senha, as variáveis não entraram no build).
2. Entre com o usuário administrador. O Painel carrega e o estoque mostra os treze insumos.
3. Dê **F5 dentro de** `/producao/etiquetas`. Se voltar a tela, o `_redirects` está valendo.
4. No celular, abra `/chao`, use o menu do navegador para instalar o app e confira que ele abre da tela inicial. Depois coloque o aparelho em modo avião e recarregue: o service worker tem que servir a tela mesmo sem rede.

## Cuidados

- Publicar sem `VITE_SUPABASE_URL` deixa um Prodio de mentira no ar, com dados de exemplo e sem login. Cheque o `.env` antes de `pnpm deploy:web`.
- A `service_role` key e a `CREDENTIALS_KEY` só existem como secret do worker. Se uma delas aparecer num `VITE_*`, considere-a vazada e gire a chave.
- O Pages guarda todas as versões publicadas. Para voltar atrás, **no painel**, em Deployments, use Rollback na versão anterior — não precisa buildar de novo.
- Cada push numa branch que não é a de produção gera um link `*.prodio-web.pages.dev` público. Não use esses links para dados reais de cliente.
- Para chamar o worker a partir do navegador (upload de XML, credenciais de conector), o worker precisa responder CORS liberando a origem `https://app.prodio.com.br`. Enquanto isso não existir, essas telas falham com erro de CORS — o resto do sistema funciona normalmente, porque fala direto com o Supabase.
