// Os formatadores são chamados com dados de banco, de conector e de fila offline: se um deles lançar,
// a tela inteira cai. Estes testes travam o contrato "nunca lança, devolve '—'".
import { describe, expect, it } from 'vitest'
import { brl, dataBR, diaISO, diaProducao, horaBR, num, pct, relativo } from './format'

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
