import { useMemo } from 'react'
import { num } from '../../domain/format'
import type { Material, MoveType, StockMove } from '../../domain/types'
import type { Tone } from '../../ui'

// ---------- helpers de domínio compartilhados pelas abas do Estoque ----------

export const MOVE_LABEL: Record<MoveType, string> = {
  entrada_nfe: 'Entrada NF-e',
  entrada_manual: 'Entrada manual',
  baixa_producao: 'Baixa produção',
  ajuste: 'Ajuste',
  perda: 'Perda',
  estorno: 'Estorno',
  saldo_inicial: 'Saldo inicial',
}
export const MOVE_TONE: Record<MoveType, Tone> = {
  entrada_nfe: 'ok',
  entrada_manual: 'ok',
  baixa_producao: 'neutral',
  ajuste: 'info',
  perda: 'danger',
  estorno: 'warn',
  saldo_inicial: 'accent',
}
export const MOTIVOS_PERDA = ['Quebra', 'Defeito de material', 'Erro de corte', 'Deterioração', 'Extravio', 'Outro']

export type Estado = 'critico' | 'atencao' | 'ok'
export const estadoDe = (m: Material): Estado => (m.saldo < m.minimo ? 'critico' : m.saldo < m.minimo * 1.3 ? 'atencao' : 'ok')
export const ESTADO_BADGE: Record<Estado, { tone: Tone; label: string }> = {
  critico: { tone: 'danger', label: 'Crítico' },
  atencao: { tone: 'warn', label: 'Atenção' },
  ok: { tone: 'ok', label: 'OK' },
}

export const MS_DIA = 86_400_000
export const mesmoDia = (iso: string, ref = new Date()) => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

/** Consumo médio diário (unidade de consumo) a partir das baixas de produção dos últimos 7 dias. */
export function consumoDiario(materialId: string, moves: StockMove[]) {
  const limite = Date.now() - 7 * MS_DIA
  const total = moves
    .filter((m) => m.materialId === materialId && m.tipo === 'baixa_producao' && new Date(m.em).getTime() >= limite)
    .reduce((s, m) => s + Math.abs(m.delta), 0)
  return total > 0 ? total / 7 : undefined
}

export const sinal = (v: number, casas = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), casas)}`
export const casasDe = (m: Material) => (m.unidadeConsumo === 'un' ? 0 : 2)

export interface LinhaSaldo {
  m: Material
  cobertura?: number
  consumo?: number
  valor: number
  estado: Estado
}

/** Linhas da tabela de saldos com consumo, cobertura, valor e estado. */
export function useLinhasSaldo(materials: Material[], stockMoves: StockMove[]) {
  return useMemo<LinhaSaldo[]>(
    () =>
      materials.map((m) => {
        const consumo = consumoDiario(m.id, stockMoves)
        return { m, consumo, cobertura: consumo ? m.saldo / consumo : undefined, valor: m.saldo * m.custoMedio, estado: estadoDe(m) }
      }),
    [materials, stockMoves],
  )
}
