// Carregamento do Snapshot inteiro e de fatias específicas a partir das leituras.
import * as L from './leituras'
import type { Parte, Patch, Snapshot } from './repo'
import type { Ctx } from './supabaseCtx'

export async function carregarTudo(ctx: Ctx): Promise<Snapshot> {
  // Tenant primeiro: o dia de produção e os perfis dependem dele. Membros antes do ledger (nomes).
  const tenant = await L.lerTenant(ctx)
  const base = { ...ctx.estado(), tenant }
  const ctx2: Ctx = { ...ctx, estado: () => base }
  const [locations, members] = await Promise.all([L.lerLocations(ctx2), L.lerMembers(ctx2)])
  const [materials, suppliers, boms, precos, dailyPlan, historico, labels, scans, stockMoves, purchaseOrders, nfes, outbox, devices, notifications, channels, operators] = await Promise.all([
    L.lerMaterials(ctx2),
    L.lerSuppliers(ctx2),
    L.lerBoms(ctx2),
    L.tolerante(L.lerPrecos(ctx2), {}),
    L.lerDailyPlan(ctx2),
    L.lerHistorico(ctx2),
    L.lerLabels(ctx2),
    L.lerScans(ctx2),
    L.lerStockMoves(ctx2),
    L.tolerante(L.lerPurchaseOrders(ctx2), []),
    L.tolerante(L.lerNfes(ctx2), []),
    L.tolerante(L.lerOutbox(ctx2), []),
    L.lerDevices(ctx2),
    L.tolerante(L.lerNotifications(ctx2), []),
    L.tolerante(L.lerChannels(ctx2), []),
    L.lerOperators(ctx2),
  ])
  const pendentes = contarPendentes(outbox)
  const [products, connectors] = await Promise.all([L.lerProducts(ctx2, { boms, materials, precos }), L.tolerante(L.lerConnectors(ctx2, pendentes), [])])
  return { tenant, products, materials, suppliers, boms, dailyPlan, historico, labels, scans, stockMoves, purchaseOrders, nfes, connectors, outbox, members, devices, notifications, channels, locations, operators }
}

function contarPendentes(outbox: Snapshot['outbox']): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of outbox) if (o.status === 'pendente') out[o.connectorId] = (out[o.connectorId] ?? 0) + 1
  return out
}

export async function carregarFatias(ctx: Ctx, partes: Parte[]): Promise<Patch> {
  const set = new Set<Parte>(partes)
  const patch: Patch = {}
  const atual = ctx.estado()
  const tarefas: Promise<void>[] = []
  const fazer = <K extends Parte>(k: K, p: () => Promise<Snapshot[K]>) => {
    if (set.has(k)) tarefas.push(p().then((v) => void (patch[k] = v)))
  }
  fazer('tenant', () => L.lerTenant(ctx))
  fazer('locations', () => L.lerLocations(ctx))
  fazer('members', () => L.lerMembers(ctx))
  fazer('materials', () => L.lerMaterials(ctx))
  fazer('suppliers', () => L.lerSuppliers(ctx))
  fazer('boms', () => L.lerBoms(ctx))
  fazer('dailyPlan', () => L.lerDailyPlan(ctx))
  fazer('historico', () => L.lerHistorico(ctx))
  fazer('labels', () => L.lerLabels(ctx))
  fazer('scans', () => L.lerScans(ctx))
  fazer('stockMoves', () => L.lerStockMoves(ctx))
  fazer('purchaseOrders', () => L.lerPurchaseOrders(ctx))
  fazer('nfes', () => L.lerNfes(ctx))
  fazer('outbox', () => L.lerOutbox(ctx))
  fazer('devices', () => L.lerDevices(ctx))
  fazer('notifications', () => L.lerNotifications(ctx))
  fazer('channels', () => L.lerChannels(ctx))
  fazer('operators', () => L.lerOperators(ctx))
  await Promise.all(tarefas)
  if (set.has('products') || set.has('boms')) {
    const boms = patch.boms ?? (set.has('boms') ? [] : atual.boms)
    const materials = patch.materials ?? atual.materials
    const precos = await L.tolerante(L.lerPrecos(ctx), {})
    patch.products = await L.lerProducts(ctx, { boms, materials, precos })
  }
  if (set.has('connectors')) {
    const outbox = patch.outbox ?? atual.outbox
    patch.connectors = await L.tolerante(L.lerConnectors(ctx, contarPendentes(outbox)), [])
  }
  return patch
}
