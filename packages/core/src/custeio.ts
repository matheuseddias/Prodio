// Custeio: custo médio ponderado móvel, custo unitário de entrada e créditos por tributo.
// Créditos vêm dos VALORES DESTACADOS no XML (nunca alíquota fixa), filtrados pelo regime do
// comprador, pelo CFOP do item e pela vigência do tributo (tributos.ts).
import { classificarCfop } from './nfe'
import type { NfeParsedItem, Regime } from './tipos'
import { creditaTributo, dataValida, type OpcoesVigencia } from './tributos'

export interface EstoqueApos {
  saldo: number
  custoMedio: number
}

const fin = (v: number | undefined | null): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// Custo médio ponderado móvel. Entrada (qtd > 0) recalcula a média; saída (qtd < 0) mantém.
// Saldo anterior zero ou negativo não polui a média: o custo passa a ser o da entrada.
// Saldo/custo anteriores não numéricos (coluna nula) valem zero; quantidade ou custo de entrada
// não numéricos ou custo negativo são erro: o ledger nunca recebe NaN.
export function custoMedioPonderado(saldoAnt: number, cmAnt: number, qtd: number, custoUnit: number): EstoqueApos {
  if (!Number.isFinite(qtd)) throw new Error(`Quantidade do movimento inválida: ${qtd}`)
  saldoAnt = fin(saldoAnt)
  cmAnt = fin(cmAnt)
  const saldo = saldoAnt + qtd
  if (qtd <= 0) return { saldo, custoMedio: cmAnt }
  if (!Number.isFinite(custoUnit) || custoUnit < 0) throw new Error(`Custo unitário de entrada inválido: ${custoUnit}`)
  if (saldoAnt <= 0 || saldo <= 0) return { saldo, custoMedio: custoUnit }
  return { saldo, custoMedio: (saldoAnt * cmAnt + qtd * custoUnit) / saldo }
}

// Custo unitário de entrada por unidade de CONSUMO: mercadoria + IPI + ICMS-ST + frete/seguro/outros rateados − desconto
// − créditos recuperáveis (quando informados; ver creditosDoItem, que calcula `total` a partir dos valores destacados).
export interface EntradaItem {
  vProd: number
  vIPI?: number
  vICMSST?: number
  vFrete?: number
  vSeg?: number
  vOutro?: number
  vDesc?: number
  creditos?: number // soma dos créditos recuperáveis do item (Creditos.total); sai do custo
  qtdConsumo: number
}
export function custoUnitarioEntrada(e: EntradaItem): number {
  if (!(Number.isFinite(e.qtdConsumo) && e.qtdConsumo > 0)) throw new Error('Quantidade em unidade de consumo deve ser um número maior que zero')
  const bruto = fin(e.vProd) + fin(e.vIPI) + fin(e.vICMSST) + fin(e.vFrete) + fin(e.vSeg) + fin(e.vOutro) - fin(e.vDesc) - fin(e.creditos)
  if (bruto < 0) throw new Error(`Custo de entrada negativo (${bruto.toFixed(2)}): desconto ou créditos maiores que o valor do item`)
  return bruto / e.qtdConsumo
}

// Rateia um total (frete, seguro, outros, desconto da nota) entre itens proporcionalmente ao valor,
// em centavos, com o último item absorvendo a diferença de arredondamento. Se nenhum item tem valor
// (bonificação), o rateio é igual entre eles: o frete nunca some.
export function ratearPorValor(valores: number[], total: number): number[] {
  const pesos = valores.map((v) => Math.max(0, fin(v)))
  const soma = pesos.reduce((a, v) => a + v, 0)
  if (!valores.length || !(Number.isFinite(total) && total > 0)) return valores.map(() => 0)
  const partes = soma > 0 ? pesos.map((v) => Math.round((total * v) / soma * 100) / 100) : valores.map(() => Math.round((total / valores.length) * 100) / 100)
  const acumulado = partes.reduce((a, v) => a + v, 0)
  partes[partes.length - 1] = Math.round((partes[partes.length - 1] + total - acumulado) * 100) / 100
  return partes
}

