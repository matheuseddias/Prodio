import {
  conteudoDaEtiqueta,
  FONTE_CONFORTO_PT,
  FONTE_MIN_PT,
  LARGURA_MONO_EM,
  larguraEm,
  layoutDaEtiqueta,
  MODULO_MIN_MM,
  modulosDaVersao,
  PT_MM,
  versaoQr,
  type DadosEtiqueta,
  type LayoutEtiqueta,
} from './etiquetaLayout'
import { presetsComId } from './etiquetaTamanhos'
import type { LabelSize } from './tipos'

const [p50, p60, p100] = presetsComId()
const tam = (delta: Partial<LabelSize>): LabelSize => ({ ...p60, id: 'x', ...delta })
// A ficha real do fundador (ED000124 Espelho Adnet Redondo 60cm - Preto), serial como a RPC grava.
const produto: DadosEtiqueta = { tipo: 'produto', serial: 'EHED0001242609260001', sku: 'ED000124', nome: 'Espelho Adnet Redondo 60cm - Preto', titulo: 'Preto', detalhe: '60cm', n: 1, total: 12 }
const montagem: DadosEtiqueta = { ...produto, tipo: 'montagem', instrucao: 'Fixar alça a 118 mm da borda · conferir lapidação' }
const caixa: DadosEtiqueta = { ...produto, tipo: 'caixa', quantidade: 20, prefixo: 'EH', total: 3 }

/** "Nada corta": confere o desenho contra a área, independente de como ele foi escolhido. */
function conferir(l: LayoutEtiqueta, t: LabelSize) {
  const caixaUtil = l.caixaMm
  // QR em pontos inteiros da impressora, módulo legível
  const pontos = (l.qr.ladoMm / l.qr.modulos) * (t.dpi / 25.4)
  expect(Math.abs(pontos - Math.round(pontos))).toBeLessThan(0.01)
  expect(l.qr.moduloMm).toBeGreaterThanOrEqual(MODULO_MIN_MM - 1e-9)
  expect(l.qr.pontosPorModulo).toBeGreaterThanOrEqual(2)
  // QR + vão + texto dentro da área útil
  if (l.disposicao === 'lado') {
    expect(l.qr.ladoMm + l.vaoMm + l.textoMm.largura).toBeLessThanOrEqual(caixaUtil.largura + 0.02)
    expect(l.qr.ladoMm).toBeLessThanOrEqual(caixaUtil.altura + 0.01)
  } else {
    expect(l.qr.ladoMm + l.vaoMm + l.textoMm.altura).toBeLessThanOrEqual(caixaUtil.altura + 0.02)
    expect(l.qr.ladoMm).toBeLessThanOrEqual(caixaUtil.largura + 0.01)
  }
  expect(l.textoMm.usada).toBeLessThanOrEqual(l.textoMm.altura + 0.01)
  // Essenciais inteiros: cada linha monoespaçada cabe na largura, nas linhas que ela tem
  for (const x of l.linhas.filter((y) => y.essencial)) {
    expect(x.abreviada).toBe(false)
    if (x.mono) {
      const porLinha = Math.floor(l.textoMm.largura / (LARGURA_MONO_EM * x.fontePt * PT_MM) + 1e-9)
      expect(porLinha * x.maxLinhas).toBeGreaterThanOrEqual([...x.texto].length)
    } else expect(larguraEm(x.texto, x) * x.fontePt * PT_MM).toBeLessThanOrEqual(l.textoMm.largura * x.maxLinhas + 0.01)
  }
  expect(l.fontePt).toBeGreaterThanOrEqual(FONTE_MIN_PT)
}

describe('QR: versão e módulos (nível M, a mesma escolha do qrcode.react)', () => {
  it('capacidades por modo', () => {
    expect(versaoQr('A'.repeat(20))).toBe(1) // alfanumérico: 20 na versão 1
    expect(versaoQr('A'.repeat(21))).toBe(2)
    expect(versaoQr('A'.repeat(38))).toBe(2)
    expect(versaoQr('A'.repeat(39))).toBe(3)
    expect(versaoQr('1'.repeat(34))).toBe(1) // numérico: 34
    expect(versaoQr('1'.repeat(35))).toBe(2)
    expect(versaoQr('a'.repeat(14))).toBe(1) // bytes: 14
    expect(versaoQr('a'.repeat(15))).toBe(2)
    expect(versaoQr('ED_1')).toBe(1) // '_' não é alfanumérico do QR: vai em bytes
    expect(versaoQr('ç'.repeat(7))).toBe(1) // 14 bytes em UTF-8
    expect(versaoQr('ç'.repeat(8))).toBe(2)
    expect(modulosDaVersao(1)).toBe(21)
    expect(modulosDaVersao(3)).toBe(29)
  })
})

