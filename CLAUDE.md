# Prodio — regras do repositório

Leia `docs/arquitetura.md` antes de tocar em banco, worker ou store. As regras de segurança de lá são obrigatórias.

## Estrutura
- `apps/web` interface (Vite + React 19 + TypeScript + Tailwind v4, PWA). Tokens em `apps/web/src/index.css`.
- `apps/worker` Cloudflare Worker (conectores, outbox, webhooks, e-mail de XML, cron). Único lugar com service role.
- `packages/core` regras de negócio puras com vitest. Sem React, sem Supabase, sem rede.
- `supabase/` migrations, RPCs, RLS, seed e testes de banco (`pnpm db:test` roda contra um Postgres 16 com os stubs de `supabase/tests/stubs_supabase.sql`).

## Regras
- Idioma da interface e dos textos: português do Brasil. Nomes de tabela, coluna e função no banco em inglês snake_case; o domínio usa os termos da fábrica (insumo, ficha técnica, apontamento, OC, NF-e).
- Arquivos com no máximo 400 linhas. Quebre em componentes ou módulos.
- Componentes de UI compartilhados ficam em `apps/web/src/ui/index.tsx`. Não crie um segundo kit.
- Estado de domínio fica em `apps/web/src/domain/store.tsx` e fala com um `Repo` (`MemoryRepo` ou `SupabaseRepo`). Páginas só guardam estado de tela.
- Tipos de domínio vêm de `@prodio/core/tipos`. Toda regra que calcula vai para `packages/core` com teste.
- Nada de cores hardcoded no desktop: use os tokens. As telas de `/chao` usam a paleta escura com classes Tailwind diretas.
- Telas do chão de fábrica (`apps/web/src/pages/chao/`): alvos de toque de 56px ou mais, feedback sonoro e háptico, funciona sem rede.
- Banco: toda tabela de domínio tem `tenant_id` e RLS na mesma migration; escrita crítica só por RPC `SECURITY DEFINER` com `assert_member`, `SET search_path = ''` e `REVOKE … FROM public, anon`; ledger append-only; idempotência por chave única. Detalhes em `docs/arquitetura.md`.
- Números: `num`, `brl`, `pct` de `apps/web/src/domain/format.ts`. Datas: `dataBR`, `horaBR`, `relativo`.
- Publicar é por push: `main` = produção (migrations pendentes com backup cifrado e ensaio → worker → web), qualquer outro branch = prévia só da web. Nada publica com teste vermelho. Não mude o workflow `Publicar`, `.github/scripts/` nem `supabase/aplicar-migracoes.sh` para publicar de outro branch ou para rodar contra produção fora dele. Detalhes em `docs/publicacao-automatica.md`.
- Migration nova tem de ser reexecutável (`if not exists`, `create or replace`, `drop … if exists` antes de recriar, `insert … where not exists`): o `db:test:migracoes` reaplica tudo sobre banco populado e exige zero linha mudada. Nome `AAAAMMDDhhmmss_nome.sql`, com data posterior à última aplicada.
- Migration aplicada nunca se edita, renomeia nem apaga (o aplicador compara o sha256 e para). Correção vai num arquivo novo.
- Migration destrutiva (DROP TABLE/COLUMN/SCHEMA, ALTER COLUMN TYPE, RENAME, TRUNCATE, DELETE, UPDATE fora de corpo de função…) só passa pela trava com a linha `-- prodio:destrutiva-aprovada: <motivo>`, e só entra com o fundador sabendo. Sem BEGIN/COMMIT próprio nem CONCURRENTLY.
- Antes de encerrar: `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm db:test`, `pnpm db:test:api` e `pnpm db:test:migracoes` verdes.
