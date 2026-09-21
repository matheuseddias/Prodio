# Prodio — plano de fundação

Consolidado em 21/09/2026 a partir de: mapeamento completo do Eddias Suprimentos (95 módulos, 593 regras de negócio, 23 Functions, 391 commits), pesquisa verificada das APIs de Tiny/Olist, Bling, BaseLinker, Magis5 e Omie, pesquisa de entrada de NF-e no Brasil, pesquisa de mercado e de segmentos, três planos estratégicos e quatro críticas adversariais. Referências a linhas são de `src/App.jsx` do repositório `suprimentos`, salvo indicação.

## 1. Resposta direta

**Reaproveitar ou reescrever?** Reescrever a estrutura, transplantar o conhecimento. Nenhum arquivo do Suprimentos vira base de código do Prodio. Levam-se as funções puras que já estão certas (cerca de 40 linhas de motores), os padrões de integração que custaram caro (fila idempotente, outbox com auditor, cursor com sobreposição) e as 15 semanas de commits como especificação viva.

**Por quê.** O Suprimentos guarda o estado inteiro num JSON único (`app_state` id=1) reescrito a cada save, com merge de três vias feito no navegador. Não tem `tenant_id` em lugar nenhum, não tem migrations versionadas, autoriza só no React, usa a anon key como credencial de servidor em 16 das 23 Functions e tem senha em texto no código. O incidente de 04-05/08 (DELETE em massa que zerou insumos, fornecedores, ordens e usuários) é consequência direta desse modelo. Num multi-tenant, esse bug apagaria dados de todos os clientes.

**A tese scan-first se sustenta?** Sim, com fronteira clara. Sustenta-se para fábrica de produto próprio, discreto e repetitivo, vendido por SKU em marketplace, com um ponto de embalagem. Nenhum concorrente pesquisado fecha esse ciclo. Não se sustenta como está para confecção com grade e facção, para sob encomenda e para lote sem unidade discreta. Essas exigem generalizações que devem vir depois, puxadas por cliente pagante.

**Por onde começar.** Não por código. Duas semanas de descoberta com 5 fábricas fora da Eddias e o congelamento real do Suprimentos. Depois, fundação multi-tenant em 3-4 dias e a primeira fatia vertical: o loop de produção (pedidos conectados, projeção do dia, etiquetas, bipe, baixa de insumos), que é o que a Eddias já faz e o que valida o produto.

## 2. O loop central do Prodio

| Passo | O que acontece | Onde |
|---|---|---|
| 1 | Conector puxa pedidos com itens e SKU da base que o cliente já usa, por cursor incremental idempotente | Automático, servidor |
| 2 | Vendas viram demanda por SKU produtivo, com alias SKU comercial para SKU de produção | Automático |
| 3 | Projeção do dia por SKU, pré-preenchida, editável pela encarregada. Fórmula: projetado = max(0, demanda × dias de cobertura − saldo no hub − em produção) | Computador, 10 minutos por dia |
| 4 | Impressão de etiquetas com serial único, faixa reservada por sequence do banco em transação | Computador + impressora térmica |
| 5 | Bipe no fim da linha = apontamento. Insere evento de scan com UNIQUE, dá entrada de acabado, baixa insumos pela ficha (backflush) e enfileira +1 no outbox do conector, tudo numa transação | Celular ou leitor Bluetooth |
| 6 | Worker do conector empurra o acabado para o hub em lote por SKU, com dry-run e auditor noturno | Automático |
| 7 | Necessidade de compra: demanda × ficha − saldo − em OC aberta, com lead time aprendido e cobertura em dias | Automático + tela de decisão |
| 8 | Ordem de compra por fornecedor, em unidade de compra com fator por linha, numeração por sequence, impressa com QR | Computador, compras |
| 9 | "Receber hoje" no celular: bipe do código de barras do DANFE, chave resolve até o XML, De-Para por fornecedor, conferência em cartões | Celular, doca |
| 10 | Entrada de insumos e baixa parcial ou total da OC numa transação; custo médio alimenta a ficha; o ciclo recomeça | Automático |

Promessa honesta: zero telas no chão de fábrica e na doca. No escritório, um ritual de 10 a 15 minutos por dia. Meça esse tempo na Eddias na primeira semana e use como número de venda.

## 3. A tese por segmento

