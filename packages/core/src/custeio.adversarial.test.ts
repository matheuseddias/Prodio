// Testes adversariais do custeio: saldo negativo, quantidade e custo zero, ST, virada 2026→2027, regime desconhecido.
import { creditosDoItem, custoMedioPonderado, custoUnitarioEntrada, ratearPorValor } from './custeio'
import type { Regime } from './tipos'
import { creditaTributo, tributoVigente } from './tributos'

describe('custoMedioPonderado · casos-limite', () => {
  it('saldo negativo anterior: a entrada define o custo, mesmo que o saldo continue negativo', () => {
    expect(custoMedioPonderado(-10, 3, 4, 7)).toEqual({ saldo: -6, custoMedio: 7 })
    expect(custoMedioPonderado(-10, 3, 10, 7)).toEqual({ saldo: 0, custoMedio: 7 })
    expect(custoMedioPonderado(-10, 3, 12, 7)).toEqual({ saldo: 2, custoMedio: 7 })
  })
  it('quantidade zero não muda nada', () => {
    expect(custoMedioPonderado(10, 2.5, 0, 99)).toEqual({ saldo: 10, custoMedio: 2.5 })
    expect(custoMedioPonderado(0, 0, 0, 99)).toEqual({ saldo: 0, custoMedio: 0 })
  })
  it('entrada com custo zero (bonificação) dilui a média; saída maior que o saldo mantém o custo', () => {
    expect(custoMedioPonderado(10, 4, 10, 0)).toEqual({ saldo: 20, custoMedio: 2 })
    expect(custoMedioPonderado(10, 4, -25, 0)).toEqual({ saldo: -15, custoMedio: 4 })
  })
  it('custo médio anterior nulo/NaN vale zero; custo de entrada NaN é erro (nunca polui o ledger)', () => {
    expect(custoMedioPonderado(10, NaN, 10, 4)).toEqual({ saldo: 20, custoMedio: 2 })
    expect(custoMedioPonderado(NaN, 5, 10, 4)).toEqual({ saldo: 10, custoMedio: 4 })
    expect(() => custoMedioPonderado(10, 2, 10, NaN)).toThrow()
    expect(() => custoMedioPonderado(10, 2, NaN, 4)).toThrow()
    expect(() => custoMedioPonderado(10, 2, Infinity, 4)).toThrow()
  })
  it('custo negativo de entrada é erro', () => {
    expect(() => custoMedioPonderado(10, 2, 10, -1)).toThrow()
  })
})

describe('custoUnitarioEntrada · casos-limite', () => {
  it('quantidade zero, negativa ou NaN é erro', () => {
    for (const qtdConsumo of [0, -1, NaN, Infinity]) expect(() => custoUnitarioEntrada({ vProd: 10, qtdConsumo })).toThrow()
  })
  it('desconto maior que o valor da mercadoria não gera custo negativo', () => {
    expect(() => custoUnitarioEntrada({ vProd: 10, vDesc: 15, qtdConsumo: 1 })).toThrow(/negativo/)
  })
  it('valor zero (bonificação) é custo zero, não erro', () => {
    expect(custoUnitarioEntrada({ vProd: 0, qtdConsumo: 10 })).toBe(0)
  })
  it('ST sem valor e com valor', () => {
    expect(custoUnitarioEntrada({ vProd: 100, vICMSST: 0, qtdConsumo: 10 })).toBe(10)
    expect(custoUnitarioEntrada({ vProd: 100, vICMSST: undefined, qtdConsumo: 10 })).toBe(10)
    expect(custoUnitarioEntrada({ vProd: 100, vICMSST: 7.5, qtdConsumo: 10 })).toBe(10.75)
  })
  it('créditos recuperáveis, quando informados, saem do custo', () => {
    // 1106 + IPI 110,60 − créditos 393,57 = 823,03 ÷ 200
    expect(custoUnitarioEntrada({ vProd: 1106, vIPI: 110.6, creditos: 393.57, qtdConsumo: 200 })).toBeCloseTo(4.11515, 5)
    expect(() => custoUnitarioEntrada({ vProd: 10, creditos: 20, qtdConsumo: 1 })).toThrow(/negativo/)
  })
})

describe('ratearPorValor · casos-limite', () => {
  it('itens com valor zero (bonificação) não perdem o frete: rateio igual', () => {
    expect(ratearPorValor([0, 0], 10)).toEqual([5, 5])
    expect(ratearPorValor([0, 0, 0], 1)).toEqual([0.33, 0.33, 0.34])
  })
  it('um item leva tudo; total negativo ou NaN vira zero', () => {
    expect(ratearPorValor([42], 7.77)).toEqual([7.77])
    expect(ratearPorValor([10, 20], -5)).toEqual([0, 0])
    expect(ratearPorValor([10, 20], NaN)).toEqual([0, 0])
  })
  it('soma das partes bate com o total em centavos mesmo com muitos itens', () => {
    const valores = Array.from({ length: 37 }, (_, i) => 3.33 * (i + 1))
    const partes = ratearPorValor(valores, 99.99)
    expect(partes.reduce((a, v) => a + v, 0)).toBeCloseTo(99.99, 2)
    expect(partes.every((p) => Number.isInteger(Math.round(p * 100)))).toBe(true)
  })
})

