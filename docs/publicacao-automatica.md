# Prodio — publicação automática: como funciona e por que é seguro

O passo a passo do fundador (o que cadastrar no GitHub, na Cloudflare e no Supabase) está em `docs/deploy.md`, seção "Publicação automática". Aqui está o mecanismo, as provas e os limites.

## 1. O fluxo

Um push dispara o workflow **Publicar** (`.github/workflows/publicar.yml`):

```
push ─► testes (o CI inteiro: lint, test, build, db:test, db:test:api, db:test:migracoes)
          │ falhou? nada publica
          ▼
        preparar ── decide: main = produção, outro branch = prévia
          │         confere segredos, variáveis VITE_*, topo de main, migrations pendentes (--simular)
          ├─ prévia:   web-previa (build + wrangler pages deploy --branch=<branch>, URL no resumo)
          └─ produção: banco ─► worker ─► web-producao
                        │ (só se houver pendente) backup cifrado → artifact → ensaio → aplicar
```

Cada seta só anda se o passo anterior terminou bem. Os comandos manuais (`pnpm deploy:worker`, `pnpm deploy:web`, `pnpm db:aplicar`) continuam valendo como plano B.

Proteções do workflow:

- **Só push.** Não há gatilho de `pull_request` no Publicar nem `pull_request_target` em lugar nenhum: pull request de fork roda só o CI, sem segredo.
- **`permissions: contents: read`** no workflow inteiro. Nenhum job escreve no repositório.
- **Nome de branch e mensagem de commit nunca entram em `run:` por `${{ }}`**: vão por variável de ambiente (`RAMO`), onde o shell não os interpreta.
- **Segredo só no passo que usa** (`env:` do passo). `pnpm install` roda sem segredo nenhum no ambiente, e o build da web (Vite e plugins) roda com o token da Cloudflare tirado do ambiente. Nada de `set -x`; a senha da connection string recebe `::add-mask::`, e o GitHub já mascara os segredos inteiros.
- **Produção serializada**: `concurrency` com `cancel-in-progress: false` em main (a publicação em andamento termina; a mais nova espera). Prévia cancela a anterior do mesmo branch.
- **Só o topo de main publica**: o preparar compara o commit com `refs/heads/main`. "Re-run failed jobs" (e "Re-run job") não roda o preparar de novo, reaproveita as saídas dele; por isso cada job de produção (banco, worker, web-producao) começa conferindo de novo, pela API do GitHub, quando é uma reexecução (`run_attempt` > 1). Reexecutar um run antigo para com erro e não põe código velho no ar.
- **Branch de produção do Pages conferida antes de enviar**: se o projeto `prodio-web` na Cloudflare não tiver `main` como branch de produção, o envio de main viraria prévia, e o envio de outro branch poderia virar produção. O script consulta a API e para antes.
- **Ações fixadas por commit** (`actions/checkout@<sha> # v4.4.0` etc.), as mesmas versões que o CI já usava.

Sem `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`, a publicação é pulada com um aviso e o workflow fica verde. Sem `SUPABASE_DB_URL`, produção **não publica nada**: sem ler o banco não dá para saber se há migration pendente, e worker e web novos podem chamar função que só existe depois dela. Com o banco lido e sem pendência, publica mesmo sem `BACKUP_SENHA`; com pendência, sem `BACKUP_SENHA` não aplica e não publica. Sem as `VITE_*`, falha em vez de publicar o modo de exemplo.

## 2. O aplicador (`supabase/aplicar-migracoes.sh`)

`BANCO_URL=… bash supabase/aplicar-migracoes.sh [--simular]` (ou `pnpm db:aplicar --simular`).

