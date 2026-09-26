# Prodio — arquitetura e convenções

Este documento é a fonte de verdade para quem escreve código no Prodio. As regras aqui vêm de três meses de incidentes do sistema anterior (Eddias Suprimentos) e das críticas ao plano de fundação. Não são preferências de estilo.

## 1. Peças

```
apps/web        interface (Vite + React 19 + TypeScript + Tailwind v4), PWA
apps/worker     Cloudflare Worker: conectores, outbox, webhooks, e-mail de XML, cron
packages/core   regras de negócio puras em TypeScript, com testes (vitest)
supabase/       Postgres: migrations, RPCs, RLS, seed, testes de banco
```

Fluxo de dependência: `web` e `worker` dependem de `core`. `core` não depende de nada (nem React, nem Supabase, nem rede).

## 2. Banco: regras inegociáveis

1. **Toda tabela de domínio tem `tenant_id uuid not null` com FK para `tenants` e RLS habilitada na mesma migration que a cria.** Sem exceção. Uma tabela sem RLS é um vazamento entre clientes.
2. **A policy padrão** é `tenant_id = (select public.current_tenant_id())`. A função `current_tenant_id()` é `STABLE`, lê a claim `tenant_id` do JWT e confirma a `membership` do usuário. O `(select …)` faz o Postgres cachear por statement.
3. **Leitura direta pelo cliente é permitida** (RLS protege). **Escrita que move estoque, reserva serial, numera documento, aponta produção ou recebe nota nunca é feita por INSERT/UPDATE direto.** Essas tabelas não têm GRANT de escrita para `authenticated`. A escrita passa por RPC. Como o Supabase concede ALL por default privileges em todo objeto novo de `public`, "não ter GRANT" exige `revoke all on table … from public, anon, authenticated` logo depois de cada `create table` (o teste `0010_seguranca_privilegios` confere o catálogo inteiro).
3a. **Referências entre tabelas do tenant são FKs compostas** `(tenant_id, x_id) references pai(tenant_id, id)`: a policy garante o `tenant_id` da linha e a FK garante que o alvo é do mesmo tenant. Toda RPC que recebe um id de outra tabela confere o tenant antes de usar.
4. **RPCs de escrita são `SECURITY DEFINER`** com, obrigatoriamente: `SET search_path = ''`, `REVOKE EXECUTE ON FUNCTION … FROM public, anon`, `GRANT EXECUTE … TO authenticated`, e a primeira instrução do corpo é `PERFORM public.assert_member(p_tenant_id, ARRAY['admin', …])`. Nomes de tabela sempre qualificados com `public.`.
5. **Service role só no worker.** Por cron, webhook e e-mail ele age sozinho. Nunca no navegador. A anon key só serve para login. Em rota acionada por usuário, o service role só entra **depois** que o pedido foi autorizado como o próprio usuário (cliente com a anon key + o JWT dele, com RLS e `current_member_role()` valendo) e **só** para o que é impossível fazer como usuário: cifrar e decifrar `connector_credentials` com a `CREDENTIALS_KEY`, que é segredo do worker, e gravar o que o worker acabou de descobrir conversando com a plataforma (status do conector, `sync_state`). O alvo vem sempre da linha já autorizada, nunca de um id vindo do corpo da requisição. Hoje são `POST /connectors/:id/credentials`, `POST /connectors/:id/test` e `POST /connectors/:id/sync` (a sincronização manual do cartão do conector: lê pelo mesmo adaptador do cron e grava pedidos e o resultado no cartão em `connectors`, mas nunca `sync_state`, que é do robô: cursor, pulso e rodadas). *(Esta frase foi acrescentada porque a regra anterior — "nunca em caminho acionado por usuário" — proibia o único caminho possível para salvar e testar credencial: a chave que cifra a credencial existe só no worker, então nenhum cliente consegue fazer isso por conta própria. A exigência não foi afrouxada: o service role continua proibido de rodar antes de o pedido ter sido autorizado como o usuário.)*
6. **Idempotência é chave única, não lógica de aplicação.** `scan_events(tenant_id, label_id, stage_id, event_type)` com `NULLS NOT DISTINCT`; `stock_moves.idempotency_key` único por tenant; `receipts.idempotency_key`; `integration_outbox(tenant_id, connector_id, dedupe_key)`. Chaves vindas do cliente entram sempre num namespace próprio (`manual:`); `nfe:`, `rcpt:`, `scan:`, `rev:` e `inv:` são das RPCs de origem.
7. **Ledger é append-only.** `stock_moves` nunca sofre UPDATE ou DELETE. Estorno é um movimento contrário com `reverses_id`. Saldo e custo médio ficam em `stock_balances`, mantidos pela RPC dentro da transação com `SELECT … FOR UPDATE`. Única exceção: os scripts de limpeza dos dados de exemplo (`supabase/limpar_exemplo.sql` e `supabase/limpar_so_exemplo.sql`, rodados à mão pelo dono do banco), que apagam os movimentos dos insumos do exemplo — o insumo precisa sair e movimento não se estorna para o nada — desligando o gatilho `stock_moves_append_only` só em volta do DELETE, dentro da própria transação.
8. **Numeração de documento** vem de `doc_counters` com `UPDATE … RETURNING` dentro da mesma transação que cria o documento. Nunca é calculada no cliente.
9. **Exclusão** é `deleted_at` (soft delete) nas tabelas de cadastro. Nada de DELETE em massa vindo do cliente. Importação substitui por escopo explícito, nunca por diferença de memória.
10. **Claim de tenant** vem do hook `custom_access_token_hook`, que lê `user_active_tenant`. JWT expira em 15 minutos. Trocar de tenant é RPC `set_active_tenant` seguida de `refreshSession()` no cliente. Remover alguém de um tenant apaga a `membership`, e a policy deixa de valer no próximo statement porque `current_tenant_id()` confere a membership, não só a claim.
11. **Operador de chão de fábrica** não tem e-mail: o aparelho faz sign-in anônimo, o admin registra o aparelho (vira `membership` com papel `dispositivo` e local), e o operador entra com PIN via RPC `set_operator(pin)`, que grava `device_sessions.operator_id`. `register_scan` lê o operador da sessão do aparelho. Só uma sessão anônima resgata o código de pareamento (`pair_code` nunca sai pela tabela); PIN errado devolve zero linhas e conta no aparelho, que bloqueia por 15 min após 5 falhas.
12. **Credenciais de conectores** ficam em `connector_credentials` cifradas com `pgp_sym_encrypt` e a chave `CREDENTIALS_KEY` do worker. Nunca em env global, nunca em texto.
13. **Migrations são a única forma de mudar o schema.** Nada criado pelo painel. Cada migration é reexecutável (`create … if not exists`, `create or replace function`, `drop … if exists` antes de recriar). Em produção elas entram só pelo aplicador (`supabase/aplicar-migracoes.sh`, no push em main): uma transação por arquivo, controle com sha256 em `prodio_admin.migracoes`, backup cifrado e ensaio antes, trava de destrutivas. Migration aplicada não se edita. Detalhes em `docs/publicacao-automatica.md`.
14. **Datas** em `timestamptz`. Competência de produção é `date` calculada pelo fuso do tenant e pela `hora_virada` (ex.: bipe às 02:00 conta para o dia anterior).

