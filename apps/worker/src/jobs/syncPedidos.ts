// Cron de 5 min: para cada conector ativo, lê os pedidos novos desde sync_state.cursor, página por
// página, e grava cada página (worker_upsert_orders) e o ponto de retomada antes de ler a próxima.
// Erro de um conector não para os outros tenants.
//
// INCIDENTE DE 25/09/2026 (causa reproduzida em 26/09 contra PostgREST 12.2.3): o robô passou 24 h
// sem gravar nada — nem sucesso, nem falha — enquanto o botão "Sincronizar agora" funcionava. A listagem de conectores
// (Db.listarConectoresAtivos) pedia `tenants(slug, fuso)` em embed, o PostgREST respondia PGRST201
// e o erro era engolido aqui com um log 'sync.listar': nenhum conector era tentado, logo nenhum
// pulso e nenhum erro no cartão. O botão funcionava porque a rota dele lê o tenant numa consulta à
// parte. Hoje a listagem não usa embed, e a falha dela deixa aviso no cartão (avisoListagem.ts).
//
// O resto abaixo é PREVENÇÃO, não foi a causa: rodada que morre no meio (CPU do plano, fetch
// pendurado, exceção) não pode jogar fora o que leu nem recomeçar para sempre do mesmo ponto.
//   • cada página vai para o banco e SÓ DEPOIS o cursor dela é gravado: morrer na página 4 faz a
//     próxima rodada começar na 4 (o cursor nunca passa de um pedido não gravado);
//   • cada rodada lê no máximo `paginas_por_rodada` páginas (connectors.config, padrão pequeno):
//     rodadas curtas, e um atraso grande é drenado em várias rodadas de 5 minutos;
//   • o pulso (sync_state.last_run_at) é gravado antes de tudo: rodada que morre deixa rastro.
import type { Env } from '../env'
import { camposDoErro, type ConectorRow, type Credenciais, type Db, type PedidoParaRpc } from '../db'
import { montarConector } from '../conectores'
import { mensagemDaFalhaDeSync, redigirSegredos } from '../conectores/mensagens'
import type { Conector, Cursor, PaginaPedidos, PedidoNormalizado } from '../conectores/tipos'
import { log, mensagemErro } from '../log'
import { avisarFalhaDeListagem, limparAvisoDeListagem } from './avisoListagem'
import { desativarSeSemCredenciais } from './semCredenciais'

export interface ResumoSync {
  conectores: number
  ok: number
  falhas: number
  pedidos: number
}

export type MontarConector = (row: ConectorRow) => Promise<Conector>

export function paraRpc(p: PedidoNormalizado): PedidoParaRpc {
  const r: PedidoParaRpc = {
    external_id: p.externalId,
    external_status: p.status,
    confirmed_at: p.confirmedAt,
    updated_at_external: p.updatedAt,
    total: p.total,
    itens: p.itens.map((it) => ({ sku_externo: it.skuExterno, quantidade: it.quantidade, preco: it.preco })),
  }
  // Sem anotação, a chave nem vai: `x -> 'raw'` vira NULL de SQL e o coalesce de worker_upsert_orders
  // mantém o que já estava (um `null` de JSON sobrescreveria a anotação do webhook).
  if (p.raw !== undefined && p.raw !== null) r.raw = p.raw
  return r
}

// Páginas por rodada: PEQUENO de propósito. No plano Free cada execução do cron tem 10 ms de CPU
// (e 50 subrequisições); no pago, 30 s de CPU. Uma página do BaseLinker são 100 pedidos, então 2
// páginas por rodada de 5 minutos drenam 2.400 pedidos por hora — de sobra para colocar em dia uma
// primeira carga ou um robô que ficou parado — e cada rodada termina em poucos segundos.
// Configurável por conector em connectors.config.paginas_por_rodada (1 a PAGINAS_POR_RODADA_MAX).
export const PAGINAS_POR_RODADA_PADRAO = 2
export const PAGINAS_POR_RODADA_MAX = 20

export function paginasPorRodada(config: Record<string, unknown> | null | undefined): number {
  const n = Math.floor(Number(config?.paginas_por_rodada))
  if (!Number.isFinite(n) || n < 1) return PAGINAS_POR_RODADA_PADRAO
  return Math.min(n, PAGINAS_POR_RODADA_MAX)
}

