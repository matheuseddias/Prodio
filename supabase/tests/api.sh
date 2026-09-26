#!/usr/bin/env bash
# Teste de API: roda as consultas reais da web e do worker contra um PostgREST de verdade.
# Por quê: o cron do worker ficou 24 h mudo porque o PostgREST respondia PGRST201 ao select com
# embed tenants(slug, fuso) de Db.listarConectoresAtivos, e nenhum teste passava pelo PostgREST
# (os do worker usam Db falso; run.sh fala SQL direto). Não entra em `pnpm test` nem em `pnpm db:test`.
#
# Uso: PGURL=postgres://postgres@localhost:5432/postgres bash supabase/tests/api.sh   (pnpm db:test:api)
# Monta um banco descartável ao lado do de PGURL (API_DB, padrão prodio_api_test), sobe o PostgREST
# numa porta livre (API_PORT, padrão 54340) e derruba no fim. Binário: POSTGREST_BIN, `postgrest` no
# PATH ou download fixo da 12.2.3 (linux x64) para o cache — só a primeira vez precisa de rede.
# Em sequência, pode repetir à vontade; duas rodadas AO MESMO TEMPO precisam de API_DB diferentes
# (o banco é apagado e recriado).
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres@localhost:5432/prodio_test}"
API_DB="${API_DB:-prodio_api_test}"
API_PORT="${API_PORT:-54340}"
PGRST_VERSAO="12.2.3"
PGRST_SHA256="9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c" # postgrest-v12.2.3-linux-static-x64.tar.xz
JWT_SECRET="segredo-local-do-teste-de-api-do-prodio-nao-e-de-producao"
AUTH_SENHA="authenticator-local-de-teste"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

falha() { echo "api: $*" >&2; exit 1; }

