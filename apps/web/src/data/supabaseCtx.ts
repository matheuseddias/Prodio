// Contexto compartilhado pelos módulos do SupabaseRepo: cliente, tenant ativo, estado atual do
// store (para resolver ids por serial/chave) e mapas auxiliares preenchidos nas leituras.
import type { SupabaseClient } from '@supabase/supabase-js'
import { diaProducao } from '../domain/format'
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

/** O dia de produção vive em domain/format: leitura e tela têm de usar exatamente o mesmo cálculo. */
export function diaAtual(ctx: Ctx): string {
  return diaProducao(ctx.estado().tenant.horaVirada)
}
