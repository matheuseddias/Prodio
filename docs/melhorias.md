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

13. Ligar os pedidos às telas — **feito em 26/09 no modo "média de vendas"**: a demanda é somada no
    banco (`demand_summary`), a Linha de hoje mostra a sugestão e aplica com um clique (só produto fora
    do plano; o ajuste da encarregada não é sobrescrito), a Necessidade usa a venda dos pedidos e lista
    o que ficou de fora, o Painel conta pela regra nova, e as três telas avisam "demanda desatualizada"
    (robô parado ou carga inicial longe de hoje). Falta: a sugestão entrar **sozinha** na virada do dia
    (hoje é um clique) e os outros modos do item 14.
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
16. Vínculo de SKU: o pedido só vira demanda de um produto quando o SKU casa com um produto (ou
    alias) do Prodio. O robô casa na gravação e a importação do ES religa o que chegou antes; desde
    26/09 os SKUs vendidos sem produto aparecem na Necessidade ("Fora do cálculo") e no Painel. Falta
    religar quando o produto ou o apelido é cadastrado **na tela** (hoje só a importação e o próximo
    sync do pedido religam).
16a. Componente fabricado (linha de ficha tipo produto): o bipe do produto pai baixa também os insumos
    do componente (`explode_bom` desce na ficha dele). Por isso a sugestão da Linha de hoje **não** põe
    o componente no plano pela demanda dos pais (como no ES, componente fica fora da projeção do dia):
    a demanda derivada aparece só como informação ("Nos pais/dia" e a lista de componentes), e o
    sugerido do componente cobre só a venda avulsa dele. Se alguém puser o componente no plano à mão e
    bipar, o insumo dele baixa duas vezes. **[decidir]** o bipe do pai baixa o componente pronto
    (estoque de semiacabado, e aí o componente entra no plano) ou os insumos dele (como hoje).
16b. Carteira (pedido 'carteira') continua limitada à janela da média: sem acompanhar o status depois
    da confirmação (item 5), pedido antigo ficaria em carteira para sempre.
18. Unificar as fórmulas repetidas. A Necessidade de compra usa o core desde 26/09. Falta a explosão
    de ficha da interface (`domain/storeFicha.ts`, perda em percentual) virar a do core (perda em
    fração): hoje a tela converte com `bomsParaCore` antes de chamar o core.

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
    físico com leitor. Os tamanhos já são cadastráveis (26/09, item 35); falta o código entrar no
    desenho da etiqueta (`packages/core/src/etiquetaLayout.ts`).

## Personalização

Varredura de 26/09 do que está fixo no código e varia de fábrica para fábrica. Tabela completa, com arquivo:linha,
impacto e esforço, em `docs/personalizacao.md`. **Feito em 26/09**: tamanhos de etiqueta cadastráveis
(Configurações › Etiquetas: medidas, margem, dpi, orientação, colunas no rolo, padrão; o perfil da família escolhe o
tamanho; prévia em escala real; a impressão sai na medida exata e avisa o que não cabe), o prefixo padrão da família
sem perfil igual ao do banco (ET, 1 por caixa; a tela dizia PR e 6) e o e-mail de XML pelo `tenants.slug` (a tela
montava pelo nome, de dois jeitos). Na fila, por prioridade:

31. **[P0]** Unidades da empresa no cadastro de insumo: a tabela `units` é por empresa, mas a tela usa a lista fixa do
    exemplo (`Insumos.tsx:3`). Quem compra em par, peça, litro ou fardo não consegue cadastrar.
32. **[P1]** Fuso da empresa na tela, e a web calculando o dia de produção por ele (hoje usa o relógio do navegador;
    o banco usa `tenants.fuso`).
33. **[P1]** Calendário de produção (sábado, feriados, férias coletivas) no lugar do número fixo de dias úteis.
34. **[P1]** Parâmetros da necessidade de compra na empresa: dias de segurança, lead time padrão, OCs na média do
    lead, teto do mês, cortes da curva ABC (`PARAMETROS_PADRAO` fixo no core).
35. **[P1]** Conteúdo da etiqueta por perfil (campos, EAN, data, lote, logo), junto com o código de expedição do item 27.
36. **[P1]** Carga inicial e páginas por rodada do robô na tela do conector (hoje só por SQL em `connectors.config`).
37. **[P1]** Notificações: o worker passar a enviar o que a matriz de Configurações grava.
38. **[P2]** Tamanho próprio para a etiqueta de caixa; folha A4 de etiquetas (Pimaco) em impressora comum; formato do
    serial (a sequência de 4 dígitos repete serial acima de 9.999 peças de um SKU por dia).
39. **[P2]** Lote mínimo e múltiplo de compra por fornecedor; margem por insumo na tela; CFOPs de compra por empresa.
40. **[P2]** Arredondamento do preço sugerido (hoje sempre ,x9); etapas de produção com tela; papéis e permissões
    ajustáveis.
41. **[decidir]** Domínio do e-mail de XML: o worker aceita só `xml@<slug>.prodio.app`, a web e o deploy usam
    `prodio.com.br`. Escolher e fazer o worker ler o mesmo valor.
42. **[decidir]** Tamanho de etiqueta: só o admin cadastra (a produção só escolhe no perfil). Abrir para a produção?

## Adiados pelo fundador

28. Estratégia de preço do Prodio.
29. IA para pré-preencher ficha técnica (primeiro um motor de regras por família; a IA propõe
    regras e a pessoa confirma).
30. Página de vendas: contatos reais, formulário e checkout.