describe('creditosDoItem · virada 2026→2027, ST, regimes', () => {
  const item = { vICMS: 18, vICMSST: 0, vIPI: 10, vPIS: 1.65, vCOFINS: 7.6, vCBS: 8.8, vIBS: 0.1 }

  it('2026-12-31 (último dia de PIS/COFINS/IPI) versus 2027-01-01 (CBS)', () => {
    const a = creditosDoItem(item, 'real', '5102', '2026-12-31')
    expect(a).toMatchObject({ icms: 18, ipi: 10, pis: 1.65, cofins: 7.6, cbs: 0, ibs: 0.1 })
    expect(a.total).toBeCloseTo(37.35, 6)
    const b = creditosDoItem(item, 'real', '5102', '2027-01-01')
    expect(b).toMatchObject({ icms: 18, ipi: 0, pis: 0, cofins: 0, cbs: 8.8, ibs: 0.1 })
    expect(b.total).toBeCloseTo(26.9, 6)
  })
  it('data com hora na virada: 2026-12-31T23:59:59-03:00 ainda é 2026', () => {
    expect(creditosDoItem(item, 'real', '5102', '2026-12-31T23:59:59-03:00').pis).toBe(1.65)
    expect(creditosDoItem(item, 'real', '5102', '2027-01-01T00:00:00-03:00').pis).toBe(0)
  })
  it('IBS antes de 2026 não credita; CBS antes de 2027 não credita', () => {
    expect(creditosDoItem(item, 'real', '5102', '2025-12-31')).toMatchObject({ ibs: 0, cbs: 0, pis: 1.65 })
    expect(tributoVigente('IBS', '2025-12-31')).toBe(false)
  })
  it('data inválida ou vazia: nenhum crédito e motivo explícito (conservador)', () => {
    for (const data of ['', '31/12/2026', 'abc', '2026-13-40']) {
      const c = creditosDoItem(item, 'real', '5102', data)
      expect(c.total, data).toBe(0)
      expect(c.motivos.some((m) => /data/i.test(m)), data).toBe(true)
    }
    expect(tributoVigente('PIS', '')).toBe(false)
    expect(creditaTributo('ICMS', 'real', 'abc')).toBe(false)
  })
  it('ST com valor entra no custo e não credita; ST sem valor não gera motivo', () => {
    const com = creditosDoItem({ ...item, vICMSST: 30 }, 'real', '5401', '2026-06-01')
    expect(com.stNoCusto).toBe(30)
    expect(com.icms).toBe(18)
    expect(com.motivos.some((m) => /ICMS-ST/.test(m))).toBe(true)
    const sem = creditosDoItem(item, 'real', '5401', '2026-06-01')
    expect(sem.stNoCusto).toBe(0)
    expect(sem.motivos.some((m) => /ICMS-ST/.test(m))).toBe(false)
    const semCampo = creditosDoItem({ vICMS: 5 }, 'real', '5401', '2026-06-01')
    expect(semCampo.stNoCusto).toBe(0)
  })
  it('ST no Simples também é reportada no custo, mesmo sem crédito', () => {
    const c = creditosDoItem({ ...item, vICMSST: 30 }, 'simples', '5401', '2026-06-01')
    expect(c.total).toBe(0)
    expect(c.stNoCusto).toBe(30)
  })
  it('regime desconhecido: nenhum crédito e motivo explícito', () => {
    const c = creditosDoItem(item, 'mei' as Regime, '5102', '2026-06-01')
    expect(c.total).toBe(0)
    expect(c.motivos.some((m) => /regime/i.test(m))).toBe(true)
    const u = creditosDoItem(item, undefined as unknown as Regime, '5102', '2026-06-01')
    expect(u.total).toBe(0)
  })
  it('presumido: ICMS credita, IPI destacado vai para o custo com motivo; CFOP 1xxx nunca credita', () => {
    const p = creditosDoItem(item, 'presumido', '5102', '2026-06-01')
    expect(p).toMatchObject({ icms: 18, ipi: 0, pis: 0, cofins: 0 })
    expect(p.motivos.some((m) => /IPI/.test(m))).toBe(true)
    const e = creditosDoItem(item, 'real', '1102', '2026-06-01')
    expect(e.total).toBe(0)
    expect(e.motivos.some((m) => /ignorar/.test(m))).toBe(true)
  })
  it('valores NaN/undefined no item viram zero e não contaminam o total', () => {
    const c = creditosDoItem({ vICMS: NaN, vIPI: undefined, vPIS: Infinity, vCOFINS: 7.6 }, 'real', '5102', '2026-06-01')
    expect(c).toMatchObject({ icms: 0, ipi: 0, pis: 0, cofins: 7.6, total: 7.6 })
  })
  it('fornecedor do Simples com CSOSN e vICMS destacado por engano não credita o vICMS', () => {
    const c = creditosDoItem({ vICMS: 50, fornecedorSimples: true, vCredICMSSN: 2 }, 'real', '5102', '2026-06-01')
    expect(c.icms).toBe(2)
  })
})
