// Escritas de produção e estoque: tudo por RPC (docs/schema.md, seções 0004 e 0005).
import type { Bom, Label, StockMove } from '../domain/types'
import { carregarFatias } from './fatias'
import { bomLinhasParaBanco, dailyPlanParaBanco, num } from './mapeadores'
import type { OpcoesBipe, Patch, RegistroBipe, Retorno } from './repo'
import { diaAtual, localPadraoId, rpc, type Ctx } from './supabaseCtx'

interface RegisterScanJson {
  ok: boolean
  motivo?: string | null
  scan_id?: string | null
  product?: { id: string } | null
  quantidade?: number | string | null
  bipado_hoje?: number | string | null
  projetado_hoje?: number | string | null
}

/** Só a RPC; a atualização das fatias fica a cargo do store (drena a fila e recarrega uma vez). */
export async function registerScan(ctx: Ctx, serial: string, opts: OpcoesBipe): Promise<Retorno<RegistroBipe>> {
  const r = await rpc<RegisterScanJson>(ctx, 'register_scan', { p_tenant_id: ctx.tenantId(), p_serial: serial, p_client_event_id: opts.clientEventId, p_stage_codigo: 'final' })
  const motivo = r.motivo === 'serial_desconhecido' ? 'desconhecida' : r.motivo ?? undefined
  return {
    valor: { ok: !!r.ok, motivo, scanId: r.scan_id ?? undefined, productId: r.product?.id, quantidade: r.quantidade == null ? undefined : num(r.quantidade), bipadoHoje: r.bipado_hoje == null ? undefined : num(r.bipado_hoje), projetadoHoje: r.projetado_hoje == null ? undefined : num(r.projetado_hoje) },
    patch: {},
  }
}

export async function reverseScan(ctx: Ctx, scanId: string): Promise<Patch> {
  await rpc(ctx, 'reverse_scan', { p_tenant_id: ctx.tenantId(), p_scan_id: scanId })
  return carregarFatias(ctx, ['scans', 'dailyPlan', 'materials', 'stockMoves', 'outbox'])
}

export async function setProjetado(ctx: Ctx, productId: string, projetado: number): Promise<Patch> {
  const atual = ctx.estado().dailyPlan.find((l) => l.productId === productId) ?? { productId, demandaDia: 0, projetado, impresso: 0, bipado: 0, carteira: 0, saldoHub: 0 }
  await rpc(ctx, 'set_daily_plan', { p_tenant_id: ctx.tenantId(), p_dia: diaAtual(ctx), p_location_id: localPadraoId(ctx), p_linhas: [dailyPlanParaBanco({ ...atual, projetado })] })
  return carregarFatias(ctx, ['dailyPlan'])
}

interface LabelJson {
  label_id: string
  serial: string
  dia: string
  seq: number
}
export async function printLabels(ctx: Ctx, productId: string, qtd: number, tipo: 'unidade' | 'caixa'): Promise<Retorno<Label[]>> {
  const rows = (await rpc<LabelJson[]>(ctx, 'reserve_label_batch', { p_tenant_id: ctx.tenantId(), p_product_id: productId, p_quantidade: qtd, p_tipo: tipo, p_location_id: null })) ?? []
  for (const r of rows) ctx.mapas.labelIds.set(r.serial, r.label_id)
  const perfil = ctx.estado().tenant.perfisEtiqueta.find((p) => p.familia === ctx.estado().products.find((x) => x.id === productId)?.familia)
  const valor: Label[] = rows.map((r) => ({ serial: r.serial, productId, tipo, quantidade: tipo === 'caixa' ? perfil?.unidadesPorCaixa ?? 1 : 1, status: 'impressa', dia: r.dia, seq: r.seq }))
  const patch = await carregarFatias(ctx, ['labels', 'dailyPlan'])
  return { valor, patch }
}

export async function annulLabel(ctx: Ctx, serial: string): Promise<Patch> {
  let id = ctx.mapas.labelIds.get(serial)
  if (!id) {
    const res = await ctx.sb.from('labels').select('id').eq('tenant_id', ctx.tenantId()).eq('serial', serial).maybeSingle()
    id = (res.data as { id: string } | null)?.id
  }
  if (!id) throw new Error('Etiqueta não encontrada.')
  await rpc(ctx, 'annul_label', { p_tenant_id: ctx.tenantId(), p_label_id: id })
  return carregarFatias(ctx, ['labels', 'dailyPlan'])
}

export async function addStockMove(ctx: Ctx, m: Omit<StockMove, 'id' | 'em'>, opts: { id: string }): Promise<Patch> {
  const tenant = ctx.tenantId()
  if (m.tipo === 'estorno') {
    // A página manda o movimento contrário; achamos o original mais recente do insumo e estornamos por RPC.
    const orig = ctx.estado().stockMoves.find((x) => x.materialId === m.materialId && x.tipo !== 'estorno' && Math.abs(x.delta + m.delta) < 1e-6)
    if (!orig) throw new Error('Movimento original não encontrado para estornar.')
    await rpc(ctx, 'reverse_stock_move', { p_tenant_id: tenant, p_move_id: orig.id, p_motivo: m.motivo ?? null })
  } else {
    const tipo = m.tipo === 'baixa_producao' || m.tipo === 'entrada_nfe' ? 'ajuste' : m.tipo
    await rpc(ctx, 'post_stock_move', {
      p_tenant_id: tenant,
      p_material_id: m.materialId,
      p_location_id: localPadraoId(ctx),
      p_move_type: tipo,
      p_delta: m.delta,
      p_custo_unit: m.custoUnit ?? null,
      p_motivo: [m.motivo, m.ref].filter(Boolean).join(' · ') || null,
      p_ref_type: null,
      p_ref_id: null,
      p_idempotency_key: `web:${opts.id}`,
    })
  }
  return carregarFatias(ctx, ['stockMoves', 'materials'])
}

export async function saveBom(ctx: Ctx, b: Bom): Promise<Patch> {
  if (b.linhas.length === 0) throw new Error('A ficha precisa de ao menos uma linha para ser ativada.')
  await rpc(ctx, 'activate_bom', { p_tenant_id: ctx.tenantId(), p_product_id: b.productId, p_linhas: bomLinhasParaBanco(b) })
  return carregarFatias(ctx, ['boms', 'products'])
}
