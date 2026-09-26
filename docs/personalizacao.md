# Prodio — personalização por cliente

Pedido do fundador (26/09/2026): "precisamos revisar tudo que deveria ser personalizável no sistema para adicionar
em configurações… exemplo: formatos de etiqueta (cada cliente tem sua particularidade de tamanho)". Este documento
é a varredura do sistema inteiro (core, web, worker, banco e seeds) atrás do que está fixo no código e varia de
fábrica para fábrica, com a prioridade de cada item. O que foi construído nesta rodada está na seção 1; a fila
priorizada, na seção 3 (e resumida em `docs/melhorias.md`, seção "Personalização").

Legenda. **Prioridade**: P0 = trava ou engana um cliente novo já no primeiro dia; P1 = um cliente comum vai pedir;
P2 = parte dos clientes; P3 = raro. **Esforço**: P = até 1 dia; M = 2 a 4 dias; G = 1 a 2 semanas. "Configurável"
diz onde o cliente mexe hoje (tela, só SQL, ou em lugar nenhum).

## 1. Feito nesta rodada

### 1.1 Tamanhos de etiqueta cadastráveis (P0, pedido explícito)

Antes: três tamanhos fixos na tela de Etiquetas (`etiquetasUtils.ts`, `TAMANHOS` 50 × 30, 60 × 40 e 100 × 50 mm, com
QR e fonte fixos por tamanho), escolhidos a cada impressão; o perfil da família não guardava tamanho; a impressão
saía numa folha com margem de 6 mm (`@page { margin: 6mm }`), o que numa térmica corta a borda; e o serial não
cabia: na 60 × 40 o QR de 30 mm deixava 24 mm para um serial de 20 caracteres a 8 pt (34 mm), cortado pelo
`overflow: hidden`.

Agora:

