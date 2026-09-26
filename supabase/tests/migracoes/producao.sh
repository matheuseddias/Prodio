#!/usr/bin/env bash
# Cenários de saúde dos dados: primeira execução sobre banco populado (schema aplicado à mão, sem controle),
# impressão digital, ensaio a partir de pg_dump --schema-only, backup cifrado e restauração.
# Rodado por supabase/tests/migracoes.sh.
# shellcheck source=supabase/tests/migracoes/lib.sh
source "$(dirname "$0")/lib.sh"

cenario "primeira execução num banco como o de produção (20260921* à mão, seeds, dados_eddias.sql, sem controle)"
PROD="$(banco_como_producao prod)"
DADOS_ANTES="$TMP_CENARIOS/prod.dados"; dados "$PROD" > "$DADOS_ANTES"
[[ $(wc -l < "$DADOS_ANTES") -gt 100 ]] || falhou "o banco de teste devia estar populado"
aplicador "$PROD" --simular
espera_rc 0; espera_texto "primeira execução"; espera_texto "$TOTAL pendente(s)"; espera_texto "reaplicação verificando dados"
# primeiro só as anteriores ao aplicador (as que podem ter sido coladas à mão): nenhuma linha pode mudar
MIGRACOES_DIR="$(copia_migracoes_antigas)" aplicador "$PROD"
espera_rc 0
espera_sql "$PROD" "select count(*) || ' ' || string_agg(distinct modo, ',') from prodio_admin.migracoes" "$ANTIGAS reaplicada"
diff <(dados "$PROD") "$DADOS_ANTES" >/dev/null || falhou "a primeira execução mudou dados de public"
# depois o repositório inteiro: as posteriores ao aplicador, se houver, entram como numa execução normal
aplicador "$PROD"
espera_rc 0
espera_sql "$PROD" "select count(*) filter (where modo = 'reaplicada') || ' ' || count(*) filter (where modo = 'aplicada') from prodio_admin.migracoes" "$ANTIGAS $((TOTAL - ANTIGAS))"
REF="$(novo_banco referencia)"
a_mao_migracoes "$REF" ""
diff <(estrutura "$PROD") <(estrutura "$REF") >/dev/null || falhou "depois da primeira execução o schema difere do de um banco novo"
ok "$ANTIGAS reaplicadas; $(wc -l < "$DADOS_ANTES") linhas de public idênticas antes e depois; schema igual ao de um banco novo"
aplicador "$PROD"
espera_rc 0; espera_texto "nada a aplicar"
ok "segunda execução: nada a aplicar"

cenario "primeira execução num banco com todas à mão e carga grande (import_catalog 400/400/400 gravado)"
CHEIO="$(novo_banco cheio)"
a_mao_migracoes "$CHEIO" ""
a_mao "$CHEIO" "$RAIZ"/supabase/seed.sql "$RAIZ"/supabase/seed_compras.sql "$(dados_eddias)"
sed 's/^rollback;$/commit;/' "$RAIZ/supabase/tests/0015_import_catalog_carga.test.sql" > "$TMP_CENARIOS/carga.sql"
a_mao "$CHEIO" "$TMP_CENARIOS/carga.sql"
ESTR_ANTES="$(estrutura "$CHEIO" | sha256sum)"
dados "$CHEIO" > "$TMP_CENARIOS/cheio.dados"
aplicador "$CHEIO"
espera_rc 0
diff <(dados "$CHEIO") "$TMP_CENARIOS/cheio.dados" >/dev/null || falhou "reaplicar mudou dados do banco cheio"
[[ "$(estrutura "$CHEIO" | sha256sum)" == "$ESTR_ANTES" ]] || falhou "reaplicar mudou o schema do banco cheio"
ok "$(wc -l < "$TMP_CENARIOS/cheio.dados") linhas idênticas; schema idêntico"