// Adaptador sem leitura por página (Bling, Tiny) vira uma página única e final: mesmo
// comportamento de antes para eles (o Tiny já tem teto próprio por rodada, max_pedidos).
async function lerPagina(conector: Conector, cursor: Cursor | null): Promise<PaginaPedidos> {
  if (conector.pullOrdersPagina) return conector.pullOrdersPagina(cursor)
  const { pedidos, cursor: proximo } = await conector.pullOrders(cursor)
  return { pedidos, cursor: proximo, fim: true }
}

// O que sincronizarConector precisa do banco. É um subconjunto de Db de propósito: a rota
// POST /connectors/:id/sync reaproveita esta função e o teste dela monta só estes métodos.
export type DbSync = Pick<Db, 'getSyncState' | 'setSyncState' | 'upsertOrders' | 'gravarCursor' | 'marcarRodadaManual'>

export interface OpcoesSincronizacao {
  // 'cron' (padrão): o robô. É o dono de sync_state: grava o cursor a cada página e fecha a rodada
  // com worker_set_sync_state (ultimo_sync, last_ok_at, runs, status do cartão).
  // 'manual': o botão "Sincronizar agora". Lê a partir do cursor do robô e grava os pedidos, mas
  // nunca escreve em sync_state — nem cursor (rotas/sincronizar.ts, DECISÃO 1), nem pulso, nem
  // last_ok_at — e marca o resultado só no cartão (connectors). Assim um clique no botão não faz um
  // robô morto parecer vivo.
  origem?: 'cron' | 'manual'
}

export interface ResultadoSync {
  pedidos: number // pedidos lidos da plataforma nesta rodada
  gravados: number // o que worker_upsert_orders confirmou
  paginas: number
  // false: a rodada parou no teto de páginas e ainda há pedidos na fila; as próximas continuam.
  emDia: boolean
}

// Sincroniza um conector. Lança se falhar; quem chama decide o que fazer.
export async function sincronizarConector(row: ConectorRow, db: DbSync, montar: MontarConector, opcoes: OpcoesSincronizacao = {}): Promise<ResultadoSync> {
  const robo = (opcoes.origem ?? 'cron') === 'cron'
  const resultado: ResultadoSync = { pedidos: 0, gravados: 0, paginas: 0, emDia: false }
  const conector = await montar(row)
  if (!conector.capacidades.pedidos) return { ...resultado, emDia: true }
  const estado = await db.getSyncState(row.id)
  const limite = paginasPorRodada(row.config)
  let cursor: Cursor | null = estado?.cursor ?? null
  let gravado = JSON.stringify(cursor)
  while (resultado.paginas < limite) {
    const pagina = await lerPagina(conector, cursor)
    resultado.paginas++
    resultado.pedidos += pagina.pedidos.length
    if (pagina.pedidos.length) resultado.gravados += await db.upsertOrders(row.tenant_id, row.id, pagina.pedidos.map(paraRpc))
    cursor = pagina.cursor
    // A ORDEM É O QUE GARANTE QUE NADA SE PERDE: primeiro os pedidos da página no banco, depois o
    // ponto de retomada. Morrer entre um e outro só faz a próxima rodada reler esta página.
    // Ponto igual ao que já está gravado (rodada sem novidade) não custa escrita nem subrequisição.
    const novo = JSON.stringify(cursor)
    if (robo && novo !== gravado) {
      await db.gravarCursor(row.id, row.tenant_id, cursor)
      gravado = novo
    }
    if (pagina.fim) {
      resultado.emDia = true
      break
    }
  }
  if (robo) {
    // Cursor nulo: o ponto já foi gravado página a página, e mandar de novo aqui poderia recuá-lo
    // por cima de outra rodada que tenha andado mais. A RPC marca a rodada como sucesso no cartão.
    await db.setSyncState(row.id, null, true, null)
  } else {
    await db.marcarRodadaManual(row.id, row.tenant_id, true, null)
  }
  log('info', 'sync.ok', {
    connector: row.id, tenant: row.tenant_id, plataforma: row.plataforma, origem: robo ? 'cron' : 'manual',
    pedidos: resultado.pedidos, gravados: resultado.gravados, paginas: resultado.paginas, emDia: resultado.emDia,
  })
  return resultado
}

