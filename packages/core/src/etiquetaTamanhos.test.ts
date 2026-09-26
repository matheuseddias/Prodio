import {
  areaUtilMm,
  avisosDoTamanho,
  consumoDoRolo,
  emLinhas,
  larguraDoRoloMm,
  nomeDasMedidas,
  PRESETS_TAMANHO,
  presetsComId,
  tamanhoDoPerfil,
  tamanhoPadrao,
  validarTamanho,
} from './etiquetaTamanhos'
import type { LabelSize } from './tipos'

const base: Omit<LabelSize, 'id' | 'padrao'> = { nome: '60 × 40 mm', larguraMm: 60, alturaMm: 40, margemMm: 2, dpi: 203, orientacao: 'normal', colunas: 1, espacoColunasMm: 0 }
const t = (id: string, delta: Partial<LabelSize> = {}): LabelSize => ({ ...base, id, padrao: false, ...delta })

describe('presets', () => {
  it('são os três tamanhos que eram fixos, com 60 × 40 de padrão, e todos válidos', () => {
    expect(PRESETS_TAMANHO.map((p) => p.nome)).toEqual(['50 × 30 mm', '60 × 40 mm', '100 × 50 mm'])
    expect(PRESETS_TAMANHO.filter((p) => p.padrao).map((p) => p.preset)).toEqual(['60x40'])
    for (const p of PRESETS_TAMANHO) expect(validarTamanho(p)).toEqual([])
    expect(presetsComId().map((p) => p.id)).toEqual(['preset-50x30', 'preset-60x40', 'preset-100x50'])
  })
  it('nome das medidas com vírgula decimal', () => {
    expect(nomeDasMedidas(101.6, 50.8)).toBe('101,6 × 50,8 mm')
  })
})

describe('validarTamanho', () => {
  it('limites de largura, altura, margem, dpi, orientação, colunas e vão (os checks do banco)', () => {
    expect(validarTamanho({ ...base, larguraMm: 9 })).toEqual(['Largura entre 10 e 220 mm.'])
    expect(validarTamanho({ ...base, alturaMm: 301 })).toEqual(['Altura entre 10 e 300 mm.'])
    expect(validarTamanho({ ...base, margemMm: -1 })).toEqual(['Margem entre 0 e 10 mm.'])
    expect(validarTamanho({ ...base, dpi: 250 as LabelSize['dpi'] })).toEqual(['Resolução da impressora: 203, 300 ou 600 dpi.'])
    expect(validarTamanho({ ...base, orientacao: 'deitada' as LabelSize['orientacao'] })).toEqual(['Orientação inválida.'])
    expect(validarTamanho({ ...base, colunas: 5 })).toEqual(['De 1 a 4 etiquetas lado a lado.'])
    expect(validarTamanho({ ...base, colunas: 1.5 })).toEqual(['De 1 a 4 etiquetas lado a lado.'])
    expect(validarTamanho({ ...base, espacoColunasMm: 21 })).toEqual(['Vão entre colunas de 0 a 20 mm.'])
    expect(validarTamanho({ ...base, larguraMm: NaN })).toEqual(['Largura entre 10 e 220 mm.'])
  })
  it('margem que não deixa 8 mm para imprimir', () => {
    expect(validarTamanho({ ...base, larguraMm: 20, alturaMm: 15, margemMm: 4 })[0]).toMatch(/sobram menos de 8 mm/)
    expect(validarTamanho({ ...base, larguraMm: 20, alturaMm: 16, margemMm: 4 })).toEqual([])
  })
  it('rolo largo demais com as colunas', () => {
    expect(validarTamanho({ ...base, larguraMm: 60, colunas: 4, espacoColunasMm: 3 })[0]).toMatch(/passaria de 220 mm de largura \(249 mm\)/)
    expect(validarTamanho({ ...base, larguraMm: 50, colunas: 4, espacoColunasMm: 3 })).toEqual([])
  })
  it('nome obrigatório, até 40 letras e sem repetir (sem diferença de maiúscula; o próprio pode)', () => {
    expect(validarTamanho({ ...base, nome: '  ' })).toEqual(['Dê um nome ao tamanho.'])
    expect(validarTamanho({ ...base, nome: 'x'.repeat(41) })).toEqual(['Nome com até 40 letras.'])
    const outros = [t('a', { nome: 'Rolo Zebra' })]
    expect(validarTamanho({ ...base, nome: ' rolo zebra ' }, outros)).toEqual(['Já existe um tamanho chamado "rolo zebra".'])
    expect(validarTamanho({ ...base, id: 'a', nome: 'ROLO ZEBRA' }, outros)).toEqual([])
  })
})

describe('avisos, área útil e rolo', () => {
  it('avisa rolo acima da impressora de 4 polegadas e margem abaixo de 1 mm', () => {
    expect(avisosDoTamanho(base)).toEqual([])
    expect(avisosDoTamanho({ ...base, larguraMm: 50, colunas: 3, espacoColunasMm: 2 })[0]).toMatch(/154 mm: impressora de 4 polegadas/)
    expect(avisosDoTamanho({ ...base, margemMm: 0.5 })[0]).toMatch(/Margem abaixo de 1 mm/)
  })
  it('área útil tira as margens e troca os lados quando girada', () => {
    expect(areaUtilMm(base)).toEqual({ largura: 56, altura: 36 })
    expect(areaUtilMm({ ...base, larguraMm: 30, alturaMm: 100, orientacao: 'girada' })).toEqual({ largura: 96, altura: 26 })
  })
  it('largura do rolo e linhas', () => {
    expect(larguraDoRoloMm({ larguraMm: 33, colunas: 3, espacoColunasMm: 2 })).toBe(103)
    expect(emLinhas([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(emLinhas([1, 2], 0)).toEqual([[1], [2]])
    expect(consumoDoRolo(5, 3)).toEqual({ linhas: 2, sobra: 1 })
    expect(consumoDoRolo(0, 3)).toEqual({ linhas: 0, sobra: 0 })
  })
})

describe('qual tamanho vale', () => {
  const lista = [t('a', { nome: 'A' }), t('b', { nome: 'B', padrao: true }), t('c', { nome: 'C' })]
  it('o do perfil; sem escolha (null) ou escolha apagada, o padrão da empresa', () => {
    expect(tamanhoDoPerfil(lista, { tamanhoId: 'c' }).id).toBe('c')
    expect(tamanhoDoPerfil(lista, { tamanhoId: null }).id).toBe('b')
    expect(tamanhoDoPerfil(lista, { tamanhoId: 'apagado' }).id).toBe('b')
    expect(tamanhoDoPerfil(lista, undefined).id).toBe('b')
  })
  it('sem padrão marcado cai no preset 60 × 40 ou no primeiro; sem lista, nos presets de fábrica', () => {
    expect(tamanhoPadrao([t('a'), t('b', { preset: '60x40' })]).id).toBe('b')
    expect(tamanhoPadrao([t('a'), t('b')]).id).toBe('a')
    expect(tamanhoDoPerfil([], { tamanhoId: 'x' }).id).toBe('preset-60x40')
  })
})
