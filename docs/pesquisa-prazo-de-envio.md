# Prazo de envio, horário de corte e código de expedição — pesquisa de 26/09/2026

Base dos itens 5, 14, 15 e 27 de `docs/melhorias.md`. As documentações oficiais foram lidas por
espelhos no GitHub, SDKs tipados e trechos de busca (o proxy desta sessão bloqueia os sites), e cada
afirmação sobre campo de API passou por um segundo verificador tentando derrubá-la. O que diz
"confirmar em conta real" ainda não é fato.

## Resposta curta

- **Nenhum dos três hubs manda, junto com o pedido, uma data "enviar até" pronta, e nenhum manda o
  horário de corte.**
- **Base (BaseLinker):** o `getOrders` não tem prazo. O prazo que o marketplace informa existe em
  `getOrderTransactionData(order_id)`, uma chamada por pedido: `ship_date_from` / `ship_date_to`
  (janela de envio) e `delivery_date_from` / `delivery_date_to` (entrega), em unix de segundos, com
  `""` quando vazio. Há evidência de preenchimento para Amazon, Etsy, TikTok e MadeiraMadeira; **não
  há para Mercado Livre, Shopee e Magalu** — confirmar em conta real. Alternativa do vendedor: um
  campo extra do tipo data (`custom_extra_fields`, com `include_custom_extra_fields=true`; definição
  em `getOrderExtraFields`) ou um status "Enviar hoje" movido por ação automática.
- **Tiny (Olist ERP):** a tela mostra "Data limite de despacho" para ML Flex/Turbo/Agora e Amazon, mas
  a API documentada (v3.0 e v2) não expõe. `dataPrevista` é previsão de **entrega**, não de envio.
- **Bling (v3):** o prazo de despacho do ML e da Magalu aparece só em Vendas > Objetos de postagem; a
  API não traz. `dataPrevista` e `transporte.prazoEntrega` são de entrega.
- **Horário de corte:** nenhum hub expõe. Só o Mercado Livre, direto na API dele
  (`/users/{id}/shipping/schedule/{logistic_type}`, `cutoff` por dia da semana), e o prazo por envio
  em `/shipments/{id}/sla` (`expected_date`). Shopee (`ship_by_date`), Amazon (`LatestShipDate`) e
  TikTok (`rts_sla_time`) têm prazo por pedido nas APIs próprias; se o hub repassa, só em teste.
- **Status:** os três trazem. Tiny tem situação fixa (0 aberta, 3 aprovada, 4 preparando envio,
  7 pronto envio, 1 faturada, 5 enviada, 6 entregue, 2 cancelada, 8 dados incompletos, 9 não
  entregue). Bling tem ids por conta (`/situacoes/modulos`). Base tem status por conta
  (`getOrderStatusList`) e o diário `getJournalList` (3 dias, precisa ser ativado na conta; tipo 18
  = mudança de status, 4 remoção, 5 junção, 6 divisão).
- **Conferência de expedição:** os três casam o código bipado com o **SKU ou o EAN** do item do
  pedido, recebido do leitor como teclado. Base exige pelo menos 6 caracteres; Tiny só reconhece
  EAN com 13 dígitos. Nenhum documenta simbologia: Code 128 funciona em leitor laser, 2D e câmera;
  QR só em 2D e câmera. **Teste físico obrigatório.**

## Defeito achado no worker (corrigido em 26/09)

`apps/worker/src/conectores/baselinker.ts` lê `date_status_change`, que não existe no `getOrders`. O
campo certo é `date_in_status` (desde quando o pedido está no status atual).

## Proposta para o planejamento do dia

Um cálculo só no core (`packages/core/src/planejamento.ts`), a tela só escolhe o modo:

1. **Média de vendas** (o que já existe): `max(0, demanda/dia × cobertura − saldo no hub − em
   produção)`. Demanda = todo pedido confirmado nos últimos N dias, inclusive cancelado e enviado
   (decisão de 25/09). **Atenção:** `demand_for_projection` e `v_demand_by_sku` hoje somam só
   `demanda` e `carteira`; precisam passar a contar tudo que não for `ignorar` antes de o status
   começar a mudar.
2. **Pedidos a enviar hoje:** soma dos itens dos pedidos abertos com "enviar até" dentro do
   horizonte, mais os atrasados. Pedido já enviado ou cancelado antes de produzir não entra. Exige
   status atualizado (item 5).
3. **Manual:** a encarregada digita; as sugestões aparecem ao lado.
4. **O maior dos dois:** `max(média, pedidos de hoje)` por SKU — é o que o ES fazia com
   `max(meta, picking)`.
5. **Pedidos de hoje + reposição pela média:** para quem produz o pedido do dia e mantém pulmão.

Modo padrão por empresa, exceção por família, e troca só para hoje no modal da Linha de hoje.
Ajuste manual da encarregada nunca é sobrescrito; pedido novo aparece como "+N para hoje".

