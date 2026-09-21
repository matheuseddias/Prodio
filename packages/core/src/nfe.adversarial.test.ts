// Testes adversariais do parser de NF-e: chave corrompida, XML sem protocolo, NFC-e, itens sem NCM,
// unidades divergentes, CFOP de entrada, vírgula decimal, namespaces e notas denegadas.
import xmlCompra from './fixtures/nfe-compra-5102.xml?raw'
import xmlSimples from './fixtures/nfe-simples-pcredsn.xml?raw'
import { classificarCfop, decomporChave, dvChaveNfe, validarChaveNfe } from './nfe'
import { NfeParseError, parseNfeXml } from './nfeXml'

const CHAVE = '35260312345678000195550010000012341123456786'
const troca = (xml: string, de: string, para: string) => {
  if (!xml.includes(de)) throw new Error(`fixture não contém ${de}`)
  return xml.replaceAll(de, para)
}

describe('chave de acesso · corrompida', () => {
  it('DV errado em cada posição possível é rejeitado', () => {
    for (let dv = 0; dv <= 9; dv++) expect(validarChaveNfe(CHAVE.slice(0, 43) + dv)).toBe(dv === 6)
  })
  it('chave com letras no lugar de dígitos é inválida; prefixo NFe é tolerado', () => {
    expect(validarChaveNfe(CHAVE.replace('3526', '3S26'))).toBe(false)
    expect(validarChaveNfe(CHAVE.slice(0, 43) + 'X')).toBe(false)
    expect(validarChaveNfe('NFe' + CHAVE)).toBe(true)
    expect(validarChaveNfe(CHAVE + '0')).toBe(false)
  })
  it('null, undefined e número não explodem', () => {
    expect(validarChaveNfe(null as unknown as string)).toBe(false)
    expect(validarChaveNfe(undefined as unknown as string)).toBe(false)
    expect(() => dvChaveNfe('abc')).toThrow(/43/)
    expect(() => decomporChave('NFe' + CHAVE + '1')).toThrow(/44/)
  })
  it('decompor uma chave com DV errado devolve valida: false sem lançar', () => {
    expect(decomporChave(CHAVE.slice(0, 43) + '0').valida).toBe(false)
  })
})

describe('classificarCfop · entradas estranhas', () => {
  it('CFOP 1xxx/2xxx/3xxx é ignorar mesmo com finNFe/tpNF estranhos; com pontuação e espaços também', () => {
    expect(classificarCfop('1102', '4', '0')).toBe('ignorar')
    expect(classificarCfop(' 5.102 ')).toBe('compra')
    expect(classificarCfop('5102', ' 1 ' as string, 1 as unknown as string)).toBe('compra')
  })
  it('CFOP vazio, undefined, curto, longo ou 7xxx é manual', () => {
    expect(classificarCfop('')).toBe('manual')
    expect(classificarCfop(undefined as unknown as string)).toBe('manual')
    expect(classificarCfop('510')).toBe('manual')
    expect(classificarCfop('51020')).toBe('manual')
    expect(classificarCfop('7102')).toBe('manual')
  })
})

