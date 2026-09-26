# Prodio

Produção e recebimento sem ninguém sentado no computador.

O Prodio conecta na base de pedidos que a fábrica já usa (Base.com, Bling, Tiny/Olist, Omie), projeta a produção do dia por SKU, imprime etiquetas com QR code de serial único e transforma cada bipe no fim da linha em apontamento, entrada de acabado e baixa de insumos pela ficha técnica. O recebimento de insumos é feito no celular: a pessoa vê as ordens de compra do dia, bipa a nota fiscal e o sistema dá entrada no estoque e baixa a OC.

## Estado atual

Interface completa com dados de exemplo em memória e a fundação do sistema real em construção: banco multi-tenant com RLS e RPCs (`supabase/`), regras de negócio puras com testes (`packages/core`) e worker de integrações (`apps/worker`). Sem variáveis de ambiente a interface roda com dados de exemplo; com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` ela usa o banco.

## Rodar

```bash
pnpm install
pnpm dev
```

Rotas principais:

- `/painel` cockpit do dia
- `/producao/linha-de-hoje` projeção por SKU, projetado × impresso × bipado
- `/producao/etiquetas` impressão de etiquetas com serial
- `/compras/necessidade` "comprar até quando"
- `/recebimento` notas fiscais de entrada (visão do escritório)
- `/chao` modo chão de fábrica (celular): PIN, bipe, receber, contar

## Estrutura

```
apps/web/src/
  app/        shell desktop, shell do celular, navegação, tema
  domain/     store, repositório de dados (memória ou Supabase), formatação
  ui/         kit de componentes
  pages/      uma pasta por módulo
apps/worker   Cloudflare Worker: conectores, outbox, webhooks, NF-e por XML e e-mail
packages/core regras de negócio puras (ficha, custeio, projeção, necessidade, precificação, etiquetas, NF-e)
supabase/     migrations, RPCs, RLS, seed e testes de banco
docs/         plano de fundação e arquitetura
```

Testes de banco: `PGURL=postgres://... pnpm db:test` (Postgres 16; a CI faz isso automaticamente).

Teste de API: `PGURL=postgres://... pnpm db:test:api` monta um banco descartável (`prodio_api_test`), sobe um PostgREST 12.2.3 local e roda contra ele todo `.from(…).select(…)` da web e do worker com tabela e colunas fixas (como `service_role` e como usuário; os dinâmicos são listados) e as escritas e RPCs do `Db` do worker. Existe porque o cron ficou 24 h mudo com um `PGRST201` que nenhum teste via: os outros não passam pelo PostgREST.
Na primeira vez precisa de rede para baixar o PostgREST (Linux x64, sha256 conferido, fica em `~/.cache/prodio`); em outro sistema, instale-o e passe `POSTGREST_BIN`. Não entra em `pnpm test` nem em `pnpm db:test`.
Rode antes de publicar qualquer mudança que mexa em consulta (`.from`/`.select`), no `Db` do worker ou em migration.

## Instalar num Supabase real

Ver `docs/deploy.md`: gerar os arquivos com `bash supabase/build.sh`, aplicar o schema, criar a empresa, ligar o gatilho de token e a sessão anônima.

## Publicar a interface na internet

O Supabase hospeda banco, login e API — não a interface. `apps/web` é uma SPA e precisa de um host estático próprio; até ser publicada, só existe em `localhost`.

Ver `docs/deploy-web.md`: publicar no Cloudflare Pages com domínio gratuito (`pnpm deploy:web`), o que as variáveis `VITE_*` fazem no build e como apontar `app.prodio.com.br`.

## Próximos passos

Ver `docs/plano-de-fundacao.md` e `docs/arquitetura.md`.
