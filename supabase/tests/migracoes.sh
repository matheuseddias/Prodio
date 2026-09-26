#!/usr/bin/env bash
# Prova local do aplicador de migrations, do ensaio e do backup (pnpm db:test:migracoes).
# Uso: PGURL=postgres://postgres@localhost:5432/postgres bash supabase/tests/migracoes.sh
# Cria e apaga bancos prodio_mig_*_test ao lado do de PGURL. Precisa de psql, pg_dump, pg_restore, gpg e node.
set -euo pipefail
cd "$(dirname "$0")/../.."
for f in psql pg_dump pg_restore gpg node; do command -v "$f" >/dev/null || { echo "migracoes: falta $f" >&2; exit 1; }; done
echo "trava de destrutivas (node --test)"
node --test supabase/migracoes/trava.test.mjs > /dev/null || node --test supabase/migracoes/trava.test.mjs
bash supabase/tests/migracoes/controle.sh
bash supabase/tests/migracoes/producao.sh
echo "migracoes: tudo verde"
