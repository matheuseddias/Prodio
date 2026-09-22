// Cron de 5 min: para cada conector ativo, pullOrders incremental por sync_state.cursor,
// worker_upsert_orders e worker_set_sync_state. Erro de um conector não para os outros tenants.
import type { Env } from '../env'
import type { ConectorRow, Credenciais, Db, PedidoParaRpc } from '../db'
import { montarConector } from '../conectores'
import { mensagemDaFalhaDeSync, redigirSegredos } from '../conectores/mensagens'
import type { Conector, PedidoNormalizado } from '../conectores/tipos'
import { log, mensagemErro } from '../log'
import { desativarSeSemCredenciais } from './semCredenciais'

export interface ResumoSync {
  conectores: number
  ok: number
  falhas: number
  pedidos: number
}

export type MontarConector = (row: ConectorRow) => Promise<Conector>

export function paraRpc(p: PedidoNormalizado): PedidoParaRpc {
  return {
    external_id: p.externalId,
    external_status: p.status,
    confirmed_at: p.confirmedAt,
    updated_at_external: p.updatedAt,
    total: p.total,
    raw: p.raw ?? null,
    itens: p.itens.map((it) => ({ sku_externo: it.skuExterno, quantidade: it.quantidade, preco: it.preco })),
  }
}

// O que sincronizarConector precisa do banco. É um subconjunto de Db de propósito: a rota
// POST /connectors/:id/sync reaproveita esta função e o teste dela monta só estes três métodos.
export type DbSync = Pick<Db, 'getSyncState' | 'setSyncState' | 'upsertOrders'>

export interface OpcoesSincronizacao {
  // Gravar o cursor que a plataforma devolveu. O cron grava (é o dono do cursor); a sincronização
  // manual do botão passa false e deixa o cursor onde está — ver rotas/sincronizar.ts, DECISÃO 1.
  avancarCursor?: boolean
}

// Sincroniza um conector. Lança se falhar; quem chama decide o que fazer.
export async function sincronizarConector(row: ConectorRow, db: DbSync, montar: MontarConector, opcoes: OpcoesSincronizacao = {}): Promise<number> {
  const avancar = opcoes.avancarCursor !== false
  const conector = await montar(row)
  if (!conector.capacidades.pedidos) return 0
  const estado = await db.getSyncState(row.id)
  const { pedidos, cursor } = await conector.pullOrders(estado?.cursor ?? null)
  const n = pedidos.length ? await db.upsertOrders(row.tenant_id, row.id, pedidos.map(paraRpc)) : 0
  // Cursor nulo mantém o anterior (worker_set_sync_state faz coalesce) e ainda assim marca a
  // rodada: ultimo_sync, last_ok_at e o status 'conectado' do cartão são atualizados do mesmo jeito.
  await db.setSyncState(row.id, avancar ? cursor : null, true, null)
  log('info', 'sync.ok', { connector: row.id, tenant: row.tenant_id, plataforma: row.plataforma, pedidos: pedidos.length, gravados: n, cursor: avancar ? 'avancado' : 'mantido' })
  return pedidos.length
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

export async function syncPedidos(env: Env, db: Db, montar: MontarConector = (row) => montarConector(row, env, db)): Promise<ResumoSync> {
  const resumo: ResumoSync = { conectores: 0, ok: 0, falhas: 0, pedidos: 0 }
  let conectores: ConectorRow[]
  try {
    conectores = await db.listarConectoresAtivos()
  } catch (e) {
    log('error', 'sync.listar', { erro: mensagemErro(e) })
    return resumo
  }
  for (const row of conectores) {
    resumo.conectores++
    try {
      resumo.pedidos += await sincronizarConector(row, db, montar)
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
  }
  log('info', 'sync.resumo', { ...resumo })
  return resumo
}
