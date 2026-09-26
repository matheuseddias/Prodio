import type { Material, NfeInbound, NfeItem, PurchaseOrder, Supplier } from '../../domain/types'
import type { Tone } from '../../ui'

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

export const STATUS_TONE: Record<NfeInbound['status'], Tone> = {
  aguardando_xml: 'warn',
  pendente: 'info',
  conferida: 'accent',
  recebida: 'ok',
  ignorada: 'neutral',
}
export const ORIGEM_TONE: Record<NfeInbound['origem'], Tone> = { email: 'info', upload: 'neutral', erp: 'accent', dfe: 'accent', sem_xml: 'warn' }

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

// ---- E-mail de XML por tenant ---------------------------------------------

/** Slug curto do tenant: primeira palavra do nome, sem acento. */
export const slugTenant = (nome: string) => norm(nome).split(/[^a-z0-9]+/).filter(Boolean)[0] ?? 'empresa'

/**
 * Domínio que recebe XML de NF-e por e-mail. Tem que ser o mesmo domínio configurado
 * no Email Routing da Cloudflare que aponta para o worker (apps/worker/src/email.ts).
 */
// `||` e não `??`: o workflow Publicar passa a variável vazia quando ela não existe no GitHub, e o endereço
// saía "xml@empresa." sem domínio.
export const DOMINIO_EMAIL_XML = (import.meta.env.VITE_DOMINIO_EMAIL_XML || 'prodio.com.br').trim().replace(/^@/, '')

/** Endereço que recebe XML por e-mail: xml@<slug>.<domínio> (sempre ativo). */
// O worker acha a empresa pelo tenants.slug (apps/worker/src/email.ts, resolverSlug). Antes a tela montava o
// endereço pelo nome, e de dois jeitos: Recebimento mostrava xml@eddias… e Configurações › Empresa xml@eddias-home….
export const emailXml = (t: { slug?: string; nome: string }) => `xml@${t.slug?.trim() || slugTenant(t.nome)}.${DOMINIO_EMAIL_XML}`

// ---- Nota a partir da chave + OC (consulta no provedor / recebimento às cegas) ----

/** Partes da chave de acesso: CNPJ do emitente, série e número. */
export function partesChave(chave: string) {
  return { cnpj: chave.slice(6, 20), serie: Number(chave.slice(22, 25)), numero: Number(chave.slice(25, 34)) }
}

/**
 * Monta uma NfeInbound para uma chave que não estava no Prodio.
 * - 'dfe': o provedor devolveu o XML; itens de exemplo a partir do pendente da OC.
 * - 'sem_xml': recebimento às cegas; fica 'aguardando_xml' sem itens.
 */
export function nfeDaChave(chave: string, origem: 'dfe' | 'sem_xml', po: PurchaseOrder | undefined, materials: Material[], suppliers: Supplier[]): NfeInbound {
  const { cnpj, serie, numero } = partesChave(chave)
  const forn = suppliers.find((s) => s.cnpj === cnpj) ?? (po ? suppliers.find((s) => s.id === po.supplierId) : undefined)
  const pendentes = (po?.itens ?? []).map((pi) => ({ pi, pend: Math.max(0, pi.qtd - pi.qtdRecebida) })).filter((x) => x.pend > 0)
  const itens: NfeItem[] =
    origem === 'dfe'
      ? pendentes.map(({ pi, pend }, idx) => {
          const m = materials.find((x) => x.id === pi.materialId)
          return {
            nItem: idx + 1,
            cProd: m?.sku ?? pi.materialId,
            xProd: (m?.nome ?? pi.materialId).toUpperCase(),
            ncm: (m?.ncm ?? '').replace(/\D/g, ''),
            cfop: '5102',
            uCom: pi.unidadeCompra.toUpperCase(),
            qCom: pend,
            vUnCom: pi.preco,
            vProd: Math.round(pend * pi.preco * 100) / 100,
            materialId: pi.materialId,
            fator: pi.fator,
            qtdConsumo: Math.round(pend * pi.fator * 1000) / 1000,
          }
        })
      : []
  const valorTotal = Math.round(pendentes.reduce((a, { pi, pend }) => a + pend * pi.preco, 0) * 100) / 100
  return {
    chave,
    numero,
    serie,
    cnpjEmitente: cnpj,
    emitente: forn?.nome ?? `CNPJ ${cnpj}`,
    supplierId: forn?.id,
    emissao: new Date().toISOString(),
    valorTotal,
    origem,
    status: origem === 'dfe' ? 'pendente' : 'aguardando_xml',
    poIds: po ? [po.id] : [],
    itens,
  }
}
