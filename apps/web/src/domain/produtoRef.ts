// Referência de produto pronta para a tela.
//
// Etiquetas impressas, bipes e linhas do plano guardam só o id do produto, e esse id pode não estar
// mais na lista carregada: produto com exclusão lógica (a leitura filtra `deleted_at is null`, a de
// etiquetas não), produto criado em outro dispositivo, snapshot pela metade. Antes disso virava
// `product(pid)!` seguido de `.nome` — e a tela inteira caía. A decisão do produto é: a linha
// continua aparecendo (a etiqueta foi impressa, o bipe aconteceu; sumir com o registro é pior),
// identificada como "Produto removido" com o começo do id para o suporte achar.
import type { Product } from './types'

export const ROTULO_REMOVIDO = 'Produto removido'

export interface ProdutoRef {
  id: string
  /** SKU real, ou o começo do id quando o produto não está mais na lista. */
  sku: string
  nome: string
  /** Sempre string: `atributos` pode chegar sem cor por importação ou conector. */
  cor: string
  tamanho: string
  removido: boolean
}

export function produtoRef(id: string, p?: Product): ProdutoRef {
  const ident = String(id ?? '')
  if (!p) return { id: ident, sku: ident ? ident.slice(0, 8) : '—', nome: ROTULO_REMOVIDO, cor: '', tamanho: '', removido: true }
  const attrs = p.atributos ?? {}
  return {
    id: p.id,
    sku: p.sku || ident.slice(0, 8),
    nome: p.nome || p.sku || ROTULO_REMOVIDO,
    cor: attrs.cor ?? '',
    tamanho: attrs.tamanho ?? '',
    removido: false,
  }
}
