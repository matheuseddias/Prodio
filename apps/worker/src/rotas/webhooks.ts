// POST /webhooks/bling/:connectorId — confere o HMAC do corpo cru, responde 200 na hora e processa depois
// (ctx.waitUntil). Dedupe: eventId recente em memória + idempotência do worker_upsert_orders por external_id.
import type { Env } from '../env'
import { Db, type ConectorRow } from '../db'
import { montarConector } from '../conectores'
import { ehUnsupported, type Conector } from '../conectores/tipos'
import { paraRpc } from '../jobs/syncPedidos'
import { log, mensagemErro } from '../log'
import { erro, json } from './util'

export interface EventoBling {
  eventId?: string
  event?: string
  companyId?: string | number
  data?: Record<string, unknown>
}

// Janela curta de eventIds já vistos neste isolate (o Bling reenvia em caso de timeout).
const vistos = new Set<string>()
const MAX_VISTOS = 2000
export function jaVisto(eventId: string | undefined): boolean {
  if (!eventId) return false
  if (vistos.has(eventId)) return true
  if (vistos.size >= MAX_VISTOS) vistos.delete(vistos.values().next().value as string)
  vistos.add(eventId)
  return false
}

export function idDoPedido(evento: EventoBling): string | null {
  const d = evento.data ?? {}
  const direto = d.id ?? (d.pedido as { id?: unknown } | undefined)?.id ?? d.idPedido ?? d.idPedidoVenda
  return direto === undefined || direto === null ? null : String(direto)
}

export async function processarEventoBling(row: ConectorRow, conector: Conector, evento: EventoBling, db: Db): Promise<void> {
  const tipo = String(evento.event ?? '')
  if (/pedido|order/i.test(tipo)) {
    const id = idDoPedido(evento)
    if (!id) {
      log('warn', 'webhook.bling.semId', { connector: row.id, event: tipo })
      return
    }
    const pedido = await conector.pullOrder(id)
    if (!pedido || ehUnsupported(pedido)) return
    const raw = typeof pedido.raw === 'object' && pedido.raw ? (pedido.raw as Record<string, unknown>) : {}
    pedido.raw = { ...raw, webhook: { eventId: evento.eventId, event: tipo } }
    await db.upsertOrders(row.tenant_id, row.id, [paraRpc(pedido)])
    log('info', 'webhook.bling.pedido', { connector: row.id, tenant: row.tenant_id, pedido: id, event: tipo })
    return
  }
  log('info', 'webhook.bling.ignorado', { connector: row.id, event: tipo })
}

export async function rotaWebhookBling(req: Request, env: Env, ctx: ExecutionContext, connectorId: string, db = new Db(env)): Promise<Response> {
  const corpo = await req.text()
  const row = await db.getConector(connectorId)
  if (!row || row.plataforma !== 'bling') return erro(404, 'conector não encontrado')
  let conector: Conector
  try {
    conector = await montarConector(row, env, db)
  } catch (e) {
    log('error', 'webhook.bling.conector', { connector: connectorId, erro: mensagemErro(e) })
    return erro(503, 'conector sem credenciais')
  }
  const valido = await conector.verifyWebhook(req, corpo)
  if (valido !== true) {
    log('warn', 'webhook.bling.assinatura', { connector: connectorId })
    return erro(401, 'assinatura inválida')
  }
  let evento: EventoBling
  try {
    evento = JSON.parse(corpo) as EventoBling
  } catch {
    return erro(400, 'JSON inválido')
  }
  if (jaVisto(evento.eventId)) return json({ ok: true, duplicado: true })
  ctx.waitUntil(processarEventoBling(row, conector, evento, db).catch((e) => log('error', 'webhook.bling.processar', { connector: connectorId, eventId: evento.eventId, erro: mensagemErro(e) })))
  return json({ ok: true })
}
