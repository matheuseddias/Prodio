#!/usr/bin/env bash
# Cenários do aplicador: controle, sha256, ordem, CRLF, falha no meio, trava de destrutivas, concorrência.
# Rodado por supabase/tests/migracoes.sh.
# shellcheck source=supabase/tests/migracoes/lib.sh
source "$(dirname "$0")/lib.sh"

cenario "banco novo: aplica todas em ordem, uma transação cada, e fica igual ao aplicado à mão"
NOVO="$(novo_banco novo)"
aplicador "$NOVO" --simular
espera_rc 0; espera_texto "$TOTAL pendente(s)"; espera_texto "simulação: nada foi gravado"
espera_sql "$NOVO" "select to_regnamespace('prodio_admin') is null" t
ok "--simular lista as $TOTAL e não cria nada no banco"
aplicador "$NOVO"
espera_rc 0
espera_sql "$NOVO" "select count(*) || ' ' || string_agg(distinct modo, ',') || ' ' || string_agg(distinct commit, ',') from prodio_admin.migracoes" "$TOTAL aplicada $COMMIT_TESTE"
MAO="$(novo_banco mao)"
a_mao_migracoes "$MAO" ""
diff <(estrutura "$NOVO") <(estrutura "$MAO") >/dev/null || falhou "o schema aplicado pelo aplicador difere do aplicado à mão"
ok "$TOTAL registradas com sha256 e commit; schema de public idêntico ao aplicado à mão"
for papel in anon authenticated service_role; do
  espera_sql "$NOVO" "select has_schema_privilege('$papel', 'prodio_admin', 'usage') or has_table_privilege('$papel', 'prodio_admin.migracoes', 'select')" f
done
ok "prodio_admin fechado para anon, authenticated e service_role"

cenario "segunda execução: nada a aplicar"
aplicador "$NOVO"
espera_rc 0; espera_texto "nada a aplicar"
espera_sql "$NOVO" "select count(*) from prodio_admin.migracoes" "$TOTAL"
ok "controle intacto"

cenario "arquivo novo: só ele roda"
DIR="$(copia_migracoes)"
printf -- '-- teste\ncreate table if not exists public.teste_novo (id int primary key);\n' > "$DIR/20990101000000_teste_novo.sql"
MIGRACOES_DIR="$DIR" aplicador "$NOVO"
espera_rc 0; espera_texto "1 pendente(s)"
espera_sql "$NOVO" "select modo from prodio_admin.migracoes where arquivo = '20990101000000_teste_novo.sql'" aplicada
espera_sql "$NOVO" "select to_regclass('public.teste_novo') is not null" t
ok "aplicado e registrado"

