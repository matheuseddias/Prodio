#!/usr/bin/env bash
# Gera os artefatos para aplicar o Prodio num projeto Supabase real, em supabase/dist/:
#   schema.sql         todas as migrations na ordem (cole no SQL Editor ou aplique com psql)
#   dados_eddias.sql   a empresa Eddias com cadastros de exemplo, SEM tocar em auth.users
#   limpar_exemplo.sql apaga os dados de exemplo e mantém a empresa, os usuários e os aparelhos
#                      (apaga todos os dados da empresa, não só o exemplo: só para quem ainda não usa o Prodio de verdade)
#   limpar_so_exemplo.sql apaga SÓ o exemplo e mantém conectores, credenciais, cursor do robô e pedidos reais
#                      (para quem já ligou um conector antes de importar o cadastro)
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
# limpar_exemplo.sql e limpar_so_exemplo.sql
# ---------------------------------------------------------------------------
# As fontes são supabase/limpar_exemplo.sql e supabase/limpar_so_exemplo.sql (versionadas e testadas em
# tests/0016_limpar_exemplo.test.sql e tests/0017_limpar_so_exemplo.test.sql). Quando usar cada uma: docs/deploy.md.
cp limpar_exemplo.sql dist/limpar_exemplo.sql
cp limpar_so_exemplo.sql dist/limpar_so_exemplo.sql

echo "gerado em supabase/dist/:"
wc -l dist/schema.sql dist/dados_eddias.sql dist/limpar_exemplo.sql dist/limpar_so_exemplo.sql