| Segmento | Funciona | Não basta | Generalização exigida |
|---|---|---|---|
| Produto discreto repetitivo (Eddias, decoração, acessórios, pet, papelaria) | Loop inteiro, quase sem mudança | Cadastro de ficha continua sendo tela | Nenhuma além do MVP |
| Confecção de básicos | Contagem final por SKU, recebimento de tecido por NF-e, bipe de pacote por etapa | SKU não é unidade de produção (corta-se referência em grade), tecido baixa no corte, WIP em facção | Grade como atributos, etapas com bipe de passagem, terceiro como local de estoque com romaneio |
| Metalúrgica leve de série | Contagem final, recebimento, bipe de OP por operação | Roteiro e tempos são cadastro de PCP | Etapas opcionais, tag por OP ou lote |
| Alimentos e cosméticos | Recebimento com lote e validade, bipe de batelada | Unidade de produção é o lote, rastreabilidade insumo-lote para produto-lote, FEFO | Modo lote com quantidade, validade, rastreabilidade |
| Marcenaria, gráfica, serralheria sob encomenda | Bipe de status por OS, recebimento | Não há SKU nem projeção por vendas; ficha nasce por projeto fora do Prodio | OP por pedido, tag por pedido+item, importação de lista de peças |

Segmento para começar depois da Eddias: clones da Eddias. Confecção de básicos vem em seguida, quando houver um pagante, porque suas generalizações (grade, etapas, terceiro) servem a todos os outros.

## 4. O que levar do Suprimentos

| Item | Linhas | Como levar |
|---|---|---|
| Explosão multinível de ficha com backtracking (explodeInsumos) | 180-191, testes em `tests/motores.mjs` 47-85 | Copiar como função pura, com os 4 testes |
| Custo recursivo do produto pela ficha (custoProduto) | 147-160 | Copiar; unificar as três versões divergentes de CMV (150, 2351, 4999) |
| Calculadora de consumo por partes com perda (calcParte/calcConsumo) | 80-97 | Copiar |
| Custo médio ponderado na entrada (entradaInsumo) | 227-235 | Reescrever como função pura sem mutação, chamada dentro da transação |
| Projeção diária por SKU e demanda derivada de semiacabados | 5406-5428 | Reescrever com testes, acrescentando saldo do hub |
| Necessidade de compra: cobertura, em trânsito, lead time aprendido, folga | 3458-3538 | Reescrever com testes; números mágicos viram parâmetros do tenant |
| OC em unidade de compra com fator por linha e aprendizado fornecedor→insumo | 3314-3343, 8478-8496 | Reescrever contra o schema relacional |
| Serial de etiqueta e regra "bipa uma vez só" | 294-311, 7405-7434 | Só o requisito; sequence e UNIQUE no banco |
| Recebimento contra OC com conversão e divergência | 4627-4661, 4268-4295 | Reescrever como RPC idempotente |
| De-Para item do fornecedor → insumo com fator, aprendido por CNPJ | 7779-7788, 7994-7998 | Reescrever como tabela |
| Padrões de integração: fila idempotente, outbox com dry-run e freio, auditor noturno, cursor com sobreposição | `functions/api/base.js`, `base-outbox-sync.js`, `base-auditor.js`, `base-sync.js` | Usar como desenho do conector genérico |
| Guardas de integridade e auditoria de invariantes | 1107-1129, 9981-10056 | Metade vira constraint SQL, o resto vira job de saúde do cadastro |
| Importadores de planilha com aliases de coluna | 1946-1976 e afins | Copiar o padrão, validar no servidor com prévia |
| Bateria de testes | `tests/motores.mjs` | Portar 17 dos 30 casos (explosão, fator, custo médio, auditoria). Os de SLA e merge não servem |

**Não levar:** o JSON `app_state`, as tabelas `{id, data jsonb}`, o merge de três vias no cliente, as lápides, autorização no React, anon key nas Functions, token em query string, segredos em env global, IDs da conta Eddias hardcoded, o arquivo único, qualquer componente React.

**Não copiar o motor fiscal (linhas 28-64).** Ele tem PIS/COFINS fixo em 9,25, credita ICMS integral sobre item com substituição tributária (a chapa MP0078) e zera PIS/COFINS de fornecedor Simples, o que está errado para comprador não cumulativo. Fica obsoleto em 01/2027 com a CBS. Reescrever como: crédito = valor destacado no XML por tributo, filtrado por regime do comprador e CFOP, com tabela de tributos e vigência. Custeio líquido de impostos é parâmetro opcional, desligado por padrão. O ICP é majoritariamente Simples Nacional e não credita nada.

