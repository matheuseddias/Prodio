// Necessidade de compra em dois modos (App.jsx 3395-3538 do sistema anterior, com os números mágicos
// virando parâmetros): 'metrica_mes' (demanda × ficha explodida, sem olhar saldo) e 'por_saldo'
// (necessidade − saldo − em trânsito, cobertura, lead time aprendido, folga, comprar até).
import { explodeBom, indexarBoms } from './ficha'
import type { Bom, Id, Material, PurchaseOrder, Supplier } from './tipos'
import { custoPorCompra, paraCompra } from './unidades'

export type ModoNecessidade = 'metrica_mes' | 'por_saldo'
export type CurvaABC = 'A' | 'B' | 'C'

export interface ParametrosNecessidade {
  diasCobertura: number // horizonte da necessidade no modo por_saldo (dias)
  diasSeguranca: number // estoque de segurança em dias de consumo
  leadPadraoDias: number // fallback quando nem OC nem cadastro têm lead time
  ultimasOcs: number // quantas OCs entram na média do lead time
  leadMaxDias: number // OC com prazo fora de [0, leadMaxDias] é descartada da média
  tetoPct: number // teto do mês = necessidade mensal × (1 + tetoPct)
  abcA: number // fração acumulada de valor da curva A
  abcB: number // fração acumulada de valor da curva B
  // por_saldo: o alvo cobre também o lead time do insumo (consumo × (lead + cobertura)), como a tela
  // "Por saldo" da Necessidade: compra-se para chegar e ainda sobrar a cobertura.
  coberturaMaisLead: boolean
}
export const PARAMETROS_PADRAO: ParametrosNecessidade = { diasCobertura: 30, diasSeguranca: 7, leadPadraoDias: 7, ultimasOcs: 5, leadMaxDias: 90, tetoPct: 0.07, abcA: 0.8, abcB: 0.95, coberturaMaisLead: false }

export interface EntradasNecessidade {
  modo: ModoNecessidade
  hoje: string // AAAA-MM-DD
  demandaProdutos: Record<Id, number> // vendas por produto no período
  periodoDias: number
  margem: number // fração geral (0.10)
  margemPorMaterial?: Record<Id, number> // sobrepõe a geral
  boms: Bom[]
  materiais: Material[]
  fornecedores?: Supplier[]
  ocs?: PurchaseOrder[] // para lead time aprendido e em trânsito
  saldos?: Record<Id, number> // sobrepõe material.saldo
  emTransito?: Record<Id, number> // sobrepõe o calculado das OCs abertas (unidade de consumo)
  parametros?: Partial<ParametrosNecessidade>
}

export interface LinhaNecessidade {
  materialId: Id
  nome: string
  unidadeConsumo: string
  unidadeCompra: string
  semCadastro: boolean
  fornecedorId?: Id
  qtdPeriodo: number // consumo pelas vendas do período
  qtdMes: number // normalizado a 30 dias
  qtdFinal: number // com margem
  margemUsada: number
  tetoMes: number
  consumoDia: number
  saldo: number
  emTransito: number
  necessidade: number // unidade de consumo, o que falta comprar
  qtdCompra: number // unidade de compra, inteira (ceil)
  custoUnit: number // por unidade de consumo
  custoTotal: number
  precoCompraUnit: number // por unidade de compra
  coberturaDias: number // saldo ÷ consumo/dia (Infinity sem consumo)
  coberturaComTransitoDias: number
  leadDias: number
  leadAprendido: boolean
  folgaDias: number // cobertura com trânsito − lead − segurança
  comprarAte: string | null // hoje + folga (nunca antes de hoje)
  atrasado: boolean
  curva: CurvaABC
}

export interface ResultadoNecessidade {
  linhas: LinhaNecessidade[]
  totalCusto: number
  parametros: ParametrosNecessidade
}

// Horizonte máximo para "comprar até": acima disso a cobertura é tão longa que a data não informa nada.
export const FOLGA_MAX_DIAS = 36500

