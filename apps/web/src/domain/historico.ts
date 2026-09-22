// Recortes das séries históricas para as telas. Nada aqui inventa dia nem número: o que não veio
// do banco vale zero e a tela mostra estado vazio em vez de um gráfico bonito e falso.
import type { Historico, HistoricoProducaoDia, HistoricoVendasDia } from './types'

export const historicoVazio = (): Historico => ({ producao: [], vendas: [], exemplo: false, truncada: { producao: false, vendas: false } })

/** Últimos n dias da série, que já vem do mais antigo para o mais recente. */
export function ultimosDias<T>(serie: T[], n: number): T[] {
  return n > 0 && serie.length > n ? serie.slice(serie.length - n) : serie
}

/**
 * Hoje sempre vem do store (plano do dia + bipes já reconciliados, inclusive os otimistas da fila
 * offline), não da leitura do histórico, que pode ter saído antes do último bipe.
 */
export function comHoje(serie: HistoricoProducaoDia[], hoje: string, valores: { projetado: number; produzido: number }): HistoricoProducaoDia[] {
  const i = serie.findIndex((d) => d.dia === hoje)
  if (i < 0) return [...serie, { dia: hoje, ...valores }]
  const out = [...serie]
  out[i] = { dia: hoje, ...valores }
  return out
}

/** Empresa nova, primeiro dia: nada planejado e nada bipado no período. */
export const semProducao = (serie: HistoricoProducaoDia[]) => serie.every((d) => d.projetado === 0 && d.produzido === 0)
export const semVendas = (serie: HistoricoVendasDia[]) => serie.every((d) => d.unidades === 0)
