# Prodio

Produção e recebimento sem ninguém sentado no computador.

O Prodio conecta na base de pedidos que a fábrica já usa (Base.com, Bling, Tiny/Olist, Omie), projeta a produção do dia por SKU, imprime etiquetas com QR code de serial único e transforma cada bipe no fim da linha em apontamento, entrada de acabado e baixa de insumos pela ficha técnica. O recebimento de insumos é feito no celular: a pessoa vê as ordens de compra do dia, bipa a nota fiscal e o sistema dá entrada no estoque e baixa a OC.

## Estado atual

Interface visual completa com dados de exemplo em memória. Sem backend, sem autenticação real, sem persistência. Serve para validar fluxos, telas e linguagem com a Eddias e com os primeiros parceiros.

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
src/
  app/        shell desktop, shell do celular, navegação, tema
  domain/     tipos, dados de exemplo, store em memória, formatação
  ui/         kit de componentes
  pages/      uma pasta por módulo
```

## Próximos passos

Ver `docs/plano-de-fundacao.md`.
