# Prodio — lista de melhorias

Lista viva do que ficou combinado com o fundador e ainda não está pronto. Cada item diz de onde
veio. Quando um item sai do papel, ele deixa esta lista e vira commit.

Legenda: **[andamento]** sendo feito agora · **[pesquisa]** falta confirmar fato externo ·
**[decidir]** precisa de decisão do fundador · sem marca = combinado, na fila.

## Regras de produto já decididas

- **Cancelado conta na métrica de vendas** (25/09). A peça é fabricada e o insumo consumido antes
  do cancelamento, então a média de vendas usa todo pedido confirmado, pela data de confirmação.
  O Prodio não controla devoluções.
- **Cada operação escolhe como planeja o dia** (26/09). Há fábrica que produz pela média de vendas
  e fábrica que produz exatamente o que precisa sair hoje. O sistema não pode impor um jeito só
  (ver "Modos de planejamento").

## Robô de pedidos e integrações

1. O botão "Sincronizar agora" limpa o erro do cartão e, se o robô estiver parado, o cartão cai no
   diagnóstico pelo pulso. Conferir, depois de algumas semanas no ar, se as mensagens do cartão
   estão ajudando o dono a agir (corrigido em 26/09: o robô não chegava a conector nenhum por causa
   da consulta ambígua PGRST201; agora `pnpm db:test:api` testa as consultas contra PostgREST real).
2. Estoque bipado com o conector em "erro" nunca é enviado: `enqueue_outbox` só enfileira para
   conector "conectado", e qualquer falha de sincronização põe o conector em "erro". Pede migration.
3. Carga inicial configurável na tela ao conectar ("trazer os últimos N dias"). Hoje é por SQL
   (`dias_iniciais`).
4. De-Para de status com os status reais da conta (getOrderStatusList), gravando o código e
   mostrando o nome, e recalculando os pedidos já gravados. Hoje o De-Para do BaseLinker fica
   travado na tela porque a tela tinha nomes fixos e o pedido chega com código.
5. Acompanhar mudança de status depois da confirmação (diário de eventos getJournalList ou
   releitura periódica). Não é preciso para a média de vendas, mas **é obrigatório para o modo
   "pedidos a enviar hoje"** e para a carteira: pedido já enviado ou cancelado antes de produzir não
   pode entrar na lista do dia.
6. Receptor das ações automáticas da Base, usado só como gatilho para reler o pedido pela API (senha
   por conector, guardada com hash). Opcional; acelera o item 5.
7. Bling: leitura por página, como no BaseLinker, antes de conectar conta com volume.
8. Domínio próprio para o worker (ex.: `api.prodio.com.br`) antes de clientes colarem URLs dele
   em ações automáticas.
9. Plano pago do Workers (US$ 5/mês) quando houver cliente pagando: tira o limite de 10 ms de CPU
   por execução e de 50 chamadas por execução.
10. Conectar o Tiny.
11. `orders.raw` antigo guarda dados do comprador (LGPD). Limpar: `update public.orders set raw =
    null where raw is not null`.
12. O gatilho de auditoria grava uma linha em `audit_log` a cada rodada do robô (cerca de 288 por
    dia por conector). Filtrar as colunas que o robô mexe.
12a. BaseLinker: todo HTTP 403 vira "o token foi recusado". Um bloqueio de rede ou de firewall
    mostraria a mesma frase e mandaria o dono trocar um token que está certo.
12b. Falha do auditor noturno fica só no log; não aparece no cartão.
12c. `pnpm db:test:api` fora da CI (precisa de Postgres e de rede para baixar o PostgREST).

## Demanda, produção e compras

13. Ligar os pedidos às telas: a demanda entra sozinha na Linha de hoje e na Necessidade a cada
    sincronização e na virada do dia, preservando o ajuste manual da encarregada, com aviso de
    "demanda desatualizada" quando o robô parar. Hoje as contas existem, mas nada as liga.
14. **Modos de planejamento** (26/09). Na configuração da empresa, e ajustável no dia:
    - **pela média de vendas**: vendas dos últimos N dias × dias de cobertura − estoque − em
      produção;
    - **pelos pedidos a enviar hoje**: produz o que precisa sair na data, respeitando prazo de
      envio e horário de corte;
    - **manual**: a encarregada digita;
    - combinações, por exemplo pedidos de hoje + reposição pela média, ou um modo por família de
      produto.
15. Prazo de envio e horário de corte (26/09). Pesquisa em `docs/pesquisa-prazo-de-envio.md`:
    nenhum hub manda "enviar até" pronto nem horário de corte. A Base tem a janela de envio do
    marketplace numa chamada por pedido (`getOrderTransactionData`), sem garantia de que ML, Shopee
    e Magalu preenchem; Tiny e Bling não expõem. O Prodio calcula o prazo por regra de canal e forma
    de envio (porta do `slaLimite` do ES) quando o marketplace não manda. **[pesquisa]** Falta o teste
    em conta real, só leitura.
15a. `baselinker.ts` lê `date_status_change`, que não existe; o campo é `date_in_status`.
15b. `demand_for_projection` e `v_demand_by_sku` contam só `demanda` e `carteira`; pela decisão de
    25/09 a média tem de contar tudo que não for `ignorar` (inclusive cancelado e enviado).
16. Vínculo de SKU: o pedido só vira demanda de um produto quando o SKU casa com um produto (ou
    alias) do Prodio. Os produtos da Eddias usam SKU ED. Religar os itens de pedido gravados antes
    de o produto existir.
17. Unidade da demanda: guardar e usar por dia de produção (dias úteis), não por dia corrido.
18. Unificar as fórmulas repetidas (necessidade de compra e explosão de ficha existem na tela e no
    core).

## Catálogo e kits

19. Enviar produtos e kits do Prodio para a Base pela API (addInventoryProduct com is_bundle e
    bundle_products): primeiro os componentes, depois o kit, por fila no robô, com prévia antes do
    primeiro envio. Respostas do fundador (26/09):
    - a Base sempre divide os kits nos pedidos (a demanda já chega por componente);
    - cor e tamanho são variações de um produto pai;
    - os SKUs são todos ED (pode ter sobrado algum TM);
    - nenhum kit leva item próprio (caixa, manual).
20. Vínculo produto do Prodio ↔ produto e variação na Base, guardado por conector.
21. Trazer produtos da Base para o Prodio, com prévia.
22. Kit como tipo de produto. Até lá, **não imprimir etiqueta de kit**.

## Estoque enviado para a Base

23. Saldo negativo virava zero antes de somar o bipe (credita a mais).
24. Item da fila preso em "em processamento" quando o robô cai no meio.
25. Enviar estoque para a variação certa.
26. Auditor comparando só as escritas do Prodio.

## Etiqueta

27. **Código de expedição** (26/09). Além do QR do Prodio (serial único), um código só com o SKU
    para bipar na conferência de expedição da Base, do Tiny e do Bling. Formato escolhido no perfil
    de etiqueta (código de barras Code 128 ou QR). Pesquisa: os três hubs casam pelo SKU ou pelo EAN
    (Base exige 6+ caracteres; Tiny só EAN-13). Padrão Code 128 com o SKU exato, só na etiqueta de
    produto; tamanhos e layout por etiqueta em `docs/pesquisa-prazo-de-envio.md`. Falta teste
    físico com leitor.

## Adiados pelo fundador

28. Estratégia de preço do Prodio.
29. IA para pré-preencher ficha técnica (primeiro um motor de regras por família; a IA propõe
    regras e a pessoa confirma).
30. Página de vendas: contatos reais, formulário e checkout.
