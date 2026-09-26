// Impressão de etiquetas por tamanho: cada etiqueta vai no tamanho do perfil da família (ou no escolhido para a
// impressão toda), o desenho sai do core (layoutDaEtiqueta) e as etiquetas se arrumam em linhas do rolo (uma
// "página" da térmica por linha, com as colunas lado a lado). O CSS de impressão dá a cada tamanho a sua página
// (@page com nome), para a térmica receber exatamente a medida da etiqueta. Puro e testado.
import { conteudoDaEtiqueta, layoutDaEtiqueta, type ConteudoEtiqueta, type DadosEtiqueta, type LayoutEtiqueta } from '@prodio/core/etiquetaLayout'
import type { ProdutoEtiqueta } from '@prodio/core/etiquetaAmostra'
import { consumoDoRolo, emLinhas, larguraDoRoloMm, presetsComId, tamanhoDoPerfil } from '@prodio/core/etiquetaTamanhos'
import type { LabelKind, LabelSize, Product } from '../../domain/types'
import { ORDEM_TIPOS, type ItemPreview } from './etiquetasUtils'

export const produtoParaEtiqueta = (p: Product): ProdutoEtiqueta => ({ sku: p.sku, nome: p.nome, familia: p.familia, cor: p.atributos?.cor, detalhe: p.atributos?.tamanho })

/** O que vai impresso numa etiqueta (o mesmo conteúdo de antes dos tamanhos). */
export function dadosDaEtiqueta(it: ItemPreview, tipo: LabelKind): DadosEtiqueta {
  return {
    tipo,
    serial: it.label.serial,
    sku: it.p.sku,
    nome: it.p.nome,
    titulo: it.p.atributos?.cor ?? it.p.familia,
    detalhe: it.p.atributos?.tamanho,
    quantidade: it.label.quantidade,
    prefixo: it.perfil.prefixo,
    instrucao: it.perfil.instrucaoMontagem,
    n: it.n,
    total: it.total,
  }
}

export interface EtiquetaDesenhada {
  chave: string
  tipo: LabelKind
  conteudo: ConteudoEtiqueta
  layout: LayoutEtiqueta
}

export interface GrupoTamanho {
  tamanho: LabelSize
  etiquetas: EtiquetaDesenhada[]
  porTipo: Partial<Record<LabelKind, number>>
  /** Linhas do rolo (páginas) e etiquetas em branco na última linha. */
  linhas: EtiquetaDesenhada[][]
  sobra: number
  naoCabem: number
  /** Avisos do desenho, sem repetir, com quantas etiquetas cada um atinge. */
  avisos: { texto: string; etiquetas: number }[]
  erros: string[]
}

/**
 * Agrupa a impressão por tamanho, na ordem de colagem (produto, montagem, caixa). `forcado` = um tamanho para
 * tudo (a escolha da tela); sem ele, o do perfil de cada família. O desenho é calculado uma vez por produto, tipo
 * e tamanho, com a contagem mais longa (n = total): serial e contagem das outras nunca são mais compridos.
 */
export function montarImpressao(itensPorTipo: { tipo: LabelKind; itens: ItemPreview[] }[], tamanhos: LabelSize[], forcadoId?: string | null): GrupoTamanho[] {
  const lista = tamanhos.length ? tamanhos : presetsComId()
  const forcado = forcadoId ? lista.find((t) => t.id === forcadoId) : undefined
  const desenhos = new Map<string, LayoutEtiqueta>()
  const grupos = new Map<string, { tamanho: LabelSize; etiquetas: EtiquetaDesenhada[] }>()
  const ordenados = [...itensPorTipo].sort((a, b) => ORDEM_TIPOS.indexOf(a.tipo) - ORDEM_TIPOS.indexOf(b.tipo))
  for (const { tipo, itens } of ordenados) {
    for (const it of itens) {
      const tamanho = forcado ?? tamanhoDoPerfil(lista, it.perfil)
      const chaveDesenho = `${tamanho.id}|${it.p.id}|${tipo}|${it.total}|${it.label.quantidade}|${it.label.serial.length}`
      let layout = desenhos.get(chaveDesenho)
      if (!layout) {
        layout = layoutDaEtiqueta(tamanho, conteudoDaEtiqueta(dadosDaEtiqueta({ ...it, n: it.total }, tipo)))
        desenhos.set(chaveDesenho, layout)
      }
      const g = grupos.get(tamanho.id) ?? { tamanho, etiquetas: [] }
      g.etiquetas.push({ chave: `${tipo}-${it.label.serial}`, tipo, conteudo: conteudoDaEtiqueta(dadosDaEtiqueta(it, tipo)), layout })
      grupos.set(tamanho.id, g)
    }
  }
  return [...grupos.values()].map(({ tamanho, etiquetas }) => {
    const porTipo: Partial<Record<LabelKind, number>> = {}
    const avisos = new Map<string, number>()
    const erros = new Set<string>()
    let naoCabem = 0
    for (const e of etiquetas) {
      porTipo[e.tipo] = (porTipo[e.tipo] ?? 0) + 1
      for (const a of e.layout.avisos) avisos.set(a, (avisos.get(a) ?? 0) + 1)
      if (!e.layout.cabe) {
        naoCabem++
        for (const x of e.layout.erros) erros.add(x)
      }
    }
    return {
      tamanho,
      etiquetas,
      porTipo,
      linhas: emLinhas(etiquetas, tamanho.colunas),
      sobra: consumoDoRolo(etiquetas.length, tamanho.colunas).sobra,
      naoCabem,
      avisos: [...avisos].map(([texto, n]) => ({ texto, etiquetas: n })),
      erros: [...erros],
    }
  })
}

const mm = (n: number) => `${Math.round(n * 100) / 100}mm`

/**
 * CSS de impressão: cada grupo com a sua página nomeada do tamanho da linha do rolo (colunas × largura + vãos,
 * altura da etiqueta), margem zero, uma linha por página. `so` imprime só um grupo (um rolo por vez).
 */
export function cssDeImpressao(grupos: Pick<GrupoTamanho, 'tamanho'>[], so: number | null = null): string {
  const regras = grupos.map(({ tamanho: t }, i) =>
    [
      `@page etq-${i} { size: ${mm(larguraDoRoloMm(t))} ${mm(t.alturaMm)}; margin: 0; }`,
      `.grupo-etq[data-grupo="${i}"] .linha-etq { page: etq-${i}; width: ${mm(larguraDoRoloMm(t))}; height: ${mm(t.alturaMm)}; column-gap: ${mm(t.espacoColunasMm)}; }`,
    ].join('\n'),
  )
  const soUm = so === null ? '' : `\n.grupo-etq:not([data-grupo="${so}"]) { display: none !important; }`
  return `@media print {\n${regras.join('\n')}${soUm}\n}`
}
