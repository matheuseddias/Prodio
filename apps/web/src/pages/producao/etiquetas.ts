// Helpers da tela de Etiquetas: perfis por família, tamanhos e tipos.
import type { Label, LabelKind, LabelProfile, Product } from '../../domain/types'

export type Tamanho = '50x30' | '60x40' | '100x50'
export const TAMANHOS: Record<Tamanho, { w: number; h: number; qr: number; fonte: number }> = {
  '50x30': { w: 50, h: 30, qr: 22, fonte: 8 },
  '60x40': { w: 60, h: 40, qr: 30, fonte: 9 },
  '100x50': { w: 100, h: 50, qr: 40, fonte: 11 },
}

export const ORDEM_TIPOS: LabelKind[] = ['produto', 'montagem', 'caixa']
export const NOME_TIPO: Record<LabelKind, string> = { produto: 'Produto', montagem: 'Montagem', caixa: 'Caixa' }
export const DESCRICAO_TIPO: Record<LabelKind, string> = {
  produto: 'Vai na peça pronta. QR do serial único; é a que a linha bipa.',
  montagem: 'Etiqueta de processo: acompanha a peça durante a montagem com o mesmo serial (sufixo -M) e a instrução do perfil.',
  caixa: 'Uma por caixa fechada, com serial próprio e a quantidade que contém.',
}

// Família sem perfil cadastrado cai neste padrão (só produto).
export const PERFIL_PADRAO: Omit<LabelProfile, 'familia'> = { prefixo: 'PR', tipos: ['produto'], unidadesPorCaixa: 6 }

export function perfilDe(perfis: LabelProfile[], p?: Product): LabelProfile & { padrao: boolean } {
  const achado = p && perfis.find((x) => x.familia === p.familia)
  if (achado) return { ...achado, padrao: false }
  return { ...PERFIL_PADRAO, familia: p?.familia ?? '', padrao: true }
}

export const resumoPerfis = (perfis: LabelProfile[]) =>
  perfis.map((x) => `${x.familia} → ${x.tipos.map((t) => NOME_TIPO[t]).join(' + ')}`).join(' · ')

/** Pedido de impressão de um SKU: unidades (produto/montagem) e caixas, com os tipos ativos nesta impressão. */
export interface Req {
  productId: string
  unidades: number
  caixas: number
  tipos: LabelKind[]
}

export interface ItemPreview {
  label: Label
  p: Product
  perfil: LabelProfile
  n: number
  total: number
}

export const caixasPara = (unidades: number, porCaixa: number) => (unidades > 0 ? Math.ceil(unidades / Math.max(1, porCaixa)) : 0)

/** Quantas etiquetas físicas saem para um pedido. */
export const etiquetasDoPedido = (r: Req) =>
  (r.tipos.includes('produto') ? r.unidades : 0) + (r.tipos.includes('montagem') ? r.unidades : 0) + (r.tipos.includes('caixa') ? r.caixas : 0)