### Modelo de tabelas (nomes em inglês, snake_case)

`tenants`, `memberships`, `user_active_tenant`, `locations`, `units`, `doc_counters`, `audit_log`,
`products`, `sku_aliases`, `materials`, `suppliers`, `supplier_materials`, `bom_versions`, `bom_lines`,
`label_profiles`, `label_sizes`, `daily_plans`, `labels`, `stages`, `scan_events`, `stock_moves`, `stock_balances`,
`purchase_orders`, `purchase_order_items`, `nfe_inbound`, `nfe_inbound_items`, `receipts`, `receipt_items`,
`connectors`, `connector_credentials`, `connector_status_map`, `sync_state`, `integration_outbox`, `hub_stock_snapshots`,
`channels`, `product_prices`, `inventory_sessions`, `inventory_items`, `devices`, `operators`, `device_sessions`, `notifications`, `notification_settings`.

### RPCs de escrita (nomes em inglês)

`set_active_tenant`, `next_doc_number` (interna), `register_device`, `set_operator`,
`reserve_label_batch`, `annul_label`, `register_scan`, `reverse_scan`, `set_daily_plan`,
`post_stock_move`, `reverse_stock_move`, `create_purchase_order`, `update_purchase_order_status`,
`receive_nfe`, `close_inventory_session`, `activate_bom`, `enqueue_outbox` (interna), `apply_outbox_result` (worker),
`import_catalog` (importação do cadastro do Eddias Suprimentos: só admin, em lote, com simulação; ver `docs/schema.md`),
`save_label_size`, `delete_label_size` (tamanhos de etiqueta da empresa: só admin; ver `docs/schema.md` e `docs/personalizacao.md`).

## 3. Regras de negócio no `core`

Tudo que calcula fica em `packages/core`, como função pura com teste:

- `ficha.ts` explosão multinível com proteção de ciclo, custo recursivo, calculadora de consumo por partes.
- `custeio.ts` custo médio ponderado móvel; crédito por tributo a partir dos valores destacados no XML, filtrado pelo regime do comprador e pelo CFOP, com tabela de tributos e vigência (CBS/IBS a partir de 2027). Nunca alíquota fixa.
- `projecao.ts` demanda diária por SKU, projetado = max(0, demanda × cobertura − saldo no hub − em produção), elevação à carteira.
- `planejamento.ts` planejamento pela média de vendas dos pedidos: quais pedidos contam (todo confirmado, inclusive cancelado e enviado; só `ignorar` fica fora), resumo dos pedidos (a mesma regra da RPC `demand_summary`), demanda por dia de produção (× 30 ÷ dias úteis), demanda derivada dos componentes fabricados (só informativa: o bipe do pai já baixa o insumo do componente, então componente não entra no plano pela demanda dos pais), sugestão da Linha de hoje (com saldo no hub repõe `dias_cobertura_acabado`; sem saldo, a demanda de um dia), o que ficou de fora (SKU sem produto, produto sem ficha) e se a demanda está em dia (robô parado, carga inicial atrasada). A perda da ficha é em fração no core; a interface guarda em percentual e converte (`domain/demanda.ts`, `bomsParaCore`).
- `necessidade.ts` necessidade de compra em dois modos (métrica do mês e por saldo), lead time aprendido, cobertura, folga, comprar até.
- `etiquetas.ts` serial (prefixo + SKU + AAMMDD + sequência), perfis por família (família sem perfil: prefixo ET e 1 por caixa, o mesmo da RPC `reserve_label_batch`).
- `etiquetaTamanhos.ts` tamanhos de etiqueta: os de fábrica, limites (os checks de `label_sizes`), validação com as mensagens da RPC, qual tamanho vale para o perfil, linhas do rolo. `etiquetaLayout.ts` desenho de uma etiqueta num tamanho: QR ao lado ou acima, lado do QR em pontos inteiros do dpi, a maior fonte que cabe; serial, SKU e cabeçalho nunca cortam, o resto abrevia com aviso, e quando nem o essencial cabe diz o que falta. `etiquetaAmostra.ts` pior caso dos produtos (maior SKU, maior nome) para conferir um tamanho.
- `nfe.ts` validação de chave (dígito verificador módulo 11), decomposição da chave, parser do XML (modelo 55, cStat, série, finNFe, CFOP do emitente, vDesc/vFrete/vSeg/vOutro, ICMS-ST, PIS/COFINS, IBS/CBS, uCom e uTrib), classificação por CFOP.
- `precificacao.ts` preço por margem alvo por canal.
- `unidades.ts` conversão compra → consumo.
- `importacaoEs.ts` (+ `importacaoEs/`) backup do Eddias Suprimentos → plano de importação: lê o JSON do "Baixar backup completo" em lista branca (usuários, senhas, config, vendas, notas e ledger nunca saem do navegador), normaliza unidades, resolve CNPJ, de/para TM↔ED, fichas (perda em fração, sempre 0: o consumo do ES já inclui a perda), custo de referência por unidade de consumo com a conta da ficha do ES (`importacaoEs/custos.ts`: custo líquido de tabela ÷ fator; o custo médio do ES só sem valor de NF-e, porque ele foi gravado por unidade de compra de 01/06 a 03/08/2026) e monta o payload da RPC `import_catalog`; a prévia avisa custo suspeito (custo médio legado, fator 0, unidades diferentes com fator 1, linha de ficha que passa do CMV do ES ou engole as outras — `conferenciaCustos.ts`); `juntarPrevia` cruza o plano com a simulação do banco.

## 4. Interface