- **Controle** em `prodio_admin.migracoes` (arquivo, sha256, aplicado_em, commit, modo, aplicado_por), criado por `supabase/migracoes/controle.sql`. O schema `prodio_admin` não está entre os expostos pelo PostgREST (o Supabase expõe só `public` e `graphql_public`) e tem `revoke` de `public`, `anon`, `authenticated` e `service_role`.
- **Uma execução por vez**: uma conexão de guarda segura `pg_advisory_lock` do começo ao fim; a segunda execução para na hora ("outra aplicação … em andamento"). E, por garantia, cada arquivo confere dentro da própria transação que o controle está como esperado.
- **Um arquivo, uma transação**: `psql -1 -v ON_ERROR_STOP=1 -f antes.sql -f <arquivo> -f depois.sql`, com o registro no controle no `depois.sql`. Falhou no meio: nada do arquivo fica, nem o registro. `lock_timeout` de 10 s e `statement_timeout` de 15 min por arquivo (estourou, desfaz).
- **Para sem aplicar nada** quando: um arquivo já aplicado mudou de sha256 (migration aplicada não se edita; faça outra), um aplicado sumiu do repositório, um arquivo novo tem data anterior à última aplicada, o nome não segue `AAAAMMDDhhmmss_nome.sql`, ou a trava recusou algum pendente. A URL na porta 6543 (transaction pooler) é recusada.
- **sha256 estável entre Windows e Linux**: o `.gitattributes` força LF em `*.sql` e `*.sh` na cópia de trabalho de qualquer sistema (sem ele, o Git no Windows com `core.autocrlf=true` entrega CRLF e o mesmo arquivo teria outro sha256). Segunda barreira: o aplicador tira BOM e CRLF antes de calcular, e é esse texto normalizado que vai ao banco.
- **`--simular`** só lê: lista as pendentes, diz se a primeira execução vai reaplicar verificando dados e mostra o que a trava recusaria. É o que o job preparar roda.

### A trava de destrutivas (`supabase/migracoes/trava.mjs`)

Lê o SQL com um léxico próprio (`lexico.mjs`), que sabe onde começam e terminam comentários, strings e corpos `$$`. Casos testados em `trava.test.mjs`.

