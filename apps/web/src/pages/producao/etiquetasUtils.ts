// Helpers da tela de Etiquetas: perfis por família e tipos. Os tamanhos são cadastrados pela empresa
// (Configurações › Etiquetas; core etiquetaTamanhos.ts) e o desenho de cada etiqueta sai do core (etiquetaLayout.ts).
import { PERFIL_PADRAO as PADRAO_DO_BANCO } from '@prodio/core/etiquetas'
import type { Label, LabelKind, LabelProfile, Product } from '../../domain/types'

export const ORDEM_TIPOS: LabelKind[] = ['produto', 'montagem', 'caixa']
export const NOME_TIPO: Record<LabelKind, string> = { produto: 'Produto', montagem: 'Montagem', caixa: 'Caixa' }
export const DESCRICAO_TIPO: Record<LabelKind, string> = {
  produto: 'Vai na peça pronta. QR do serial único; é a que a linha bipa.',
  montagem: 'Etiqueta de processo: acompanha a peça durante a montagem com o mesmo serial (sufixo -M) e a instrução do perfil.',
  caixa: 'Uma por caixa fechada, com serial próprio e a quantidade que contém.',
}

// Família sem perfil cadastrado: o que a RPC reserve_label_batch grava (prefixo ET, 1 por caixa, só produto), no
// tamanho padrão da empresa. Antes a tela dizia PR e 6 por caixa enquanto o banco imprimia ET e 1.
export const PERFIL_PADRAO: Omit<LabelProfile, 'familia'> = { prefixo: PADRAO_DO_BANCO.prefixo, tipos: ['produto'], unidadesPorCaixa: PADRAO_DO_BANCO.unidadesPorCaixa, tamanhoId: null }

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