// O que o cron grava em `connectors.ultimo_erro` quando um conector falha.
//
// Antes ia aqui `e.message` cru. Isso era aceitável enquanto ninguém lia a coluna; deixou de ser
// no momento em que o cartão do conector passou a MOSTRÁ-LA (apps/web/src/pages/sistema/
// ConectorSituacao.ts) — que é justamente a correção que tirou o robô da invisibilidade. Duas
// coisas quebram com a mensagem crua:
//   • segredo: `oauthTokenBling` embute `texto.slice(0, 200)` do corpo devolvido pelo provedor, e
//     `connectors` é legível por QUALQUER membro do tenant (policy connectors_select), inclusive a
//     sessão anônima do tablet do chão de fábrica. Um client_secret ecoado pelo servidor OAuth
//     apareceria na tela da fábrica inteira;
//   • utilidade: "Bling POST /pedidos: 400 {...}" não diz ao dono o que fazer, e o objetivo do
//     cartão é exatamente esse.
// Mesmo funil das rotas /test e /sync, então: mensagemDaFalhaDeSync + redigirSegredos.
//
// As credenciais são relidas SÓ no caminho de falha (e só para redigir): custa uma chamada num
// caso que já deu errado, e evita carregá-las quando está tudo bem.
async function motivoParaOCartao(row: ConectorRow, db: Db, e: unknown): Promise<{ mensagem: string; log: string }> {
  let credenciais: Credenciais | null = null
  try {
    credenciais = await db.getCredentials(row.id)
  } catch {
    // Sem credencial em mãos ainda dá para escrever a frase: o que ela perde é só a redação do
    // texto cru, e nesse caso mensagemDaFalhaDeSync devolve uma das frases fixas.
  }
  return {
    mensagem: mensagemDaFalhaDeSync(row.plataforma, e, credenciais),
    // wrangler tail é lido em reunião e fica guardado no painel da Cloudflare: o log também filtra.
    log: redigirSegredos(mensagemErro(e), credenciais),
  }
}

// O pulso nunca derruba a rodada: sem ele o diagnóstico piora, mas os pedidos ainda podem chegar.
async function pulsar(row: ConectorRow, db: Pick<Db, 'marcarPulso'>, inicio: string): Promise<void> {
  try {
    await db.marcarPulso(row.id, row.tenant_id, inicio)
  } catch (e) {
    log('error', 'sync.pulso', { connector: row.id, tenant: row.tenant_id, erro: mensagemErro(e) })
  }
}

export async function syncPedidos(env: Env, db: Db, montar: MontarConector = (row) => montarConector(row, env, db), agora: () => number = Date.now): Promise<ResumoSync> {
  const resumo: ResumoSync = { conectores: 0, ok: 0, falhas: 0, pedidos: 0 }
  let conectores: ConectorRow[]
  try {
    conectores = await db.listarConectoresAtivos()
  } catch (e) {
    // Foi exatamente aqui que o incidente de 25/09/2026 sumiu (ver o topo). O log leva o código do
    // PostgREST (PGRST201, 42703…) e o motivo vai para o cartão de cada conector ativo, se ao menos
    // a leitura mínima de connectors responder. Workers Logs: wrangler.toml, [observability].
    log('error', 'sync.listar', { erro: mensagemErro(e), ...camposDoErro(e) })
    await avisarFalhaDeListagem(db, e)
    return resumo
  }
  for (const row of conectores) {
    resumo.conectores++
    // Contrato com a interface: sync_state.last_run_at = INÍCIO da última tentativa do robô.
    const inicio = new Date(agora()).toISOString()
    await pulsar(row, db, inicio)
    await limparAvisoDeListagem(row, db)
    try {
      resumo.pedidos += (await sincronizarConector(row, db, montar)).pedidos
      resumo.ok++
    } catch (e) {
      resumo.falhas++
      // Sem credencial nenhuma: desativa e não grava erro de sync (senão repetiria a cada 5 min).
      if (await desativarSeSemCredenciais(row, db, e)) continue
      const motivo = await motivoParaOCartao(row, db, e)
      log('error', 'sync.falha', { connector: row.id, tenant: row.tenant_id, plataforma: row.plataforma, erro: motivo.log, cartao: motivo.mensagem })
      try {
        await db.setSyncState(row.id, null, false, motivo.mensagem)
      } catch (e2) {
        log('error', 'sync.gravarErro', { connector: row.id, erro: mensagemErro(e2) })
      }
    }
    // worker_set_sync_state (sucesso ou falha) regrava last_run_at com o FIM da rodada. O contrato é
    // o início, então ele volta para o início. Resultado: last_run_at > last_ok_at quer dizer
    // exatamente "a última tentativa não terminou bem" (morreu, ou falhou e o cartão diz por quê).
    await pulsar(row, db, inicio)
  }
  log('info', 'sync.resumo', { ...resumo })
  return resumo
}
