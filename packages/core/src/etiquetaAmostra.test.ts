import { amostraPiorCaso, conferirTamanho, situacaoDaConferencia, type ProdutoEtiqueta } from './etiquetaAmostra'
import { presetsComId } from './etiquetaTamanhos'

const [p50, p60] = presetsComId()
const produtos: ProdutoEtiqueta[] = [
  { sku: 'ED000124', nome: 'Espelho Adnet Redondo 60cm - Preto', familia: 'Espelho', cor: 'Preto', detalhe: '60cm' },
  { sku: 'ED000001-GG', nome: 'Espelho', familia: 'Espelho', cor: 'Champagne Fosco' },
  { sku: 'ED7', nome: 'Espelho Orgânico Grande com Moldura de Madeira Maciça', familia: 'Espelho' },
]
const perfil = { prefixo: 'EH', unidadesPorCaixa: 12, instrucaoMontagem: 'Fixar alça a 118 mm da borda', tipos: ['produto', 'montagem', 'caixa'] as const }

describe('amostra de pior caso', () => {
  it('junta o maior SKU (com o tamanho), o maior nome e a maior cor/família, com o serial mais longo', () => {
    const a = amostraPiorCaso(produtos, perfil, 'caixa')
    expect(a.serial).toBe('EHED000001-GG2612319999')
    expect(a.sku).toBe('ED000124') // "ED000124 · 60cm" é a linha de SKU mais longa
    expect(a.detalhe).toBe('60cm')
    expect(a.nome).toBe('Espelho Orgânico Grande com Moldura de Madeira Maciça')
    expect(a.titulo).toBe('Champagne Fosco')
    expect(a).toMatchObject({ quantidade: 12, prefixo: 'EH', instrucao: 'Fixar alça a 118 mm da borda', n: 999, total: 999 })
  })
  it('sem produtos usa um exemplo; sem prefixo, o ET do banco', () => {
    const a = amostraPiorCaso([], { prefixo: '', unidadesPorCaixa: 0 }, 'produto')
    expect(a.serial).toBe('ETED0001242612319999')
    expect(a.quantidade).toBe(1)
  })
})

describe('conferência do tamanho', () => {
  it('um desenho por tipo do perfil; 60 × 40 leva tudo, 50 × 30 abrevia com aviso', () => {
    const c60 = conferirTamanho(produtos, { ...perfil, tipos: [...perfil.tipos] }, p60)
    expect(c60.map((x) => x.tipo)).toEqual(['produto', 'montagem', 'caixa'])
    expect(c60.every((x) => x.layout.cabe)).toBe(true)
    const s50 = situacaoDaConferencia(conferirTamanho(produtos, { ...perfil, tipos: [...perfil.tipos] }, p50))
    expect(s50.nivel).not.toBe('erro')
  })
  it('não cabe vira erro com o tipo na frente', () => {
    const minusculo = { ...p50, larguraMm: 14, alturaMm: 10, margemMm: 1 }
    const s = situacaoDaConferencia(conferirTamanho(produtos, { ...perfil, tipos: ['produto'] }, minusculo))
    expect(s.nivel).toBe('erro')
    expect(s.textos[0]).toMatch(/^Produto: /)
  })
})
