// Regras dos perfis de etiqueta por família (tenant.perfisEtiqueta).
import { PERFIL_PADRAO } from '@prodio/core/etiquetas'
import { Box, Package, Wrench } from 'lucide-react'
import type { LabelKind, LabelProfile } from '../../domain/types'

export const PREFIXO_RE = /^[A-Z]{2,3}$/

export const TIPOS_ETIQUETA: { id: LabelKind; label: string; desc: string; icon: typeof Package }[] = [
  { id: 'produto', label: 'Produto', desc: 'Vai na caixa do produto. É a etiqueta que conta produção quando é bipada.', icon: Package },
  { id: 'montagem', label: 'Montagem', desc: 'Etiqueta de processo: vai na peça durante a montagem, com a instrução impressa.', icon: Wrench },
  { id: 'caixa', label: 'Caixa', desc: 'Uma etiqueta por N unidades, para quem bipa por caixa em vez de por peça.', icon: Box },
]

export const ORDEM_TIPOS: LabelKind[] = ['produto', 'montagem', 'caixa']

/**
 * Une as famílias dos produtos com as que já têm perfil. Família nova entra como o banco já imprime para ela
 * (prefixo ET, só produto, 1 por caixa, tamanho padrão): antes entrava com prefixo vazio e travava o Salvar.
 */
export function mesclarPerfis(perfis: LabelProfile[], familias: string[]): LabelProfile[] {
  const todas = Array.from(new Set([...perfis.map((p) => p.familia), ...familias.filter((f) => f.trim())]))
  return todas.map((familia) => perfis.find((p) => p.familia === familia) ?? { familia, prefixo: PERFIL_PADRAO.prefixo, tipos: ['produto'], unidadesPorCaixa: PERFIL_PADRAO.unidadesPorCaixa })
}

export function perfilInvalido(p: LabelProfile) {
  return !PREFIXO_RE.test(p.prefixo) || !(p.unidadesPorCaixa >= 1) || !p.tipos.includes('produto')
}
