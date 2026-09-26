#!/usr/bin/env bash
# Job "preparar" do workflow Publicar: decide o que este push publica e confere, antes de tocar em qualquer
# coisa, se dá para publicar com segurança. Nada aqui escreve em produção (o aplicador roda em --simular).
# Entradas (env): RAMO, TEM_CLOUDFLARE_TOKEN, TEM_CLOUDFLARE_CONTA (true/false), VITE_SUPABASE_URL,
#   VITE_SUPABASE_ANON_KEY, VITE_WORKER_URL, SUPABASE_DB_URL e TEM_BACKUP_SENHA (só em main).
# Saídas (GITHUB_OUTPUT): alvo=producao|previa, publicar=sim|nao, pendentes=N, pg_major=NN.
set -euo pipefail
saida() { echo "$1=$2" >> "$GITHUB_OUTPUT"; }
nota() { echo "::notice title=Publicação::$*"; }
erro() { echo "::error title=Publicação::$*"; exit 1; }

if [[ "$RAMO" == main ]]; then ALVO=producao; else ALVO=previa; fi
saida alvo "$ALVO"

# 1. Sem Cloudflare configurada, a publicação automática está desligada: testes verdes e nada publicado.
if [[ "$TEM_CLOUDFLARE_TOKEN" != true || "$TEM_CLOUDFLARE_CONTA" != true ]]; then
  nota "Sem os segredos CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID: publicação pulada (os testes passaram). Para publicar a cada push, cadastre os dois (docs/deploy.md, Publicação automática)."
  saida publicar nao
  exit 0
fi

# 2. Produção só publica o topo de main: "Re-run" de um push antigo não põe código velho no ar.
if [[ "$ALVO" == producao ]]; then
  topo="$(git ls-remote origin refs/heads/main | cut -f1)"
  if [[ "$topo" != "$GITHUB_SHA" ]]; then
    nota "Este commit (${GITHUB_SHA:0:7}) não é mais o topo de main (${topo:0:7}): nada publicado. A execução do commit mais novo publica."
    saida publicar nao
    exit 0
  fi
fi

# 3. A web precisa das VITE_*: sem elas o build sai em modo de exemplo (dados falsos, sem login).
faltam=()
for v in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY VITE_WORKER_URL; do
  [[ -n "${!v:-}" ]] || faltam+=("$v")
done
[[ ${#faltam[@]} -eq 0 ]] || erro "Faltam as variáveis ${faltam[*]} em Settings > Secrets and variables > Actions, aba Variables. Sem elas o site sairia em modo de exemplo, sem login e com dados falsos. Nada foi publicado."
[[ "$VITE_SUPABASE_URL" == https://* && "$VITE_WORKER_URL" == https://* ]] \
  || erro "VITE_SUPABASE_URL e VITE_WORKER_URL têm de começar com https://. Nada foi publicado."
saida publicar sim
[[ "$ALVO" == producao ]] || exit 0

# 4. Banco: sem acesso não dá para saber se há migration pendente. Worker e web novos podem chamar
#    função que só existe depois da migration, então sem essa certeza nada é publicado.
# Espaço ou quebra de linha colados junto no segredo quebram a URL (incidente de 26/09/2026 com o
# Account ID da Cloudflare); connection string não tem espaço legítimo (senha com espaço vai codificada).
SUPABASE_DB_URL="$(printf '%s' "${SUPABASE_DB_URL:-}" | tr -d ' \t\r\n')"
[[ -n "${SUPABASE_DB_URL:-}" ]] || erro "Falta o segredo SUPABASE_DB_URL (connection string do Session pooler do Supabase). Sem ele não dá para saber se há migration pendente, e publicar worker e web sobre um banco sem as funções que eles chamam quebraria o sistema. Nada foi publicado."
senha="${SUPABASE_DB_URL#*://}"; senha="${senha%@*}"
if [[ "$senha" == *:* ]]; then echo "::add-mask::${senha#*:}"; fi
command -v psql >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq postgresql-client >/dev/null; }

resultado="$(mktemp)"
BANCO_URL="$SUPABASE_DB_URL" APLICADOR_SAIDA="$resultado" bash supabase/aplicar-migracoes.sh --simular \
  || erro "O aplicador de migrations recusou (motivo no log acima). Nada foi aplicado nem publicado."
cat "$resultado" >> "$GITHUB_OUTPUT"
pendentes="$(sed -n 's/^pendentes=//p' "$resultado")"
pg_major="$(sed -n 's/^pg_major=//p' "$resultado")"
[[ "$pg_major" =~ ^[0-9]{2}$ ]] || erro "versão do Postgres de produção inesperada: '$pg_major'"
if [[ "$pendentes" -gt 0 && "$TEM_BACKUP_SENHA" != true ]]; then
  erro "Há $pendentes migration(s) pendente(s) e falta o segredo BACKUP_SENHA. Sem backup cifrado nenhuma migration é aplicada, e sem a migration worker e web não são publicados."
fi
if [[ "$pendentes" -gt 0 ]]; then
  nota "$pendentes migration(s) pendente(s): backup cifrado, ensaio e aplicação antes de publicar worker e web."
else
  nota "Nenhuma migration pendente: publica worker e web."
fi
