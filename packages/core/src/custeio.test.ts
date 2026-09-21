import { creditosDoItem, custoMedioPonderado, custoUnitarioEntrada, ratearPorValor, tributosDoItemNfe } from './custeio'
import xmlChapaSt from './fixtures/nfe-chapa-st-5401.xml?raw'
import xmlCompra from './fixtures/nfe-compra-5102.xml?raw'
import xmlFrete from './fixtures/nfe-frete-desconto-utrib.xml?raw'
import xmlSimples from './fixtures/nfe-simples-pcredsn.xml?raw'
import { parseNfeXml } from './nfe'

describe('custoMedioPonderado (casos portados de motores.mjs)', () => {
  it('entrada: saldo soma', () => {
    expect(custoMedioPonderado(10, 2, 10, 4).saldo).toBe(20)
  })
  it('entrada: custo médio 10@2 + 10@4 = 3', () => {
    expect(custoMedioPonderado(10, 2, 10, 4).custoMedio).toBe(3)
  })
  it('saldo zero: o custo vira o da entrada (em unidade de consumo)', () => {
    expect(custoMedioPonderado(0, 0, 6, 5).custoMedio).toBe(5)
    expect(custoMedioPonderado(0, 99, 6, 5).custoMedio).toBe(5)
  })
  it('saída mantém o custo médio; saldo negativo anterior não polui a média', () => {
    expect(custoMedioPonderado(20, 3, -5, 0)).toEqual({ saldo: 15, custoMedio: 3 })
    expect(custoMedioPonderado(-2, 3, 10, 7)).toEqual({ saldo: 8, custoMedio: 7 })
  })
})

describe('custoUnitarioEntrada e rateio', () => {
  it('custo bruto + IPI + ST + frete rateado − desconto, por unidade de consumo', () => {
    // 2 caixas de 100 tubos: 1106 + IPI 110,60 + frete 20 − desconto 6 = 1230,60 ÷ 200 = 6,153
    expect(custoUnitarioEntrada({ vProd: 1106, vIPI: 110.6, vFrete: 20, vDesc: 6, qtdConsumo: 200 })).toBeCloseTo(6.153, 6)
    expect(custoUnitarioEntrada({ vProd: 1383.54, vIPI: 138.35, vICMSST: 74.71, qtdConsumo: 30.8 })).toBeCloseTo(51.84, 2)
    expect(() => custoUnitarioEntrada({ vProd: 10, qtdConsumo: 0 })).toThrow()
  })
  it('rateia frete proporcional ao valor, em centavos, sem perder a diferença', () => {
    expect(ratearPorValor([950, 1106], 20)).toEqual([9.24, 10.76])
    expect(ratearPorValor([10, 10, 10], 1)).toEqual([0.33, 0.33, 0.34])
    expect(ratearPorValor([10, 10], 0)).toEqual([0, 0])
    expect(ratearPorValor([], 5)).toEqual([])
  })
})

describe('creditosDoItem por valores destacados', () => {
  const compra = parseNfeXml(xmlCompra)
  const cola = compra.itens[1] // ICMS 199,08 · IPI 110,60 · PIS 14,96 · COFINS 68,93

  it('lucro real credita ICMS, IPI, PIS e COFINS em 2026', () => {
    const c = creditosDoItem(cola, 'real', cola.cfop, compra.emissao)
    expect(c).toMatchObject({ icms: 199.08, ipi: 110.6, pis: 14.96, cofins: 68.93, cbs: 0, ibs: 0, stNoCusto: 0 })
    expect(c.total).toBeCloseTo(393.57, 2)
  })
  it('presumido credita só ICMS; Simples não credita nada', () => {
    const p = creditosDoItem(cola, 'presumido', cola.cfop, compra.emissao)
    expect(p).toMatchObject({ icms: 199.08, ipi: 0, pis: 0, cofins: 0 })
    expect(p.total).toBe(199.08)
    const s = creditosDoItem(cola, 'simples', cola.cfop, compra.emissao)
    expect(s.total).toBe(0)
    expect(s.motivos[0]).toMatch(/Simples/)
  })
  it('chapa com ST: ICMS-ST não credita e entra no custo; ICMS próprio credita', () => {
    const nota = parseNfeXml(xmlChapaSt)
    const c = creditosDoItem(nota.itens[0], 'real', '5401', nota.emissao)
    expect(c.icms).toBe(249.04)
    expect(c.stNoCusto).toBe(74.71)
    expect(c.total).toBeCloseTo(249.04 + 138.35 + 18.72 + 86.22, 2)
    expect(c.motivos.some((m) => /ICMS-ST/.test(m))).toBe(true)
  })
  it('fornecedor Simples com pCredSN: credita só o vCredICMSSN, nunca PIS/COFINS/IPI', () => {
    const nota = parseNfeXml(xmlSimples)
    const t = tributosDoItemNfe(nota.itens[0])
    expect(t.fornecedorSimples).toBe(true)
    const c = creditosDoItem(nota.itens[0], 'real', '6102', nota.emissao)
    expect(c).toMatchObject({ icms: 15.21, ipi: 0, pis: 0, cofins: 0, total: 15.21 })
    const semCred = creditosDoItem({ vICMS: 50, fornecedorSimples: true, vCredICMSSN: 0 }, 'real', '5102', '2026-05-01')
    expect(semCred.icms).toBe(0)
  })
  it('PIS/COFINS creditam até 2026-12-31 e param em 2027; CBS começa em 2027; IPI zera em 2027 fora da ZFM', () => {
    const item = { vICMS: 18, vIPI: 10, vPIS: 1.65, vCOFINS: 7.6, vCBS: 8.8, vIBS: 0.1 }
    const antes = creditosDoItem(item, 'real', '5102', '2026-12-31')
    expect(antes).toMatchObject({ pis: 1.65, cofins: 7.6, ipi: 10, cbs: 0, ibs: 0.1 })
    const depois = creditosDoItem(item, 'real', '5102', '2027-01-01')
    expect(depois).toMatchObject({ pis: 0, cofins: 0, ipi: 0, cbs: 8.8, ibs: 0.1, icms: 18 })
    expect(depois.motivos.some((m) => /IPI/.test(m))).toBe(true)
    const zfm = creditosDoItem(item, 'real', '5102', '2027-01-01', { zfm: true })
    expect(zfm.ipi).toBe(10)
  })
  it('nota de 2027 parseada: real credita CBS e IBS destacados', () => {
    const nota = parseNfeXml(xmlFrete)
    const c = creditosDoItem(nota.itens[0], 'real', nota.itens[0].cfop, nota.emissao)
    expect(c).toMatchObject({ icms: 64.8, cbs: 31.68, ibs: 0.36, pis: 0, cofins: 0 })
  })
  it('CFOP que não é compra não gera crédito (devolução, remessa, entrada própria)', () => {
    expect(creditosDoItem(cola, 'real', '5202', compra.emissao).total).toBe(0)
    expect(creditosDoItem(cola, 'real', '5915', compra.emissao).total).toBe(0)
    expect(creditosDoItem(cola, 'real', '5102', compra.emissao, { finNFe: '4' }).total).toBe(0)
  })
})