## 5. Modelo de dados núcleo

- `tenants`, `memberships` (user, tenant, role, local), `locations`, `units`, `tenant_params`, `doc_counters` (numeração por tenant via UPDATE ... RETURNING).
- `products` (referência) com `variants` opcionais e `sku_aliases` (SKU comercial → produto).
- `materials` (insumo) com unidade de compra, unidade de consumo, fator, mínimo. Saldo não é coluna.
- `suppliers` por CNPJ, `supplier_materials` (código do fornecedor, unidade, fator, preço). É o De-Para de NF-e.
- `bom_versions` e `bom_lines`, com componente fabricado, calc por partes e validação de ciclo ao ativar.
- `labels` (serial opaco, tipo unidade | caixa com quantidade | OP | romaneio, status reservada | impressa | anulada).
- `scan_events` com UNIQUE (tenant, label, etapa, tipo) NULLS NOT DISTINCT. É o apontamento.
- `production_orders` opcional, com três origens: projeção automática, pedido, manual. O relatório diário é um GROUP BY de scans, não uma tabela com UNIQUE por dia.
- `stock_moves` append-only com delta sinalizado, tipo enum, chave de idempotência e referência. `stock_balances` mantida na RPC com SELECT FOR UPDATE. Estorno é movimento contrário.
- `purchase_orders` e `purchase_order_items` (unidade de compra, fator, recebido).
- `nfe_inbound` e `nfe_inbound_items` (chave de 44 dígitos, origem, status, CFOP do emitente, uCom e uTrib, vínculo n:n com itens de OC).
- `receipts` com idempotência por movimento (chave:nItem).
- `connectors`, `connector_credentials` (Vault), `sync_state` (cursor), `integration_outbox`, `status_map` por tenant.
- `audit_log`.

## 6. Multi-tenancy e segurança: regras inegociáveis

1. `tenant_id NOT NULL` em toda tabela de domínio e RLS habilitada desde a primeira migration. Policy usa `(select current_tenant_id())`, função STABLE que consulta `memberships`.
2. Nenhuma conexão de servidor a serviço de usuário usa service role ou role que ignora RLS. Service role só em workers de cron.
3. Tabelas que movem estoque, reservam serial ou numeram documento não têm GRANT de escrita para `authenticated`. Toda escrita passa por RPC `SECURITY DEFINER` com `SET search_path = ''`, `REVOKE EXECUTE FROM public, anon`, e checagem explícita de membership na primeira linha.
4. Claim de tenant no JWT com expiração curta (15 min). Troca de tenant via RPC que valida membership seguida de refresh de sessão.
5. Operador de chão de fábrica sem e-mail: sign-in anônimo por dispositivo, admin registra o dispositivo como membership com papel `dispositivo` e local, PIN validado por RPC dentro do tenant.
6. Teste de isolamento no CI: para cada tabela e cada função exposta, tentar ler e escrever como tenant B em dado do tenant A e exigir zero linhas.
7. Credenciais de conectores e certificados no Vault, cifrados por tenant. Nunca em env global.
8. Webhooks com verificação de assinatura quando existir (Bling), dedupe por id de evento, resposta 200 imediata e processamento assíncrono.
9. Backup PITR ativado antes do primeiro cliente pagante. Migrations e RPCs só via repositório, nunca pelo painel.

## 7. Conectores de pedidos

Interface genérica com capacidades opcionais por adaptador: `pullOrders(cursor)`, `pullCatalog()`, `pullFinishedStock()`, `pushFinishedStock(deltas)`, `findInboundNfe(chave)`, `pullPurchaseOrders()`, `onWebhook(payload)`. Cada tenant tem `status_map` (os status de pedido são personalizados na Base, no Bling e na Omie).

| Plataforma | Pedidos com itens | Webhooks | Catálogo e ficha | Push de acabado | NF-e de compra | Esforço | Confiança |
|---|---|---|---|---|---|---|---|
| BaseLinker | Sim, inline em getOrders | Não; polling de getJournalList | Sim; sem ficha de fabricação | Sim, saldo absoluto ou documentos IGR/IGI | Não | 3 dias MVP | Média |
| Bling v3 | Listagem sem itens; detalhe por pedido, 3 req/s | Sim, com HMAC | Sim, com estrutura (ficha) | Sim, POST /estoques | Sim: GET /nfe?tipo=0&chaveAcesso= e itens em GET /nfe/{id} | 8-11 dias | Média-alta |
| Tiny/Olist v3 | Listagem sem itens; detalhe por pedido | Só na interface, não na API | Sim, com /fabricado | Sim, POST /estoque/{id} | Sim, GET /notas tipo E e XML; POST /notas/xml | 6-10 dias, mais custo operacional (app privado por seller, refresh de 1 dia) | Média |
| Omie | Sim, com apenas_resumo=N | Sim, sem HMAC | Sim, com malha (ficha) e OP nativa | Sim, ajuste de estoque | Sim: ConsultarRecebimento por chave; ConcluirRecebimento só move etapa | 8-12 dias | Média |
| Magis5 | Não verificado | Não verificado | Só produto por SKU confirmado | Não verificado | Não | Indefinido | Baixa |

