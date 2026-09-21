// Cron de 5 min: para cada conector ativo, pullOrders incremental por sync_state.cursor,
// worker_upsert_orders e worker_set_sync_state. Erro de um conector não para os outros tenants.
import type { Env } from '../env'
import type { ConectorRow, Db, PedidoParaRpc } from '../db'
import { montarConector } from '../conectores'
import type { Conector, PedidoNormalizado } from '../conectores/tipos'
import { log, mensagemErro } from '../log'

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

// Sincroniza um conector. Lança se falhar; quem chama decide o que fazer.
export async function sincronizarConector(row: ConectorRow, db: Db, montar: MontarConector): Promise<number> {
  const conector = await montar(row)
  if (!conector.capacidades.pedidos) return 0
  const estado = await db.getSyncState(row.id)
  const { pedidos, cursor } = await conector.pullOrders(estado?.cursor ?? null)
  const n = pedidos.length ? await db.upsertOrders(row.tenant_id, row.id, pedidos.map(paraRpc)) : 0
  await db.setSyncState(row.id, cursor, true, null)
  log('info', 'sync.ok', { connector: row.id, tenant: row.tenant_id, plataforma: row.plataforma, pedidos: pedidos.length, gravados: n })
  return pedidos.length
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
      const erro = mensagemErro(e)
      log('error', 'sync.falha', { connector: row.id, tenant: row.tenant_id, plataforma: row.plataforma, erro })
      try {
        await db.setSyncState(row.id, null, false, erro)
      } catch (e2) {
        log('error', 'sync.gravarErro', { connector: row.id, erro: mensagemErro(e2) })
      }
    }
  }
  log('info', 'sync.resumo', { ...resumo })
  return resumo
}
