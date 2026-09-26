// Tamanhos de etiqueta (label_sizes, migration 20260926000700): mapeadores e leitura. As escritas (RPCs
// save_label_size e delete_label_size, só admin) estão em escritasSistema.ts. O desenho da etiqueta em cada
// tamanho é do core (etiquetaLayout.ts).
import { DPIS } from '@prodio/core/etiquetaTamanhos'
import type { DpiImpressora, LabelSize } from '../domain/types'
import { num } from './mapeadoresCadastros'
import { ehUuid } from './repo'
import type { Ctx } from './supabaseCtx'

export interface LabelSizeRow {
  id: string
  nome: string
  largura_mm: number | string
  altura_mm: number | string
  margem_mm: number | string
  dpi: number
  orientacao: string
  colunas: number
  espaco_colunas_mm: number | string
  padrao: boolean
  preset: string | null
}

export function tamanhoDoBanco(r: LabelSizeRow): LabelSize {
  const dpi = num(r.dpi, 203) as DpiImpressora
  return {
    id: r.id,
    nome: String(r.nome ?? ''),
    larguraMm: num(r.largura_mm, 60),
    alturaMm: num(r.altura_mm, 40),
    margemMm: num(r.margem_mm, 2),
    dpi: DPIS.includes(dpi) ? dpi : 203,
    orientacao: r.orientacao === 'girada' ? 'girada' : 'normal',
    colunas: Math.max(1, Math.round(num(r.colunas, 1))),
    espacoColunasMm: num(r.espaco_colunas_mm, 0),
    padrao: !!r.padrao,
    preset: r.preset ?? undefined,
  }
}

/** Corpo da RPC save_label_size. Id que não é do banco (tamanho novo, criado na tela) vai sem id: a RPC cria. */
export function tamanhoParaBanco(t: LabelSize): Record<string, unknown> {
  return {
    ...(ehUuid(t.id) ? { id: t.id } : {}),
    nome: t.nome.trim(),
    largura_mm: t.larguraMm,
    altura_mm: t.alturaMm,
    margem_mm: t.margemMm,
    dpi: t.dpi,
    orientacao: t.orientacao,
    colunas: t.colunas,
    espaco_colunas_mm: t.espacoColunasMm,
    padrao: t.padrao,
  }
}

/**
 * Tamanhos da empresa, do mais estreito para o mais largo. Banco sem a tabela (prévia da web contra o banco de
 * produção antes de main publicar a migration): lista vazia, e as telas usam os tamanhos de fábrica do core
 * sem deixar cadastrar.
 */
export async function lerLabelSizes(ctx: Ctx): Promise<LabelSize[]> {
  const res = await ctx.sb
    .from('label_sizes')
    .select('id,nome,largura_mm,altura_mm,margem_mm,dpi,orientacao,colunas,espaco_colunas_mm,padrao,preset')
    .eq('tenant_id', ctx.tenantId())
    .order('largura_mm')
    .order('altura_mm')
    .order('id')
  if (res.error) {
    console.warn('[prodio] tamanhos de etiqueta indisponíveis (migration pendente?):', res.error.message)
    return []
  }
  return ((res.data ?? []) as LabelSizeRow[]).map(tamanhoDoBanco)
}