Ordem: BaseLinker interno primeiro (é a Eddias e há código de referência), depois Bling ou Tiny conforme o design partner, depois o outro, depois Omie, Magis5 só com cliente pedindo e conta de teste na mão. Verificar no primeiro dia do spike do Bling se pedidos lidos por API contam no limite do plano do cliente (mudança de abril/2026).

## 8. Entrada de NF-e

**Fato central.** O DANFE da NF-e (modelo 55) traz a chave de 44 dígitos em código de barras Code-128, não em QR. O QR é da NFC-e. A chave é só um ponteiro: não contém itens. Sem o XML não há entrada por item.

**MVP: XML-first, sem custódia de certificado.** Um índice único por chave com três entradas: compartilhar ou subir o XML no app (do WhatsApp ou e-mail), caixa de e-mail por tenant que o comprador informa ao fornecedor, e busca no ERP conectado quando o cliente já importa notas lá (Bling, Tiny, Omie). Se nada existir, recebimento cego contra a OC, pendente de conciliar quando o XML chegar.

**Evolução.** Certificado A1 via provedor (Focus NFe, API de notas recebidas) como canal opcional, com Ciência da Operação só ao bipar ou quando existe OC compatível, e Confirmação da Operação ao concluir a conferência. A Nuvem Fiscal foi desativada em 07/2026. Para a Eddias, que hoje recebe as notas por DF-e via Kamino, resolver a origem antes do cutover de recebimento: ou adaptador de leitura do espelho Kamino, ou A1 via provedor.

**Fluxo no celular.** Tela "Receber hoje" com OCs previstas e notas já conhecidas. Bipe do Code-128, validação do dígito verificador. Resolução da chave em ordem: índice local, ERP conectado, provedor DF-e, recebimento cego. Sugestão de OC por CNPJ e itens. De-Para por fornecedor com fator; itens novos entram numa fila de mapeamento, nunca criam insumo em silêncio. Conversão uCom para unidade de consumo, com uTrib como fallback. Conferência com ok ou divergente por item. Confirmar grava entradas, baixa OCs, marca a chave como recebida.

**Armadilhas que o parser precisa tratar desde a primeira versão.** Classificar pelo CFOP do emitente (5xxx e 6xxx): 5101, 5102, 5401, 5403, 5405 e equivalentes 6xxx entram como compra; remessa, retorno de industrialização, bonificação, conserto e devolução vão para classificação manual. Recusar nota cancelada ou denegada (cStat). Ratear frete, seguro e outras despesas. Ler ICMS-ST, PIS/COFINS e o grupo IBS/CBS. Nota com várias OCs e OC com várias notas. Notas de serviço não têm chave de 44 dígitos.

## 9. Stack

**Recomendação.** TypeScript de ponta a ponta num monorepo pnpm, com regra de arquivo abaixo de 400 linhas. Front: React 19 + Vite como PWA instalável, câmera via BarcodeDetector com fallback ZXing, leitor HID, fila offline em IndexedDB. Domínio em `packages/core` puro com vitest. Banco: Supabase Postgres em São Paulo com migrations versionadas, RLS, Auth, Storage privado, RPCs plpgsql. Um único runtime de servidor: Cloudflare Workers com cron no `wrangler.toml` para conectores, webhooks, parser de XML e Email Worker para a caixa de XML. Sem Edge Functions, pg_cron ou Realtime no MVP.

**Por quê.** É o ecossistema que você já opera com o Claude. O que faltou no Suprimentos não foi a stack, foi o desenho: schema versionado, RLS, escritas transacionais no servidor e domínio isolado com testes.

**Alternativa.** Monólito Rails 8 ou Laravel com Postgres gerenciado. Só vale se você contratar um dev de backend com essa experiência.

## 10. Plano de execução em fatias verticais