- Páginas leem do store; o store fala com um `Repo`. Há duas implementações: `MemoryRepo` (dados de exemplo, usada sem variáveis de ambiente) e `SupabaseRepo`. A escolha é por `VITE_SUPABASE_URL`.
- Toda escrita crítica chama uma RPC. Leituras usam `supabase.from(...)` com RLS.
- **Leitura que pode passar de 1.000 linhas é paginada** (`data/paginar.ts`, `lerTudo`, lotes de 1.000 com ordem estável terminando numa chave única). O PostgREST do Supabase corta em 1.000 (db-max-rows) sem erro: a tela ficaria pela metade e salvar uma ficha cortada ativaria uma versão com linhas a menos. Hoje: fornecedores, insumos (+ `v_stock`), fichas (`v_bom_active`), produtos e preços. O `db:test:api` sobe o PostgREST com o mesmo teto e prova a leitura acima dele.
- **Pedido não vem para o navegador.** A demanda e as vendas por dia são somadas no banco (`demand_summary` devolve um jsonb só; `sales_by_day`, no máximo um dia por linha) e entram no Snapshot como a fatia `demanda`. A Linha de hoje, a Necessidade e o Painel calculam em cima dela pelo core e relêem a fatia a cada 5 minutos enquanto estão abertas. A sugestão do dia entra no plano pela `set_daily_plan`, só para produto que ainda não está no plano (o ajuste da encarregada nunca é sobrescrito).
- **Importar do ES** (Configurações, aba só para admin): o arquivo do "Baixar backup completo" é lido no navegador (`FileReader` → `lerBackupES` do core, em lista branca); o JSON cru não vai para estado, store, storage, URL nem console. O store chama `Repo.importarCatalogo` (Supabase: RPC `import_catalog`; memória: `data/importacaoMemoria.ts`, as mesmas regras sobre os dados de exemplo), sempre simulando antes (a prévia) e gravando exatamente o payload simulado. Depois de gravar, o store relê só as fatias do catálogo. A prévia e o resultado mostram quantos itens de pedido sem produto a gravação religa (regra do robô: apelido, depois SKU) e, havendo dados de exemplo, qual script de limpeza rodar: `limpar_so_exemplo.sql` quando já há conector ligado ou pedido real, `limpar_exemplo.sql` só sem uso real.
- **Impressão de etiqueta** (`pages/producao/etiquetasImpressao.ts`): cada família sai no tamanho do perfil (`label_sizes`), desenhada pelo core; cada linha do rolo é uma página nomeada do tamanho exato (`@page etq-N { size: L A; margin: 0 }`), para a térmica receber a medida da etiqueta. Nada de margem de página nem moldura na impressão.
- Chão de fábrica funciona sem rede: fila de bipes em IndexedDB, conjunto local de seriais lidos para responder "já bipado" offline, replay em ordem tratando conflito de unicidade como sucesso.

## 5. Worker

- Um runtime só. Cron a cada 5 minutos: para cada tenant com conector ativo, `pullOrders` incremental por cursor com sobreposição e `applyOutbox` em lote por SKU com dry-run opcional. Cron diário: auditor compara saldo do hub com o Prodio e registra divergências.
- Webhooks em `/webhooks/{plataforma}/{tenant_id}/{token}`: verificar assinatura quando existir (Bling), dedupe por id de evento, responder 200 imediato, processar depois.
- `POST /nfe/xml` recebe XML (upload ou e-mail), roda o parser do core e grava `nfe_inbound` via service role, validando o tenant pelo endereço de destino ou pelo token.
- Interface de conector: `pullOrders(cursor)`, `pullCatalog()`, `pullFinishedStock()`, `pushFinishedStock(deltas)`, `findInboundNfe(chave)`, `pullPurchaseOrders()`, `verifyWebhook(req)`. Adaptadores declaram capacidades; o que não suportam devolve `unsupported`.
- **OAuth só grava token no navegador que começou o fluxo.** O callback do OAuth chega sem JWT — é navegação vinda da plataforma — e o `state` assinado diz em qual conector gravar, mas não diz quem pediu. Sozinho, ele permitia que um admin de um tenant qualquer emitisse uma URL de autorização legítima e a mandasse para um terceiro: a vítima autorizava a conta dela e o token caía no conector do atacante (pior no Bling, cujo app OAuth é global do Prodio e mostra "Prodio" no consentimento). Por isso `/oauth/start` devolve uma URL do próprio worker (`/oauth/go`), que grava um nonce num cookie `HttpOnly; Secure; SameSite=Lax` antes de desviar para a plataforma, e o callback só grava credencial quando o nonce do `state` bate com o do cookie. Detalhes e testes em `apps/worker/src/rotas/oauthVinculo.ts`.
- **Consulta do worker não usa embed do PostgREST** (`.select('…, tenants(…)')`): quando há mais de um caminho entre duas tabelas — e as FKs compostas da §2 3a criam vários —, o PostgREST recusa com `PGRST201`. Foi isso que deixou o cron parado em 25/09/2026. Leia a tabela relacionada numa segunda consulta; `apps/worker/src/semEmbed.test.ts` reprova o embed.
- **Segredo de plataforma nunca sai numa resposta HTTP nem numa linha de log.** A última barreira é `redigirSegredos` (`apps/worker/src/rotas/testar.ts`): antes de responder, o texto é varrido pelos valores da credencial que o worker acabou de decifrar. Não se confia em cada adaptador lembrar de sanitizar — vários repassam um pedaço do corpo cru da plataforma.

## 6. Testes

- `core`: vitest, casos reais da Eddias como fixtures (fichas, XMLs anonimizados).
- Banco: `supabase/tests/*.test.sql` rodam contra Postgres 16 em CI com stubs do schema `auth`. Um teste obrigatório: para cada tabela e RPC, o usuário do tenant B não lê nem escreve dado do tenant A.
- Web: build e lint verdes; smoke em Chromium nas rotas.