// hoje + n dias em AAAA-MM-DD. Data de partida inválida ou horizonte além do máximo devolvem null
// (nunca uma RangeError de Date).
const somarDias = (dia: string, n: number): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dia ?? ''))
  if (!m || !Number.isFinite(n) || n > FOLGA_MAX_DIAS) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const fracao = (v: number | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const diasEntre = (a: string, b: string): number => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 864e5)

// Lead time aprendido: média (entrega prevista − criação) das últimas N OCs não canceladas do fornecedor.
export function leadTimeAprendido(supplierId: Id, ocs: PurchaseOrder[], p: Pick<ParametrosNecessidade, 'ultimasOcs' | 'leadMaxDias'> = PARAMETROS_PADRAO): number | null {
  const amostras = ocs
    .filter((o) => o.supplierId === supplierId && o.status !== 'cancelada' && o.entregaPrevista && o.criadaEm)
    .map((o) => ({ t: o.criadaEm, dias: diasEntre(o.criadaEm, o.entregaPrevista!) }))
    .filter((x) => x.dias >= 0 && x.dias <= p.leadMaxDias)
    .sort((a, b) => b.t.localeCompare(a.t))
    .slice(0, p.ultimasOcs)
  if (!amostras.length) return null
  return Math.round(amostras.reduce((a, x) => a + x.dias, 0) / amostras.length)
}

// Em trânsito: saldo a receber das OCs abertas/parciais, em unidade de consumo.
export function emTransitoDasOcs(ocs: PurchaseOrder[]): Record<Id, number> {
  const acc: Record<Id, number> = {}
  for (const o of ocs) {
    if (o.status !== 'aberta' && o.status !== 'parcial') continue
    for (const it of o.itens) {
      const falta = Math.max(0, (it.qtd || 0) - (it.qtdRecebida || 0)) * (it.fator > 0 ? it.fator : 1)
      acc[it.materialId] = (acc[it.materialId] || 0) + falta
    }
  }
  return acc
}

// Curva ABC por valor: acumulado ≤ abcA → A, ≤ abcB → B, resto C. Devolve materialId → curva.
// O maior item é sempre A (um item que carrega 100% do valor não pode cair em C). Valores iguais recebem
// a mesma curva (a do primeiro do empate): a ordem de entrada não separa A de C. Valor negativo ou não numérico vale zero.
export function curvaABC(valores: { id: Id; valor: number }[], abcA = PARAMETROS_PADRAO.abcA, abcB = PARAMETROS_PADRAO.abcB): Record<Id, CurvaABC> {
  const ordenado = valores.map((x) => ({ id: x.id, valor: Number.isFinite(x.valor) ? Math.max(0, x.valor) : 0 })).sort((a, b) => b.valor - a.valor)
  const total = ordenado.reduce((a, x) => a + x.valor, 0)
  let acum = 0
  const out: Record<Id, CurvaABC> = {}
  let anterior: { valor: number; curva: CurvaABC } | null = null
  for (const x of ordenado) {
    acum += x.valor
    const pc = total > 0 ? acum / total : 1
    let curva: CurvaABC = pc <= abcA + 1e-9 ? 'A' : pc <= abcB + 1e-9 ? 'B' : 'C'
    if (!anterior && x.valor > 0) curva = 'A'
    else if (anterior && anterior.valor === x.valor) curva = anterior.curva
    out[x.id] = curva
    anterior = { valor: x.valor, curva }
  }
  return out
}

