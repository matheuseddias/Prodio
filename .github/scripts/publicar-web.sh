#!/usr/bin/env bash
# Build da interface com as VITE_* e publicação no Cloudflare Pages (projeto prodio-web, envio direto).
# RAMO=main publica produção (app.prodio.com.br); outro branch publica uma prévia e põe a URL no resumo.
# Entradas (env): RAMO, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_WORKER_URL, VITE_DOMINIO_EMAIL_XML
#   (opcional), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_SHA, GITHUB_STEP_SUMMARY.
set -euo pipefail
erro() { echo "::error title=Publicação da web::$*"; exit 1; }
[[ -n "${RAMO:-}" ]] || erro "RAMO vazio"
for v in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_WORKER_URL; do
  [[ -n "${!v:-}" ]] || erro "Falta $v: o build sairia em modo de exemplo (sem login, dados falsos). Nada foi publicado."
done
# Variável vazia não é "sem variável" para o Vite: o domínio do e-mail de XML ficaria em branco.
[[ -n "${VITE_DOMINIO_EMAIL_XML:-}" ]] || unset VITE_DOMINIO_EMAIL_XML

# Token e conta limpos (espaço ou quebra de linha colados junto no segredo) e conferidos.
# shellcheck source=.github/scripts/cloudflare-env.sh
source "$(dirname "$0")/cloudflare-env.sh"

# A branch de produção do projeto decide se o envio vira produção ou prévia. Confere ANTES de enviar: um
# projeto criado pelo `wrangler pages deploy` num branch qualquer pode ter esse branch como produção.
PROJETO=prodio-web # o mesmo de apps/web/wrangler.toml
projeto="$(curl -sS --fail -K - "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJETO" \
  <<<"header = \"Authorization: Bearer $CLOUDFLARE_API_TOKEN\"")" \
  || erro "Não consegui ler o projeto $PROJETO na Cloudflare: confira CLOUDFLARE_ACCOUNT_ID e se o token tem 'Cloudflare Pages: Edit' nessa conta."
ramo_producao="$(node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(String(d?.result?.production_branch ?? ""))' <<<"$projeto")"
if [[ "$RAMO" == main && "$ramo_producao" != main ]]; then
  erro "A branch de produção do $PROJETO na Cloudflare é '$ramo_producao', não main: este push sairia como prévia. Ajuste para main (docs/deploy.md, Publicação automática, passo 5) e rode de novo. Nada foi publicado."
fi
if [[ "$RAMO" != main && "$RAMO" == "$ramo_producao" ]]; then
  erro "O branch '$RAMO' é a branch de produção do $PROJETO na Cloudflare: publicar daqui iria para produção sem passar por main. Ajuste para main (docs/deploy.md). Nada foi publicado."
fi

# O build roda código de dependência (Vite e plugins): sem o token e a conta da Cloudflare no ambiente.
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID pnpm --filter @prodio/web build
grep -rqF -- "$VITE_SUPABASE_URL" apps/web/dist/assets \
  || erro "O build não contém VITE_SUPABASE_URL: ele sairia em modo de exemplo. Nada foi publicado."

resultado="$(mktemp)"
cd apps/web
# Nome do projeto e pasta (dist) vêm de apps/web/wrangler.toml; o branch vai por variável, nunca interpolado.
WRANGLER_OUTPUT_FILE_PATH="$resultado" WRANGLER_SEND_METRICS=false \
  pnpm exec wrangler pages deploy --branch "$RAMO" --commit-hash "$GITHUB_SHA" --commit-dirty=true

# Uma linha por campo: ambiente, url, alias, branch de produção do projeto.
mapfile -t campos < <(node -e '
  const linhas = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l))
  const d = linhas.reverse().find((l) => l.type === "pages-deploy-detailed") || {}
  for (const c of ["environment", "url", "alias", "production_branch"]) console.log(d[c] ?? "")
' "$resultado")
ambiente="${campos[0]:-}"; url="${campos[1]:-}"; alias="${campos[2]:-}"; ramo_producao="${campos[3]:-}"
[[ -n "$url" ]] || erro "O wrangler não devolveu a URL da publicação."

if [[ "$RAMO" == main && "$ambiente" != production ]]; then
  erro "O push em main virou PRÉVIA ($url), não produção: a branch de produção do projeto prodio-web no Cloudflare é '$ramo_producao'. Ajuste para main (docs/deploy.md, Publicação automática) e rode de novo."
fi
if [[ "$RAMO" != main && "$ambiente" == production ]]; then
  erro "O branch '$RAMO' publicou em PRODUÇÃO: a branch de produção do prodio-web no Cloudflare é '$ramo_producao', não main. Corrija no painel já."
fi

{
  if [[ "$RAMO" == main ]]; then
    echo "### Interface publicada em produção"
    echo "- Endereço desta versão: $url"
    echo "- Produção: https://app.prodio.com.br e https://prodio-web.pages.dev"
  else
    echo "### Prévia da interface"
    echo "- Prévia deste commit: $url"
    [[ -n "$alias" ]] && echo "- Sempre a última deste branch: $alias"
    echo "- A prévia fala com o banco de produção: o que for gravado nela é gravado de verdade."
  fi
} >> "$GITHUB_STEP_SUMMARY"
echo "web: publicada em $url ($ambiente)"
