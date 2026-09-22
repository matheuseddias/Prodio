-- Prodio · correção: conector fantasma
--
-- O QUE ACONTECEU
-- A versão antiga de supabase/seed_compras.sql semeava o conector do BaseLinker já como 'conectado',
-- com ultimo_sync recente, cursor em sync_state, itens no integration_outbox, saldos de hub e uma
-- auditoria — tudo isso sem credencial, porque credencial é cifrada com a CREDENTIALS_KEY do worker e
-- não pode ser semeada. Resultado num banco que recebeu aquele seed: a tela de Conectores mostra uma
-- integração conectada que nunca existiu, e assim que o worker subir o cron vai pegar esse conector
-- (ele coleta os de status 'conectado' e 'erro'), não achar credencial e falhar de 5 em 5 minutos.
-- Pior: o cursor semeado (date_confirmed_from = o instante do seed) faria a primeira coleta de verdade
-- começar dali e pular todo o histórico da conta.
--
-- QUANDO USAR
-- Uma vez, num banco onde o seed antigo já foi aplicado, antes de publicar o worker ou de conectar uma
-- plataforma de verdade. Quem instalar o seed novo (supabase/dist/dados_eddias.sql gerado depois desta
-- correção) não precisa deste arquivo: lá os conectores já nascem desconectados.
--
-- O QUE FAZ
-- Só mexe em conector SEM credencial salva (connector_credentials), ou seja, em integração que
-- comprovadamente nunca foi conectada. Conector conectado de verdade não é tocado.
--   1. status = 'desconectado', ultimo_sync e ultimo_erro zerados, e a config limpa de 'pedidos_24h',
--      'cursor', 'inventory_id' e 'warehouse_id'. Esses dois últimos são o ajuste mais urgente: o
--      adaptador do BaseLinker lê inventory_id/warehouse_id de connectors.config (não da credencial),
--      então o inventário 24384 semeado seria usado de verdade assim que alguém conectasse a conta —
--      o Prodio escreveria saldo num inventário que não é o do cliente. Sem eles o adaptador pega o
--      inventário padrão da conta e recusa o envio de estoque com um erro claro até o depósito ser configurado;
--   2. apaga o sync_state desses conectores (estado de uma sincronização que não aconteceu, e o cursor
--      falso faria a primeira coleta real pular o histórico);
--   3. marca como 'ignorado' o outbox pendente/em erro desses conectores — mesmo efeito de
--      disconnect_connector, sem apagar linha nenhuma, então o histórico fica auditável;
--   4. apaga os snapshots de hub e as auditorias desses conectores, que são resposta de plataforma e
--      conferência diária inventadas (saldo de hub falso entra na projeção e vira sugestão de compra errada);
--   5. apaga o De-Para de status semeado — e só ele, pelos oito nomes que o seed antigo usava. BaseLinker,
--      Tiny e Bling devolvem o status como código da conta ('1', '2', …), nunca como 'new'/'paid'/'confirmed'.
--      Com um mapa que não casa com nada, worker_upsert_orders vê que existe mapa, não acha o status e grava
--      significado nulo: o pedido entra no banco e some da demanda, em silêncio. Sem mapa, todo pedido vira
--      'demanda' — errado para menos, mas visível. O De-Para certo se cadastra depois, pela RPC set_status_map.
-- Não toca em pedidos, produtos, insumos, estoque, OC nem NF-e.
--
-- SEGURO RODAR DUAS VEZES: toda instrução é um update para o mesmo valor ou um delete do que já sumiu.
-- A segunda execução devolve 0 conectores corrigidos.
--
-- COMO RODAR
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/correcoes/20260922_conector_fantasma.sql
-- ou cole no SQL Editor do painel. Precisa ser o dono do banco (postgres), não a anon key.

begin;

-- 1. conectores sem credencial voltam a ser o que sempre foram: desconectados
update public.connectors c
   set status = 'desconectado',
       ultimo_sync = null,
       ultimo_erro = null,
       config = c.config - 'pedidos_24h' - 'cursor' - 'inventory_id' - 'warehouse_id'
 where not exists (select 1 from public.connector_credentials cc where cc.connector_id = c.id)
   and (c.status <> 'desconectado' or c.ultimo_sync is not null or c.ultimo_erro is not null
        or c.config ?| array['pedidos_24h', 'cursor', 'inventory_id', 'warehouse_id']);

-- 2. estado de sincronização (inclusive o cursor que pularia o histórico)
delete from public.sync_state s
 where not exists (select 1 from public.connector_credentials cc where cc.connector_id = s.connector_id);

-- 3. fila de estoque a caminho de uma plataforma que nunca foi conectada
update public.integration_outbox o
   set status = 'ignorado',
       erro = 'conector nunca foi conectado (correção 20260922_conector_fantasma)'
 where o.status in ('pendente', 'erro')
   and not exists (select 1 from public.connector_credentials cc where cc.connector_id = o.connector_id);

-- 4. saldos de hub e auditorias que nenhuma plataforma respondeu
delete from public.hub_stock_snapshots h
 where not exists (select 1 from public.connector_credentials cc where cc.connector_id = h.connector_id);
delete from public.audit_runs a
 where a.connector_id is not null
   and not exists (select 1 from public.connector_credentials cc where cc.connector_id = a.connector_id);

-- 5. De-Para de status semeado: só os oito nomes do seed antigo, que nenhuma plataforma devolve
delete from public.connector_status_map m
 where m.status_externo in ('new', 'paid', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned')
   and not exists (select 1 from public.connector_credentials cc where cc.connector_id = m.connector_id);

commit;

-- Confira: todo conector sem credencial tem que aparecer como 'desconectado', sem último sync.
select c.plataforma, c.nome, c.status, c.ultimo_sync,
       exists (select 1 from public.connector_credentials cc where cc.connector_id = c.id) as tem_credencial
  from public.connectors c
 order by c.plataforma;
