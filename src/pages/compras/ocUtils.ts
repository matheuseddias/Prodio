import type { PoStatus, PurchaseOrder, PurchaseOrderItem } from '../../domain/types'
import type { Tone } from '../../ui'

export const STATUS_LABEL: Record<PoStatus, string> = {
  aberta: 'Aberta',
  parcial: 'Parcial',
  recebida: 'Recebida',
  cancelada: 'Cancelada',
}

export const STATUS_TONE: Record<PoStatus, Tone> = {
  aberta: 'info',
  parcial: 'warn',
  recebida: 'ok',
  cancelada: 'neutral',
}

export const itemTotal = (it: Pick<PurchaseOrderItem, 'qtd' | 'preco' | 'ipiPct'>) =>
  it.qtd * it.preco * (1 + it.ipiPct / 100)

export const ocTotal = (po: PurchaseOrder) => po.itens.reduce((s, it) => s + itemTotal(it), 0)

/** Percentual recebido ponderado pela quantidade em unidade de consumo. */
export const ocRecebidoPct = (po: PurchaseOrder) => {
  const tot = po.itens.reduce((s, it) => s + it.qtd * it.fator, 0)
  if (tot <= 0) return 0
  const rec = po.itens.reduce((s, it) => s + Math.min(it.qtd, it.qtdRecebida) * it.fator, 0)
  return Math.round((rec / tot) * 100)
}

/** Converte "YYYY-MM-DD" (ou ISO completo) em Date local sem deslocamento de fuso. */
export const parseData = (iso: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(iso)
}

export const hojeLocal = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export const somaDias = (base: Date, dias: number) => {
  const d = new Date(base)
  d.setDate(d.getDate() + dias)
  return d
}

export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const diasAte = (iso: string) => {
  const alvo = parseData(iso)
  alvo.setHours(0, 0, 0, 0)
  return Math.round((alvo.getTime() - hojeLocal().getTime()) / 86_400_000)
}

export const ocAtrasada = (po: PurchaseOrder) =>
  (po.status === 'aberta' || po.status === 'parcial') && !!po.entregaPrevista && diasAte(po.entregaPrevista) < 0

export const condicaoLabel = (cond: number[]) =>
  cond.length === 0 || (cond.length === 1 && cond[0] === 0) ? 'À vista' : `${cond.join('/')} dias`

export interface Parcela {
  n: number
  dias: number
  vencimento: Date
  valor: number
}

export const parcelas = (po: PurchaseOrder): Parcela[] => {
  const total = ocTotal(po)
  const cond = po.condicaoPagamento.length ? po.condicaoPagamento : [0]
  const base = po.entregaPrevista ? parseData(po.entregaPrevista) : parseData(po.criadaEm)
  const valor = Math.round((total / cond.length) * 100) / 100
  return cond.map((dias, i) => ({
    n: i + 1,
    dias,
    vencimento: somaDias(base, dias),
    valor: i === cond.length - 1 ? Math.round((total - valor * (cond.length - 1)) * 100) / 100 : valor,
  }))
}