| Etapa | Entrega | Critério de pronto |
|---|---|---|
| Portão 0 (2 semanas, zero código de produto) | 5 conversas com fábricas de 5-50 pessoas fora do grupo Eddias, 4 delas clones da Eddias e no máximo 1 confecção. Perguntas: regime tributário, de onde vem o XML das compras, produz por meta do dia ou por OP, qual ERP ou hub usa, quem bipa no fim da linha, quanto pagaria. Hardening e congelamento do Suprimentos | 1 design partner nomeado com piloto pago simbólico. Lista de 20 fábricas alcançáveis. Suprimentos com no máximo 2 commits por mês |
| Fundação (3-4 dias) | Monorepo, migration 0001 (tenants, memberships, locais, contadores, parâmetros), RLS em tudo, hook de claim, CI com lint, vitest e teste de isolamento, `packages/core` com os motores portados e 17 testes | CI verde, teste de isolamento passando por tabela e função |
| Fatia 1: produção scan-first (3 semanas) | Cadastros importados por script das tabelas do Suprimentos, ficha com calculadora, ledger, conector BaseLinker (pedidos, catálogo, saldo, outbox), projeção do dia, etiquetas com sequence, PWA de bipe com PIN e fila offline, backflush por scan, "Linha de hoje" | Eddias roda um dia inteiro de produção só no Prodio em sombra de leitura (comparação automática de bipes por SKU e baixa dos 20 insumos mais caros) com divergência zero |
| Cutover 1 da Eddias (um fim de semana) | Produção inteira passa para o Prodio: projeção, etiquetas, bipe, backflush, outbox para a Base. Desliga o insert em `base_outbox` e o cron correspondente no mesmo momento. Sem ponte, sem dupla digitação | Rollback documentado = Suprimentos intacto + PITR. Uma semana sem incidente |
| Fatia 2: compras e recebimento (3 semanas) | Necessidade de compra em dois modos (métrica do mês, padrão da Eddias; por saldo, liberado quando o inventário cíclico mostrar acurácia), OC com QR, "Receber hoje", XML-first, parser completo com fixtures reais (chapa com ST, fornecedor Simples, devolução, nota cancelada), De-Para, entrada e baixa em RPC | Origem de NF-e da Eddias resolvida. A nota aparece em "Receber hoje" antes do caminhão chegar |
| Cutover 2 da Eddias | Compras e recebimento passam para o Prodio. Suprimentos fica só com expedição, devoluções, precificação e financeiro | Duas semanas sem incidente |
| Fatia 3: segundo tenant (3-4 semanas) | Design partner começa com planilha de vendas no dia 1 e bipe na semana 1. Conector Bling ou Tiny entra após a segunda semana de bipe. Importação de catálogo e ficha pelo ERP. Onboarding assistido pago | Parceiro com 80% da produção bipada por 30 dias e suporte abaixo de 2 horas por semana |
| Depois, uma por vez, puxada por cliente pagante | Modo lote/caixa com quantidade no scan, etapas com bipe de passagem, grade e ordem de corte, terceiro com romaneio, A1 via provedor, segundo conector, cobrança automática | Cada generalização só entra com cliente pagando por ela |

Regra de ritmo: replaneje por fatia, não por calendário. Três semanas com menos de 10 commits sem incidente é sinal de replanejar. Se o hardening do Suprimentos não estiver feito em duas semanas, não há tempo para o Prodio ainda.

## 11. Eddias e Suprimentos durante a transição

- Congelar de verdade. Setembro teve 4 commits, todos feature nova. Regra: só correção que pare a operação; todo pedido da fábrica vai para o backlog do Prodio.
- Hardening mínimo em 1-2 dias: rotacionar a anon key; exigir token em todas as Functions (`base-produtos`, `base-funil`, `notify` e `base-check` estão sem autenticação; 7 rotas aceitam token ausente); remover ou proteger as rotas de diagnóstico com escrita; remover a senha do SEED (linha 336) e o campo senha do cadastro de usuários; tornar o bucket de fotos de devolução privado.
- A Eddias é fonte de dados, não operação paralela. Dupla digitação por 3-4 pessoas é o dual-write de 24/06 feito por humanos, e aquele explodiu em 05/08. Sombra só de leitura, por script, e cutover seco por módulo.
- Não migrar os 27 mil movimentos antigos. Cadastro, ficha, saldo atual como lançamento de abertura, OCs abertas e notas pendentes. Histórico fica no Suprimentos em modo leitura.