describe('parseNfeXml · estrutura', () => {
  it('XML sem protNFe é sem_protocolo; com protNFe sem cStat também', () => {
    const semProt = xmlCompra.replace(/<protNFe[\s\S]*<\/protNFe>/, '')
    const n = parseNfeXml(semProt)
    expect(n.situacao).toBe('sem_protocolo')
    expect(n.chave).toBe(CHAVE)
    expect(n.classificacao).toBe('compra')
    const semCStat = xmlCompra.replace('<cStat>100</cStat>', '')
    expect(parseNfeXml(semCStat).situacao).toBe('sem_protocolo')
  })
  it('NFC-e modelo 65 é rejeitada com mensagem clara; mod ausente também', () => {
    expect(() => parseNfeXml(troca(xmlCompra, '<mod>55</mod>', '<mod>65</mod>'))).toThrow(/65/)
    expect(() => parseNfeXml(troca(xmlCompra, '<mod>55</mod>', ''))).toThrow(/desconhecido/)
  })
  it('nota denegada (cStat 110, 301, 302) é ignorar com aviso', () => {
    for (const c of ['110', '301', '302']) {
      const n = parseNfeXml(troca(xmlCompra, '<cStat>100</cStat>', `<cStat>${c}</cStat>`))
      expect(n.situacao, c).toBe('denegada')
      expect(n.classificacao, c).toBe('ignorar')
      expect(n.avisos.some((a) => /denegada/i.test(a)), c).toBe(true)
    }
  })
  it('cStat desconhecido não derruba: situação desconhecida com aviso', () => {
    const n = parseNfeXml(troca(xmlCompra, '<cStat>100</cStat>', '<cStat>999</cStat>'))
    expect(n.situacao).toBe('desconhecida')
    expect(n.classificacao).toBe('compra')
  })
  it('XML com prefixo de namespace e XML sem namespace nenhum parseiam igual', () => {
    const comPrefixo = xmlCompra
      .replace(/<(\/?)(nfeProc|NFe|infNFe|ide|emit|dest|det|prod|imposto|total|ICMSTot|protNFe|infProt)\b/g, '<$1nfe:$2')
      .replace('xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"', 'xmlns:nfe="http://www.portalfiscal.inf.br/nfe" versao="4.00"')
      .replace('<nfe:NFe xmlns="http://www.portalfiscal.inf.br/nfe">', '<nfe:NFe>')
    const semNs = xmlCompra.replaceAll(' xmlns="http://www.portalfiscal.inf.br/nfe"', '')
    const a = parseNfeXml(comPrefixo)
    const b = parseNfeXml(semNs)
    const c = parseNfeXml(xmlCompra)
    expect(a.chave).toBe(CHAVE)
    expect(a.itens).toHaveLength(2)
    expect(a.totais).toEqual(c.totais)
    expect(b).toEqual(c)
  })
  it('espaço/quebra antes da declaração XML e BOM são tolerados', () => {
    expect(parseNfeXml('\n  ' + xmlCompra).chave).toBe(CHAVE)
    expect(parseNfeXml('﻿' + xmlCompra).chave).toBe(CHAVE)
  })
  it('evento de cancelamento (procEventoNFe) e resNFe não são NF-e', () => {
    expect(() => parseNfeXml('<procEventoNFe><evento><infEvento><chNFe>1</chNFe></infEvento></evento></procEventoNFe>')).toThrow(NfeParseError)
    expect(() => parseNfeXml('<resNFe><chNFe>1</chNFe></resNFe>')).toThrow(/infNFe/)
  })
  it('Id do infNFe truncado cai na chNFe do protocolo; sem nenhuma chave é erro', () => {
    const n = parseNfeXml(troca(xmlCompra, `Id="NFe${CHAVE}"`, 'Id="NFe123"'))
    expect(n.chave).toBe(CHAVE)
    const semChave = troca(xmlCompra, `Id="NFe${CHAVE}"`, 'Id="NFe123"').replace(`<chNFe>${CHAVE}</chNFe>`, '')
    expect(() => parseNfeXml(semChave)).toThrow(/Chave/)
  })
  it('chave do protocolo diferente da nota gera aviso', () => {
    const n = parseNfeXml(troca(xmlCompra, `<chNFe>${CHAVE}</chNFe>`, `<chNFe>${CHAVE.slice(0, 43)}0</chNFe>`))
    expect(n.avisos.some((a) => /protocolo difere/.test(a))).toBe(true)
  })
})

