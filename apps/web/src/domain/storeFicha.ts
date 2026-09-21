// Explosão de ficha multinível e custo de ficha (versão em memória usada pela interface).
import type { Bom, Material } from './types'

export function explodeBom(productId: string, qtd: number, boms: Bom[], visitados: Set<string> = new Set()): Record<string, number> {
  const out: Record<string, number> = {}
  if (visitados.has(productId)) return out
  const bom = boms.find((b) => b.productId === productId && b.ativa)
  if (!bom) return out
  const next = new Set(visitados)
  next.add(productId)
  for (const l of bom.linhas) {
    const consumo = l.consumo * (1 + l.perdaPct / 100) * qtd
    if (l.tipo === 'insumo' && l.materialId) {
      out[l.materialId] = (out[l.materialId] ?? 0) + consumo
    } else if (l.tipo === 'produto' && l.componentId) {
      const sub = explodeBom(l.componentId, consumo, boms, next)
      for (const [k, v] of Object.entries(sub)) out[k] = (out[k] ?? 0) + v
    }
  }
  return out
}

export function custoFicha(productId: string, boms: Bom[], materials: Material[]): number | undefined {
  const bom = boms.find((b) => b.productId === productId && b.ativa)
  if (!bom) return undefined
  const exp = explodeBom(productId, 1, boms)
  let total = 0
  for (const [mid, q] of Object.entries(exp)) {
    const m = materials.find((x) => x.id === mid)
    if (m) total += q * m.custoMedio
  }
  return Math.round(total * 100) / 100
}