cenario "CRLF e BOM: o mesmo sha256 (o aplicador normaliza antes de calcular)"
CRLF="$(copia_migracoes)"
cp "$DIR/20990101000000_teste_novo.sql" "$CRLF/"
for f in "$CRLF"/*.sql; do sed -i 's/$/\r/' "$f"; done
sed -i '1s/^/\xef\xbb\xbf/' "$CRLF/20260921000100_fundacao.sql"
grep -q $'\r$' "$CRLF/20260921000100_fundacao.sql" || falhou "a cópia não ficou com CRLF"
MIGRACOES_DIR="$CRLF" aplicador "$NOVO"
espera_rc 0; espera_texto "nada a aplicar"
ok "arquivos com CRLF e BOM reconhecidos como já aplicados"

cenario "arquivo aplicado alterado: para tudo"
ALT="$(copia_migracoes)"
cp "$DIR/20990101000000_teste_novo.sql" "$ALT/"
echo "-- uma edição inocente" >> "$ALT/20260921000300_cadastros.sql"
printf 'create table public.nao_deveria (id int);\n' > "$ALT/20990102000000_outra.sql"
MIGRACOES_DIR="$ALT" aplicador "$NOVO"
espera_rc 1; espera_texto "20260921000300_cadastros.sql já foi aplicado e mudou"; espera_texto "nada foi aplicado"
espera_sql "$NOVO" "select to_regclass('public.nao_deveria') is null" t
ok "recusou e não aplicou nem o arquivo novo que estava junto"

cenario "arquivo aplicado sumiu e arquivo novo com data antiga: para tudo"
SUMIU="$(copia_migracoes)"
rm "$SUMIU/20260921000700_nfe.sql"
MIGRACOES_DIR="$SUMIU" aplicador "$NOVO"
espera_rc 1; espera_texto "20260921000700_nfe.sql foi aplicado e não existe mais"
VELHO="$(copia_migracoes)"
cp "$DIR/20990101000000_teste_novo.sql" "$VELHO/"
printf 'create table public.velho (id int);\n' > "$VELHO/20260101000000_velho.sql"
MIGRACOES_DIR="$VELHO" aplicador "$NOVO"
espera_rc 1; espera_texto "data anterior à última aplicada"
espera_sql "$NOVO" "select to_regclass('public.velho') is null" t
ok "os dois recusados sem aplicar nada"

cenario "falha no meio de um arquivo: nada dele fica, nem no controle; o anterior fica"
MEIO="$(copia_migracoes)"
cp "$DIR/20990101000000_teste_novo.sql" "$MEIO/"
printf 'create table public.antes_da_falha (id int);\n' > "$MEIO/20990201000000_bom.sql"
printf 'create table public.meio_a (id int);\ninsert into public.meio_a values (1);\nselect 1/0;\ncreate table public.meio_b (id int);\n' > "$MEIO/20990202000000_quebra.sql"
printf 'create table public.depois_da_falha (id int);\n' > "$MEIO/20990203000000_depois.sql"
MIGRACOES_DIR="$MEIO" aplicador "$NOVO"
espera_rc 1; espera_texto "20990202000000_quebra.sql falhou"; espera_texto "division by zero"
espera_sql "$NOVO" "select to_regclass('public.antes_da_falha') is not null, to_regclass('public.meio_a') is null, to_regclass('public.meio_b') is null, to_regclass('public.depois_da_falha') is null" "t|t|t|t"
espera_sql "$NOVO" "select string_agg(arquivo, ',' order by arquivo) from prodio_admin.migracoes where arquivo like '2099020%'" "20990201000000_bom.sql"
ok "o arquivo que quebrou foi desfeito inteiro; o seguinte não rodou"
printf 'create table public.meio_a (id int);\ninsert into public.meio_a values (1);\n' > "$MEIO/20990202000000_quebra.sql"
MIGRACOES_DIR="$MEIO" aplicador "$NOVO"
espera_rc 0; espera_texto "2 pendente(s)"
ok "corrigido o arquivo (ainda não aplicado, pode editar), a execução seguinte continua dali"

cenario "trava de destrutivas"
TRAVA="$(copia_migracoes)"
cp "$MEIO"/2099*.sql "$TRAVA/"
printf 'create table public.inocente (id int);\n' > "$TRAVA/20990301000000_inocente.sql"
printf -- '-- apaga o que sobrou do teste\ndelete from public.meio_a where id = 1;\n' > "$TRAVA/20990302000000_apaga.sql"
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO" --simular
espera_rc 1; espera_texto "RECUSADO 20990302000000_apaga.sql"; espera_texto "DELETE"
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
espera_rc 1; espera_texto "nada foi aplicado"
espera_sql "$NOVO" "select to_regclass('public.inocente') is null, (select count(*) from public.meio_a)" "t|1"
ok "DELETE sem aprovação: recusado na simulação e na aplicação, e nem o arquivo inocente antes dele rodou"
printf -- '-- prodio:destrutiva-aprovada: linha de teste sem uso, combinado com o fundador em 26/09\ndelete from public.meio_a where id = 1;\n' > "$TRAVA/20990302000000_apaga.sql"
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
espera_rc 0; espera_texto "APROVADO 20990302000000_apaga.sql"
espera_sql "$NOVO" "select to_regclass('public.inocente') is not null, (select count(*) from public.meio_a)" "t|0"
ok "com a linha de aprovação: aplicado, e o motivo aparece no log"
printf -- '-- prodio:destrutiva-aprovada: tanto faz\ncreate table public.t_commit (id int);\ncommit;\n' > "$TRAVA/20990303000000_commit.sql"
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
espera_rc 1; espera_texto "controle de transação próprio"
rm "$TRAVA/20990303000000_commit.sql"
printf 'create index concurrently if not exists i_inocente on public.inocente (id);\n' > "$TRAVA/20990303000000_conc.sql"
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
espera_rc 1; espera_texto "CONCURRENTLY"
espera_sql "$NOVO" "select to_regclass('public.t_commit') is null, to_regclass('public.i_inocente') is null" "t|t"
ok "COMMIT próprio (mesmo com aprovação) e CONCURRENTLY recusados com mensagem clara"
rm "$TRAVA/20990303000000_conc.sql"
for caso in "drop table public.inocente;" "alter table public.inocente drop column id;" "alter table public.inocente alter column id type bigint;" \
  "alter table public.inocente rename to outra;" "truncate public.inocente;" "update public.inocente set id = 2;" \
  "do \$\$ begin delete from public.inocente; end \$\$;" "drop schema if exists lixo cascade;"; do
  printf -- '-- corpo de função não conta: create function x() ... $$ delete from t $$\n%s\n' "$caso" > "$TRAVA/20990304000000_caso.sql"
  MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
  espera_rc 1; espera_texto "RECUSADO 20990304000000_caso.sql"
done
espera_sql "$NOVO" "select to_regclass('public.inocente') is not null" t
ok "DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE, RENAME, TRUNCATE, UPDATE, DELETE em DO e DROP SCHEMA recusados"
# função que já existe no banco, chamada sem schema (o search_path resolve para public): o aplicador passa
# à trava os nomes de public do banco-alvo
for caso in "select reverse_stock_move(null::uuid, null::uuid, 'x');" "do \$\$ begin perform disconnect_connector(null::uuid); end \$\$;"; do
  printf '%s\n' "$caso" > "$TRAVA/20990304000000_caso.sql"
  MIGRACOES_DIR="$TRAVA" aplicador "$NOVO" --simular
  espera_rc 1; espera_texto "sem schema, que é public."
done
ok "chamada sem schema a função que já existe em public recusada (reverse_stock_move, disconnect_connector)"
rm "$TRAVA/20990304000000_caso.sql"

cenario "duas execuções ao mesmo tempo: a segunda para sem aplicar"
printf 'create table public.concorrente (id int);\n' > "$TRAVA/20990401000000_concorrente.sql"
coproc SEGURA { psql "$NOVO" -X -q -At 2>&1; }
echo "select pg_advisory_lock(8261720260926);" >&"${SEGURA[1]}"
read -r -t 10 _ <&"${SEGURA[0]}" || falhou "não consegui segurar a trava no teste"
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
espera_rc 1; espera_texto "outra aplicação de migrations está em andamento"
espera_sql "$NOVO" "select to_regclass('public.concorrente') is null" t
kill "$SEGURA_PID" 2>/dev/null || true; wait 2>/dev/null || true
MIGRACOES_DIR="$TRAVA" aplicador "$NOVO"
espera_rc 0
ok "com a trava ocupada, recusou; liberada, aplicou"

cenario "URL do transaction pooler (porta 6543) é recusada"
for url in "postgres://postgres.ref:x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" \
  "postgres://postgres.ref:x@aws-0-sa-east-1.pooler.supabase.com:6543" "postgres://postgres.ref:x@/postgres?host=aws-0-sa-east-1.pooler.supabase.com&port=6543"; do
  aplicador "$url" --simular
  espera_rc 1; espera_texto "porta 6543"
done
ok "recusada antes de conectar (com e sem barra, e em ?port=)"
echo "migracoes/controle: tudo verde"
