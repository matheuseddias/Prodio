// Cálculos da aba Produtividade. Histórico além dos 14 dias do mock é gerado de forma determinística,
// repetindo o padrão semanal de producao14d (dados de exemplo até existir backend).
import { diaISO } from '../../domain/format'
import { producao14d } from '../../domain/mock'
import type { DailyPlanLine, ScanEvent } from '../../domain/types'
import type { Tone } from '../../ui'

export interface DiaProducao {
  dia: string
  projetado: number
  produzido: number
}

export const PERIODOS = [7, 14, 30, 90] as const
export type Periodo = (typeof PERIODOS)[number]

/** Turno padrão da linha (07:00–16:00). Usado para peças por hora trabalhada no período. */
export const HORAS_TURNO = 9

const hash = (s: string) => {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Últimos N dias (terminando hoje). Dias dentro do mock usam o mock; os demais repetem o padrão semanal. */
export function historicoProducao(dias: number, hojeReal?: { projetado: number; produzido: number }): DiaProducao[] {
  const hoje = new Date()
  const porDia = new Map(producao14d.map((d) => [d.dia, d]))
  // Dia da semana de cada entrada do mock, derivado do mesmo jeito que o mock deriva.
  const refPorDow = new Map<number, DiaProducao[]>()
  producao14d.forEach((d, i) => {
    const dt = new Date(hoje)
    dt.setDate(dt.getDate() - (13 - i))
    const arr = refPorDow.get(dt.getDay()) ?? []
    arr.push(d)
    refPorDow.set(dt.getDay(), arr)
  })

  const out: DiaProducao[] = []
  for (let i = dias - 1; i >= 0; i--) {
    const dt = new Date(hoje)
    dt.setDate(dt.getDate() - i)
    const dia = diaISO(dt)
    const real = porDia.get(dia)
    if (real) {
      out.push({ ...real })
      continue
    }
    const cands = refPorDow.get(dt.getDay()) ?? []
    const ref = cands[Math.floor(i / 7) % Math.max(1, cands.length)]
    if (!ref || ref.projetado === 0) {
      out.push({ dia, projetado: 0, produzido: 0 })
      continue
    }
    const j = hash(dia)
    const projetado = ref.projetado + ((j % 41) - 20)
    const produzido = Math.max(0, ref.produzido + ((Math.floor(j / 41) % 51) - 25))
    out.push({ dia, projetado, produzido })
  }
  if (hojeReal && out.length) out[out.length - 1] = { ...out[out.length - 1], ...hojeReal }
  return out
}

export const aderenciaDe = (d: { projetado: number; produzido: number }) => (d.projetado > 0 ? d.produzido / d.projetado : 0)
export const toneAderencia = (a: number): Tone => (a >= 0.95 ? 'ok' : a >= 0.85 ? 'warn' : 'danger')

export function resumoPeriodo(h: DiaProducao[]) {
  const uteis = h.filter((d) => d.projetado > 0)
  const projetado = uteis.reduce((a, d) => a + d.projetado, 0)
  const produzido = uteis.reduce((a, d) => a + d.produzido, 0)
  const aderencia = projetado > 0 ? produzido / projetado : 0
  let melhor: DiaProducao | undefined
  let pior: DiaProducao | undefined
  for (const d of uteis) {
    if (!melhor || aderenciaDe(d) > aderenciaDe(melhor)) melhor = d
    if (!pior || aderenciaDe(d) < aderenciaDe(pior)) pior = d
  }
  const pecasHora = uteis.length ? produzido / (uteis.length * HORAS_TURNO) : 0
  return { projetado, produzido, aderencia, melhor, pior, pecasHora, diasUteis: uteis.length }
}

export const bipesDoDia = (scans: ScanEvent[], dia: string) => scans.filter((x) => x.competencia === dia && x.tipo === 'produzido')

export function porHoraDe(scans: ScanEvent[]): number[] {
  const h = Array.from({ length: 24 }, () => 0)
  for (const x of scans) {
    const hora = new Date(x.em).getHours()
    if (Number.isNaN(hora)) continue // bipe sem hora válida não entra no histograma nem corrompe o array
    h[hora] += x.quantidade
  }
  return h
}

/** Gargalo: hora com menor volume no meio do turno (ignora a primeira e a última hora com bipes). */
export function gargaloDe(porHora: number[]): number | undefined {
  const ativas = porHora.map((v, h) => ({ v, h })).filter((x) => x.v > 0)
  if (ativas.length < 3) return undefined
  const meio = ativas.slice(1, -1)
  return meio.reduce((m, x) => (x.v < m.v ? x : m)).h
}

export interface LinhaOperador {
  nome: string
  hoje: number
  periodoEstimado: number
  mediaHora: number
  participacao: number
}

export function porOperador(scansHoje: ScanEvent[], produzidoPeriodo: number): LinhaOperador[] {
  const acc = new Map<string, { qtd: number; horas: Set<number> }>()
  for (const x of scansHoje) {
    const a = acc.get(x.operador) ?? { qtd: 0, horas: new Set<number>() }
    a.qtd += x.quantidade
    const hora = new Date(x.em).getHours()
    if (!Number.isNaN(hora)) a.horas.add(hora)
    acc.set(x.operador, a)
  }
  const total = [...acc.values()].reduce((s, a) => s + a.qtd, 0)
  return [...acc.entries()]
    .map(([nome, a]) => {
      const participacao = total > 0 ? a.qtd / total : 0
      return { nome, hoje: a.qtd, periodoEstimado: Math.round(produzidoPeriodo * participacao), mediaHora: a.horas.size ? a.qtd / a.horas.size : 0, participacao }
    })
    .sort((a, b) => b.hoje - a.hoje)
}

export interface LinhaSku {
  productId: string
  hoje: number
  projetado: number
  aderencia: number
}

export function porSku(scansHoje: ScanEvent[], plano: DailyPlanLine[]): LinhaSku[] {
  const acc = new Map<string, number>()
  for (const x of scansHoje) acc.set(x.productId, (acc.get(x.productId) ?? 0) + x.quantidade)
  const ids = new Set([...acc.keys(), ...plano.filter((l) => l.projetado > 0).map((l) => l.productId)])
  return [...ids]
    .map((productId) => {
      const hoje = acc.get(productId) ?? 0
      const projetado = plano.find((l) => l.productId === productId)?.projetado ?? 0
      return { productId, hoje, projetado, aderencia: aderenciaDe({ projetado, produzido: hoje }) }
    })
    .sort((a, b) => b.projetado - a.projetado || b.hoje - a.hoje)
}

export function csvFechamentos(h: DiaProducao[]): string {
  const linhas = ['dia;projetado;produzido;aderencia_pct']
  for (const d of [...h].reverse()) linhas.push(`${d.dia};${d.projetado};${d.produzido};${d.projetado > 0 ? Math.round(aderenciaDe(d) * 100) : ''}`)
  return linhas.join('\n')
}

export function baixarCsv(nome: string, conteudo: string) {
  const blob = new Blob([`﻿${conteudo}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}
