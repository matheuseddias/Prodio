import { creditaTributo, TRIBUTOS, tributo, tributoVigente } from './tributos'

describe('tabela de tributos e vigência', () => {
  it('todos os tributos têm entrada e código único', () => {
    const codigos = TRIBUTOS.map((t) => t.codigo)
    expect(new Set(codigos).size).toBe(codigos.length)
    expect(tributo('ICMSST').creditaPara).toEqual([])
  })
  it('PIS/COFINS vigentes até 2026-12-31; CBS a partir de 2027-01-01', () => {
    expect(tributoVigente('PIS', '2026-12-31')).toBe(true)
    expect(tributoVigente('COFINS', '2027-01-01')).toBe(false)
    expect(tributoVigente('CBS', '2026-12-31')).toBe(false)
    expect(tributoVigente('CBS', '2027-01-01T00:00:00-03:00')).toBe(true)
  })
  it('IPI zera em 2027 fora da ZFM e segue na ZFM', () => {
    expect(tributoVigente('IPI', '2026-06-01')).toBe(true)
    expect(tributoVigente('IPI', '2027-03-01')).toBe(false)
    expect(tributoVigente('IPI', '2027-03-01', { zfm: true })).toBe(true)
  })
  it('IBS em transição desde 2026; ICMS até 2032', () => {
    expect(tributoVigente('IBS', '2025-12-31')).toBe(false)
    expect(tributoVigente('IBS', '2026-01-01')).toBe(true)
    expect(tributoVigente('ICMS', '2033-01-01')).toBe(false)
  })
  it('creditaTributo cruza regime × vigência', () => {
    expect(creditaTributo('ICMS', 'simples', '2026-01-01')).toBe(false)
    expect(creditaTributo('ICMS', 'presumido', '2026-01-01')).toBe(true)
    expect(creditaTributo('PIS', 'presumido', '2026-01-01')).toBe(false)
    expect(creditaTributo('PIS', 'real', '2026-01-01')).toBe(true)
    expect(creditaTributo('PIS', 'real', '2027-01-01')).toBe(false)
    expect(creditaTributo('ICMSST', 'real', '2026-01-01')).toBe(false)
  })
})
