import xmlCancelada from './fixtures/nfe-cancelada-101.xml?raw'
import xmlChapaSt from './fixtures/nfe-chapa-st-5401.xml?raw'
import xmlCompra from './fixtures/nfe-compra-5102.xml?raw'
import xmlDevolucao from './fixtures/nfe-devolucao-5202.xml?raw'
import xmlFrete from './fixtures/nfe-frete-desconto-utrib.xml?raw'
import xmlInvalido from './fixtures/nfe-invalido.xml?raw'
import xmlSimples from './fixtures/nfe-simples-pcredsn.xml?raw'
import { classificarCfop, decomporChave, dvChaveNfe, NfeParseError, parseNfeXml, validarChaveNfe } from './nfe'

const CHAVE = '35260312345678000195550010000012341123456786'

describe('chave de acesso', () => {
  it('valida 44 dígitos com DV módulo 11 (pesos 2-9)', () => {
    expect(validarChaveNfe(CHAVE)).toBe(true)
    expect(validarChaveNfe('3526 0312 3456 7800 0195 5500 1000 0012 3411 2345 6786')).toBe(true)
    expect(dvChaveNfe(CHAVE.slice(0, 43))).toBe(6)
  })
  it('rejeita DV errado, tamanho errado e vazio', () => {
    expect(validarChaveNfe(CHAVE.slice(0, 43) + '7')).toBe(false)
    expect(validarChaveNfe(CHAVE.slice(0, 40))).toBe(false)
    expect(validarChaveNfe('')).toBe(false)
  })
  it('resto 0 ou 1 gera DV 0', () => {
    // base escolhida para soma % 11 == 0
    const base = '00000000000000000000000000000000000000000000'.slice(0, 43)
    expect(dvChaveNfe(base)).toBe(0)
  })
  it('decompõe UF, AAMM, CNPJ, modelo, série, número, tpEmis, cNF e DV', () => {
    expect(decomporChave(CHAVE)).toEqual({ cUF: '35', aamm: '2603', cnpj: '12345678000195', modelo: '55', serie: 1, numero: 1234, tpEmis: '1', cNF: '12345678', dv: 6, valida: true })
    expect(() => decomporChave('123')).toThrow(/44/)
  })
})

describe('classificarCfop', () => {
  it('compra: 5101/5102/5401/5403/5405/5122/5124 e equivalentes 6xxx', () => {
    for (const c of ['5101', '5102', '5401', '5403', '5405', '5122', '5124', '6101', '6102', '6401', '6403', '6404', '6122', '6124']) expect(classificarCfop(c, '1', '1'), c).toBe('compra')
  })
  it('manual: remessas, devoluções, bonificação, industrialização por encomenda e desconhecidos', () => {
    for (const c of ['5901', '5902', '5910', '5915', '5916', '5202', '5949', '5125', '6202', '6949', '5933', '7102', 'abc']) expect(classificarCfop(c, '1', '1'), c).toBe('manual')
  })
  it('ignorar: 1xxx/2xxx/3xxx (nota de entrada do próprio tenant)', () => {
    expect(classificarCfop('1102')).toBe('ignorar')
    expect(classificarCfop('2102')).toBe('ignorar')
    expect(classificarCfop('3102')).toBe('ignorar')
  })
  it('finNFe de devolução/complementar ou tpNF de entrada nunca é compra', () => {
    expect(classificarCfop('5102', '4', '1')).toBe('manual')
    expect(classificarCfop('5102', '2', '1')).toBe('manual')
    expect(classificarCfop('5102', '1', '0')).toBe('manual')
  })
})

