// Os formatadores são chamados com dados de banco, de conector e de fila offline: se um deles lançar,
// a tela inteira cai. Estes testes travam o contrato "nunca lança, devolve '—'".
import { afterEach, describe, expect, it } from 'vitest'
import { brl, dataBR, dataPorExtenso, diaISO, diaProducao, horaBR, lerNumeroBR, num, numeroParaCampo, pct, relativo } from './format'

const RUIM = [undefined, null, NaN, '', {}, []] as unknown[]

describe('formatadores não lançam', () => {
  it('num, brl e pct devolvem traço para valor inválido', () => {
    for (const v of RUIM) {
      expect(num(v as number)).toBe('—')
      expect(brl(v as number)).toBe('—')
      expect(pct(v as number)).toBe('—')
    }
  })

  it('num continua formatando número de verdade', () => {
    expect(num(1234)).toBe('1.234')
    expect(num(1.5, 1)).toBe('1,5')
    expect(pct(0.42)).toBe('42%')
    expect(brl(10)).toMatch(/^R\$\s10,00$/)
    expect(num(0)).toBe('0')
  })

  it('datas inválidas viram traço em vez de "Invalid Date"', () => {
    for (const v of RUIM) {
      expect(dataBR(v as string)).toBe('—')
      expect(horaBR(v as string)).toBe('—')
      expect(relativo(v as string)).toBe('—')
    }
    expect(dataBR('2026-09-22T12:00:00')).toBe('22/09/2026')
  })
})

describe('data sem hora é dia do calendário local', () => {
  // "Comprar até" e a entrega prevista da OC chegam como AAAA-MM-DD. Em Brasília, new Date('2026-09-26') é
  // 25/09 às 21h: a Necessidade mostrava "25/09/2026" (ontem) sem o selo de vencido, e o chão, a OC um dia antes.
  const tzOriginal = process.env.TZ
  afterEach(() => {
    if (tzOriginal === undefined) delete process.env.TZ
    else process.env.TZ = tzOriginal
  })

  it('não volta um dia a oeste de Greenwich', () => {
    process.env.TZ = 'America/Sao_Paulo'
    expect(new Date('2026-09-26').getDate()).toBe(25) // a armadilha existe neste fuso
    expect(dataBR('2026-09-26')).toBe('26/09/2026')
    expect(dataBR(' 2026-01-01 ')).toBe('01/01/2026')
    expect(relativo('2026-09-26')).not.toBe('—')
  })

  it('não avança um dia a leste de Greenwich', () => {
    process.env.TZ = 'Asia/Tokyo'
    expect(dataBR('2026-09-26')).toBe('26/09/2026')
  })

  it('data com hora continua no instante que veio', () => {
    process.env.TZ = 'America/Sao_Paulo'
    expect(dataBR('2026-09-26T02:00:00Z')).toBe('25/09/2026') // 23h do dia 25 em Brasília
    expect(dataBR('2026-02-30')).toBe('02/03/2026') // o Date do JS rola o mês, como antes
    expect(dataBR('2026-9-26')).toBe('26/09/2026')
  })

  it('por extenso: o dia pedido, em minúsculas (sem "De" capitalizado)', () => {
    process.env.TZ = 'America/Sao_Paulo'
    expect(dataPorExtenso('2026-09-26')).toBe('sábado, 26 de setembro de 2026')
    for (const v of RUIM) expect(dataPorExtenso(v as string)).toBe('—')
  })
})

describe('dia de produção', () => {
  it('usa o calendário local, não UTC', () => {
    // 21:30 em Brasília (UTC-3) já é o dia seguinte em UTC: o dia local tem de continuar sendo o 21.
    const noite = new Date('2026-09-22T00:30:00Z')
    const esperado = `${noite.getFullYear()}-${String(noite.getMonth() + 1).padStart(2, '0')}-${String(noite.getDate()).padStart(2, '0')}`
    expect(diaISO(noite)).toBe(esperado)
  })

  it('desconta a hora de virada: bipe às 02:00 conta para o dia anterior', () => {
    const madrugada = new Date(2026, 8, 22, 2, 0, 0)
    expect(diaProducao('05:00', madrugada)).toBe('2026-09-21')
    expect(diaProducao('05:00', new Date(2026, 8, 22, 9, 0, 0))).toBe('2026-09-22')
  })

  it('cai em 05:00 quando o tenant não tem hora de virada', () => {
    const madrugada = new Date(2026, 8, 22, 2, 0, 0)
    expect(diaProducao(undefined, madrugada)).toBe('2026-09-21')
    expect(diaProducao('', madrugada)).toBe('2026-09-21')
  })
})

// Campo de número da ficha técnica, do fator do fornecedor e da quantidade recebida no chão:
// o operador digita com vírgula e o campo não pode trocar 0,5 por 5.
describe('número digitado em pt-BR', () => {
  it('lê vírgula decimal, milhar com ponto e ponto decimal sem vírgula', () => {
    expect(lerNumeroBR('0,5')).toBe(0.5)
    expect(lerNumeroBR('12,3456')).toBe(12.3456)
    expect(lerNumeroBR('100,00')).toBe(100)
    expect(lerNumeroBR('1.234,56')).toBe(1234.56)
    expect(lerNumeroBR('1234.5')).toBe(1234.5)
    expect(lerNumeroBR(' 7 ')).toBe(7)
    expect(lerNumeroBR('-2,5')).toBe(-2.5)
  })

  it('meio de digitação vale o que já dá para ler', () => {
    expect(lerNumeroBR('5,')).toBe(5)
    expect(lerNumeroBR(',5')).toBe(0.5)
    expect(lerNumeroBR('0,')).toBe(0)
  })

  it('texto que não é número vira NaN (o campo não grava)', () => {
    for (const v of ['', ' ', ',', '-', '1,2,3', 'abc', '1e3', '12a', undefined as unknown as string]) expect(lerNumeroBR(v)).toBeNaN()
  })

  it('mostra para edição com vírgula, sem milhar e sem zeros à direita', () => {
    expect(numeroParaCampo(0.5)).toBe('0,5')
    expect(numeroParaCampo(12.3456)).toBe('12,3456')
    expect(numeroParaCampo(1234.5)).toBe('1234,5')
    expect(numeroParaCampo(100)).toBe('100')
    expect(numeroParaCampo(0.00025)).toBe('0,00025')
    expect(numeroParaCampo(0.1234567, 4)).toBe('0,1235')
    expect(numeroParaCampo(NaN)).toBe('')
    expect(numeroParaCampo(undefined as unknown as number)).toBe('')
  })

  it('ida e volta não muda o número', () => {
    for (const v of [0, 0.5, 12.3456, 1234.5, 0.00025, 7]) expect(lerNumeroBR(numeroParaCampo(v))).toBe(v)
  })
})