describe('conteúdo da etiqueta', () => {
  it('produto: título, nome, SKU com o tamanho, serial e contagem; o QR é o serial', () => {
    const c = conteudoDaEtiqueta(produto)
    expect(c.qr).toBe(produto.serial)
    expect(c.linhas.map((l) => [l.chave, l.texto])).toEqual([
      ['titulo', 'Preto'],
      ['nome', 'Espelho Adnet Redondo 60cm - Preto'],
      ['sku', 'ED000124 · 60cm'],
      ['serial', 'EHED0001242609260001'],
      ['contador', '1/12'],
    ])
  })
  it('montagem: cabeçalho, serial com -M (o QR continua o serial) e instrução, sem o nome', () => {
    const c = conteudoDaEtiqueta(montagem)
    expect(c.qr).toBe(produto.serial)
    expect(c.linhas.map((l) => l.chave)).toEqual(['cabecalho', 'titulo', 'sku', 'serial', 'instrucao', 'contador'])
    expect(c.linhas.find((l) => l.chave === 'serial')?.texto).toBe('EHED0001242609260001-M')
  })
  it('caixa: cabeçalho com a quantidade e o prefixo na contagem', () => {
    const c = conteudoDaEtiqueta(caixa)
    expect(c.linhas[0]).toMatchObject({ chave: 'cabecalho', texto: 'Caixa · contém 20 un', essencial: true })
    expect(c.linhas.at(-1)?.texto).toBe('1/3 · EH')
  })
})

describe('layout nos tamanhos de fábrica', () => {
  it('as três etiquetas cabem inteiras nos três presets, com fonte e QR confortáveis', () => {
    for (const t of [p50, p60, p100]) {
      for (const d of [produto, montagem, caixa]) {
        const l = layoutDaEtiqueta(t, conteudoDaEtiqueta(d))
        expect(l.cabe, `${t.nome} ${d.tipo}`).toBe(true)
        expect(l.erros).toEqual([])
        expect(l.fontePt).toBeGreaterThanOrEqual(FONTE_CONFORTO_PT)
        expect(l.qr.moduloMm).toBeGreaterThanOrEqual(0.33)
        expect(l.disposicao).toBe('lado')
        conferir(l, t)
      }
    }
  })
  it('60 × 40 e 100 × 50 levam a etiqueta de produto inteira, sem aviso', () => {
    for (const t of [p60, p100]) {
      const l = layoutDaEtiqueta(t, conteudoDaEtiqueta(produto))
      expect(l.avisos).toEqual([])
      expect(l.linhas.map((x) => x.chave)).toEqual(['titulo', 'nome', 'sku', 'serial', 'contador'])
    }
  })
  it('QR e texto crescem com a etiqueta', () => {
    const [a, b, c] = [p50, p60, p100].map((t) => layoutDaEtiqueta(t, conteudoDaEtiqueta(produto)))
    expect(a.qr.ladoMm).toBeLessThan(b.qr.ladoMm)
    expect(b.qr.ladoMm).toBeLessThan(c.qr.ladoMm)
    expect(a.fontePt).toBeLessThanOrEqual(b.fontePt)
    expect(b.fontePt).toBeLessThan(c.fontePt)
    expect(c.qr.ladoMm).toBeGreaterThan(40) // 100 × 50: o QR ocupa quase a altura toda
  })
  it('o serial nunca é cortado: em 50 × 30 a fonte se ajusta para ele caber numa linha', () => {
    const l = layoutDaEtiqueta(p50, conteudoDaEtiqueta(produto))
    const serial = l.linhas.find((x) => x.chave === 'serial')!
    expect(serial.maxLinhas).toBe(1)
    expect([...serial.texto].length * LARGURA_MONO_EM * serial.fontePt * PT_MM).toBeLessThanOrEqual(l.textoMm.largura)
  })
})

