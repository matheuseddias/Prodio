// Leitura em lista branca do backup do ES ("Baixar backup completo" = JSON.stringify(db)).
// Regra de segurança: nada do arquivo é espalhado (...obj) nem devolvido cru. Cada campo é copiado de forma
// explícita, com tipo conferido e tamanho limitado. Fora das seções de cadastro só se lê:
//   · de users, sales, ordens e afins: a quantidade (card "fica de fora");
//   · de movs: só `data` (idade do backup);
//   · de notasImportadas: só `cnpj` e `ordem`; de ordens: só `numero` e `fornecedor` (achar CNPJ).
// config, kaminoContas, kaminoMP, users[].*, movs[].por/comprador nunca são lidos.
import { CHAVE_PROIBIDA, digitos, num, texto } from './normalizar'

type Bruto = Record<string, unknown>

export interface ProdutoES {
  indice: number
  sku: unknown
  nome?: string
  ean?: unknown
  ncm?: unknown
  status?: string
  cmv?: number
  cor?: string
  tipo?: string
  categoria?: string
  formato?: string
  linha?: string
  material?: string
  largura?: number
  altura?: number
  lapidado?: boolean
  divisao?: string
  grupoCorte?: string
  temEstoque: boolean
}

export interface FornecedorDoInsumoES {
  nome?: string
  preco?: number
  aliqIcms?: number
}

export interface InsumoES {
  indice: number
  sku: unknown
  nome?: string
  ncm?: unknown
  unidade?: unknown
  unidadeConsumo?: unknown
  fatorConversao?: number
  minimo?: number
  custoMedio?: number
  aliqIcms?: number
  fornecedor?: string
  fornecedores: FornecedorDoInsumoES[]
  temSaldo: boolean
}

export interface FornecedorES {
  indice: number
  nome?: string
  cnpj?: unknown
  regimeNormal?: boolean
  leadTime?: number
  prazo?: unknown
  contato?: string
}

export interface ParteCalcES {
  nome?: string
  larg?: unknown
  alt?: unknown
  comp?: unknown
  peso?: unknown
  un?: unknown
  qtd?: unknown
  larguraRolo?: unknown
}
export interface CalcES {
  tipo?: string
  perdaTipo?: string
  perda?: unknown
  larguraRolo?: unknown
  partes: ParteCalcES[]
}
export interface LinhaBomES {
  indice: number
  sku: unknown
  mpCode: unknown
  consumo: unknown
  unidade?: unknown
  tipo?: string
  calc?: CalcES
}

export type CodigoFornES = { mp: unknown; fator?: number } | { legado: unknown }

export interface BackupES {
  products: ProdutoES[]
  insumos: InsumoES[]
  fornecedores: FornecedorES[]
  bom: LinhaBomES[]
  depara: Map<string, unknown>
  deparaForn: Map<string, Map<string, CodigoFornES>>
  fornInsumo: Map<string, Map<string, { un?: string; fator?: number; inteiro?: boolean }>>
  kaminoForn: Map<string, string>
  kaminoItem: Map<string, Map<string, unknown>>
  precifProd: Map<string, { pesoKg?: number; c?: number; l?: number; a?: number }>
  notas: { cnpj: string; ordem: string }[]
  ordens: { numero: string; fornecedor: string }[]
  tombs: Map<string, Map<string, string>>
  maiorDataMov?: string
  ignorado: { secao: string; itens: number }[]
  temSecoes: { products: boolean; insumos: boolean; bom: boolean }
}

