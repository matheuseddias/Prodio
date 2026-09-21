import type { Product } from '../../domain/types'

export const uid = () => Math.random().toString(36).slice(2, 10)

export type Modo = { tipo: 'novo' } | { tipo: 'editar'; produto: Product } | { tipo: 'duplicar'; origem: Product }

export function produtoVazio(): Product {
  return { id: uid(), sku: '', nome: '', familia: '', atributos: {}, status: 'ativo', aliases: [], temFicha: false }
}
