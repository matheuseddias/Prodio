#!/usr/bin/env bash
# Ajudantes dos cenários do aplicador (supabase/tests/migracoes.sh). Cada cenário cria bancos descartáveis
# prodio_mig_<nome>_test ao lado do banco de PGURL e apaga no fim.
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGURL="${PGURL:-postgres://postgres@localhost:5432/postgres}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
TMP_CENARIOS="$(mktemp -d)"
COMMIT_TESTE=0123456789abcdef0123456789abcdef01234567
export LC_COLLATE=C
MIGRACOES_DO_REPO=("$RAIZ"/supabase/migrations/*.sql)
# shellcheck disable=SC2034 # usada pelos cenários (controle.sh, producao.sh)
TOTAL="${#MIGRACOES_DO_REPO[@]}"
# Última migration anterior ao aplicador (a constante dele) e quantas do repositório vão até ela: na primeira
# execução só essas são reaplicadas verificando dados; as posteriores entram como numa execução normal.
ULTIMA_ANTES_DO_APLICADOR="$(sed -n 's/^ULTIMA_ANTES_DO_APLICADOR=//p' "$RAIZ/supabase/aplicar-migracoes.sh")"
[[ "$ULTIMA_ANTES_DO_APLICADOR" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]] || { echo "migracoes: não achei ULTIMA_ANTES_DO_APLICADOR no aplicador" >&2; exit 1; }
ANTIGAS=0
for f in "${MIGRACOES_DO_REPO[@]}"; do [[ "$(basename "$f")" > "$ULTIMA_ANTES_DO_APLICADOR" ]] || ANTIGAS=$((ANTIGAS + 1)); done

limpar_cenarios() {
  if [[ -f "$TMP_CENARIOS/bancos" ]]; then
    while read -r b; do psql "$PGURL" -X -q -c "drop database if exists $b with (force)" >/dev/null 2>&1 || true; done < "$TMP_CENARIOS/bancos"
  fi
  rm -rf "$TMP_CENARIOS"
}
trap limpar_cenarios EXIT

falhou() { echo "migracoes: FALHOU: $*" >&2; [[ -n "${SAIDA:-}" ]] && printf '%s\n' "--- saída do aplicador ---" "$SAIDA" >&2; exit 1; }
ok() { echo "  ok: $*"; }
cenario() { echo "cenário: $*"; }

# Troca o banco de uma URL postgres:// mantendo usuário, host, porta e parâmetros.
url_com_banco() {
  local url="$1" base query="" resto
  base="${url%%\?*}"; [[ "$url" == *\?* ]] && query="?${url#*\?}"
  resto="${base#*://}"
  echo "${base%%://*}://${resto%%/*}/$2$query"
}

novo_banco() { # nome → URL de um banco vazio com os stubs do Supabase
  local nome="prodio_mig_$1_test"
  psql "$PGURL" -X -q -c "drop database if exists $nome with (force)" -c "create database $nome" >/dev/null
  echo "$nome" >> "$TMP_CENARIOS/bancos" # $(novo_banco …) roda num subshell: a lista vai por arquivo
  local url; url="$(url_com_banco "$PGURL" "$nome")"
  psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/tests/stubs_supabase.sql" >/dev/null
  echo "$url"
}
banco_vazio() { # nome → URL de um banco vazio, sem stubs
  local nome="prodio_mig_$1_test"
  psql "$PGURL" -X -q -c "drop database if exists $nome with (force)" -c "create database $nome" >/dev/null
  echo "$nome" >> "$TMP_CENARIOS/bancos"
  url_com_banco "$PGURL" "$nome"
}

# Como foi feito em produção até hoje: cada arquivo colado no SQL Editor (aqui, psql -f), sem controle.
a_mao() { local url="$1"; shift; for f in "$@"; do psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done; }
a_mao_migracoes() { a_mao "$1" "$RAIZ"/supabase/migrations/"$2"*.sql; } # url, prefixo do nome

# Roda o aplicador sem abortar o cenário: guarda a saída em SAIDA e o código em RC.
aplicador() {
  local url="$1"; shift
  set +e
  SAIDA="$(BANCO_URL="$url" COMMIT="$COMMIT_TESTE" bash "$RAIZ/supabase/aplicar-migracoes.sh" "$@" 2>&1)"
  RC=$?
  set -e
}
espera_rc() { [[ "$RC" == "$1" ]] || falhou "esperava saída $1 do aplicador, veio $RC"; }
espera_texto() { grep -qF -- "$1" <<<"$SAIDA" || falhou "esperava na saída: $1"; }
consulta() { psql "$1" -X -q -At -v ON_ERROR_STOP=1 -c "$2"; }
espera_sql() { local v; v="$(consulta "$1" "$2")"; [[ "$v" == "$3" ]] || falhou "$2 → '$v', esperava '$3'"; }

# Cópia das migrations para um cenário mexer (MIGRACOES_DIR), sem tocar nas do repositório.
copia_migracoes() {
  local d; d="$(mktemp -d "$TMP_CENARIOS/mig.XXXX")"
  cp "$RAIZ"/supabase/migrations/*.sql "$d/"
  echo "$d"
}
copia_migracoes_antigas() { # só as anteriores ao aplicador (as que podem ter sido coladas à mão)
  local d f; d="$(copia_migracoes)"
  for f in "$d"/*.sql; do [[ "$(basename "$f")" > "$ULTIMA_ANTES_DO_APLICADOR" ]] && rm "$f"; done
  echo "$d"
}

# Fotografias para comparar antes e depois. \restrict/\unrestrict têm chave aleatória a cada pg_dump.
dados() { # todas as linhas de public, uma por INSERT, em ordem: independe da ordem física no disco
  pg_dump "$1" --data-only --inserts --rows-per-insert=1 -n public 2>/dev/null | grep '^INSERT' | LC_ALL=C sort
}
estrutura() {
  pg_dump "$1" --schema-only -n public | grep -vE '^\\(un)?restrict ' | grep -v '^-- Dumped'
}
contagens() {
  consulta "$1" "select string_agg(c.relname || '=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', c.oid::regclass), false, true, '')))[1]::text, ' ' order by c.relname) from pg_class c where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace"
}

# Banco "de produção" como está hoje: 20260921* aplicadas à mão, seeds e dist/dados_eddias.sql (build.sh).
banco_como_producao() { # nome → URL
  local url; url="$(novo_banco "$1")"
  a_mao_migracoes "$url" 20260921
  a_mao "$url" "$RAIZ"/supabase/seed.sql "$RAIZ"/supabase/seed_compras.sql
  a_mao "$url" "$(dados_eddias)"
  echo "$url"
}

# dist/dados_eddias.sql gerado pelo build.sh numa cópia de supabase/ (não mexe no dist/ do repositório).
dados_eddias() {
  local d="$TMP_CENARIOS/build"
  if [[ ! -f "$d/dist/dados_eddias.sql" ]]; then
    mkdir -p "$d"
    cp -r "$RAIZ"/supabase/build.sh "$RAIZ"/supabase/seed*.sql "$RAIZ"/supabase/limpar_*.sql "$RAIZ"/supabase/migrations "$d/"
    bash "$d/build.sh" >/dev/null
  fi
  echo "$d/dist/dados_eddias.sql"
}