const LIMITE_ITENS = 100_000
const ehObjeto = (x: unknown): x is Bruto => typeof x === 'object' && x !== null && !Array.isArray(x)
const lista = (x: unknown): unknown[] => (Array.isArray(x) ? x.slice(0, LIMITE_ITENS) : [])
const objetos = (x: unknown): Bruto[] => lista(x).filter(ehObjeto)
/** Entradas de um objeto do ES como Map, ignorando chaves de protótipo. */
function entradas(x: unknown): [string, unknown][] {
  if (!ehObjeto(x)) return []
  return Object.keys(x)
    .slice(0, LIMITE_ITENS)
    .filter((k) => !CHAVE_PROIBIDA.has(k) && k.length <= 200)
    .map((k) => [k, x[k]])
}
const campo = (o: Bruto, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const bool = (x: unknown): boolean | undefined => (typeof x === 'boolean' ? x : undefined)
const escalar = (x: unknown): unknown => (typeof x === 'string' ? x.slice(0, 200) : typeof x === 'number' ? x : undefined)

function lerProduto(o: Bruto, indice: number): ProdutoES {
  return {
    indice,
    sku: escalar(campo(o, 'sku')),
    nome: texto(campo(o, 'nome'), 200),
    ean: escalar(campo(o, 'ean')),
    ncm: escalar(campo(o, 'ncm')),
    status: texto(campo(o, 'status'), 20),
    cmv: num(campo(o, 'cmv')),
    cor: texto(campo(o, 'cor'), 60),
    tipo: texto(campo(o, 'tipo'), 60),
    categoria: texto(campo(o, 'categoria'), 60),
    formato: texto(campo(o, 'formato'), 60),
    linha: texto(campo(o, 'linha'), 60),
    material: texto(campo(o, 'material'), 60),
    largura: num(campo(o, 'largura')),
    altura: num(campo(o, 'altura')),
    lapidado: bool(campo(o, 'lapidado')),
    divisao: texto(campo(o, 'divisao'), 60),
    grupoCorte: texto(campo(o, 'grupoCorte'), 60),
    temEstoque: (num(campo(o, 'estoque')) ?? 0) !== 0 || (num(campo(o, 'reservado')) ?? 0) !== 0,
  }
}

function lerInsumo(o: Bruto, indice: number): InsumoES {
  const saldo = num(campo(o, 'saldo'))
  return {
    indice,
    sku: escalar(campo(o, 'sku')),
    nome: texto(campo(o, 'nome'), 200),
    ncm: escalar(campo(o, 'ncm')),
    unidade: escalar(campo(o, 'unidade')),
    unidadeConsumo: escalar(campo(o, 'unidadeConsumo')),
    fatorConversao: num(campo(o, 'fatorConversao')),
    minimo: num(campo(o, 'minimo')),
    custoMedio: num(campo(o, 'custoMedio')),
    aliqIcms: num(campo(o, 'aliqIcms')),
    fornecedor: texto(campo(o, 'fornecedor'), 200),
    fornecedores: objetos(campo(o, 'fornecedores'))
      .slice(0, 50)
      .map((f) => ({ nome: texto(campo(f, 'nome'), 200), preco: num(campo(f, 'preco')), aliqIcms: num(campo(f, 'aliqIcms')) })),
    temSaldo: saldo !== undefined && saldo !== 0,
  }
}

function lerFornecedor(o: Bruto, indice: number): FornecedorES {
  return {
    indice,
    nome: texto(campo(o, 'nome'), 200),
    cnpj: escalar(campo(o, 'cnpj')),
    regimeNormal: bool(campo(o, 'regimeNormal')),
    leadTime: num(campo(o, 'leadTime')),
    prazo: escalar(campo(o, 'prazo')),
    contato: texto(campo(o, 'contato'), 500),
  }
}

function lerCalc(x: unknown): CalcES | undefined {
  if (!ehObjeto(x)) return undefined
  return {
    tipo: texto(campo(x, 'tipo'), 20),
    perdaTipo: texto(campo(x, 'perdaTipo'), 20),
    perda: escalar(campo(x, 'perda')),
    larguraRolo: escalar(campo(x, 'larguraRolo')),
    partes: objetos(campo(x, 'partes'))
      .slice(0, 50)
      .map((p) => ({
        nome: texto(campo(p, 'nome'), 80),
        larg: escalar(campo(p, 'larg')),
        alt: escalar(campo(p, 'alt')),
        comp: escalar(campo(p, 'comp')),
        peso: escalar(campo(p, 'peso')),
        un: escalar(campo(p, 'un')),
        qtd: escalar(campo(p, 'qtd')),
        larguraRolo: escalar(campo(p, 'larguraRolo')),
      })),
  }
}

function lerLinhaBom(o: Bruto, indice: number): LinhaBomES {
  const consumo = campo(o, 'consumo')
  return {
    indice,
    sku: escalar(campo(o, 'sku')),
    mpCode: escalar(campo(o, 'mpCode')),
    consumo: consumo === null || typeof consumo === 'number' || typeof consumo === 'string' ? escalar(consumo) ?? null : 'invalido',
    unidade: escalar(campo(o, 'unidade')),
    tipo: texto(campo(o, 'tipo'), 20),
    calc: lerCalc(campo(o, 'calc')),
  }
}

// Seções que não são cadastro: só a quantidade sai daqui.
const IGNORADAS: [string, string][] = [
  ['users', 'Usuários do ES (e senhas)'],
  ['config', 'Configurações do ES'],
  ['ordens', 'Ordens de compra'],
  ['sales', 'Vendas'],
  ['notasImportadas', 'Notas fiscais importadas'],
  ['movs', 'Movimentações de estoque'],
  ['bipes', 'Bipes'],
  ['conferencia', 'Conferência'],
  ['devolucoes', 'Devoluções'],
  ['romaneios', 'Romaneios'],
  ['perdas', 'Perdas'],
  ['kaminoContas', 'Contas do Kamino'],
  ['kaminoMP', 'Pagamentos de matéria-prima do Kamino'],
  ['metas', 'Metas'],
  ['projDia', 'Projeção do dia'],
  ['linhaHist', 'Histórico da linha'],
  ['impressoDia', 'Etiquetas impressas por dia'],
  ['seqEtiqueta', 'Sequência de etiquetas'],
  ['seqMontagem', 'Sequência de montagem'],
  ['tombs', 'Exclusões registradas (tombs)'],
  ['prazos', 'Lista de prazos'],
]
function tamanho(x: unknown): number {
  if (Array.isArray(x)) return x.length
  if (ehObjeto(x)) return Object.keys(x).length
  return x === undefined || x === null ? 0 : 1
}

/** Lê o backup cru em lista branca. Devolve undefined quando não é um objeto. */
export function lerBackup(bruto: unknown): BackupES | undefined {
  if (!ehObjeto(bruto)) return undefined
  const g = (k: string) => campo(bruto, k)
  const insumos = objetos(g('insumos')).map(lerInsumo)
  const products = objetos(g('products')).map(lerProduto)

  const deparaForn = new Map<string, Map<string, CodigoFornES>>()
  for (const [cnpj, itens] of entradas(g('deparaForn'))) {
    const m = new Map<string, CodigoFornES>()
    for (const [cProd, v] of entradas(itens)) {
      if (ehObjeto(v)) m.set(cProd, { mp: escalar(campo(v, 'mp')), fator: num(campo(v, 'fator')) })
      else if (typeof v === 'string') m.set(cProd, { legado: v.slice(0, 60) })
    }
    deparaForn.set(digitos(cnpj), m)
  }
  const fornInsumo = new Map<string, Map<string, { un?: string; fator?: number; inteiro?: boolean }>>()
  for (const [nome, itens] of entradas(g('fornInsumo'))) {
    const m = new Map<string, { un?: string; fator?: number; inteiro?: boolean }>()
    for (const [mp, v] of entradas(itens)) {
      if (ehObjeto(v)) m.set(mp, { un: texto(campo(v, 'un'), 20), fator: num(campo(v, 'fator')), inteiro: bool(campo(v, 'inteiro')) })
    }
    const n = texto(nome, 200)
    if (n) fornInsumo.set(n, m)
  }
  const kaminoForn = new Map<string, string>()
  for (const [cnpj, nome] of entradas(g('kaminoForn'))) {
    const n = texto(nome, 200)
    if (n) kaminoForn.set(digitos(cnpj), n)
  }
  const kaminoItem = new Map<string, Map<string, unknown>>()
  for (const [cnpj, itens] of entradas(g('kaminoItem'))) {
    kaminoItem.set(digitos(cnpj), new Map(entradas(itens).map(([cod, mp]) => [cod, escalar(mp)])))
  }
  const precifProd = new Map<string, { pesoKg?: number; c?: number; l?: number; a?: number }>()
  for (const [sku, v] of entradas(g('precifProd'))) {
    if (ehObjeto(v)) precifProd.set(sku.replace(/\s+/g, '').toUpperCase(), { pesoKg: num(campo(v, 'pesoKg')), c: num(campo(v, 'c')), l: num(campo(v, 'l')), a: num(campo(v, 'a')) })
  }
  const tombs = new Map<string, Map<string, string>>()
  for (const [secao, itens] of entradas(g('tombs'))) {
    const m = new Map<string, string>()
    for (const [chave, quando] of entradas(itens)) if (typeof quando === 'string' && quando) m.set(chave, quando.slice(0, 30))
    tombs.set(secao, m)
  }
  let maiorDataMov: string | undefined
  for (const mov of objetos(g('movs'))) {
    const d = campo(mov, 'data')
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && (!maiorDataMov || d.slice(0, 10) > maiorDataMov)) maiorDataMov = d.slice(0, 10)
  }

  return {
    products,
    insumos,
    fornecedores: objetos(g('fornecedores')).map(lerFornecedor),
    bom: objetos(g('bom')).map(lerLinhaBom),
    depara: new Map(entradas(g('depara')).map(([de, para]) => [de, escalar(para)])),
    deparaForn,
    fornInsumo,
    kaminoForn,
    kaminoItem,
    precifProd,
    notas: objetos(g('notasImportadas')).map((n) => ({ cnpj: digitos(campo(n, 'cnpj')), ordem: texto(campo(n, 'ordem'), 60) ?? '' })),
    ordens: objetos(g('ordens')).map((o) => ({ numero: texto(campo(o, 'numero'), 60) ?? '', fornecedor: texto(campo(o, 'fornecedor'), 200) ?? '' })),
    tombs,
    maiorDataMov,
    ignorado: IGNORADAS.map(([k, secao]) => ({ secao, itens: tamanho(g(k)) })).filter((s) => s.itens > 0),
    temSecoes: { products: Array.isArray(g('products')), insumos: Array.isArray(g('insumos')), bom: Array.isArray(g('bom')) },
  }
}