// ---------------------------------------------------------------------------
// Créditos por tributo
// ---------------------------------------------------------------------------
export interface ItemTributos {
  vICMS?: number
  vICMSST?: number
  vIPI?: number
  vPIS?: number
  vCOFINS?: number
  vCBS?: number
  vIBS?: number
  vCredICMSSN?: number // "permite crédito" quando o fornecedor é do Simples (pCredSN)
  fornecedorSimples?: boolean
}
export interface Creditos {
  icms: number
  ipi: number
  pis: number
  cofins: number
  cbs: number
  ibs: number
  total: number
  stNoCusto: number // ICMS-ST nunca credita: soma ao custo
  motivos: string[]
}
export interface OpcoesCredito extends OpcoesVigencia {
  finNFe?: string // padrão '1'
  tpNF?: string // padrão '1'
}

const isItemNfe = (i: NfeParsedItem | ItemTributos): i is NfeParsedItem => 'icms' in i && typeof (i as NfeParsedItem).icms === 'object'

// Normaliza um item parseado da NF-e para os valores que o cálculo de crédito usa.
export function tributosDoItemNfe(item: NfeParsedItem): ItemTributos {
  return {
    vICMS: item.icms.vICMS,
    vICMSST: item.icms.vICMSST,
    vIPI: item.ipi.v,
    vPIS: item.pis.v,
    vCOFINS: item.cofins.v,
    vCBS: item.cbs.v,
    vIBS: item.ibs.v,
    vCredICMSSN: item.icms.vCredICMSSN,
    fornecedorSimples: !!item.icms.csosn,
  }
}

export function creditosDoItem(itemNfe: NfeParsedItem | ItemTributos, regimeComprador: Regime, cfop: string, data: string, opcoes: OpcoesCredito = {}): Creditos {
  const t = isItemNfe(itemNfe) ? tributosDoItemNfe(itemNfe) : itemNfe
  const c: Creditos = { icms: 0, ipi: 0, pis: 0, cofins: 0, cbs: 0, ibs: 0, total: 0, stNoCusto: fin(t.vICMSST), motivos: [] }
  if (c.stNoCusto > 0) c.motivos.push('ICMS-ST não gera crédito e entra no custo')
  if (regimeComprador === 'simples') {
    c.motivos.push('Comprador no Simples Nacional não aproveita crédito')
    return c
  }
  if (regimeComprador !== 'presumido' && regimeComprador !== 'real') {
    c.motivos.push(`Regime do comprador desconhecido (${String(regimeComprador)}): nenhum crédito`)
    return c
  }
  if (!dataValida(data)) {
    c.motivos.push(`Data de emissão inválida (${String(data) || 'vazia'}): nenhum crédito`)
    return c
  }
  const classe = classificarCfop(cfop, opcoes.finNFe ?? '1', opcoes.tpNF ?? '1')
  if (classe !== 'compra') {
    c.motivos.push(`CFOP ${cfop} não é compra para industrialização/comercialização (${classe})`)
    return c
  }
  const pode = (cod: Parameters<typeof creditaTributo>[0]) => creditaTributo(cod, regimeComprador, data, opcoes)
  if (pode('ICMS')) {
    if (t.fornecedorSimples) {
      c.icms = fin(t.vCredICMSSN)
      if (c.icms > 0) c.motivos.push('Fornecedor do Simples: crédito de ICMS pelo valor informado (pCredSN)')
      else c.motivos.push('Fornecedor do Simples sem crédito de ICMS informado')
    } else c.icms = fin(t.vICMS)
  }
  if (!t.fornecedorSimples) {
    if (pode('IPI')) c.ipi = fin(t.vIPI)
    else if (fin(t.vIPI) > 0) c.motivos.push('IPI destacado não credita neste regime/data: entra no custo')
    if (pode('PIS')) c.pis = fin(t.vPIS)
    if (pode('COFINS')) c.cofins = fin(t.vCOFINS)
    if (pode('CBS')) c.cbs = fin(t.vCBS)
    if (pode('IBS')) c.ibs = fin(t.vIBS)
  } else if (fin(t.vPIS) + fin(t.vCOFINS) + fin(t.vIPI) > 0) {
    c.motivos.push('Fornecedor do Simples: PIS/COFINS/IPI não creditam')
  }
  c.total = c.icms + c.ipi + c.pis + c.cofins + c.cbs + c.ibs
  return c
}