export function necessidadeDeCompra(e: EntradasNecessidade): ResultadoNecessidade {
  const p: ParametrosNecessidade = { ...PARAMETROS_PADRAO, ...e.parametros }
  const idx = indexarBoms(e.boms)
  const materiais = new Map(e.materiais.map((m) => [m.id, m]))
  const fornecedores = new Map((e.fornecedores ?? []).map((f) => [f.id, f]))
  const ocs = e.ocs ?? []
  const transito = e.emTransito ?? emTransitoDasOcs(ocs)
  const periodo = e.periodoDias > 0 ? e.periodoDias : 1

  // 1) necessidade bruta por insumo: demanda dos produtos × ficha explodida
  const need: Record<Id, number> = {}
  for (const [pid, qtd] of Object.entries(e.demandaProdutos)) {
    if (!(qtd > 0)) continue
    for (const [mid, q] of Object.entries(explodeBom(pid, qtd, idx))) need[mid] = (need[mid] || 0) + q
  }

  const leadCache = new Map<Id, number | null>()
  const linhas: LinhaNecessidade[] = Object.entries(need).map(([materialId, qtdPeriodo]) => {
    const m = materiais.get(materialId)
    const qtdMes = (qtdPeriodo / periodo) * 30
    const margemUsada = fracao(e.margemPorMaterial?.[materialId]) ?? fracao(e.margem) ?? 0
    const qtdFinal = qtdMes * (1 + margemUsada)
    const consumoDia = qtdMes / 30
    const saldo = e.saldos?.[materialId] ?? m?.saldo ?? 0
    const emTransito = transito[materialId] ?? 0
    const fator = m?.fatorConversao ?? 1
    const custoUnit = m?.custoMedio ?? 0
    const fornecedorId = m?.fornecedorPadraoId
    let lead: number | null = null
    if (fornecedorId) {
      if (!leadCache.has(fornecedorId)) leadCache.set(fornecedorId, leadTimeAprendido(fornecedorId, ocs, p))
      lead = leadCache.get(fornecedorId) ?? null
    }
    const leadAprendido = lead !== null
    const leadDias = lead ?? fornecedores.get(fornecedorId ?? '')?.leadTimeDias ?? m?.leadTimeDias ?? p.leadPadraoDias
    const alvoDias = p.diasCobertura + (p.coberturaMaisLead ? leadDias : 0)
    const necessidade = e.modo === 'metrica_mes' ? qtdFinal : Math.max(0, consumoDia * (1 + margemUsada) * alvoDias - saldo - emTransito)
    const coberturaDias = consumoDia > 0 ? saldo / consumoDia : Infinity
    const coberturaComTransitoDias = consumoDia > 0 ? (saldo + emTransito) / consumoDia : Infinity
    const folgaDias = coberturaComTransitoDias === Infinity ? Infinity : coberturaComTransitoDias - leadDias - p.diasSeguranca
    const comprarAte = folgaDias === Infinity ? null : somarDias(e.hoje, Math.max(0, Math.floor(folgaDias)))
    return {
      materialId,
      nome: m?.nome ?? '(não cadastrado)',
      unidadeConsumo: m?.unidadeConsumo ?? '?',
      unidadeCompra: m?.unidadeCompra ?? '?',
      semCadastro: !m,
      fornecedorId,
      qtdPeriodo,
      qtdMes,
      qtdFinal,
      margemUsada,
      tetoMes: qtdMes * (1 + p.tetoPct),
      consumoDia,
      saldo,
      emTransito,
      necessidade,
      qtdCompra: paraCompra(necessidade, fator),
      custoUnit,
      custoTotal: necessidade * custoUnit,
      precoCompraUnit: custoPorCompra(custoUnit, fator),
      coberturaDias,
      coberturaComTransitoDias,
      leadDias,
      leadAprendido,
      folgaDias,
      comprarAte,
      atrasado: folgaDias < 0,
      curva: 'C',
    }
  })

  const curvas = curvaABC(linhas.map((l) => ({ id: l.materialId, valor: l.custoTotal })), p.abcA, p.abcB)
  for (const l of linhas) l.curva = curvas[l.materialId]
  linhas.sort((a, b) => b.custoTotal - a.custoTotal)
  return { linhas, totalCusto: linhas.reduce((a, l) => a + l.custoTotal, 0), parametros: p }
}