# Troca o banco (ou o usuário) de uma URL postgres:// mantendo host, porta e parâmetros.
partes_url() { # url → define U_ESQUEMA U_AUTOR U_CAMINHO U_QUERY
  local url="$1" base
  base="${url%%\?*}"
  U_QUERY=""; [[ "$url" == *\?* ]] && U_QUERY="?${url#*\?}"
  U_ESQUEMA="${base%%://*}"
  local resto="${base#*://}"
  U_AUTOR="${resto%%/*}"
  U_CAMINHO=""; [[ "$resto" == */* ]] && U_CAMINHO="/${resto#*/}"
}
url_com_banco() { partes_url "$1"; echo "${U_ESQUEMA}://${U_AUTOR}/$2${U_QUERY}"; }
url_com_usuario() { partes_url "$1"; echo "${U_ESQUEMA}://$2:$3@${U_AUTOR##*@}${U_CAMINHO}${U_QUERY}"; }

[[ "$API_DB" =~ ^[a-z_][a-z0-9_]*$ && "$API_DB" == *test* ]] || falha "API_DB='$API_DB' precisa ser um nome simples com 'test' (este script apaga e recria o banco)"
partes_url "$PGURL"
[[ "${U_CAMINHO#/}" != "$API_DB" ]] || falha "PGURL aponta para o próprio $API_DB; aponte para outro banco (ex.: postgres)"
TEST_URL="$(url_com_banco "$PGURL" "$API_DB")"
AUTH_URL="$(url_com_usuario "$TEST_URL" authenticator "$AUTH_SENHA")"

achar_postgrest() {
  if [[ -n "${POSTGREST_BIN:-}" ]]; then
    [[ -x "$POSTGREST_BIN" ]] || falha "POSTGREST_BIN=$POSTGREST_BIN não é executável"
    echo "$POSTGREST_BIN"; return
  fi
  if command -v postgrest >/dev/null 2>&1; then command -v postgrest; return; fi
  local dir="${XDG_CACHE_HOME:-$HOME/.cache}/prodio/postgrest-$PGRST_VERSAO"
  if [[ -x "$dir/postgrest" ]]; then echo "$dir/postgrest"; return; fi
  if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    falha "sem PostgREST e o download automático é só para Linux x64 ($(uname -s) $(uname -m)).
  Instale o PostgREST $PGRST_VERSAO (https://github.com/PostgREST/postgrest/releases/tag/v$PGRST_VERSAO;
  no macOS: brew install postgrest) e rode com POSTGREST_BIN=/caminho/do/postgrest pnpm db:test:api"
  fi
  local tmp; tmp="$(mktemp -d)"
  local arquivo="postgrest-v$PGRST_VERSAO-linux-static-x64.tar.xz"
  echo "api: baixando $arquivo para $dir" >&2
  curl -fsSL -o "$tmp/$arquivo" "https://github.com/PostgREST/postgrest/releases/download/v$PGRST_VERSAO/$arquivo" \
    || { rm -rf "$tmp"; falha "não consegui baixar o PostgREST (precisa de rede na primeira vez)"; }
  echo "$PGRST_SHA256  $tmp/$arquivo" | sha256sum -c --quiet - >/dev/null 2>&1 \
    || { rm -rf "$tmp"; falha "sha256 do $arquivo não confere com o fixado no script; não vou executar"; }
  tar -xJf "$tmp/$arquivo" -C "$tmp" postgrest
  mkdir -p "$dir"
  mv "$tmp/postgrest" "$dir/postgrest"
  rm -rf "$tmp"
  echo "$dir/postgrest"
}

porta_livre() {
  local p="$1"
  for _ in $(seq 1 20); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return; fi
    p=$((p + 1))
  done
  falha "nenhuma porta livre entre $1 e $p (defina API_PORT)"
}

PGRST_BIN="$(achar_postgrest)"
PGRST_VERSAO_USADA="$("$PGRST_BIN" --version 2>/dev/null | head -n1 || true)"
[[ "$PGRST_VERSAO_USADA" == *"$PGRST_VERSAO"* ]] \
  || echo "api: aviso: usando '$PGRST_VERSAO_USADA'; o teste foi calibrado com a $PGRST_VERSAO (família do Supabase)" >&2

echo "api: banco descartável $API_DB (stubs + migrations + seeds)"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "drop database if exists $API_DB with (force)" -c "create database $API_DB"
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f tests/stubs_supabase.sql
for f in migrations/*.sql seed*.sql; do
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
# Papel de login do PostgREST, como no Supabase (papéis valem para o cluster inteiro).
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password '$AUTH_SENHA';
  end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
SQL

PORTA="$(porta_livre "$API_PORT")"
LOG="$(mktemp)"
# PGRST_DB_MAX_ROWS=1000: o teto do Supabase. Sem ele aqui, uma leitura que precisa paginar passaria no teste
# e seria cortada em 1.000 linhas, sem erro, em produção.
PGRST_DB_URI="$AUTH_URL" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$JWT_SECRET" PGRST_DB_MAX_ROWS=1000 \
PGRST_DB_EXTRA_SEARCH_PATH="public, extensions" PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$PORTA" \
  "$PGRST_BIN" >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -f "$LOG"' EXIT

pronto=""
for _ in $(seq 1 60); do
  if [[ "$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/" || true)" == 200 ]]; then pronto=1; break; fi
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if [[ -z "$pronto" ]]; then
  cat "$LOG" >&2
  falha "o PostgREST não ficou pronto na porta $PORTA (log acima; se o papel authenticator já existia com outra senha, ajuste-a ou use um Postgres com trust local)"
fi
# Quem respondeu tem de ser o NOSSO processo: se outro servidor pegou a porta entre porta_livre e o
# bind, o nosso morreu e o teste rodaria contra o banco de outra pessoa.
if ! kill -0 "$PID" 2>/dev/null; then
  cat "$LOG" >&2
  falha "o PostgREST saiu logo depois de subir e outro processo responde na porta $PORTA (log acima)"
fi
echo "api: $PGRST_VERSAO_USADA na porta $PORTA"

NODE_FLAGS=()
[[ "$(node -p 'Boolean(process.features.typescript)')" == true ]] || NODE_FLAGS=(--experimental-strip-types)
NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}" \
API_URL="http://127.0.0.1:$PORTA" API_JWT_SECRET="$JWT_SECRET" node ${NODE_FLAGS[@]+"${NODE_FLAGS[@]}"} tests/api/rodar.mjs
echo "api: tudo verde"
