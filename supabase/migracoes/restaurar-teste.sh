#!/usr/bin/env bash
# Restaura um backup cifrado (artifact "backup-producao-…" do GitHub Actions) num Postgres de TESTE, vazio,
# e mostra quantas linhas cada tabela tem. Serve para conferir que o backup presta antes de precisar dele.
# Nunca aponte TESTE_URL para produção: o script recusa host que não seja desta máquina.
#
# Uso: TESTE_URL=postgres://postgres:senha@localhost:5432/postgres bash supabase/migracoes/restaurar-teste.sh backup.dump.gpg
#   Sem BACKUP_SENHA no ambiente, o gpg pede a senha na tela (é o normal na sua máquina).
#   Um Postgres de teste descartável: docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=teste postgres:17
#   PG_BIN: pasta do pg_restore, se não estiver no PATH (a versão tem de ser a do backup ou mais nova).
# Por que em três etapas: memberships, user_active_tenant e devices apontam para auth.users, que o backup
# não traz. Entram primeiro as tabelas, depois os dados, depois os ids de usuário citados (no auth.users do
# stub) e só então as chaves estrangeiras e os índices.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
ARQUIVO="${1:-}"
falha() { echo "restaurar: ERRO: $*" >&2; exit 1; }
[[ -f "$ARQUIVO" ]] || falha "uso: TESTE_URL=… bash supabase/migracoes/restaurar-teste.sh <backup.dump.gpg>"
[[ -n "${TESTE_URL:-}" ]] || falha "defina TESTE_URL (um Postgres de teste, vazio)"
hospede="${TESTE_URL#*://}"; hospede="${hospede##*@}"; hospede="${hospede%%/*}"; hospede="${hospede%%\?*}"; hospede="${hospede%:*}"
if [[ -n "$hospede" && "$hospede" != localhost && "$hospede" != 127.0.0.1 && "$hospede" != "[::1]" ]]; then
  falha "TESTE_URL tem de ser um Postgres desta máquina, não '$hospede' (este script não restaura em produção)"
fi
# host=/hostaddr= na query valem mais que o host da URL (postgres://u@/banco?host=outro): também só locais.
if [[ "$TESTE_URL" =~ [?\&](host|hostaddr)=([^\&]*) ]]; then
  outro="${BASH_REMATCH[2]}"
  if [[ "$outro" != /* && "$outro" != %2[Ff]* && "$outro" != localhost && "$outro" != 127.0.0.1 && "$outro" != ::1 ]]; then
    falha "TESTE_URL tem de ser um Postgres desta máquina, não '$outro'"
  fi
fi
BIN="${PG_BIN:+$PG_BIN/}"
teste() { psql "$TESTE_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
[[ "$(teste -c "select count(*) from pg_catalog.pg_tables where schemaname in ('public', 'prodio_admin')")" == 0 ]] \
  || falha "o banco de teste não está vazio; crie um novo"

TMP="$(mktemp -d)"
GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'rm -rf "$TMP" "$GNUPGHOME"' EXIT
chmod 700 "$TMP" "$GNUPGHOME"
DUMP="$TMP/backup.dump"
if [[ -n "${BACKUP_SENHA:-}" ]]; then
  gpg --batch --no-tty --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$DUMP" "$ARQUIVO" 3<<<"$BACKUP_SENHA" \
    || falha "não consegui decifrar (senha errada ou arquivo corrompido)"
else
  gpg --quiet --decrypt --output "$DUMP" "$ARQUIVO" || falha "não consegui decifrar (senha errada ou arquivo corrompido)"
fi
"${BIN}pg_restore" --list "$DUMP" > "$TMP/lista" || falha "o arquivo decifrado não é um dump do pg_dump"
grep -vE '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' "$TMP/lista" > "$TMP/lista-sem-public"

teste -f "$RAIZ/supabase/tests/stubs_supabase.sql" >/dev/null
restaurar() { "${BIN}pg_restore" --exit-on-error --single-transaction --no-owner --no-privileges -L "$TMP/lista-sem-public" -d "$TESTE_URL" "$@" "$DUMP"; }
restaurar --section=pre-data || falha "as tabelas não restauraram"
restaurar --section=data || falha "os dados não restauraram"
# ids de usuário citados pelas chaves para auth.users (tabela e coluna tiradas do próprio dump)
"${BIN}pg_restore" --section=post-data -f - "$DUMP" | awk '
  /^ALTER TABLE ONLY public\./ { tabela = $4 }
  /FOREIGN KEY \(.*\) REFERENCES auth\.users\(id\)/ { match($0, /FOREIGN KEY \([a-z_]+\)/); col = substr($0, RSTART + 13, RLENGTH - 14); print tabela "|" col }
' | sort -u | while IFS='|' read -r tabela coluna; do
  [[ "$tabela" =~ ^public\.[a-z_]+$ && "$coluna" =~ ^[a-z_]+$ ]] || continue
  teste -c "insert into auth.users (id) select distinct $coluna from $tabela where $coluna is not null on conflict do nothing" >/dev/null
done
restaurar --section=post-data || falha "chaves e índices não restauraram"

echo "restaurar: backup restaurado. Linhas por tabela:"
teste -F ' | ' -c "
  select format('%-32s', c.relnamespace::regnamespace || '.' || c.relname),
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %s', c.oid::regclass), false, true, '')))[1]::text
    from pg_class c
   where c.relkind = 'r' and c.relnamespace::regnamespace::text in ('public', 'prodio_admin')
   order by 1"
