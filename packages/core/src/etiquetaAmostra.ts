// Conferência de um tamanho antes de imprimir: monta a etiqueta de "pior caso" dos produtos (o maior SKU, o
// maior nome e a maior cor/família, com o serial mais longo que a RPC reserve_label_batch grava) e desenha
// nela. Se o pior caso cabe, todas as etiquetas daquela família cabem. Usado em Configurações › Etiquetas.
import { conteudoDaEtiqueta, larguraEm, layoutDaEtiqueta, type DadosEtiqueta, type LayoutEtiqueta } from './etiquetaLayout'
import type { LabelKind, LabelProfile, LabelSize } from './tipos'

export interface ProdutoEtiqueta {
  sku: string
  nome: string
  familia: string
  cor?: string
  detalhe?: string // atributo tamanho
}

const EXEMPLO: ProdutoEtiqueta = { sku: 'ED000124', nome: 'Espelho Adnet Redondo 60cm - Preto', familia: 'Espelho', cor: 'Preto', detalhe: '60cm' }
const maior = <T,>(xs: T[], medida: (x: T) => number): T => xs.reduce((a, x) => (medida(x) > medida(a) ? x : a))

/**
 * Etiqueta de pior caso de um tipo para os produtos dados (sem produtos, um exemplo). Serial com a data de
 * 6 dígitos e a sequência 9999; contagem 999/999.
 */
export function amostraPiorCaso(produtos: ProdutoEtiqueta[], perfil: Pick<LabelProfile, 'prefixo' | 'unidadesPorCaixa' | 'instrucaoMontagem'>, tipo: LabelKind): DadosEtiqueta {
  const lista = produtos.length ? produtos : [EXEMPLO]
  const skuLinha = (p: ProdutoEtiqueta) => (p.detalhe?.trim() ? `${p.sku} · ${p.detalhe.trim()}` : p.sku)
  const doSku = maior(lista, (p) => [...skuLinha(p)].length)
  const comSkuLongo = maior(lista, (p) => [...p.sku.trim()].length)
  const doNome = maior(lista, (p) => larguraEm(p.nome))
  const doTitulo = maior(lista, (p) => larguraEm(p.cor?.trim() || p.familia, { negrito: true, caixaAlta: true }))
  return {
    tipo,
    serial: `${perfil.prefixo || 'ET'}${comSkuLongo.sku.trim().toUpperCase()}2612319999`,
    sku: doSku.sku,
    detalhe: doSku.detalhe,
    nome: doNome.nome,
    titulo: doTitulo.cor?.trim() || doTitulo.familia,
    quantidade: Math.max(1, perfil.unidadesPorCaixa || 1),
    prefixo: perfil.prefixo,
    instrucao: perfil.instrucaoMontagem,
    n: 999,
    total: 999,
  }
}

export interface ConferenciaTipo {
  tipo: LabelKind
  amostra: DadosEtiqueta
  layout: LayoutEtiqueta
}

/** Desenha o pior caso de cada tipo que o perfil gera, no tamanho dado. */
export function conferirTamanho(produtos: ProdutoEtiqueta[], perfil: Pick<LabelProfile, 'prefixo' | 'unidadesPorCaixa' | 'instrucaoMontagem' | 'tipos'>, tamanho: LabelSize): ConferenciaTipo[] {
  return perfil.tipos.map((tipo) => {
    const amostra = amostraPiorCaso(produtos, perfil, tipo)
    return { tipo, amostra, layout: layoutDaEtiqueta(tamanho, conteudoDaEtiqueta(amostra)) }
  })
}

/** Resumo para a tabela de perfis: 'erro' se algum tipo não cabe, 'aviso' se algo foi abreviado, 'ok'. */
export function situacaoDaConferencia(c: ConferenciaTipo[]): { nivel: 'ok' | 'aviso' | 'erro'; textos: string[] } {
  const NOME: Record<LabelKind, string> = { produto: 'Produto', montagem: 'Montagem', caixa: 'Caixa' }
  const erros = c.filter((x) => !x.layout.cabe).flatMap((x) => x.layout.erros.slice(0, 1).map((e) => `${NOME[x.tipo]}: ${e}`))
  if (erros.length) return { nivel: 'erro', textos: erros }
  const avisos = c.flatMap((x) => x.layout.avisos.map((a) => `${NOME[x.tipo]}: ${a}`))
  return { nivel: avisos.length ? 'aviso' : 'ok', textos: avisos }
}
