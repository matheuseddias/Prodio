#!/usr/bin/env bash
# Roda as migrations e os testes de banco num PostgreSQL vazio.
# Uso: PGURL=postgres://postgres@localhost:5432/prodio_test bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres@localhost:5432/prodio_test}"

psql "$PGURL" -v ON_ERROR_STOP=1 -q -f tests/stubs_supabase.sql
for f in migrations/*.sql; do
  echo "migration: $f"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f"
done
for f in seed*.sql; do
  echo "seed: $f"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f"
done
for f in tests/*.test.sql; do
  echo "test: $f"
  psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "banco: tudo verde"
