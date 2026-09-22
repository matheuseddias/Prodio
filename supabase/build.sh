#!/usr/bin/env bash
# Gera os artefatos para aplicar o Prodio num projeto Supabase real, em supabase/dist/:
#   schema.sql         todas as migrations na ordem (cole no SQL Editor ou aplique com psql)
#   dados_eddias.sql   a empresa Eddias com cadastros de exemplo, SEM tocar em auth.users
#   limpar_exemplo.sql apaga os dados de exemplo e mantém a empresa, os usuários e os aparelhos
#
# Os seeds de desenvolvimento (seed.sql, seed_compras.sql) criam usuários direto em auth.users,
# o que só funciona no Postgres local com stubs. Num projeto real o usuário nasce no Auth
# (painel ou cadastro) e aqui ele é resolvido pelo e-mail.
#
# Uso: bash supabase/build.sh [email-do-admin]
set -euo pipefail
cd "$(dirname "$0")"
EMAIL="${1:-matheus@eddias.com.br}"
mkdir -p dist

# ---------------------------------------------------------------------------
# schema.sql
# ---------------------------------------------------------------------------
{
  echo "-- Prodio · schema completo (gerado por supabase/build.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ))"
  echo "-- Aplique num projeto Supabase novo. É idempotente: rodar de novo não quebra."
  echo
  for f in migrations/*.sql; do
    echo "-- ==========================================================================="
    echo "-- $f"
    echo "-- ==========================================================================="
    cat "$f"
    echo
  done
} > dist/schema.sql

# ---------------------------------------------------------------------------
# dados_eddias.sql
# ---------------------------------------------------------------------------
USER_LOOKUP="(select u.id from auth.users u where u.email = '${EMAIL}')"
{
  echo "-- Prodio · empresa Eddias e cadastros de exemplo (gerado por supabase/build.sh)."
  echo "-- Pré-requisito: o usuário ${EMAIL} já existe no Auth (painel: Authentication > Users)."
  echo "-- Não cria nem altera usuários: o admin é resolvido pelo e-mail."
  echo "-- Idempotente. Para remover só os dados de exemplo, rode limpar_exemplo.sql."
  echo
  echo "do \$guard\$ begin"
  echo "  if ${USER_LOOKUP} is null then"
  echo "    raise exception 'Crie o usuário ${EMAIL} no Auth antes de rodar este arquivo';"
  echo "  end if;"
  echo "end \$guard\$;"
  echo
  # Seeds sem as linhas de auth.users e sem o aparelho pré-pareado (em produção o aparelho pareia pelo app).
  python3 - "$EMAIL" <<'PY'
import re, sys
email = sys.argv[1]
lookup = f"(select u.id from auth.users u where u.email = '{email}')"
ANON = '33333333-3333-3333-3333-333333333333'
ADMIN = '22222222-2222-2222-2222-222222222222'
saida = []
for nome in ('seed.sql', 'seed_compras.sql'):
    texto = open(nome, encoding='utf-8').read()
    blocos = texto.split('\n\n')
    mantidos = []
    for b in blocos:
        # fora: criação de usuários e tudo que depende do usuário anônimo do aparelho
        if 'insert into auth.users' in b:
            continue
        if ANON in b:
            continue
        mantidos.append(b)
    t = '\n\n'.join(mantidos)
    t = t.replace(f"'{ADMIN}'", lookup)
    t = t.replace('-- Seed de desenvolvimento:', '-- Cadastros:')
    t = t.replace('-- Operadores (PIN 1234 / 2345 / 3456) e aparelho registrado a um usuário anônimo fixo.',
                  '-- Operadores (PIN 1234 / 2345 / 3456). Troque os PINs em Configurações depois do primeiro acesso.')
    saida.append(f"-- ---------------------------------------------------------------------------\n-- {nome}\n-- ---------------------------------------------------------------------------\n{t}")
print('\n\n'.join(saida))
PY
} > dist/dados_eddias.sql

# ---------------------------------------------------------------------------
# limpar_exemplo.sql
# ---------------------------------------------------------------------------
cat > dist/limpar_exemplo.sql <<'SQL'
-- Prodio · remove os dados de exemplo da Eddias e mantém a empresa, usuários, aparelhos e operadores.
-- Use antes de importar os dados reais. O ledger é apagado junto porque os saldos vinham do exemplo.
do $$
declare t uuid;
begin
  select id into t from public.tenants where slug = 'eddias';
  if t is null then raise notice 'empresa eddias não encontrada'; return; end if;
  delete from public.notifications where tenant_id = t;
  delete from public.inventory_items where tenant_id = t;
  delete from public.inventory_sessions where tenant_id = t;
  delete from public.product_prices where tenant_id = t;
  delete from public.channels where tenant_id = t;
  delete from public.integration_outbox where tenant_id = t;
  delete from public.order_items where tenant_id = t;
  delete from public.orders where tenant_id = t;
  delete from public.audit_runs where tenant_id = t;
  delete from public.hub_stock_snapshots where tenant_id = t;
  delete from public.connector_status_map where tenant_id = t;
  delete from public.sync_state where tenant_id = t;
  delete from public.connector_credentials where tenant_id = t;
  delete from public.connectors where tenant_id = t;
  delete from public.receipt_items where tenant_id = t;
  delete from public.receipts where tenant_id = t;
  delete from public.nfe_po_links where tenant_id = t;
  delete from public.nfe_inbound_items where tenant_id = t;
  delete from public.nfe_inbound where tenant_id = t;
  delete from public.purchase_order_items where tenant_id = t;
  delete from public.purchase_orders where tenant_id = t;
  delete from public.scan_events where tenant_id = t;
  delete from public.labels where tenant_id = t;
  delete from public.daily_plans where tenant_id = t;
  delete from public.stock_balances where tenant_id = t;
  alter table public.stock_moves disable trigger user;
  delete from public.stock_moves where tenant_id = t;
  alter table public.stock_moves enable trigger user;
  delete from public.bom_lines where tenant_id = t;
  delete from public.bom_versions where tenant_id = t;
  delete from public.supplier_materials where tenant_id = t;
  delete from public.materials where tenant_id = t;
  delete from public.sku_aliases where tenant_id = t;
  delete from public.products where tenant_id = t;
  delete from public.suppliers where tenant_id = t;
  update public.doc_counters set next_value = 1 where tenant_id = t;
  raise notice 'dados de exemplo removidos; empresa, usuários, locais, unidades, perfis de etiqueta e operadores mantidos';
end $$;
SQL

echo "gerado em supabase/dist/:"
wc -l dist/schema.sql dist/dados_eddias.sql dist/limpar_exemplo.sql
