// Tipos da NF-e parseada (core/nfe.ts): valores destacados por item, base do custeio.

export type NfeSituacao = 'autorizada' | 'cancelada' | 'denegada' | 'sem_protocolo' | 'desconhecida'
export type NfeClassificacao = 'compra' | 'manual' | 'ignorar'

export interface NfeParsedIcms {
  cst?: string
  csosn?: string
  orig?: string
  vBC: number
  pICMS: number
  vICMS: number
  vBCST: number
  vICMSST: number
  pCredSN: number
  vCredICMSSN: number
}
export interface NfeParsedTributo {
  cst?: string
  vBC: number
  p: number
  v: number
}
export interface NfeParsedRastro {
  nLote: string
  qLote?: number
  dFab?: string
  dVal?: string
}
export interface NfeParsedItem {
  nItem: number
  cProd: string
  xProd: string
  ncm: string
  cfop: string
  uCom: string
  qCom: number
  vUnCom: number
  vProd: number
  uTrib: string
  qTrib: number
  vUnTrib: number
  vFrete: number
  vDesc: number
  vSeg: number
  vOutro: number
  icms: NfeParsedIcms
  ipi: NfeParsedTributo
  pis: NfeParsedTributo
  cofins: NfeParsedTributo
  ibs: NfeParsedTributo
  cbs: NfeParsedTributo
  rastro: NfeParsedRastro[]
  classificacao: NfeClassificacao
}
export interface NfeParsedTotais {
  vProd: number
  vNF: number
  vFrete: number
  vDesc: number
  vSeg: number
  vOutro: number
  vBC: number
  vICMS: number
  vBCST: number
  vST: number
  vIPI: number
  vPIS: number
  vCOFINS: number
  vIBS: number
  vCBS: number
}
export interface NfeParsed {
  chave: string
  modelo: string
  serie: number
  numero: number
  finNFe: string // 1 normal, 2 complementar, 3 ajuste, 4 devolução
  tpNF: string // 0 entrada, 1 saída
  natOp: string
  cStat?: string
  situacao: NfeSituacao
  emitente: { cnpj: string; nome: string; crt: string; uf?: string; ie?: string; simples: boolean }
  destinatario: { cnpj?: string; cpf?: string; nome?: string }
  dhEmi: string
  emissao: string // AAAA-MM-DD
  totais: NfeParsedTotais
  itens: NfeParsedItem[]
  classificacao: NfeClassificacao // consolidada: compra se todos compra; ignorar se todos ignorar; senão manual
  avisos: string[]
}