describe('adaptação', () => {
  it('dpi: o QR fica em pontos inteiros da impressora (300 dpi dá outro lado que 203)', () => {
    const a = layoutDaEtiqueta(p60, conteudoDaEtiqueta(produto))
    const b = layoutDaEtiqueta({ ...p60, dpi: 300 }, conteudoDaEtiqueta(produto))
    const c = layoutDaEtiqueta({ ...p60, dpi: 600 }, conteudoDaEtiqueta(produto))
    expect(a.qr.ladoMm).not.toBe(b.qr.ladoMm)
    for (const [l, dpi] of [[a, 203], [b, 300], [c, 600]] as const) conferir(l, { ...p60, dpi })
  })
  it('girada: 30 × 100 girada desenha como 100 × 30 normal', () => {
    const g = layoutDaEtiqueta(tam({ larguraMm: 30, alturaMm: 100, orientacao: 'girada' }), conteudoDaEtiqueta(produto))
    const n = layoutDaEtiqueta(tam({ larguraMm: 100, alturaMm: 30 }), conteudoDaEtiqueta(produto))
    expect(g.girada).toBe(true)
    expect({ ...g, girada: false }).toEqual(n)
  })
  it('etiqueta alta e estreita põe o QR em cima do texto', () => {
    const l = layoutDaEtiqueta(tam({ larguraMm: 40, alturaMm: 60 }), conteudoDaEtiqueta(produto))
    expect(l.disposicao).toBe('empilhado')
    expect(l.qr.ladoMm).toBeGreaterThan(20)
    conferir(l, tam({ larguraMm: 40, alturaMm: 60 }))
  })
  it('etiqueta pequena abre mão do opcional e avisa, mas o essencial continua inteiro', () => {
    const t = tam({ larguraMm: 30, alturaMm: 20, margemMm: 1 })
    const l = layoutDaEtiqueta(t, conteudoDaEtiqueta(produto))
    expect(l.cabe).toBe(true)
    expect(l.linhas.map((x) => x.chave)).not.toContain('contador')
    expect(l.avisos).toContain('Sem a contagem (n/total): não coube.')
    conferir(l, t)
  })
  it('instrução longa: inteira na 100 × 50 (o QR cede espaço), cortada com aviso na 50 × 30', () => {
    const longa = { ...montagem, instrucao: 'Fixar a alça a 118 mm da borda, conferir a lapidação e passar silicone neutro em todo o perímetro antes de embalar e etiquetar a caixa' }
    const grande = layoutDaEtiqueta(p100, conteudoDaEtiqueta(longa))
    expect(grande.avisos).toEqual([])
    expect(grande.linhas.find((x) => x.chave === 'instrucao')).toMatchObject({ abreviada: false })
    const l = layoutDaEtiqueta(p50, conteudoDaEtiqueta(longa))
    expect(l.avisos.some((a) => a.startsWith('Instrução de montagem cortada'))).toBe(true)
    expect(l.fontePt).toBeGreaterThanOrEqual(FONTE_CONFORTO_PT) // cortar a instrução em vez de encolher o texto todo
    conferir(l, p50)
  })
  it('antes de abreviar, tenta caber inteiro com fonte confortável', () => {
    const media = { ...montagem, instrucao: 'Fixar a alça a 118 mm da borda, conferir a lapidação e passar silicone neutro no perímetro' }
    const l = layoutDaEtiqueta(p50, conteudoDaEtiqueta(media))
    expect(l.avisos).toEqual([])
    expect(l.fontePt).toBeGreaterThanOrEqual(FONTE_CONFORTO_PT)
  })
  it('SKU longo quebra o serial em duas linhas em vez de cortar', () => {
    const d = { ...produto, sku: 'ESPELHO-ADNET-REDONDO-60-PRETO', serial: 'EHESPELHO-ADNET-REDONDO-60-PRETO2609260001' }
    const l = layoutDaEtiqueta(p50, conteudoDaEtiqueta(d))
    expect(l.cabe).toBe(true)
    expect(l.linhas.find((x) => x.chave === 'serial')?.maxLinhas).toBe(2)
    expect(l.avisos).toContain('Serial em 2 linhas.')
    conferir(l, p50)
  })
  it('quando nem o essencial cabe, diz o que falta', () => {
    const l = layoutDaEtiqueta(tam({ larguraMm: 12, alturaMm: 10, margemMm: 1 }), conteudoDaEtiqueta(caixa))
    expect(l.cabe).toBe(false)
    expect(l.erros.join(' ')).toMatch(/serial|altura|QR/)
    expect(l.erros.at(-1)).toBe('Aumente a etiqueta ou diminua a margem.')
  })
  it('determinístico', () => {
    expect(layoutDaEtiqueta(p60, conteudoDaEtiqueta(caixa))).toEqual(layoutDaEtiqueta(p60, conteudoDaEtiqueta(caixa)))
  })
})

describe('nada corta, em tamanhos e conteúdos variados', () => {
  // Gerador determinístico (mulberry32): o teste é o mesmo em toda execução.
  const aleatorio = (semente: number) => () => {
    semente = (semente + 0x6d2b79f5) | 0
    let x = Math.imul(semente ^ (semente >>> 15), 1 | semente)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  it('400 combinações: quando cabe, QR legível em pontos inteiros e texto essencial inteiro dentro da área', () => {
    const r = aleatorio(20260926)
    const escolha = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
    let cabem = 0
    for (let i = 0; i < 400; i++) {
      const t = tam({
        larguraMm: Math.round(15 + r() * 110),
        alturaMm: Math.round(12 + r() * 80),
        margemMm: Math.round(r() * 30) / 10,
        dpi: escolha([203, 300, 600] as const),
        orientacao: escolha(['normal', 'girada'] as const),
      })
      const sku = 'ED' + String(Math.floor(r() * 1e6)).padStart(6, '0') + (r() < 0.3 ? '-' + 'X'.repeat(Math.floor(r() * 16)) : '')
      const d: DadosEtiqueta = {
        ...escolha([produto, montagem, caixa]),
        sku,
        serial: escolha(['EH', 'ET', 'MPX']) + sku + '2609260001',
        nome: 'Produto '.repeat(1 + Math.floor(r() * 6)).trim(),
        detalhe: r() < 0.5 ? '60cm' : undefined,
      }
      const l = layoutDaEtiqueta(t, conteudoDaEtiqueta(d))
      if (!l.cabe) {
        expect(l.erros.length).toBeGreaterThan(0)
        continue
      }
      cabem++
      conferir(l, t)
    }
    expect(cabem).toBeGreaterThan(250)
  })
})