cenario "impressão digital: se reaplicar mudaria um dado, o arquivo não entra (e a regra vale na execução seguinte)"
MEXIDO="$(banco_como_producao mexido)"
# alguém renomeou a etapa 'final' na mão; reaplicar a 20260921000500 recriaria uma 'final'
consulta "$MEXIDO" "update public.stages set codigo = 'acabamento' where codigo = 'final'" >/dev/null
dados "$MEXIDO" > "$TMP_CENARIOS/mexido.dados"
aplicador "$MEXIDO"
espera_rc 1; espera_texto "20260921000500_producao.sql falhou"; espera_texto "reaplicar este arquivo mudaria dados"
espera_sql "$MEXIDO" "select count(*) from prodio_admin.migracoes" 4
diff <(dados "$MEXIDO") "$TMP_CENARIOS/mexido.dados" >/dev/null || falhou "a falha deixou dado mudado"
aplicador "$MEXIDO"
espera_rc 1; espera_texto "reaplicar este arquivo mudaria dados"
espera_sql "$MEXIDO" "select valor from prodio_admin.parametros where chave = 'reaplicar_verificando_ate'" "$ULTIMA_ANTES_DO_APLICADOR"
ok "parou na 20260921000500 sem mudar nada; a execução seguinte continua verificando"

cenario "robô gravando no meio da reaplicação: a conferência não acusa dado mudado (REPEATABLE READ)"
ROBO="$(banco_como_producao robo)"
# Uma tabela qualquer de public fora das migrations, como os pedidos que o cron do worker grava a cada 5 min.
consulta "$ROBO" "create table public.robo_teste (id int)" >/dev/null
( sleep 2; consulta "$ROBO" "insert into public.robo_teste values (1)" >/dev/null ) &
ROBO_PID=$!
export APLICADOR_PAUSA_TESTE=5 # pausa entre as duas impressões do primeiro arquivo reaplicado
aplicador "$ROBO"
unset APLICADOR_PAUSA_TESTE
wait "$ROBO_PID" || falhou "a gravação concorrente falhou"
espera_rc 0
espera_sql "$ROBO" "select count(*) from public.robo_teste" 1
espera_sql "$ROBO" "select count(*) from prodio_admin.migracoes where modo = 'reaplicada'" "$ANTIGAS"
ok "a linha gravada no meio ficou, e as $ANTIGAS reaplicadas passaram na conferência"

cenario "primeira execução com migration posterior ao aplicador (tabela nova e cadastro novo): entra normalmente"
NOVA="$(banco_como_producao nova)"
DIR_NOVA="$(copia_migracoes)"
cat > "$DIR_NOVA/20990101000000_nova_tabela.sql" <<'SQL'
create table if not exists public.nova_tabela (id int primary key, tenant_id uuid not null references public.tenants(id));
alter table public.nova_tabela enable row level security;
insert into public.units (tenant_id, code, nome, kind)
  select t.id, 'cx', 'Caixa', 'unidade' from public.tenants t
   where not exists (select 1 from public.units u where u.tenant_id = t.id and u.code = 'cx');
SQL
MIGRACOES_DIR="$DIR_NOVA" aplicador "$NOVA" --simular
espera_rc 0; espera_texto "pendente: 20990101000000_nova_tabela.sql"
if grep -F "pendente: 20990101000000_nova_tabela.sql" <<<"$SAIDA" | grep -q verificando; then falhou "a migration nova não devia ser verificada"; fi
MIGRACOES_DIR="$DIR_NOVA" aplicador "$NOVA"
espera_rc 0
espera_sql "$NOVA" "select count(*) from prodio_admin.migracoes where modo = 'reaplicada'" "$ANTIGAS"
espera_sql "$NOVA" "select modo from prodio_admin.migracoes where arquivo = '20990101000000_nova_tabela.sql'" aplicada
espera_sql "$NOVA" "select to_regclass('public.nova_tabela') is not null, (select count(*) from public.units where code = 'cx') = (select count(*) from public.tenants)" "t|t"
espera_sql "$NOVA" "select valor from prodio_admin.parametros where chave = 'reaplicar_verificando_ate'" "$ULTIMA_ANTES_DO_APLICADOR"
MIGRACOES_DIR="$DIR_NOVA" aplicador "$NOVA"
espera_rc 0; espera_texto "nada a aplicar"
ok "as $ANTIGAS antigas reaplicadas verificando; a nova aplicada (tabela e cadastro gravados); a seguinte não tem nada"

