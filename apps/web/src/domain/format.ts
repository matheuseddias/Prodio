// Formatadores de tela. Regra desta camada: nenhum deles pode lançar. Um campo que chega vazio ou
// torto de um conector, de uma importação ou de um upsert otimista tem de virar '—' na célula, nunca
// derrubar a árvore do React (era assim que `num(undefined)` virava tela branca).
const SEM_VALOR = '—'

/** Número aproveitável ou null: undefined, null, '', NaN, booleano, objeto e array caem em null. */
const finito = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** Data aproveitável ou null (string vazia, undefined e "Invalid Date" caem em null). */
const data = (v: unknown): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v !== 'string' && typeof v !== 'number') return null
  if (typeof v === 'string' && v.trim() === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export const brl = (v: number) => {
  const n = finito(v)
  return n === null ? SEM_VALOR : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export const num = (v: number, casas = 0) => {
  const n = finito(v)
  return n === null ? SEM_VALOR : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

export const pct = (v: number) => {
  const n = finito(v)
  return n === null ? SEM_VALOR : `${Math.round(n * 100)}%`
}

export const dataBR = (iso: string) => {
  const d = data(iso)
  return d ? d.toLocaleDateString('pt-BR') : SEM_VALOR
}

export const horaBR = (iso: string) => {
  const d = data(iso)
  return d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : SEM_VALOR
}

export const dataHoraBR = (iso: string) => `${dataBR(iso)} ${horaBR(iso)}`

export const relativo = (iso: string) => {
  const d = data(iso)
  if (!d) return SEM_VALOR
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const dias = Math.round(h / 24)
  return `há ${dias} d`
}

export const cnpjFmt = (c: string) =>
  String(c ?? '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

export const chaveFmt = (chave: string) => String(chave ?? '').replace(/(\d{4})(?=\d)/g, '$1 ')

/** Data do calendário local em ISO. Nunca UTC: às 21h de Brasília `toISOString()` já devolve amanhã. */
export const diaISO = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const hojeISO = () => diaISO()

/**
 * Dia de produção: o relógio local descontado da hora de virada do tenant (com virada 05:00, um bipe
 * às 02:00 conta para o dia anterior). É o mesmo dia que a camada de dados usa para buscar plano,
 * etiquetas e bipes — as telas precisam filtrar por ele, não por `hojeISO()`, senão pedem um dia e
 * mostram outro.
 */
export function diaProducao(horaVirada: string | undefined, agora = new Date()): string {
  const [h, m] = String(horaVirada || '05:00').split(':').map((x) => Number(x) || 0)
  return diaISO(new Date(agora.getTime() - (h * 60 + m) * 60_000))
}