## 12. Riscos e sinais de parada

- O loop não está fechado nem na Eddias: compras rodam por vendas × ficha porque o saldo de insumos "ainda não é fiel" (linha 3750). Baixa automática gerando compra certa é hipótese. Mitigação: inventário cíclico por scan e modo "por saldo" liberado só com acurácia comprovada.
- Segundo cliente inexistente. Sem design partner nomeado no Portão 0, o Prodio vira Suprimentos 2. Mitigação: o Portão 0 é bloqueante.
- Recriar a Eddias em vez de um produto. Mitigação: só entra no MVP o que o segundo cliente também usa.
- Dependência de APIs de terceiros: Bling conta pedidos via API no plano, Tiny exige app privado por seller e refresh diário, Omie bloqueia por consumo redundante. Mitigação: conector com capacidades opcionais e status mapeado por tenant.
- Incumbente copia o scan. Bling, Olist e Omie já têm app com câmera. Defesa: a experiência ponta a ponta (projeção, etiqueta, outbox, recebimento) e a profundidade industrial, não o scan em si.
- Preço: um tier só no ano 1 (R$ 299-399 por CNPJ, bipadores ilimitados) mais onboarding pago. Registrar critério de continuidade em 6 meses após o primeiro pagante: pelo menos 3 pagantes externos com 80% da produção bipada e suporte abaixo de 2 horas por semana por cliente. Abaixo disso, o Prodio continua como sistema interno da Eddias, o que já justifica a fundação, e o roadmap de conectores para.
- Reforma tributária: CBS substitui PIS/COFINS em 01/2027 e o leiaute da NF-e já traz IBS/CBS. Custeio por valores destacados com vigência evita reprocessar o ledger.

## 13. Perguntas que só você responde

1. Quem são as 3 primeiras fábricas fora da Eddias que você já conhece e que pagariam? Alguma aceita ser design partner?
2. A Eddias vai desligar o Suprimentos por completo ou expedição, devoluções, precificação e financeiro ficam nele por tempo indeterminado?
3. Qual é a headline de venda: "o que você embala aparece no estoque do hub em minutos", "compre a tempo" ou "receba a nota pelo celular"? A recomendação é a primeira, porque está provada desde 05/08.
4. Quantas horas por semana vão para o Prodio nas próximas 12 semanas, e você segue como único dev com Claude?
5. Preço-alvo e modelo de cobrança: por CNPJ com bipadores ilimitados é a recomendação. Pix e boleto ou só cartão?
6. Como as fábricas-alvo recebem NF-e hoje: XML por e-mail, ERP com certificado, ou o contador tem?
7. Para a Eddias, qual origem de NF-e no cutover 2: adaptador de leitura do Kamino ou A1 via Focus NFe?
8. O nome Prodio, domínio e marca estão registrados? A Eddias aparece como caso de referência?
9. Existe alguém na Eddias (compras, encarregada) que possa ser o usuário-teste diário sem você no meio?
10. Aceita que o histórico antigo (27 mil movimentos, financeiro Kamino) fique no Suprimentos em modo leitura?

## 14. Decisões de escopo (21/09/2026)

Registradas com o fundador depois da primeira versão da interface.

**Entra no Prodio**
- Precificação por canal, com canais criados e configurados pelo próprio cliente (presets editáveis de Mercado Livre, Shopee, Amazon, TikTok, Magalu, loja própria e atacado). O custo vem da ficha técnica.
- Painel de produtividade com histórico. Justificativa: medir aderência da projeção, achar gargalo por hora e reconhecer quem produz, sem apontamento além do bipe. Vive em Apontamentos.
- Conferência e inventário genéricos, em sessões, com modo "por peças" para material dimensional e sobras aproveitáveis. Substitui a conciliação de chapas da Eddias.
- Etiqueta de montagem generalizada como etiqueta de processo, configurada por família em perfis de etiqueta (produto, montagem, caixa).
- Avisos por Google Chat (webhook por espaço), e-mail e, depois, WhatsApp.
- Envio de produtos ao ERP ou hub pela API do conector (substitui a exportação de planilha para o Tiny).

**Fica fora, também para a Eddias**
- Expedição, devoluções e financeiro.
- Espelho de NF-e da Kamino. No lugar: XML por e-mail, upload ou ERP conectado, e consulta direta por chave na hora do bipe via provedor (certificado A1 do cliente ou consulta paga por chave).
- Conciliação física de chapas como módulo específico.
