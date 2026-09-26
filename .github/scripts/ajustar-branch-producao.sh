#!/usr/bin/env bash
# Troca a branch de produção do projeto Pages prodio-web para main. Uma vez só: roda pelo workflow
# "Ajustar Pages" (disparo manual). Projeto criado por envio direto (wrangler pages deploy) só muda a
# branch de produção pela API, e o primeiro envio manual deixou o branch em que ele foi feito como produção.
# Sem isso o Publicar recusa (prévia iria para produção sem passar por main).
# Entradas (env): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GITHUB_STEP_SUMMARY.
set -euo pipefail
erro() { echo "::error title=Ajustar Pages::$*"; exit 1; }
# shellcheck source=.github/scripts/cloudflare-env.sh
source "$(dirname "$0")/cloudflare-env.sh"

PROJETO=prodio-web
URL="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PROJETO"
cabecalho() { printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$CLOUDFLARE_API_TOKEN"; }
ramo_de() { node -e 'const d = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(String(d?.result?.production_branch ?? ""))'; }

antes="$(curl -sS --fail -K - "$URL" < <(cabecalho) | ramo_de)" || erro "Não consegui ler o projeto $PROJETO."
echo "Branch de produção atual do $PROJETO: '$antes'"
if [[ "$antes" == main ]]; then
  echo "::notice title=Ajustar Pages::A branch de produção do $PROJETO já é main. Nada a fazer."
  exit 0
fi

curl -sS --fail -K - -X PATCH "$URL" --data '{"production_branch":"main"}' < <(cabecalho) >/dev/null \
  || erro "A Cloudflare recusou a troca (o token precisa de 'Cloudflare Pages: Edit')."
depois="$(curl -sS --fail -K - "$URL" < <(cabecalho) | ramo_de)" || erro "Não consegui reler o projeto."
[[ "$depois" == main ]] || erro "Depois da troca a branch de produção ficou '$depois', não main."

msg="Branch de produção do $PROJETO: '$antes' → main. A próxima publicação de main passa a ser a de produção."
echo "::notice title=Ajustar Pages::$msg"
[[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && echo "$msg" >> "$GITHUB_STEP_SUMMARY"
exit 0