- **Cadastro por empresa** (Configurações › **Etiquetas**, card "Tamanhos de etiqueta"): nome, largura × altura em
  mm (largura atravessa o rolo, altura vai no sentido do avanço), margem, impressora de 203, 300 ou 600 dpi,
  orientação normal ou girada 90° (etiqueta estreita e comprida lida deitada), colunas lado a lado no rolo (1 a 4) e
  o vão entre elas, e o tamanho padrão. Os três tamanhos antigos viram linhas editáveis de cada empresa ("de
  fábrica"), com o 60 × 40 de padrão. Só o admin cadastra e altera; os outros papéis veem.
- **Pré-visualização em escala real** no cadastro (1 mm da tela ≈ 1 mm da etiqueta, com zoom 2× e 3×), com a
  etiqueta de **pior caso** dos produtos da empresa (maior SKU, maior nome, maior instrução, serial mais longo que a
  RPC grava), as colunas do rolo, e o que o desenho decidiu: lado do QR, módulo em pontos da impressora, fonte, o
  que foi abreviado e o que não cabe. Também lista as famílias que usam o tamanho, com ✓ cabe / ⚠ abrevia / ✗ não cabe.
- **Perfil da família escolhe o tamanho** (card "Perfis por família", que saiu da aba Produção): "Padrão (…)" ou um
  tamanho da lista, com a mesma conferência ao lado. Família nova entra como o banco já imprime para ela (prefixo
  ET, 1 por caixa) e não trava mais o Salvar da aba Produção.
- **Impressão se adapta** (Produção › Etiquetas): cada família sai no tamanho do perfil (ou num tamanho forçado para
  a impressão toda). A pré-visualização agrupa por tamanho (um rolo por grupo, com "Imprimir só este tamanho") e
  avisa quantas etiquetas não cabem. Cada linha do rolo vira uma página nomeada do tamanho exato
  (`@page etq-N { size: L mm A mm; margin: 0 }`), então a térmica recebe a medida da etiqueta. Conferido no Chromium:
  60 × 40 sai em páginas de 60 × 40 mm; um rolo de 2 colunas 40 × 25 com 3 mm de vão sai em páginas de 83 × 25 mm
  com a segunda etiqueta a 43 mm.
- **Desenho (core, `etiquetaLayout.ts`)**: QR ao lado ou acima do texto, lado do QR em pontos inteiros da impressora
  (módulo nítido; mínimo 0,25 mm e 2 pontos, confortável a partir de 0,33 mm), versão do QR calculada como o
  `qrcode.react` (o teste compara com o SVG desenhado) e a maior fonte que cabe (5 a 14 pt). Serial, SKU e o
  cabeçalho (Montagem, Caixa · contém N un) nunca são cortados; antes de abreviar, tenta caber tudo com fonte ≥ 6,5
  pt; depois abre mão, nesta ordem e sempre com aviso: nome em 1 linha, cor/família abreviada, instrução em 2
  linhas, contagem n/total, instrução em 1 linha, nome, serial e SKU em 2 linhas, cor/família. Se nem o essencial
  cabe, diz o que falta ("O serial (20 caracteres) precisa de 9,7 mm e só há 5,7 mm").
- **Banco** (`20260926000700_etiquetas_tamanhos.sql`): tabela `label_sizes` com `tenant_id`, RLS de leitura e
  escrita só pelas RPCs `save_label_size` / `delete_label_size` (admin, `assert_member`, `search_path ''`, revoke),
  `label_profiles.label_size_id` com FK composta (nulo = padrão; apagar o tamanho devolve o perfil ao padrão).
  Reexecutável; a trava de destrutivas aceita sem aprovação. Detalhes em `docs/schema.md`.
- **Compatibilidade**: perfis existentes ficam no padrão (60 × 40, o mesmo que a tela usava). Enquanto `main` não
  publica a migration, a prévia da web contra o banco de produção carrega os tamanhos de fábrica do core, esconde a
  coluna Tamanho e não manda `label_size_id` (teste `tamanhosEtiquetaPendente.test.ts`).
- **Testes**: core `etiquetaTamanhos.test.ts`, `etiquetaLayout.test.ts` (inclui 400 combinações aleatórias
  conferindo "nada corta") e `etiquetaAmostra.test.ts`; banco `0022_etiquetas_tamanhos` (fábrica, validação,
  padrão, perfil, exclusão, papéis, isolamento, privilégios); API parte (e) do `db:test:api` (a camada de dados da
  web contra o PostgREST); web `etiquetasImpressao.test.tsx` e `tamanhosEtiqueta.test.ts`.

### 1.2 Prefixo de família sem perfil (P0, bug)

A RPC `reserve_label_batch` grava prefixo **ET** e 1 unidade por caixa para família sem perfil
(`20260921000500_producao.sql:206-208`), mas a web dizia **PR** e 6 por caixa (`etiquetasUtils.ts`, `local.ts`,
`ConfigPerfis.ts`, `mapeadoresCadastros.ts`; core `etiquetas.ts:4`). Depois da importação do ES, com famílias sem
perfil, a tela de Etiquetas calculava caixas com 6 por caixa e a etiqueta de caixa impressa dizia "contém 1 un".
Agora core, web e banco dizem ET e 1.

### 1.3 Endereço do e-mail de XML (P0, bug)

O worker acha a empresa pelo `tenants.slug` (`apps/worker/src/email.ts:11`), mas a web montava o endereço pelo
nome, e de dois jeitos: Recebimento mostrava `xml@eddias…` (primeira palavra) e Configurações › Empresa
`xml@eddias-home…` (nome inteiro). E com a variável `VITE_DOMINIO_EMAIL_XML` vazia (o workflow passa vazia quando ela
não existe no GitHub) o endereço saía sem domínio. Agora as três telas usam o slug lido do banco e o domínio padrão
nunca fica vazio. **Falta decidir o domínio** (seção 4).

## 2. O que já era configurável

Hora de virada, dias úteis no mês, margem de projeção, dias de cobertura, janela da média de vendas, cobertura do
acabado no hub, exigir projeção para imprimir (Configurações › Produção); regime tributário, crédito de impostos,
margem alvo (Empresa); canais de venda com presets e taxas (Precificação); perfis por família: prefixo, etiquetas
geradas, unidades por caixa, instrução (agora na aba Etiquetas); locais; operadores e PIN; De-Para de status por
conector; tema. Por SQL, sem tela: `connectors.config.paginas_por_rodada` e `dias_iniciais`.

## 3. Fila priorizada

### Etiquetas e serial

| # | O quê | Onde está fixo | Configurável hoje | Impacto num cliente novo | Esforço | Prior. |
|---|---|---|---|---|---|---|
| E1 | Conteúdo da etiqueta: quais campos saem (cor/família, nome, SKU·tamanho, serial, contagem), EAN, data, lote, logo | `packages/core/src/etiquetaLayout.ts` (`conteudoDaEtiqueta`) | não | cliente que precisa do EAN ou da marca na peça não consegue | M | P1 |
| E2 | Código de expedição (Code 128 com o SKU) para a conferência do hub | — (item 27 de `melhorias.md`) | não | quem confere expedição na Base/Tiny/Bling bipa outra etiqueta | M | P1 |
| E3 | Tamanho próprio para a etiqueta de caixa (hoje o perfil tem um tamanho para os três tipos) | `label_profiles.label_size_id` (um por perfil) | parcial | caixa costuma usar etiqueta maior | P | P2 |
| E4 | Folha A4 de etiquetas (Pimaco) em impressora comum: linhas, colunas e margens da folha | `etiquetasImpressao.ts` (uma linha do rolo por página) | não | fábrica sem térmica | M | P2 |
| E5 | Formato do serial: dígitos da sequência (4, `lpad` corta acima de 9999 por SKU e dia), data AAMMDD, separador | `20260921000500_producao.sql:213`, core `etiquetas.ts:9` (`SEQ_MAX`) | não | quem faz mais de 9.999 peças de um SKU por dia repete serial | M | P2 |
| E6 | Prefixo com 2 ou 3 letras maiúsculas | `20260921000300_cadastros.sql:155`, core `etiquetas.ts:6` | não | cliente com prefixo numérico ou de 4 letras | P | P3 |
| E7 | Tipos de etiqueta fixos (produto, montagem, caixa) | `20260921000300_cadastros.sql:156` | não | etiqueta de lote, de palete ou de etapa | G | P3 |
| E8 | Limite de 5.000 etiquetas por lote | `20260921000500_producao.sql:193` | não | raro | P | P3 |
| E9 | Fonte da etiqueta (Arial/Liberation e monoespaçada de 0,6 em) | `EtiquetaImpressa.tsx` (`FONTE`) | não | raro; o desenho supõe essas larguras | M | P3 |

### Produção e calendário

| # | O quê | Onde está fixo | Configurável hoje | Impacto num cliente novo | Esforço | Prior. |
|---|---|---|---|---|---|---|
| P1 | Modo de planejamento (média de vendas, pedidos a enviar hoje, manual, combinações) | `planejamento.ts` (só média) | não | quem produz sob pedido não usa a sugestão (item 14 de `melhorias.md`) | G | P0 |
| P2 | Fuso da empresa na tela; a web calcula o dia de produção pelo relógio do navegador, o banco pelo `tenants.fuso` | `apps/web/src/domain/format.ts:98` (`diaProducao`), `20260921000100_fundacao.sql:43` | só SQL | fábrica em Manaus ou Cuiabá (fuso −4) vê um dia e o banco grava outro perto da virada | P | P1 |
| P3 | Calendário: dias úteis é um número por mês; sem sábado, feriado, férias coletivas | `tenants.dias_uteis_mes`, `planejamento.ts:41` | parcial (número) | demanda por dia errada em mês com feriado ou 6 dias de trabalho | M | P1 |
| P4 | Etapas de produção: só nasce a etapa "final", sem tela | `20260921000500_producao.sql:19-31` | só SQL | quem bipa corte, montagem e embalagem separado | G | P2 |
| P5 | Alerta "robô parado" (1 h) e "carga atrasada" (24 h) | `planejamento.ts:257-259` | não | cliente com hub lento recebe alarme falso | P | P3 |
| P6 | Releitura da demanda nas telas a cada 5 min | `useDemandaViva.ts:6` | não | raro | P | P3 |

### Compras e estoque

| # | O quê | Onde está fixo | Configurável hoje | Impacto num cliente novo | Esforço | Prior. |
|---|---|---|---|---|---|---|
| C1 | Unidades: a tabela `units` é por empresa, mas o cadastro de insumo usa uma lista fixa do exemplo | `apps/web/src/pages/cadastros/Insumos.tsx:3` (`units` de `mock.ts`) | não na tela | quem compra em "par", "pc", "l", "fardo" não cadastra o insumo | P | P0 |
| C2 | Parâmetros da necessidade: segurança 7 dias, lead padrão 7, média das últimas 5 OCs, lead máximo 90, teto 7%, curva ABC 80/95 | `packages/core/src/necessidade.ts:24` (`PARAMETROS_PADRAO`) | não | fornecedor lento ou estoque de segurança maior pede outro número | P | P1 |
| C3 | Margem por insumo (o core aceita, a tela não expõe) | `necessidade.ts` (`margemPorMaterial`) | não | insumo com perda alta | P | P2 |
| C4 | Lote mínimo e múltiplo de compra por fornecedor (a compra arredonda só para a unidade de compra) | `necessidade.ts` (`qtdCompra` = ceil) | não | fornecedor que só vende caixa com 12 | M | P2 |
| C5 | Numeração da OC: sequência sem prefixo nem ano | `20260921000600_compras.sql:138` (`next_doc_number`) | não | quem já tem numeração no ERP | P | P3 |
| C6 | CFOPs que contam como compra e como remessa | `packages/core/src/nfe.ts:65-67` | não | operação com CFOP diferente (industrialização) | M | P2 |

### Comercial

| # | O quê | Onde está fixo | Configurável hoje | Impacto num cliente novo | Esforço | Prior. |
|---|---|---|---|---|---|---|
| V1 | Arredondamento do preço sugerido (sempre termina em ,x9) | `packages/core/src/precificacao.ts:52` | não | quem trabalha com ,90 ou inteiro | P | P2 |
| V2 | Presets de canal (comissões do ML, Shopee, Amazon…) | `precificacao.ts` (`PRESETS`) | sim (ajustável depois de criar) | as taxas mudam; o preset envelhece | P | P3 |

### Integrações e robô

| # | O quê | Onde está fixo | Configurável hoje | Impacto num cliente novo | Esforço | Prior. |
|---|---|---|---|---|---|---|
| I1 | Carga inicial e páginas por rodada do robô | `apps/worker/src/jobs/syncPedidos.ts:56-58`, `baselinker.ts:35`, `bling.ts:215` | só SQL (`connectors.config`) | cliente grande quer 90 dias de carga; volume alto pede mais páginas (item 3 de `melhorias.md`) | P | P1 |
| I2 | De-Para de status com os status reais da conta | `ConectorDePara.tsx` (nomes fixos) | parcial | (item 4 de `melhorias.md`) | M | P1 |
| I3 | Significados fixos do De-Para (demanda, carteira, enviado, cancelado, ignorar) | `20260921000800_integracoes.sql:27,49` | não | status próprio do cliente (ex.: "aguardando arte") | M | P2 |
| I4 | Cron de 5 min e auditor às 03:00 UTC para todas as empresas | `apps/worker/wrangler.toml` (`crons`) | não | raro; auditor à meia-noite de Brasília para todos | M | P3 |

### Sistema

| # | O quê | Onde está fixo | Configurável hoje | Impacto num cliente novo | Esforço | Prior. |
|---|---|---|---|---|---|---|
| S1 | Notificações: a matriz é gravada, mas o worker não envia | `ConfigNotificacoes.tsx:1-5`, `notification_settings` | tela sem efeito | dono acha que vai ser avisado e não é | M | P1 |
| S2 | Papéis fixos (admin, compras, produção, leitura, dispositivo) e o que cada um faz, fixo em cada RPC; a web quase não esconde botão por papel | `20260921000100_fundacao.sql:19` (enum), `assert_member` em cada RPC | não | cliente quer "compras sem ver custo", "produção sem apagar perfil" | G | P2 |
| S3 | PIN do operador: 5 erros bloqueiam 15 min | `20260921000200_aparelhos.sql:191-192` | não | raro | P | P3 |
| S4 | Idioma (só pt-BR, o seletor está travado) e moeda (BRL) | `ConfigAparencia.tsx:36`, `format.ts:23` | não | só para cliente fora do Brasil | G | P3 |

## 4. Decisões pendentes **[decidir]**

- **Domínio do e-mail de XML.** O worker aceita só `xml@<slug>.prodio.app` (`apps/worker/src/email.ts:11`); a web e a
  documentação de deploy usam `prodio.com.br` (`VITE_DOMINIO_EMAIL_XML`, opcional). Escolher o domínio do Email
  Routing e deixar o worker ler o mesmo valor (variável), em vez da expressão fixa.
- **Quem cadastra tamanho de etiqueta.** Hoje só admin (as RPCs); a produção escolhe o tamanho da família no perfil.
  Se a encarregada precisar ajustar a margem na impressora, abrir a RPC para `producao`.
- **Etiqueta de caixa com tamanho próprio** (E3): um segundo `label_size_id` no perfil, ou tamanho por tipo.

## 5. Como conferir

- Configurações › Etiquetas: editar um tamanho mostra a prévia em escala real; confira a primeira vez com uma
  régua (o tamanho na tela depende do monitor).
- Imprimir uma etiqueta de teste: na caixa de impressão do navegador, a impressora térmica deve aparecer com o
  papel do tamanho cadastrado e margens "nenhuma". Se a térmica estiver com outra mídia no driver, ajuste o driver
  para a mesma medida.
- `pnpm test` (core e web), `pnpm db:test` (0022), `pnpm db:test:api` (parte e).
