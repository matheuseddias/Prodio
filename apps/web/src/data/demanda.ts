// Demanda dos pedidos: só agregados do banco (RPCs demand_summary e sales_by_day, migration
// 20260926000500_demanda.sql). Os pedidos em si nunca vêm para o navegador — são dezenas de milhares
// na carga de 90 dias e o PostgREST corta leitura em 1.000 linhas sem avisar.
import { demandaVazia, janelaDaDemanda } from '@prodio/core/planejamento'
import type { DemandaResumo, HistoricoVendasDia } from '../domain/types'
import { checar } from './erros'
import { num, strOpt } from './mapeadoresCadastros'
import type { Ctx } from './supabaseCtx'

// --- demand_summary -----------------------------------------------------------------------------
interface ProdutoJson {
  product_id?: string
  vendido?: number | string
  carteira?: number | string
  ultimo_pedido?: string | null
}
interface SkuJson {
  sku?: string | null
  unidades?: number | string
  pedidos?: number | string
}
interface HubJson {
  product_id?: string
  saldo?: number | string
  capturado_em?: string | null
}
export interface DemandaJson {
  dias?: number | string
  desde?: string | null
  gerado_em?: string | null
  ultimo_pedido?: string | null
  pedidos?: number | string
  pedidos_24h?: number | string
  unidades?: number | string
  sem_produto?: { linhas?: number | string; unidades?: number | string; skus?: number | string } | null
  skus_sem_produto?: SkuJson[] | null
  produtos?: ProdutoJson[] | null
  hub?: HubJson[] | null
}

const lista = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : [])

/** jsonb da RPC → domínio. Nada aqui lança: campo torto vira zero ou some. */
export function demandaDoBanco(j: DemandaJson | null | undefined): DemandaResumo {
  if (!j || typeof j !== 'object') return demandaVazia(false)
  return {
    disponivel: true,
    exemplo: false,
    dias: janelaDaDemanda(num(j.dias, 14)),
    desde: strOpt(j.desde),
    geradoEm: strOpt(j.gerado_em),
    ultimoPedido: strOpt(j.ultimo_pedido),
    pedidos: num(j.pedidos),
    pedidos24h: num(j.pedidos_24h),
    unidades: num(j.unidades),
    semProduto: { linhas: num(j.sem_produto?.linhas), unidades: num(j.sem_produto?.unidades), skus: num(j.sem_produto?.skus) },
    skusSemProduto: lista(j.skus_sem_produto).map((s) => ({ sku: String(s.sku ?? ''), unidades: num(s.unidades), pedidos: num(s.pedidos) })),
    produtos: lista(j.produtos)
      .filter((p) => !!p.product_id)
      .map((p) => ({ productId: String(p.product_id), vendido: num(p.vendido), carteira: num(p.carteira), ultimoPedido: strOpt(p.ultimo_pedido) })),
    hub: lista(j.hub)
      .filter((h) => !!h.product_id)
      .map((h) => ({ productId: String(h.product_id), saldo: num(h.saldo), capturadoEm: strOpt(h.capturado_em) })),
  }
}

/**
 * Resumo da demanda na janela do tenant. Falha aqui não derruba a carga: vira `disponivel: false` e
 * as telas dizem "não consegui ler a demanda" em vez de "nada a comprar".
 */
export async function lerDemanda(ctx: Ctx): Promise<DemandaResumo> {
  try {
    const res = await ctx.sb.rpc('demand_summary', { p_tenant_id: ctx.tenantId(), p_dias: null })
    return demandaDoBanco(checar(res) as DemandaJson)
  } catch (e) {
    console.warn('[prodio] demanda indisponível:', (e as Error)?.message ?? e)
    return demandaVazia(false)
  }
}

// --- sales_by_day -------------------------------------------------------------------------------
export interface VendaDiaRow {
  dia: string
  pedidos: number | string
  unidades: number | string
}

/** Uma linha por dia (o banco já completa os dias sem pedido com zero), do mais antigo ao mais recente. */
export function serieVendasDaRpc(rows: VendaDiaRow[] | null | undefined): HistoricoVendasDia[] {
  return lista(rows)
    .map((r) => ({ dia: String(r.dia ?? '').slice(0, 10), unidades: num(r.unidades) }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.dia))
    .sort((a, b) => a.dia.localeCompare(b.dia))
}

/** Unidades vendidas por dia de calendário (fuso do tenant), pela mesma regra da demanda. */
export async function lerVendasPorDia(ctx: Ctx, dias: number): Promise<HistoricoVendasDia[]> {
  const res = await ctx.sb.rpc('sales_by_day', { p_tenant_id: ctx.tenantId(), p_dias: dias })
  return serieVendasDaRpc(checar(res) as VendaDiaRow[])
}
