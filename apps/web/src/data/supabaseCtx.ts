// Contexto compartilhado pelos módulos do SupabaseRepo: cliente, tenant ativo, estado atual do
// store (para resolver ids por serial/chave) e mapas auxiliares preenchidos nas leituras.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Location } from '../domain/types'
import { checar } from './erros'
import type { Snapshot } from './repo'

export interface Mapas {
  /** serial da etiqueta → id em labels */
  labelIds: Map<string, string>
  /** chave da NF-e → id em nfe_inbound */
  nfeIds: Map<string, string>
  /** `${chave}:${nItem}` → id em nfe_inbound_items */
  nfeItemIds: Map<string, string>
  /** user_id → nome (memberships) para o "por" do ledger e dos bipes de escritório */
  nomes: Record<string, string>
}

export interface Ctx {
  sb: SupabaseClient
  tenantId: () => string
  estado: () => Snapshot
  mapas: Mapas
}

export function novosMapas(): Mapas {
  return { labelIds: new Map(), nfeIds: new Map(), nfeItemIds: new Map(), nomes: {} }
}

/** Chama uma RPC e devolve o resultado com erro traduzido. */
export async function rpc<T = unknown>(ctx: Ctx, nome: string, args: Record<string, unknown>): Promise<T> {
  const res = await ctx.sb.rpc(nome, args)
  return checar(res) as T
}

/** Local padrão do tenant: a primeira fábrica cadastrada (a RPC usa o mesmo critério). */
export function localPadrao(ctx: Ctx): Location | undefined {
  const locs = ctx.estado().locations
  return locs.find((l) => l.tipo === 'fabrica') ?? locs[0]
}

export function localPadraoId(ctx: Ctx): string {
  const l = localPadrao(ctx)
  if (!l) throw new Error('Cadastre um local de estoque antes de continuar.')
  return l.id
}

/** Dia de produção pelo relógio local e pela hora de virada do tenant (bipe às 02:00 conta para o dia anterior). */
export function diaProducao(horaVirada: string, agora = new Date()): string {
  const [h, m] = horaVirada.split(':').map((x) => Number(x) || 0)
  const d = new Date(agora.getTime() - (h * 60 + m) * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function diaAtual(ctx: Ctx): string {
  return diaProducao(ctx.estado().tenant.horaVirada || '05:00')
}
