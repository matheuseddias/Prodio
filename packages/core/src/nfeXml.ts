// Parser do XML da NF-e (modelo 55) para o formato normalizado NfeParsed.
// Depende de fast-xml-parser, então NÃO entra no barril do pacote: o navegador não precisa dele.
// Importe por caminho: import { parseNfeXml } from '@prodio/core/nfeXml'.
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { NfeClassificacao, NfeParsed, NfeParsedIcms, NfeParsedItem, NfeParsedRastro, NfeParsedTotais, NfeParsedTributo, NfeSituacao } from './tipos'
import { classificarCfop, somenteDigitos, validarChaveNfe } from './nfe'

export class NfeParseError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'NfeParseError'
  }
}

// ---------------------------------------------------------------------------
// Parser do XML
// ---------------------------------------------------------------------------
type Nodo = Record<string, unknown>
const obj = (v: unknown): Nodo => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Nodo) : {})
const lista = (v: unknown): Nodo[] => (Array.isArray(v) ? v.map(obj) : v && typeof v === 'object' ? [obj(v)] : [])
const txt = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? txt((v as Nodo)['#text']) : String(v).trim())
// Número decimal do XML. O layout manda ponto decimal, mas XML retrabalhado à mão chega com vírgula
// ("950,00") e até milhar ("1.106,00"): com vírgula presente, o ponto é separador de milhar.
const num = (v: unknown): number => {
  const t = txt(v)
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : 0
}

const TAGS_LISTA = new Set(['det', 'rastro', 'dup', 'vol', 'detPag', 'DI', 'adi'])
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => TAGS_LISTA.has(nome),
})

const SITUACOES: Record<string, NfeSituacao> = {
  '100': 'autorizada',
  '150': 'autorizada',
  '101': 'cancelada',
  '135': 'cancelada',
  '151': 'cancelada',
  '155': 'cancelada',
  '110': 'denegada',
  '301': 'denegada',
  '302': 'denegada',
  '303': 'denegada',
}

// Grupo de tributo padrão (IPI/PIS/COFINS): {CST, vBC, pX, vX} vindo de subgrupos (IPITrib, PISAliq, PISOutr…).
function lerTributo(grupo: unknown, campoP: string, campoV: string): NfeParsedTributo {
  const g = obj(grupo)
  const sub = Object.keys(g).find((k) => !k.startsWith('@_') && typeof g[k] === 'object')
  const fonte = sub ? obj(g[sub]) : g
  return { cst: txt(fonte.CST) || undefined, vBC: num(fonte.vBC), p: num(fonte[campoP]), v: num(fonte[campoV]) }
}

function lerIcms(grupo: unknown): NfeParsedIcms {
  const g = obj(grupo)
  const sub = Object.keys(g).find((k) => k.startsWith('ICMS'))
  const f = sub ? obj(g[sub]) : {}
  return {
    cst: txt(f.CST) || undefined,
    csosn: txt(f.CSOSN) || undefined,
    orig: txt(f.orig) || undefined,
    vBC: num(f.vBC),
    pICMS: num(f.pICMS),
    vICMS: num(f.vICMS),
    vBCST: num(f.vBCST),
    vICMSST: num(f.vICMSST),
    pCredSN: num(f.pCredSN),
    vCredICMSSN: num(f.vCredICMSSN),
  }
}

// Grupo IBSCBS (NT 2025.002): gIBSCBS { vBC, gIBSUF{pIBSUF,vIBSUF}, gIBSMun{pIBSMun,vIBSMun}, vIBS, gCBS{pCBS,vCBS} }
function lerIbsCbs(grupo: unknown): { ibs: NfeParsedTributo; cbs: NfeParsedTributo } {
  const g = obj(grupo)
  const cst = txt(g.CST) || undefined
  const gi = obj(g.gIBSCBS)
  const uf = obj(gi.gIBSUF)
  const mun = obj(gi.gIBSMun)
  const cbs = obj(gi.gCBS)
  const vIBS = gi.vIBS !== undefined ? num(gi.vIBS) : num(uf.vIBSUF) + num(mun.vIBSMun)
  return {
    ibs: { cst, vBC: num(gi.vBC), p: num(uf.pIBSUF) + num(mun.pIBSMun), v: vIBS },
    cbs: { cst, vBC: num(gi.vBC), p: num(cbs.pCBS), v: num(cbs.vCBS) },
  }
}

