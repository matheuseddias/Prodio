import { modulosDaVersao, versaoQr } from '@prodio/core/etiquetaLayout'
import { presetsComId } from '@prodio/core/etiquetaTamanhos'
import { QRCodeSVG } from 'qrcode.react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as mock from '../../domain/mock'
import type { Label, LabelProfile, LabelSize, Product } from '../../domain/types'
import { EtiquetaImpressa } from './EtiquetaImpressa'
import { cssDeImpressao, montarImpressao } from './etiquetasImpressao'
import type { ItemPreview } from './etiquetasUtils'

const [p50, p60, p100] = presetsComId()
const rolo: LabelSize = { ...p50, id: 'rolo', nome: 'Rolo 2 colunas', larguraMm: 40, alturaMm: 25, colunas: 2, espacoColunasMm: 3, padrao: false, preset: undefined }
const tamanhos = [p50, p60, p100, rolo]
const produto = (id: string, familia: string): Product => ({ ...mock.products[0], id, sku: `ED${id}`, familia, nome: `Produto ${id}` })
const item = (p: Product, perfil: LabelProfile, n: number, total: number, tipo: Label['tipo'] = 'unidade'): ItemPreview => ({
  label: { serial: `EH${p.sku}260926${String(n).padStart(4, '0')}`, productId: p.id, tipo, quantidade: tipo === 'caixa' ? 4 : 1, status: 'impressa', dia: '2026-09-26', seq: n },
  p,
  perfil,
  n,
  total,
})

describe('QR: o core conta os módulos igual ao qrcode.react', () => {
  it('versão e módulos batem com o viewBox do SVG desenhado', () => {
    for (const valor of ['EHED0001242609260001', 'EHED00012426092600012', 'ETESPELHO-ADNET-REDONDO-60-PRETO2609260001', 'ED_001', 'minúsculo', '12345678901234567890123456789012345']) {
      const svg = renderToStaticMarkup(<QRCodeSVG value={valor} level="M" marginSize={0} />)
      const n = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1])
      expect(n, valor).toBe(modulosDaVersao(versaoQr(valor)))
    }
  })
})

describe('impressão por tamanho', () => {
  const espelho: LabelProfile = { familia: 'Espelho', prefixo: 'EH', tipos: ['produto', 'montagem'], unidadesPorCaixa: 6, tamanhoId: null }
  const bandeja: LabelProfile = { familia: 'Bandeja', prefixo: 'EH', tipos: ['produto', 'caixa'], unidadesPorCaixa: 4, tamanhoId: 'rolo' }
  const a = produto('A', 'Espelho')
  const b = produto('B', 'Bandeja')
  const grupos = [
    { tipo: 'caixa' as const, itens: [item(b, bandeja, 1, 1, 'caixa')] },
    { tipo: 'produto' as const, itens: [item(a, espelho, 1, 2), item(a, espelho, 2, 2), item(b, bandeja, 1, 2), item(b, bandeja, 2, 2)] },
    { tipo: 'montagem' as const, itens: [item(a, espelho, 1, 2), item(a, espelho, 2, 2)] },
  ]

  it('cada família no tamanho do perfil (sem escolha = padrão), na ordem de colagem, em linhas do rolo', () => {
    const g = montarImpressao(grupos, tamanhos)
    expect(g.map((x) => x.tamanho.id)).toEqual(['preset-60x40', 'rolo'])
    expect(g[0].etiquetas.map((e) => e.tipo)).toEqual(['produto', 'produto', 'montagem', 'montagem'])
    expect(g[1].etiquetas.map((e) => e.tipo)).toEqual(['produto', 'produto', 'caixa'])
    expect(g[1].linhas.map((l) => l.length)).toEqual([2, 1]) // 2 colunas: a caixa fica sozinha na última linha
    expect(g[1].sobra).toBe(1)
    expect(g[0].porTipo).toEqual({ produto: 2, montagem: 2 })
    // a montagem leva o serial com -M; o QR continua o serial
    const m = g[0].etiquetas.find((e) => e.tipo === 'montagem')!
    expect(m.conteudo.linhas.find((l) => l.chave === 'serial')?.texto.endsWith('-M')).toBe(true)
    expect(m.conteudo.qr.endsWith('-M')).toBe(false)
  })
  it('tamanho forçado na tela vale para todas; o mesmo desenho serve às etiquetas do mesmo produto', () => {
    const g = montarImpressao(grupos, tamanhos, 'preset-100x50')
    expect(g).toHaveLength(1)
    expect(g[0].etiquetas).toHaveLength(7)
    const produtoA = g[0].etiquetas.filter((e) => e.tipo === 'produto' && e.conteudo.qr.includes('EDA'))
    expect(produtoA[0].layout).toBe(produtoA[1].layout)
    expect(g[0].naoCabem).toBe(0)
  })
  it('sem tamanhos no banco, usa os de fábrica', () => {
    expect(montarImpressao(grupos, [])[0].tamanho.id).toBe('preset-60x40')
  })
  it('tamanho pequeno demais: conta as que não cabem e diz por quê', () => {
    const minusculo: LabelSize = { ...p50, id: 'mini', larguraMm: 14, alturaMm: 10, margemMm: 1 }
    const g = montarImpressao(grupos, [...tamanhos, minusculo], 'mini')
    expect(g[0].naoCabem).toBe(7)
    expect(g[0].erros.length).toBeGreaterThan(0)
  })
  it('CSS: uma página nomeada por tamanho, do tamanho da linha do rolo, sem margem; "só este" esconde os outros', () => {
    const g = montarImpressao(grupos, tamanhos)
    const css = cssDeImpressao(g)
    expect(css).toContain('@page etq-0 { size: 60mm 40mm; margin: 0; }')
    expect(css).toContain('@page etq-1 { size: 83mm 25mm; margin: 0; }') // 2 × 40 + 3 de vão
    expect(css).toContain('.grupo-etq[data-grupo="1"] .linha-etq { page: etq-1; width: 83mm; height: 25mm; column-gap: 3mm; }')
    expect(css).not.toContain(':not([data-grupo')
    expect(cssDeImpressao(g, 1)).toContain('.grupo-etq:not([data-grupo="1"]) { display: none !important; }')
  })
})

describe('etiqueta desenhada', () => {
  it('em milímetros reais, com o QR e o texto do desenho; girada vira 90°', () => {
    const g = montarImpressao([{ tipo: 'produto', itens: [item(produto('A', 'Espelho'), { familia: 'Espelho', prefixo: 'EH', tipos: ['produto'], unidadesPorCaixa: 1 }, 1, 1)] }], tamanhos, 'preset-60x40')
    const e = g[0].etiquetas[0]
    const html = renderToStaticMarkup(<EtiquetaImpressa tamanho={p60} layout={e.layout} conteudo={e.conteudo} />)
    expect(html).toContain('width:60mm;height:40mm')
    expect(html).toContain(`width:${e.layout.qr.ladoMm}mm`)
    expect(html).toContain('EHEDA2609260001')
    const girada = renderToStaticMarkup(<EtiquetaImpressa tamanho={{ ...p60, larguraMm: 30, alturaMm: 100 }} layout={{ ...e.layout, girada: true, caixaMm: { largura: 96, altura: 26 } }} conteudo={e.conteudo} />)
    expect(girada).toContain('transform:translateX(26mm) rotate(90deg)')
  })
})