describe('parseNfeXml · itens', () => {
  it('item sem NCM gera aviso e ncm vazio; item sem CFOP é manual', () => {
    const n = parseNfeXml(troca(xmlCompra, '<NCM>60019200</NCM>', ''))
    expect(n.itens[0].ncm).toBe('')
    expect(n.avisos.some((a) => /Item 1.*NCM/.test(a))).toBe(true)
    const semCfop = parseNfeXml(troca(xmlCompra, '<CFOP>5102</CFOP>', ''))
    expect(semCfop.itens.every((i) => i.classificacao === 'manual')).toBe(true)
    expect(semCfop.classificacao).toBe('manual')
  })
  it('uTrib diferente de uCom com qTrib diferente: mantém os dois e avisa', () => {
    const x = troca(xmlCompra, '<uTrib>MT</uTrib><qTrib>100.0000</qTrib><vUnTrib>9.5000000000</vUnTrib>', '<uTrib>KG</uTrib><qTrib>25.0000</qTrib><vUnTrib>38.0000000000</vUnTrib>')
    const n = parseNfeXml(x)
    expect(n.itens[0]).toMatchObject({ uCom: 'MT', qCom: 100, uTrib: 'KG', qTrib: 25, vUnTrib: 38 })
    expect(n.avisos.filter((a) => /difere da tributável/.test(a))).toHaveLength(1)
  })
  it('uTrib ausente herda uCom e não avisa', () => {
    const x = xmlCompra.replaceAll(/<uTrib>[^<]*<\/uTrib><qTrib>[^<]*<\/qTrib><vUnTrib>[^<]*<\/vUnTrib>/g, '')
    const n = parseNfeXml(x)
    expect(n.itens[0]).toMatchObject({ uTrib: 'MT', qTrib: 100, vUnTrib: 9.5 })
    expect(n.avisos.some((a) => /tributável/.test(a))).toBe(false)
  })
  it('CFOP 1xxx num item (nota de entrada emitida pelo próprio tenant) classifica ignorar', () => {
    const n = parseNfeXml(xmlCompra.replaceAll('<CFOP>5102</CFOP>', '<CFOP>1102</CFOP>'))
    expect(n.itens.every((i) => i.classificacao === 'ignorar')).toBe(true)
    expect(n.classificacao).toBe('ignorar')
    // misto (um item compra, outro ignorar) exige decisão humana
    const misto = parseNfeXml(troca(xmlCompra, '<CFOP>5102</CFOP>', '<CFOP>1102</CFOP>').replace('<CFOP>1102</CFOP>', '<CFOP>5102</CFOP>'))
    expect(misto.classificacao).toBe('manual')
  })
  it('valores com vírgula decimal e com separador de milhar são lidos', () => {
    const x = troca(xmlCompra, '<vProd>950.00</vProd>', '<vProd>950,00</vProd>').replace('<vProd>1106.00</vProd>', '<vProd>1.106,00</vProd>')
    const n = parseNfeXml(x)
    expect(n.itens[0].vProd).toBe(950)
    expect(n.itens[1].vProd).toBe(1106)
    expect(n.avisos.some((a) => /Soma dos itens/.test(a))).toBe(false)
  })
  it('valor não numérico vira zero em vez de NaN', () => {
    const n = parseNfeXml(troca(xmlCompra, '<vICMS>171.00</vICMS>', '<vICMS>abc</vICMS>'))
    expect(n.itens[0].icms.vICMS).toBe(0)
    expect(Number.isFinite(n.totais.vNF)).toBe(true)
  })
  it('item com indTot=0 (não compõe o total) não gera aviso de soma divergente', () => {
    const x = troca(xmlCompra, '<vProd>2056.00</vProd>', '<vProd>950.00</vProd>').replace('<indTot>1</indTot>\n          <rastro>', '<indTot>0</indTot>\n          <rastro>')
    const n = parseNfeXml(x)
    expect(n.avisos.some((a) => /Soma dos itens/.test(a))).toBe(false)
  })
  it('nota sem itens: aviso e classificação manual', () => {
    const n = parseNfeXml(xmlCompra.replace(/<det nItem="1">[\s\S]*<\/det>\s*<total>/, '<total>'))
    expect(n.itens).toEqual([])
    expect(n.classificacao).toBe('manual')
    expect(n.avisos.some((a) => /sem itens/.test(a))).toBe(true)
  })
  it('sem dhEmi nem dEmi: emissão vazia e aviso', () => {
    const n = parseNfeXml(troca(xmlCompra, '<dhEmi>2026-03-10T14:22:00-03:00</dhEmi>', ''))
    expect(n.emissao).toBe('')
    expect(n.avisos.some((a) => /emiss/i.test(a))).toBe(true)
    const antigo = parseNfeXml(troca(xmlCompra, '<dhEmi>2026-03-10T14:22:00-03:00</dhEmi>', '<dEmi>2026-03-10</dEmi>'))
    expect(antigo.emissao).toBe('2026-03-10')
  })
  it('CSOSN sem pCredSN (102) no Simples: sem crédito e sem NaN', () => {
    const x = troca(xmlSimples, '<ICMSSN101><orig>0</orig><CSOSN>101</CSOSN><pCredSN>2.56</pCredSN><vCredICMSSN>15.21</vCredICMSSN></ICMSSN101>', '<ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102>')
    const it = parseNfeXml(x).itens[0]
    expect(it.icms).toMatchObject({ csosn: '102', vCredICMSSN: 0, vICMS: 0 })
  })
  it('grupo ICMS vazio ou ausente não crasha', () => {
    const n = parseNfeXml(troca(xmlCompra, '<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>950.00</vBC><pICMS>18.00</pICMS><vICMS>171.00</vICMS></ICMS00></ICMS>', '<ICMS/>'))
    expect(n.itens[0].icms.vICMS).toBe(0)
    expect(n.itens[0].icms.cst).toBeUndefined()
  })
  it('tpNF 0 (nota de entrada do emitente) nunca é compra', () => {
    const n = parseNfeXml(troca(xmlCompra, '<tpNF>1</tpNF>', '<tpNF>0</tpNF>'))
    expect(n.classificacao).toBe('manual')
  })
})