function lerItem(det: Nodo, finNFe: string, tpNF: string): NfeParsedItem {
  const prod = obj(det.prod)
  const imp = obj(det.imposto)
  const { ibs, cbs } = lerIbsCbs(imp.IBSCBS)
  const cfop = txt(prod.CFOP)
  const rastro: NfeParsedRastro[] = lista(prod.rastro).map((r) => ({ nLote: txt(r.nLote), qLote: r.qLote !== undefined ? num(r.qLote) : undefined, dFab: txt(r.dFab) || undefined, dVal: txt(r.dVal) || undefined }))
  return {
    nItem: Number(txt(det['@_nItem'])) || 0,
    cProd: txt(prod.cProd),
    xProd: txt(prod.xProd),
    ncm: txt(prod.NCM),
    cfop,
    uCom: txt(prod.uCom),
    qCom: num(prod.qCom),
    vUnCom: num(prod.vUnCom),
    vProd: num(prod.vProd),
    uTrib: txt(prod.uTrib) || txt(prod.uCom),
    qTrib: prod.qTrib !== undefined ? num(prod.qTrib) : num(prod.qCom),
    vUnTrib: prod.vUnTrib !== undefined ? num(prod.vUnTrib) : num(prod.vUnCom),
    vFrete: num(prod.vFrete),
    vDesc: num(prod.vDesc),
    vSeg: num(prod.vSeg),
    vOutro: num(prod.vOutro),
    icms: lerIcms(imp.ICMS),
    ipi: lerTributo(imp.IPI, 'pIPI', 'vIPI'),
    pis: lerTributo(imp.PIS, 'pPIS', 'vPIS'),
    cofins: lerTributo(imp.COFINS, 'pCOFINS', 'vCOFINS'),
    ibs,
    cbs,
    rastro,
    classificacao: classificarCfop(cfop, finNFe, tpNF),
  }
}

function lerTotais(total: Nodo): NfeParsedTotais {
  const t = obj(total.ICMSTot)
  const ibscbs = obj(total.IBSCBSTot)
  return {
    vProd: num(t.vProd),
    vNF: num(t.vNF),
    vFrete: num(t.vFrete),
    vDesc: num(t.vDesc),
    vSeg: num(t.vSeg),
    vOutro: num(t.vOutro),
    vBC: num(t.vBC),
    vICMS: num(t.vICMS),
    vBCST: num(t.vBCST),
    vST: num(t.vST),
    vIPI: num(t.vIPI),
    vPIS: num(t.vPIS),
    vCOFINS: num(t.vCOFINS),
    vIBS: num(ibscbs.vIBS ?? obj(ibscbs.gIBS).vIBS),
    vCBS: num(ibscbs.vCBS ?? obj(ibscbs.gCBS).vCBS),
  }
}

function classificacaoDaNota(itens: NfeParsedItem[], situacao: NfeSituacao): NfeClassificacao {
  if (situacao === 'cancelada' || situacao === 'denegada') return 'ignorar'
  if (!itens.length) return 'manual'
  if (itens.every((i) => i.classificacao === 'compra')) return 'compra'
  if (itens.every((i) => i.classificacao === 'ignorar')) return 'ignorar'
  return 'manual'
}

