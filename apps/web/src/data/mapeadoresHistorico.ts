// Banco → domínio das séries históricas dos gráficos (Painel e Produtividade).
// Regra desta camada: dia sem linha no banco vale zero. Nunca se inventa número nem se repete
// padrão de outro dia — foi assim que o Painel passou a mostrar produção que não existia.
import { diaISO } from '../domain/format'
import type { HistoricoProducaoDia } from '../domain/types'
import { num } from './mapeadoresCadastros'

/** Teto de segurança para o eixo: um intervalo torto não vira um laço infinito. */
const MAX_DIAS = 400

/** `dia` ISO deslocado em n dias (n negativo anda para trás). Meio-dia evita o pulo de horário de verão. */
export function somaDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00`)
  if (Number.isNaN(d.getTime())) return dia
  d.setDate(d.getDate() + n)
  return diaISO(d)
}

/** Dias do intervalo, inclusive nas pontas, do mais antigo ao mais recente. */
export function intervaloDias(desde: string, ate: string): string[] {
  const d = new Date(`${desde}T12:00:00`)
  const fim = new Date(`${ate}T12:00:00`)
  if (Number.isNaN(d.getTime()) || Number.isNaN(fim.getTime())) return []
  const out: string[] = []
  while (d <= fim && out.length < MAX_DIAS) {
    out.push(diaISO(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * Leitura que bateu no limite de linhas: o dia mais antigo que voltou pode estar pela metade,
 * então o eixo começa no dia seguinte a ele. Devolve o primeiro dia que dá para exibir inteiro.
 */
export function primeiroDiaCompleto(diasLidos: string[], ate: string): string {
  const unicos = [...new Set(diasLidos.filter(Boolean))].sort()
  return unicos.length > 1 ? unicos[1] : ate
}

// --- Produção (v_daily_plan) ---------------------------------------------------------------------
export interface HistoricoProducaoRow {
  dia: string
  product_id: string
  projetado: number | string
  bipado: number | string
}

export const diaDaLinha = (r: { dia?: string | null }) => String(r.dia ?? '').slice(0, 10)

/**
 * A view devolve uma linha por (dia, local, produto). `projetado` é do local e soma; `bipado` é o
 * total do produto no dia — a subconsulta da view não filtra local —, então somar por local
 * contaria duas vezes numa fábrica com dois galpões: fica um valor por produto.
 */
export function serieProducaoDoBanco(rows: HistoricoProducaoRow[], dias: string[]): HistoricoProducaoDia[] {
  const projetado = new Map<string, number>()
  const bipado = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const dia = diaDaLinha(r)
    if (!dia) continue
    projetado.set(dia, (projetado.get(dia) ?? 0) + num(r.projetado))
    const porProduto = bipado.get(dia) ?? new Map<string, number>()
    porProduto.set(r.product_id, Math.max(porProduto.get(r.product_id) ?? 0, num(r.bipado)))
    bipado.set(dia, porProduto)
  }
  return dias.map((dia) => ({
    dia,
    projetado: projetado.get(dia) ?? 0,
    produzido: [...(bipado.get(dia)?.values() ?? [])].reduce((a, v) => a + v, 0),
  }))
}

// Vendas por dia: agregadas no banco (RPC sales_by_day); o mapeador está em data/demanda.ts.
