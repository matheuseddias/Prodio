# Prodio — regras do repositório

- Idioma da interface e dos textos: português do Brasil. Nomes de código em inglês são aceitáveis, mas o domínio usa os termos da fábrica (insumo, ficha técnica, apontamento, OC, NF-e).
- Stack: Vite + React 19 + TypeScript + Tailwind v4 (tokens em `src/index.css`) + react-router-dom v7 + lucide-react. PWA via vite-plugin-pwa.
- Arquivos com no máximo 400 linhas. Quebre em componentes dentro da pasta do módulo.
- Componentes de UI compartilhados ficam em `src/ui/index.tsx`. Não crie um segundo kit.
- Estado de domínio fica em `src/domain/store.tsx`. Páginas não mantêm dados de domínio em estado local, só estado de tela (filtros, modais).
- Nada de cores hardcoded no desktop: use os tokens (`bg-surface`, `text-muted`, `border-border`, `bg-accent`, `text-ok` etc.). As telas de `/chao` usam a paleta escura com classes Tailwind diretas.
- Telas do chão de fábrica (`src/pages/chao/`): alvos de toque de 56px ou mais, feedback sonoro e háptico, funciona sem rede.
- Números: `num`, `brl`, `pct` de `src/domain/format.ts`. Datas: `dataBR`, `horaBR`, `relativo`.
- Antes de encerrar: `pnpm build` e `pnpm lint` verdes.
