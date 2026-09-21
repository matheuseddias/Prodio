import type { NfeInbound, NfeItem, PurchaseOrder } from '../../domain/types'

// ---- Chave NF-e ------------------------------------------------------------

/** Dígito verificador (módulo 11) dos 43 primeiros dígitos da chave. */
export function dvChaveNfe(chave43: string): number {
  const d = chave43.replace(/\D/g, '').slice(0, 43)
  let peso = 2
  let soma = 0
  for (let i = d.length - 1; i >= 0; i--) {
    soma += Number(d[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto === 0 || resto === 1 ? 0 : 11 - resto
}

export type ChaveCheck = { ok: true; chave: string } | { ok: false; motivo: 'tamanho' | 'dv' }

/** Valida uma chave de acesso: 44 dígitos numéricos e DV módulo 11. */
export function validaChaveNfe(raw: string): ChaveCheck {
  const chave = raw.replace(/\D/g, '')
  if (chave.length !== 44) return { ok: false, motivo: 'tamanho' }
  if (dvChaveNfe(chave) !== Number(chave[43])) return { ok: false, motivo: 'dv' }
  return { ok: true, chave }
}

// ---- CFOP ------------------------------------------------------------------

const CFOP_AUTO = new Set(['5101', '5102', '5401', '5403', '5405'])
const CFOP_MANUAL: Record<string, string> = {
  '5901': 'Remessa p/ industrialização',
  '5902': 'Retorno de industrialização',
  '5910': 'Bonificação / brinde',
  '5915': 'Remessa p/ conserto',
  '5916': 'Retorno de conserto',
  '5202': 'Devolução de compra',
  '5949': 'Outras saídas',
}

export interface CfopInfo {
  auto: boolean
  label: string
}

/** Entram automático: 5101/5102/5401/5403/5405 e os equivalentes 6xxx. Outros pedem classificação. */
export function cfopInfo(cfop: string): CfopInfo {
  const c = cfop.trim()
  const equiv = c.startsWith('6') ? '5' + c.slice(1) : c
  if (CFOP_AUTO.has(equiv)) return { auto: true, label: 'Compra · entra automático' }
  if (CFOP_MANUAL[equiv]) return { auto: false, label: CFOP_MANUAL[equiv] }
  return { auto: false, label: 'Classificar' }
}

// ---- Origem ----------------------------------------------------------------

export const ORIGEM_LABEL: Record<NfeInbound['origem'], string> = {
  email: 'E-mail',
  upload: 'Upload',
  erp: 'ERP',
  dfe: 'DF-e',
  sem_xml: 'Sem XML',
}

export const STATUS_LABEL: Record<NfeInbound['status'], string> = {
  aguardando_xml: 'Aguardando XML',
  pendente: 'Pendente',
  conferida: 'Conferida',
  recebida: 'Recebida',
  ignorada: 'Ignorada',
}

// ---- Baixa de OC -----------------------------------------------------------

/**
 * Monta o mapa purchaseOrderItem.id → quantidade recebida em unidade de COMPRA
 * (qtdConsumo ÷ fator do item da OC), distribuindo entre as OCs vinculadas.
 */
export function porOcFromItens(poIds: string[], itens: NfeItem[], purchaseOrders: PurchaseOrder[]): Record<string, number> {
  const out: Record<string, number> = {}
  const pos = purchaseOrders.filter((po) => poIds.includes(po.id))
  for (const it of itens) {
    if (!it.materialId || !it.qtdConsumo) continue
    let restante = it.qtdConsumo
    for (const po of pos) {
      for (const pi of po.itens) {
        if (pi.materialId !== it.materialId || restante <= 0) continue
        const pendenteConsumo = Math.max(0, (pi.qtd - pi.qtdRecebida) * pi.fator - (out[pi.id] ?? 0) * pi.fator)
        const aplicar = Math.min(restante, pendenteConsumo > 0 ? pendenteConsumo : restante)
        out[pi.id] = Math.round(((out[pi.id] ?? 0) + aplicar / pi.fator) * 1000) / 1000
        restante -= aplicar
      }
    }
  }
  return out
}

/** Prevê o status de cada OC vinculada depois de aplicar porOc. */
export function previsaoOcs(poIds: string[], porOc: Record<string, number>, purchaseOrders: PurchaseOrder[]) {
  return purchaseOrders
    .filter((po) => poIds.includes(po.id))
    .map((po) => {
      const itens = po.itens.map((pi) => ({ ...pi, qtdRecebida: pi.qtdRecebida + (porOc[pi.id] ?? 0) }))
      const completo = itens.every((pi) => pi.qtdRecebida >= pi.qtd)
      const algum = itens.some((pi) => pi.qtdRecebida > 0)
      return { po, status: completo ? 'total' : algum ? 'parcial' : 'sem_baixa' } as const
    })
}

/** Pendente na OC (unidade de consumo) para um insumo. */
export function pendenteOcConsumo(poIds: string[], materialId: string, purchaseOrders: PurchaseOrder[]): number {
  let total = 0
  for (const po of purchaseOrders) {
    if (!poIds.includes(po.id)) continue
    for (const pi of po.itens) if (pi.materialId === materialId) total += Math.max(0, pi.qtd - pi.qtdRecebida) * pi.fator
  }
  return total
}

/** Normaliza texto para comparação (sem acento, minúsculo). */
export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Similaridade simples por palavras em comum (includes). */
export function similaridade(a: string, b: string): number {
  const ta = norm(a)
    .split(/[^a-z0-9,]+/)
    .filter((t) => t.length >= 3)
  const nb = norm(b)
  return ta.filter((t) => nb.includes(t)).length
}