cenario "ensaio: estrutura de produção (pg_dump --schema-only) num Postgres vazio, mesmo aplicador"
PROD2="$(banco_como_producao prod2)"
ENSAIO="$(banco_vazio ensaio)"
BANCO_URL="$PROD2" ENSAIO_URL="$ENSAIO" COMMIT="$COMMIT_TESTE" bash "$RAIZ/supabase/migracoes/ensaio.sh" > "$TMP_CENARIOS/ensaio.log" 2>&1 \
  || { cat "$TMP_CENARIOS/ensaio.log"; falhou "o ensaio devia passar"; }
espera_sql "$ENSAIO" "select count(*) from prodio_admin.migracoes" "$TOTAL"
espera_sql "$ENSAIO" "select count(*) from public.tenants" 0
espera_sql "$PROD2" "select to_regnamespace('prodio_admin') is null" t
ok "primeira execução ensaiada ($TOTAL no ensaio, sem nenhuma linha de dado); produção intocada"
aplicador "$PROD2"
espera_rc 0
ENSAIO2="$(banco_vazio ensaio2)"
DIR="$(copia_migracoes)"
printf 'create table public.nova (id int primary key, tenant_id uuid not null references public.tenants(id));\n' > "$DIR/20990101000000_nova.sql"
printf 'alter table public.nao_existe add column x int;\n' > "$DIR/20990102000000_quebrada.sql"
dados "$PROD2" > "$TMP_CENARIOS/prod2.dados"
set +e
MIGRACOES_DIR="$DIR" BANCO_URL="$PROD2" ENSAIO_URL="$ENSAIO2" bash "$RAIZ/supabase/migracoes/ensaio.sh" > "$TMP_CENARIOS/ensaio2.log" 2>&1
rc=$?
set -e
[[ $rc -ne 0 ]] || falhou "o ensaio devia falhar com a migration quebrada"
grep -q 'relation "public.nao_existe" does not exist' "$TMP_CENARIOS/ensaio2.log" || { cat "$TMP_CENARIOS/ensaio2.log"; falhou "mensagem do ensaio"; }
espera_sql "$PROD2" "select count(*) from prodio_admin.migracoes" "$TOTAL"
espera_sql "$PROD2" "select to_regclass('public.nova') is null" t
diff <(dados "$PROD2") "$TMP_CENARIOS/prod2.dados" >/dev/null || falhou "o ensaio mexeu em produção"
ok "migration que não roda sobre o schema real: o ensaio falha e produção fica igual"

cenario "o que o ensaio não pega (depende de dado): produção desfaz o arquivo inteiro"
DIR2="$(copia_migracoes)"
printf 'create table public.antes (id int);\nalter table public.products add column obrigatorio text not null;\n' > "$DIR2/20990101000000_nao_nula.sql"
ENSAIO3="$(banco_vazio ensaio3)"
MIGRACOES_DIR="$DIR2" BANCO_URL="$PROD2" ENSAIO_URL="$ENSAIO3" bash "$RAIZ/supabase/migracoes/ensaio.sh" > "$TMP_CENARIOS/ensaio3.log" 2>&1 \
  || { cat "$TMP_CENARIOS/ensaio3.log"; falhou "sem linhas, o ensaio passa"; }
