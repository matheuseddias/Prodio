// Custo do insumo no ES → custo de referência do Prodio: R$ por unidade de CONSUMO, líquido dos créditos
// (é a unidade e a base do custo médio do ledger, que o substitui na primeira entrada de NF-e).
//
// A regra é a que o próprio ES usa na ficha técnica, no CMV pela ficha, no custo de componente e em Compras
// (App.jsx: linhas da Ficha, cmvFichaSku, custoProduto, projeção de compras): com custo de NF-e no cadastro
// (valorNfe + IPI > 0), vale o custo líquido de tabela ÷ fator (custoLiqCons); sem ele, o custo médio (custoAtual).
// O custoMedio do ES não serve sozinho: de 01/06 a 03/08/2026 ele nascia do custo por unidade de COMPRA (o
// conserto 288739f só trocou o cálculo, os valores gravados ficaram), o botão "Usar custo de tabela" ainda grava
// por unidade de compra, e saldo negativo deixa médio zerado ou negativo. Usar o médio foi o que trouxe insumo
// sem custo e bobina inteira cobrada por unidade na ficha.
import { arred } from './normalizar'

/** Campos de custo de um insumo do ES (valores na unidade de compra, como no cadastro do ES). */
export interface CustoInsumoES {
  valorNfe?: number
  valorIpi?: number
  credIpi?: number
  aliqIpi?: number
  aliqIcms?: number
  aliqCredSN?: number
  regimeNormal: boolean
  fatorConversao?: number
  custoMedio?: number
}

export type OrigemCusto = 'tabela' | 'medio' | 'nenhum'

export interface CustoReferencia {
  /** R$ por unidade de consumo, na escala de materials.custo_referencia (numeric(14,4)). */
  custo?: number
  origem: OrigemCusto
  avisos: string[]
}

const PIS_COFINS = 9.25 // % do ES, base sem o ICMS
/** custo_referencia é numeric(14,4): o banco aceita até 1e10; acima disso o valor não vai. */
const MAX_CUSTO = 1e9
/** Custo médio do ES tantas vezes maior (ou menor) que o de tabela: vale avisar. */
const DIVERGENCIA = 3
/** Médio ÷ tabela dentro desta folga em torno do fator: o médio está por unidade de compra. */
const FOLGA_FATOR = 0.35

const n = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? v : 0)

/** fatorIns do ES: fator > 0, senão 1. */
export const fatorES = (f: number | undefined): number => (f !== undefined && f > 0 ? f : 1)

/** custoNfe e custoLiq do ES (unidade de compra): valor + IPI, menos ICMS, IPI e PIS/COFINS (normal) ou só o ICMS do Simples. */
export function custoTabelaES(i: CustoInsumoES): { nfe: number; liquido: number } {
  const merc = n(i.valorNfe)
  const ipi = i.valorIpi !== undefined ? i.valorIpi : n(i.credIpi)
  const nfe = merc + ipi
  let creditos: number
  if (i.regimeNormal) {
    const icms = merc * (n(i.aliqIcms) / 100)
    const credIpi = i.aliqIpi !== undefined ? merc * (i.aliqIpi / 100) : ipi
    creditos = icms + credIpi + Math.max(merc - icms, 0) * (PIS_COFINS / 100)
  } else creditos = merc * (n(i.aliqCredSN) / 100)
  return { nfe, liquido: nfe - creditos }
}

/** Reais no padrão da tela: R$ 1.603,16; abaixo de R$ 1, 4 casas (R$ 0,0582), que é a escala do custo por unidade. */
export function reais(v: number, casas = Math.abs(v) < 1 && v !== 0 ? 4 : 2): string {
  const [int, dec] = Math.abs(v).toFixed(casas).split('.')
  const milhar = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '-' : ''}R$ ${milhar}${dec ? `,${dec}` : ''}`
}

const vezes = (r: number): string => (r >= 10 ? String(Math.round(r)) : r.toFixed(1).replace('.', ','))

/**
 * Custo de referência de um insumo do ES, com os avisos da prévia.
 * `compra` e `consumo` são os códigos de unidade do Prodio (só para as mensagens).
 */
export function custoReferenciaES(i: CustoInsumoES, compra: string, consumo: string): CustoReferencia {
  const fator = fatorES(i.fatorConversao)
  const { nfe, liquido } = custoTabelaES(i)
  const medio = i.custoMedio !== undefined && i.custoMedio > 0 ? i.custoMedio : 0
  const avisos: string[] = []
  const tabela = nfe > 0 && liquido > 0 ? liquido / fator : 0
  const escolher = (v: number, origem: OrigemCusto): CustoReferencia => {
    const custo = arred(v, 4)
    if (custo > 0 && custo < MAX_CUSTO) return { custo, origem, avisos }
    avisos.push(custo > 0 ? `custo ${reais(v)}/${consumo} fora da faixa aceita; custo de referência não enviado, confira o fator` : `custo ${reais(v, 6)}/${consumo} abaixo de R$ 0,0001; custo de referência não enviado`)
    return { origem: 'nenhum', avisos }
  }

  if (tabela > 0) {
    if (medio > 0) {
      const r = medio / tabela
      if (fator >= 2 && Math.abs(r / fator - 1) <= FOLGA_FATOR) {
        avisos.push(`o custo médio do ES (${reais(medio)}) está por ${compra}, não por ${consumo}: vale o custo de tabela ${reais(tabela)}/${consumo} (custo líquido ${reais(liquido)}/${compra} ÷ fator ${arred(fator, 6)}, a conta da ficha do ES)`)
      } else if (r >= DIVERGENCIA || r <= 1 / DIVERGENCIA) {
        const quanto = r >= 1 ? `${vezes(r)}× o` : `1/${vezes(1 / r)} do`
        avisos.push(`o custo médio do ES (${reais(medio)}/${consumo}) é ${quanto} custo de tabela (${reais(tabela)}/${consumo}); vale o de tabela, a conta da ficha do ES — confira o valor da NF-e e o fator no ES`)
      }
    }
    return escolher(tabela, 'tabela')
  }
  if (nfe > 0) avisos.push(`os créditos do ES (${reais(nfe - liquido)}) cobrem o custo da NF-e (${reais(nfe)}/${compra}); ${medio > 0 ? 'vale o custo médio do ES' : 'custo de referência não enviado'}`)
  if (medio > 0) return escolher(medio, 'medio')
  if (nfe <= 0) avisos.push('sem custo no ES (valor da NF-e e custo médio zerados ou ausentes); custo de referência não enviado')
  return { origem: 'nenhum', avisos }
}