**De onde vem o "enviar até"**, nesta ordem, sempre guardando a origem: manual → marketplace pelo
hub (Base `ship_date_to`) → campo de data escolhido pelo cliente → regra do Prodio por canal e
forma de envio (corte, prazo em dias úteis, hora da coleta, sábado, feriados). A regra é a porta do
`slaLimite` do ES (`/home/user/suprimentos/src/App.jsx:9299-9340`) com fuso explícito. Tiny e Bling
só dão a data, sem hora; a regra usa a hora em que o Prodio viu o pedido.

**Modelo de dados (resumo):** em `orders`, canal, forma de envio, `status_desde`, `status_lido_em`,
prazos por origem e `enviar_ate` calculado; tabelas `shipping_rules`, `calendar_days` e
`planning_settings`; em `daily_plans`, modo, sugestões e `ajuste_manual`; em `connector_status_map`,
`forca_envio_hoje`. Tudo com `tenant_id`, RLS e escrita por RPC.

## Código de expedição na etiqueta

- **Code 128 com o SKU exato** como aparece no pedido do hub, por padrão. Opção EAN só para produto
  com EAN-13 válido. QR como opção para quem tem leitor 2D.
- Só na etiqueta de **produto**. Nunca na de montagem nem na de caixa (bipar a caixa contaria uma
  unidade na conferência).
- Validação: pelo menos 6 caracteres, ASCII imprimível, sem espaço nas pontas.
- Tamanho: barra mais fina ≥ 0,25 mm (2 pontos a 203 dpi, 3 a 300 dpi), altura ≥ 8 mm, zona de
  silêncio ≥ 10 módulos. "ED000001" ocupa ~30 mm; "ED000001-1" ~39 mm. Na 50×30 o QR do serial cai
  para ~14 mm e o código vai numa faixa embaixo; na 60×40 cabe QR de 22 mm em cima e faixa embaixo.
  O DPI da impressora vira configuração.
- Codificador próprio no core (`codigo128.ts`, sem dependência nova); o ES tinha um
  (`App.jsx:246-291`), sem uso desde 16/07/2026.
- O Bipe do `/chao` lê Code 128 pela câmera: reconhecer o SKU e responder "Esse é o código de
  expedição; bipe o QR", sem pôr na fila.

## Ordem de trabalho proposta

1. Teste em conta real, só leitura: `getOrderTransactionData` num pedido de cada canal, campo extra
   de data, `getJournalList` ativado ou não. Sem isso não dá para prometer prazo automático.
2. Consertos sem decisão: `date_in_status`; média contando cancelado e enviado; carteira sem janela
   de N dias.
3. Etiqueta com código de expedição (independente do resto) e teste físico com leitor.
4. Core: `prazoEnvio.ts` e `planejamento.ts`, com os casos do ES.
5. Migration de prazos e planejamento.
6. Acompanhamento de status na Base (pré-requisito do modo pedidos).
7. Prazo nos conectores (fila de `getOrderTransactionData` com teto por rodada).
8. Ligar os pedidos às telas.
9. Telas: "Como planejar o dia", "Prazos de envio", Linha de hoje com o seletor de modo.
10. Piloto de uma semana numa fábrica que produz sob encomenda.
11. Só se o passo 1 mostrar que os hubs não repassam o prazo: conector só de leitura com o Mercado
    Livre.

## Perguntas em aberto ao fundador

- Canais e formas de envio usados e o horário real de coleta de cada um.
- "Hoje" é o que sai na coleta de hoje ou o que sai no próximo envio?
- Pedido sem prazo conhecido entra na produção de hoje ou fica numa lista à parte?
- No modo pedidos, descontar o estoque acabado do hub? (Na Base o pedido pode já ter baixado esse
  estoque.)
- Combinação padrão: "o maior dos dois" ou "pedidos de hoje + reposição"?
- Pedido novo depois da projeção aplicada entra sozinho ou como "+N" para a encarregada aceitar?
- Impressora (203 ou 300 dpi) e tamanho de etiqueta mais comuns; leitores laser ou 2D.
- Os clientes aceitam ativar o registro de eventos (journal) na API da Base?

## Lacunas

- A doc oficial da Base de 23/09/2026 não foi lida; pode haver campo novo no `getOrders`.
- Preenchimento real de `ship_date_*` por ML, Shopee, Magalu, TikTok BR e Amazon BR; formato e fuso.
- Se o SKU do item do pedido na Base vem do anúncio ou do produto do inventário (se vier do anúncio
  com outro SKU, o código de expedição não casa).
- Tiny 3.1.x pode expor a data limite de despacho; não verificado.
- Full/fulfillment, ML Envios Agora, fabricação sob encomenda do ML, pré-venda e pedido em mais de
  um pacote não estão desenhados.
- Custo real de CPU do enriquecimento no plano Free do Workers não foi medido.