describe('parseNfeXml', () => {
  it('compra 5102 com 2 itens: cabeçalho, totais, itens, tributos, rastro e classificação', () => {
    const n = parseNfeXml(xmlCompra)
    expect(n.chave).toBe(CHAVE)
    expect(n.modelo).toBe('55')
    expect(n.situacao).toBe('autorizada')
    expect(n.cStat).toBe('100')
    expect(n.serie).toBe(1)
    expect(n.numero).toBe(1234)
    expect(n.finNFe).toBe('1')
    expect(n.tpNF).toBe('1')
    expect(n.emitente).toMatchObject({ cnpj: '12345678000195', nome: 'TECIDOS EXEMPLO LTDA', crt: '3', uf: 'SP', simples: false })
    expect(n.destinatario.cnpj).toBe('55666777000188')
    expect(n.emissao).toBe('2026-03-10')
    expect(n.totais).toMatchObject({ vProd: 2056, vNF: 2166.6, vICMS: 370.08, vIPI: 110.6, vPIS: 27.81, vCOFINS: 128.13, vST: 0, vFrete: 0, vDesc: 0 })
    expect(n.itens).toHaveLength(2)
    const [i1, i2] = n.itens
    expect(i1).toMatchObject({ nItem: 1, cProd: 'SUE-PRT', ncm: '60019200', cfop: '5102', uCom: 'MT', qCom: 100, vUnCom: 9.5, vProd: 950, uTrib: 'MT', qTrib: 100, classificacao: 'compra' })
    expect(i1.icms).toMatchObject({ cst: '00', vBC: 950, pICMS: 18, vICMS: 171, vICMSST: 0 })
    expect(i1.ipi).toMatchObject({ cst: '53', v: 0 })
    expect(i1.pis).toMatchObject({ cst: '01', p: 1.65, v: 12.85 })
    expect(i1.cofins).toMatchObject({ cst: '01', p: 7.6, v: 59.2 })
    expect(i2).toMatchObject({ nItem: 2, cProd: 'COLA-793', qCom: 2, vUnCom: 553, vProd: 1106 })
    expect(i2.ipi).toMatchObject({ cst: '50', p: 10, v: 110.6 })
    expect(i2.rastro).toEqual([{ nLote: 'L2603A', qLote: 2, dFab: '2026-03-01', dVal: '2027-03-01' }])
    expect(n.classificacao).toBe('compra')
    expect(n.avisos).toEqual([])
  })
  it('chapa com ST 5401: lê ICMS próprio e ICMS-ST separados', () => {
    const n = parseNfeXml(xmlChapaSt)
    expect(n.serie).toBe(2)
    expect(n.numero).toBe(777)
    const it = n.itens[0]
    expect(it.cfop).toBe('5401')
    expect(it.classificacao).toBe('compra')
    expect(it.icms).toMatchObject({ cst: '10', vICMS: 249.04, vBCST: 1798.6, vICMSST: 74.71 })
    expect(it.ipi.v).toBe(138.35)
    expect(n.totais.vST).toBe(74.71)
    expect(n.totais.vNF).toBe(1596.6)
  })
  it('fornecedor Simples (NFe solta, sem nfeProc): CSOSN 101 com pCredSN/vCredICMSSN e aviso de sem protocolo', () => {
    const n = parseNfeXml(xmlSimples)
    expect(n.situacao).toBe('sem_protocolo')
    expect(n.cStat).toBeUndefined()
    expect(n.emitente.simples).toBe(true)
    expect(n.emitente.crt).toBe('1')
    const it = n.itens[0]
    expect(it.cfop).toBe('6102')
    expect(it.classificacao).toBe('compra')
    expect(it.icms).toMatchObject({ csosn: '101', pCredSN: 2.56, vCredICMSSN: 15.21, vICMS: 0 })
    expect(it.pis).toMatchObject({ cst: '07', v: 0 })
    expect(n.avisos.some((a) => /protocolo/.test(a))).toBe(true)
  })
  it('devolução 5202 (finNFe 4) vira manual com aviso', () => {
    const n = parseNfeXml(xmlDevolucao)
    expect(n.finNFe).toBe('4')
    expect(n.itens[0].classificacao).toBe('manual')
    expect(n.classificacao).toBe('manual')
    expect(n.avisos.some((a) => /devolução/i.test(a))).toBe(true)
  })
  it('nota cancelada (cStat 101) é ignorada com aviso', () => {
    const n = parseNfeXml(xmlCancelada)
    expect(n.situacao).toBe('cancelada')
    expect(n.cStat).toBe('101')
    expect(n.classificacao).toBe('ignorar')
    expect(n.avisos.some((a) => /cancelada/i.test(a))).toBe(true)
  })
  it('frete, desconto, uTrib diferente de uCom (CX vs UN) e grupo IBS/CBS em 2027', () => {
    const n = parseNfeXml(xmlFrete)
    expect(n.emissao).toBe('2027-02-15')
    const it = n.itens[0]
    expect(it).toMatchObject({ uCom: 'CX', qCom: 10, vUnCom: 34.9, uTrib: 'UN', qTrib: 100, vUnTrib: 3.49, vFrete: 20, vDesc: 9, vProd: 349 })
    expect(it.ibs).toMatchObject({ cst: '000', vBC: 360, p: 0.1, v: 0.36 })
    expect(it.cbs).toMatchObject({ p: 8.8, v: 31.68 })
    expect(it.pis.v).toBe(0)
    expect(n.totais).toMatchObject({ vFrete: 20, vDesc: 9, vNF: 360, vIBS: 0.36, vCBS: 31.68 })
    expect(n.avisos.some((a) => /CX difere da tributável UN/.test(a))).toBe(true)
  })
  it('XML inválido, vazio, sem infNFe e modelo 65 lançam NfeParseError', () => {
    expect(() => parseNfeXml(xmlInvalido)).toThrow(NfeParseError)
    expect(() => parseNfeXml('')).toThrow(/vazio/)
    expect(() => parseNfeXml('<root><a>1</a></root>')).toThrow(/infNFe/)
    const nfce = xmlCompra.replace('<mod>55</mod>', '<mod>65</mod>')
    expect(() => parseNfeXml(nfce)).toThrow(/modelo 55/)
  })
  it('DV errado na chave e soma de itens divergente viram avisos, não erro', () => {
    const alterado = xmlCompra.replaceAll(CHAVE, CHAVE.slice(0, 43) + '0').replace('<vProd>2056.00</vProd>', '<vProd>2000.00</vProd>')
    const n = parseNfeXml(alterado)
    expect(n.avisos.some((a) => /verificador/.test(a))).toBe(true)
    expect(n.avisos.some((a) => /Soma dos itens/.test(a))).toBe(true)
  })
})
