# Prodio — instalar num projeto Supabase

Passo a passo para sair do zero até a interface conversando com o banco real. Foi validado contra PostgreSQL 16 com os stubs do Supabase; os itens marcados **no painel** só existem no projeto hospedado.

Gere os arquivos antes de começar:

```bash
bash supabase/build.sh                 # usa matheus@eddias.com.br como admin
bash supabase/build.sh outro@email.com # ou passe outro e-mail
```

Saem três arquivos em `supabase/dist/` (não versionados, são gerados):

| Arquivo | O que faz |
|---|---|
| `schema.sql` | As 9 migrations na ordem. Cria tabelas, RLS, funções e views. |
| `dados_eddias.sql` | Cria a empresa Eddias com cadastros de exemplo. Não toca em `auth.users`. |
| `limpar_exemplo.sql` | Apaga só os dados de exemplo, mantendo empresa, usuários, locais, unidades, perfis de etiqueta e operadores. |

## 1. Criar o usuário administrador

**No painel**, em Authentication > Users > Add user, crie o usuário com o e-mail do administrador e uma senha. Marque como confirmado.

O cadastro público está desligado de propósito (`enable_signup = false`): num sistema de fábrica, quem entra é convidado.

## 2. Aplicar o schema

Pelo SQL Editor do painel: abra `supabase/dist/schema.sql`, cole e execute.

Ou por linha de comando, com a string de conexão em Settings > Database (use a do pooler na porta 5432, modo session):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dist/schema.sql
```

Ou com o Supabase CLI, que registra as versões e permite `db diff` depois:

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push
```

O schema é idempotente: rodar de novo não quebra nada.

## 3. Criar a empresa e os dados de exemplo

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/dist/dados_eddias.sql
```

Se o usuário do passo 1 não existir, o arquivo interrompe com uma mensagem dizendo isso. Ao final você tem a empresa Eddias, 11 produtos, 13 insumos, 5 fornecedores, 4 fichas técnicas, plano do dia, saldos, 6 ordens de compra, 6 notas fiscais e 3 operadores com PIN 1234, 2345 e 3456.

Quando for usar dados reais, rode `limpar_exemplo.sql` e importe os seus pelas telas de cadastro.

## 4. Ligar o gatilho de token

**No painel**, em Authentication > Hooks > Custom Access Token, aponte para a função `public.custom_access_token_hook` e ative.

Sem isso nada funciona: é esse gatilho que coloca a empresa e o papel dentro do token, e todas as políticas de segurança leem dali. O sintoma de esquecer é entrar no sistema e não ver nada.

## 5. Ligar a sessão anônima

**No painel**, em Authentication > Providers > Anonymous sign-ins, ative.

É como o celular do chão de fábrica entra sem e-mail: ele abre uma sessão anônima, o administrador registra o aparelho com um código de pareamento e só então ele vira um membro do tipo dispositivo, preso a um local.

## 6. Criar o balde de arquivos

**No painel**, em Storage, crie um balde privado chamado `nfe-xml`. É onde o worker guarda o XML das notas recebidas.

## 7. Apontar a interface para o banco

```bash
cp apps/web/.env.example apps/web/.env
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (Settings > API). Sem essas duas variáveis a interface continua rodando com dados de exemplo em memória, o que é útil para demonstração.

```bash
pnpm dev
```

Entre com o e-mail e a senha do passo 1.

## 8. Subir o worker (quando for conectar hub ou receber XML)

```bash
cd apps/worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put CREDENTIALS_KEY   # openssl rand -hex 32
wrangler deploy
```

Depois preencha `VITE_WORKER_URL` no `.env` da interface. O detalhe de cada rota e do e-mail de entrada está em `apps/worker/README.md`.

## Conferir se ficou de pé

```sql
-- no SQL Editor
select nome, slug from public.tenants;
select count(*) as tabelas_sem_rls
  from pg_tables t
  left join pg_class c on c.relname = t.tablename
 where t.schemaname = 'public' and not c.relrowsecurity;  -- tem que dar 0
```

Na interface: o painel mostra a linha do dia com oito produtos, e a tela de estoque mostra treze insumos com saldo.

Para provar o ciclo inteiro: em Produção > Etiquetas, imprima algumas etiquetas; abra `/chao` em outro aparelho ou em outra aba, pareie com o código gerado em Configurações > Dispositivos, entre com o PIN e bipe. O bipe tem que aparecer na linha do dia e baixar os insumos no estoque, tudo numa transação só.

## Cuidados

- O projeto do Prodio é separado do Supabase do Eddias Suprimentos. Nada aqui lê ou escreve lá.
- A chave de serviço (`service_role`) só vai para o worker. Nunca para a interface, nunca para o navegador.
- Troque os PINs de exemplo antes de usar na fábrica de verdade.
- Ligue o backup contínuo (Point in Time Recovery) antes do primeiro dia de operação real.
