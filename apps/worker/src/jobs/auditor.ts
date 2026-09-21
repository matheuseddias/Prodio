// Cron diário: lê o saldo de acabado no hub para todos os produtos, grava hub_stock_snapshots e compara
// com o esperado (snapshot anterior + bipes do dia). Divergências vão para audit_runs via worker_record_audit.
import type { Env } from '../env'
import type { ConectorRow, Db } from '../db'
import { montarConector } from '../conectores'
import { ehUnsupported, type SaldoHub } from '../conectores/tipos'
import { log, mensagemErro } from '../log'
import type { MontarConector } from './syncPedidos'

export interface Divergencia {
  sku: string
  product_id: string
  saldo_hub: number
  saldo_anterior: number | null
  bipado_hoje: number
  esperado: number | null
  diferenca: number | null
}

export interface ResumoAuditor {
  conectores: number
  produtos: number
  divergencias: number
  falhas: number
}

// Data (AAAA-MM-DD) no fuso do tenant. A hora_virada fica com o banco (competência dos bipes).
export function diaNoFuso(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
}

export function compararSaldos(
  produtos: { id: string; sku: string }[],
  saldos: SaldoHub[],
  anteriores: Map<string, number>,
  bipados: Map<string, number>,
): Divergencia[] {
  const porSku = new Map(saldos.map((s) => [s.sku, s.saldo]))
  const saida: Divergencia[] = []
  for (const p of produtos) {
    const hub = porSku.get(p.sku)
    if (hub === undefined) continue // produto não existe no hub: não é divergência de saldo
    const anterior = anteriores.get(p.id) ?? null
    const bipado = bipados.get(p.id) ?? 0
    const esperado = anterior === null ? null : anterior + bipado
    const diferenca = esperado === null ? null : Math.round((hub - esperado) * 10000) / 10000
    if (diferenca !== null && diferenca !== 0) saida.push({ sku: p.sku, product_id: p.id, saldo_hub: hub, saldo_anterior: anterior, bipado_hoje: bipado, esperado, diferenca })
  }
  return saida
}

export async function auditarConector(row: ConectorRow, db: Db, montar: MontarConector, agora = new Date()): Promise<{ produtos: number; divergencias: number }> {
  const conector = await montar(row)
  if (!conector.capacidades.pushEstoque && !conector.capacidades.catalogo) return { produtos: 0, divergencias: 0 }
  const produtos = await db.listarProdutos(row.tenant_id)
  if (produtos.length === 0) return { produtos: 0, divergencias: 0 }
  const saldos = await conector.pullFinishedStock(produtos.map((p) => p.sku))
  if (ehUnsupported(saldos)) return { produtos: 0, divergencias: 0 }
  const anteriores = new Map((await db.snapshotsHub(row.tenant_id, row.id)).map((s) => [s.product_id, s.saldo_hub]))
  const dia = diaNoFuso(agora, row.tenants?.fuso ?? 'America/Sao_Paulo')
  const bipados = await db.bipadoPorProduto(row.tenant_id, dia)
  const divergencias = compararSaldos(produtos, saldos, anteriores, bipados)
  await db.upsertHubStock(row.tenant_id, row.id, saldos.map((s) => ({ sku: s.sku, saldo: s.saldo })))
  await db.recordAudit(row.tenant_id, row.id, divergencias)
  log(divergencias.length ? 'warn' : 'info', 'auditor.conector', { connector: row.id, tenant: row.tenant_id, dia, produtos: saldos.length, divergencias: divergencias.length })
  return { produtos: saldos.length, divergencias: divergencias.length }
}

export async function auditor(env: Env, db: Db, montar: MontarConector = (row) => montarConector(row, env, db)): Promise<ResumoAuditor> {
  const resumo: ResumoAuditor = { conectores: 0, produtos: 0, divergencias: 0, falhas: 0 }
  let conectores: ConectorRow[]
  try {
    conectores = await db.listarConectoresAtivos()
  } catch (e) {
    log('error', 'auditor.listar', { erro: mensagemErro(e) })
    return resumo
  }
  for (const row of conectores) {
    resumo.conectores++
    try {
      const r = await auditarConector(row, db, montar)
      resumo.produtos += r.produtos
      resumo.divergencias += r.divergencias
    } catch (e) {
      resumo.falhas++
      log('error', 'auditor.falha', { connector: row.id, tenant: row.tenant_id, erro: mensagemErro(e) })
    }
  }
  log('info', 'auditor.resumo', { ...resumo })
  return resumo
}