MIGRACOES_DIR="$DIR2" aplicador "$PROD2"
espera_rc 1; espera_texto "contains null values"
espera_sql "$PROD2" "select to_regclass('public.antes') is null, (select count(*) from prodio_admin.migracoes)" "t|$TOTAL"
diff <(dados "$PROD2") "$TMP_CENARIOS/prod2.dados" >/dev/null || falhou "a falha em produção deixou rastro"
ok "o ensaio passou (tabela vazia), produção recusou e nada do arquivo ficou"

cenario "backup cifrado e restauração num banco novo"
SENHA="senha-de-teste-do-backup-$RANDOM-$RANDOM"
BK="$TMP_CENARIOS/backup"
BANCO_URL="$CHEIO" BACKUP_SENHA="$SENHA" bash "$RAIZ/supabase/migracoes/backup.sh" "$BK" backup-producao-teste > "$TMP_CENARIOS/backup.log" 2>&1 \
  || { cat "$TMP_CENARIOS/backup.log"; falhou "backup"; }
ARQ="$BK/backup-producao-teste.dump.gpg"
[[ -f "$ARQ" && $(find "$BK" -type f | wc -l) -eq 1 ]] || falhou "o backup devia deixar só o .gpg"
if head -c 5 "$ARQ" | grep -q PGDMP; then falhou "backup não cifrado"; fi
if strings "$ARQ" | grep -q 'Fornecedor 1'; then falhou "dado legível no arquivo cifrado"; fi
[[ "$(stat -c %a "$ARQ")" == 600 ]] || falhou "o backup devia ser legível só pelo dono"
set +e
BACKUP_SENHA="curta" BANCO_URL="$CHEIO" bash "$RAIZ/supabase/migracoes/backup.sh" "$BK" x > /dev/null 2>&1; rc_curta=$?
BANCO_URL="$CHEIO" bash "$RAIZ/supabase/migracoes/backup.sh" "$BK" y > /dev/null 2>&1; rc_sem=$?
set -e
[[ $rc_curta -ne 0 && $rc_sem -ne 0 ]] || falhou "backup sem senha ou com senha curta devia falhar"
ok "só o .gpg (modo 600), sem texto legível; sem senha ou com senha curta, falha"
RESTO="$(banco_vazio restaurado)"
BACKUP_SENHA="$SENHA" TESTE_URL="$RESTO" bash "$RAIZ/supabase/migracoes/restaurar-teste.sh" "$ARQ" > "$TMP_CENARIOS/restaurar.log" 2>&1 \
  || { cat "$TMP_CENARIOS/restaurar.log"; falhou "restauração"; }
[[ "$(contagens "$RESTO")" == "$(contagens "$CHEIO")" ]] || falhou "contagens diferentes: $(contagens "$RESTO") × $(contagens "$CHEIO")"
diff <(dados "$RESTO") <(dados "$CHEIO") >/dev/null || falhou "dados restaurados diferem do original"
espera_sql "$RESTO" "select count(*) from prodio_admin.migracoes" "$TOTAL"
ok "restaurado num banco novo: contagens e linhas idênticas às do original ($(consulta "$RESTO" "select count(*) from public.products") produtos)"
RESTO2="$(banco_vazio restaurado2)"
set +e
BACKUP_SENHA="senha-errada-com-mais-de-vinte" TESTE_URL="$RESTO2" bash "$RAIZ/supabase/migracoes/restaurar-teste.sh" "$ARQ" > /dev/null 2>&1; rc=$?
TESTE_URL="postgres://x:y@db.abc.supabase.co:5432/postgres" BACKUP_SENHA="$SENHA" bash "$RAIZ/supabase/migracoes/restaurar-teste.sh" "$ARQ" > /dev/null 2>&1; rc_remoto=$?
set -e
[[ $rc -ne 0 && $rc_remoto -ne 0 ]] || falhou "senha errada ou banco remoto deviam falhar"
ok "senha errada não decifra; restaurar-teste recusa host que não é desta máquina"
echo "migracoes/producao: tudo verde"