// Aceita nfeProc (com protocolo) ou NFe solta. Exige modelo 55. Lança NfeParseError em XML inválido.
export function parseNfeXml(xml: string): NfeParsed {
  const texto = String(xml || '').replace(/^[\s\uFEFF]+/, '')
  if (!texto.trim()) throw new NfeParseError('XML vazio')
  const valido = XMLValidator.validate(texto)
  if (valido !== true) throw new NfeParseError(`XML malformado: ${valido.err.msg}`)
  const raiz = obj(parser.parse(texto))
  const proc = obj(raiz.nfeProc)
  const nfe = obj(proc.NFe ?? raiz.NFe)
  const inf = obj(nfe.infNFe)
  if (!Object.keys(inf).length) throw new NfeParseError('XML não contém infNFe (não é uma NF-e)')
  const ide = obj(inf.ide)
  const modelo = txt(ide.mod)
  if (modelo !== '55') throw new NfeParseError(`Modelo ${modelo || 'desconhecido'} não suportado: só NF-e modelo 55`)
  const avisos: string[] = []
  const prot = obj(obj(proc.protNFe).infProt)
  const chaveId = somenteDigitos(txt(inf['@_Id']))
  const chave = chaveId.length === 44 ? chaveId : somenteDigitos(txt(prot.chNFe))
  if (chave.length !== 44) throw new NfeParseError('Chave de acesso ausente no XML')
  if (!validarChaveNfe(chave)) avisos.push('Dígito verificador da chave não confere')
  if (txt(prot.chNFe) && somenteDigitos(txt(prot.chNFe)) !== chave) avisos.push('Chave do protocolo difere da chave da nota')
  const cStat = txt(prot.cStat) || undefined
  let situacao: NfeSituacao = 'sem_protocolo'
  if (cStat) situacao = SITUACOES[cStat] ?? 'desconhecida'
  if (situacao === 'sem_protocolo') avisos.push('XML sem protocolo de autorização (protNFe)')
  if (situacao === 'desconhecida') avisos.push(`cStat ${cStat} não reconhecido: ${txt(prot.xMotivo)}`)
  if (situacao === 'cancelada') avisos.push(`Nota cancelada (cStat ${cStat})`)
  if (situacao === 'denegada') avisos.push(`Nota denegada (cStat ${cStat})`)
  const finNFe = txt(ide.finNFe) || '1'
  const tpNF = txt(ide.tpNF) || '1'
  const emit = obj(inf.emit)
  const dest = obj(inf.dest)
  const crt = txt(emit.CRT)
  const dets = lista(inf.det)
  const itens = dets.map((d) => lerItem(d, finNFe, tpNF))
  if (!itens.length) avisos.push('Nota sem itens')
  const dhEmi = txt(ide.dhEmi) || txt(ide.dEmi)
  if (!dhEmi) avisos.push('Nota sem data de emissão (dhEmi/dEmi)')
  const totais = lerTotais(obj(inf.total))
  // indTot=0 marca item que não compõe o total da nota
  const somaProd = itens.reduce((a, i, k) => (txt(obj(dets[k].prod).indTot) === '0' ? a : a + i.vProd), 0)
  if (Math.abs(somaProd - totais.vProd) > 0.011) avisos.push(`Soma dos itens (${somaProd.toFixed(2)}) difere de vProd (${totais.vProd.toFixed(2)})`)
  for (const i of itens) if (!i.ncm) avisos.push(`Item ${i.nItem}: sem NCM`)
  if (finNFe === '4') avisos.push('Nota de devolução: tratar manualmente')
  for (const i of itens) if (i.uTrib && i.uCom && i.uTrib !== i.uCom) avisos.push(`Item ${i.nItem}: unidade comercial ${i.uCom} difere da tributável ${i.uTrib}`)
  return {
    chave,
    modelo,
    serie: Number(txt(ide.serie)) || 0,
    numero: Number(txt(ide.nNF)) || 0,
    finNFe,
    tpNF,
    natOp: txt(ide.natOp),
    cStat,
    situacao,
    emitente: { cnpj: somenteDigitos(txt(emit.CNPJ)), nome: txt(emit.xNome), crt, uf: txt(obj(emit.enderEmit).UF) || undefined, ie: txt(emit.IE) || undefined, simples: crt === '1' || crt === '4' },
    destinatario: { cnpj: somenteDigitos(txt(dest.CNPJ)) || undefined, cpf: somenteDigitos(txt(dest.CPF)) || undefined, nome: txt(dest.xNome) || undefined },
    dhEmi,
    emissao: dhEmi.slice(0, 10),
    totais,
    itens,
    classificacao: classificacaoDaNota(itens, situacao),
    avisos,
  }
}