| Recusa sempre | Recusa sem `-- prodio:destrutiva-aprovada: <motivo>` |
|---|---|
| `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` próprios; `CONCURRENTLY`; meta-comando do psql (`\i`, `\set`…) | `DROP TABLE` (inclusive `if exists`), `DROP SCHEMA`, `DROP OWNED`, `DROP SEQUENCE`, `DROP … CASCADE`, `ALTER TABLE … DROP [COLUMN]`, `ALTER COLUMN … TYPE`, `RENAME`, `SET SCHEMA`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT … ON CONFLICT DO UPDATE`, `MERGE` com update/delete, `CALL`, `setval()` e `RESTART` de sequência, chamada a função que já existe em public (`public.f()` ou `f()` sem schema) |

Conta: comando de nível zero, corpo de `DO` (executa na hora) com o SQL dinâmico dentro dele, o corpo de função criada **e chamada** no mesmo arquivo (em `$$…$$` ou `BEGIN ATOMIC`), e as chamadas dentro de `ALTER TABLE` (`DEFAULT` e `CHECK` rodam sobre cada linha que já existe) e de `CREATE TABLE/MATERIALIZED VIEW … AS`. Chamada sem schema conta como `public.f()` quando `f` existe em public no banco-alvo (o aplicador passa a lista à trava) ou é criada por outro arquivo pendente. Não conta: comentário, string, e corpo de `CREATE FUNCTION` que o arquivo não chama (é assim que toda RPC grava, e ela só roda quando alguém chamar). `on delete cascade`, `for update`, `grant delete`, gatilho `before update` e política `for update` não são destrutivos e passam. `ALTER TABLE … DROP CONSTRAINT` também passa, de propósito: não apaga linha, e é metade do padrão reexecutável `drop constraint if exists` + `add constraint`. A linha de aprovação vale só como comentário de linha fora de corpo de função, e aparece no log com o motivo.

Limite: a trava é léxica. Função que já existe no banco não tem o corpo lido (por isso chamá-la pede aprovação), SQL dinâmico montado para esconder a palavra (`'DEL' || 'ETE'`) passa, e nada impede uma migration de estragar dado de um jeito que não usa essas palavras (um gatilho criado no arquivo e disparado por um `INSERT`, por exemplo). Para isso existem a revisão, o ensaio e o backup.

RLS não é assunto da trava, é do CI: `supabase/tests/0018_seguranca_rls_em_tudo.test.sql` (no `db:test`, antes de publicar) falha se alguma tabela de `public` estiver sem RLS, se uma view legível por `authenticated` não tiver `security_invoker`, ou se uma materialized view for legível por `authenticated`. Sem isso, uma migration que esquecesse o `enable row level security` iria ao ar com a tabela aberta entre empresas (o Supabase dá `ALL` em tabela nova de `public` para `anon` e `authenticated`).

## 3. A primeira execução (produção com as 20260921* aplicadas à mão)

Em produção as nove `20260921*` foram coladas no SQL Editor e o controle não existe. Duas saídas foram consideradas:

1. **Linha de base**: marcar as 20260921* como aplicadas sem rodar, a partir de uma verificação de que os objetos existem. Rejeitada: "existe" não prova "igual ao arquivo" (uma política, um grant ou o corpo de uma função podem ser de outra versão), e o controle passaria a afirmar algo não verificado.
2. **Reaplicar tudo, provando a cada arquivo que nenhum dado mudou** (escolhida). Todas as migrations do repositório são reexecutáveis (`create … if not exists`, `create or replace`, `drop … if exists` antes de recriar política e gatilho, `insert … where not exists`). O aplicador detecta "controle vazio e public com tabelas", grava em `prodio_admin.parametros` até que arquivo vale a regra (a `20260926000400_import_catalog_pedidos.sql`, constante `ULTIMA_ANTES_DO_APLICADOR` no aplicador: só ela e as anteriores podem ter sido coladas à mão; migration posterior entra como numa execução normal, porque uma tabela nova ou um cadastro novo mudaria a impressão digital e a primeira execução nunca terminaria), e roda cada um com a impressão digital de todas as tabelas de `public` (contagem + md5 de cada linha, `prodio_admin.impressao_dados()`) antes e depois, **na mesma transação**. Se reaplicar mudaria uma linha, o arquivo inteiro é desfeito e o aplicador para. A impressão digital não pula tabela: se o usuário do aplicador não puder ler uma tabela, ou se a RLS esconder linhas dele, ela dá erro (como o `pg_dump` do backup daria) em vez de comparar só uma parte. A regra continua valendo se a primeira execução parar no meio. Ao fim, o schema de produção fica exatamente o dos arquivos, e cada linha do controle diz a verdade (`modo = reaplicada` nas anteriores ao aplicador, `aplicada` nas posteriores).

Provas (`pnpm db:test:migracoes`, cenários em `supabase/tests/migracoes/producao.sh`):

- banco como o de produção hoje (stubs + 20260921* à mão + seeds + `dist/dados_eddias.sql` gerado pelo `build.sh`): as 13 reaplicadas, as 369 linhas de `public` idênticas antes e depois (`pg_dump --data-only --inserts`, ordenado) e o schema final igual ao de um banco novo;
- banco com as 13 à mão e a carga de 400 produtos/insumos/fichas gravada: 8.072 linhas idênticas e schema idêntico;
- banco em que alguém renomeou a etapa `final` na mão: reaplicar a `20260921000500` recriaria a etapa; o aplicador para nela, nada muda, e a execução seguinte continua verificando;
- primeira execução com uma migration posterior ao aplicador que cria tabela e grava cadastro: as 13 reaplicadas verificando, a nova aplicada normalmente.

**Se a primeira execução parar** ("reaplicar este arquivo mudaria dados de public"): produção ficou como estava (o arquivo foi desfeito; os anteriores ficam registrados), e worker e interface não foram publicados. O log diz qual arquivo. Não edite a migration aplicada: abra uma sessão do Claude, peça para comparar o que aquele arquivo insere com o que está em produção (só leitura) e decida com ela se o dado de produção é o certo (aí o caminho é uma linha de base só daquele arquivo, gravada à mão no controle com o fundador sabendo) ou se falta dado (aí se corrige o dado e roda de novo).

## 4. O ensaio (`supabase/migracoes/ensaio.sh`)

Antes de tocar em produção: `pg_dump --schema-only -n public` de produção e o controle `prodio_admin` com as linhas, restaurados num Postgres de serviço do job **da mesma versão maior** de produção, com o mínimo de ambiente Supabase: os stubs dos testes (`anon`, `authenticated`, `service_role`, `supabase_auth_admin`, schemas `extensions` e `auth`), as extensões de produção que existem na imagem oficial, e os papéis citados no dump como dono ou em GRANT (`nologin`). Depois roda o **mesmo aplicador** lá. Falhou: produção não é tocada.

| Pega | Não pega |
|---|---|
| migration que não roda sobre o schema real (objeto que falta ou já existe diferente, assinatura de função, dependência, papel inexistente), erro de sintaxe, trava de destrutivas, sha256 e ordem contra o controle real | o que depende de **dados** (`NOT NULL` sem default em tabela com linhas, índice único sobre duplicados, `CHECK` violado), tempo e travas de tabela grande, e o que é próprio do Supabase (o ensaio roda como superusuário; o aviso de "objetos com outro dono" aponta o caso `must be owner`) |

No que o ensaio não pega, a transação do arquivo falha em produção e é desfeita inteira (cenário "o que o ensaio não pega" nos testes), e o backup veio antes.

## 5. O backup (`supabase/migracoes/backup.sh`)

Só roda quando há migration pendente, antes do ensaio. `pg_dump --format=custom` de `public` e `prodio_admin`, com o cliente da versão do servidor (o workflow lê a versão de produção e instala `postgresql-client-<versão>` do repositório oficial do PostgreSQL). Confere que o dump abre e tem tabelas, cifra com `gpg --symmetric --cipher-algo AES256` (S2K SHA-512, 65 milhões de iterações; a senha entra por `--passphrase-fd`, nunca na linha de comando), decifra de volta e compara o sha256 com o dump, e apaga o dump em claro. Qualquer falha para tudo.

Vai como **artifact** do run, `backup-producao-AAAAMMDD-HHMMSS-<commit>`, guardado 14 dias. O artifact fica no repositório privado (só quem tem acesso ao repositório baixa) e, mesmo baixado, só abre com a `BACKUP_SENHA`, que existe no gerenciador de senhas do fundador e como segredo do GitHub (que ninguém consegue ler de volta).

Não entram os usuários do login (`auth.users`, cuidado do Supabase; migration nenhuma mexe lá) nem os schemas internos do Supabase. O plano gratuito do Supabase não garante backup; este cobre o momento de risco, que é a migration.

### Restaurar num banco de teste (conferir que presta)

```bash
# 1. baixar: GitHub > Actions > o run > Artifacts > backup-producao-… (ou: gh run download <id> -n backup-producao-…)
unzip backup-producao-*.zip
# 2. um Postgres descartável da mesma versão de produção (ou mais novo)
docker run --rm -d --name prodio-teste -p 5433:5432 -e POSTGRES_PASSWORD=teste postgres:17
# 3. restaurar e ver as contagens (o gpg pede a BACKUP_SENHA)
TESTE_URL=postgres://postgres:teste@localhost:5433/postgres bash supabase/migracoes/restaurar-teste.sh backup-producao-*.dump.gpg
```

O `restaurar-teste.sh` recusa host que não seja desta máquina e banco que não esteja vazio. Sem o script: `gpg -d backup.dump.gpg > backup.dump` e `pg_restore -l backup.dump` (lista o conteúdo); `pg_restore --no-owner --no-privileges -d <banco-de-teste> backup.dump` restaura (as chaves para `auth.users` só entram se os usuários existirem lá — é o que o script resolve).

### Restaurar em produção (desastre)

Nunca por cima, e nunca sem o fundador. Restaure num banco de teste, confira, e copie de volta só as **linhas** afetadas, numa transação, com um script revisado (peça a uma sessão do Claude para montá-lo com você olhando). Nunca `truncate … cascade` nem `delete` sem `where`: as chaves estrangeiras levam junto as tabelas que dependem daquela. Tabela de ledger (`stock_moves`) tem gatilho append-only: ver `docs/arquitetura.md` §2.7. Restaurar exige um computador com `gpg` e `pg_restore` e a `BACKUP_SENHA`, que não se manda em chat.

## 6. Riscos que continuam

- **Segredos de produção e branches.** No GitHub Free com repositório privado não há Environments com regra de branch: o workflow de qualquer branch empurrado para o repositório poderia, se alterado, ler `SUPABASE_DB_URL`. O Publicar só entrega `SUPABASE_DB_URL` e `BACKUP_SENHA` a jobs de main, e o `CLAUDE.md` proíbe mudar o workflow para publicar de outro branch; a proteção de verdade é assinar o GitHub Pro/Team e mover `SUPABASE_DB_URL` e `BACKUP_SENHA` para um Environment `producao` restrito a `main`.
- **A prévia fala com o banco de produção** (as mesmas `VITE_*`). O que for gravado numa prévia, logado, é gravado de verdade. Um projeto Supabase de homologação resolveria.
- **Ensaio como superusuário** e com stubs: o que é próprio do Supabase só aparece em produção, onde a transação desfaz.
