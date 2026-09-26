// Regras do modo memória como funções puras sobre o Snapshot. Usadas pelo MemoryRepo (que guarda o
// estado) e pelo store (atualização otimista antes da resposta do backend). Comportamento idêntico
// ao antigo StoreProvider.
import { diaProducao } from '../domain/format'
import { PERFIL_PADRAO } from '@prodio/core/etiquetas'
import type { Bom, Channel, DailyPlanLine, Label, LabelSize, NfeInbound, OutboxItem, Product, PurchaseOrder, ScanEvent, StockMove } from '../domain/types'
import type { ScanResult, Snapshot } from './repo'

export interface Resultado<T = void> {
  estado: Snapshot
  valor: T
}

const agora = () => new Date().toISOString()
/** Competência e dia da etiqueta seguem a hora de virada do tenant, igual ao que o banco grava. */
const diaDoTenant = (s: Snapshot) => diaProducao(s.tenant.horaVirada)
const r3 = (n: number) => Math.round(n * 1000) / 1000
const r2 = (n: number) => Math.round(n * 100) / 100

export function upsertLista<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]
}

export function registerScan(s: Snapshot, serialRaw: string, operador: string, dispositivo: string, id: string, lidos?: Set<string>): Resultado<ScanResult> {
  const serial = serialRaw.trim().toUpperCase()
  const label = s.labels.find((l) => l.serial === serial)
  if (!label) return { estado: s, valor: { ok: false, motivo: 'desconhecida' } }
  const product = s.products.find((p) => p.id === label.productId)
  if (!product) return { estado: s, valor: { ok: false, motivo: 'desconhecida' } }
  if (label.status === 'anulada') return { estado: s, valor: { ok: false, motivo: 'anulada', product } }
  if (label.status === 'reservada') return { estado: s, valor: { ok: false, motivo: 'nao_impressa', product } }
  if (lidos?.has(serial) || s.scans.some((x) => x.serial === serial && x.tipo === 'produzido')) {
    return { estado: s, valor: { ok: false, motivo: 'ja_bipado', product } }
  }
  const scan: ScanEvent = {
    id,
    serial,
    productId: label.productId,
    operador,
    dispositivo,
    etapa: 'final',
    tipo: 'produzido',
    quantidade: label.quantidade,
    em: agora(),
    competencia: diaDoTenant(s),
    sincronizado: true,
  }
  const dailyPlan = s.dailyPlan.map((l) => (l.productId === label.productId ? { ...l, bipado: l.bipado + label.quantidade } : l))
  const conector = s.connectors.find((c) => c.status === 'conectado' && c.capacidades.pushEstoque)
  const outbox: OutboxItem[] = conector
    ? [{ id: `${id}-ob`, connectorId: conector.id, productId: label.productId, delta: label.quantidade, status: 'pendente', em: scan.em }, ...s.outbox]
    : s.outbox
  return { estado: { ...s, scans: [scan, ...s.scans], dailyPlan, outbox }, valor: { ok: true, scan, product } }
}

export function reverseScan(s: Snapshot, scanId: string, revId: string): Snapshot {
  const orig = s.scans.find((x) => x.id === scanId)
  if (!orig || orig.tipo !== 'produzido') return s
  const rev: ScanEvent = { ...orig, id: revId, tipo: 'estorno', quantidade: -orig.quantidade, em: agora() }
  const scans = s.scans.filter((x) => x.id !== scanId)
  const dailyPlan = s.dailyPlan.map((l) => (l.productId === orig.productId ? { ...l, bipado: Math.max(0, l.bipado - orig.quantidade) } : l))
  return { ...s, scans: [rev, ...scans], dailyPlan }
}

export function setProjetado(s: Snapshot, productId: string, projetado: number): Snapshot {
  return {
    ...s,
    dailyPlan: s.dailyPlan.some((l) => l.productId === productId)
      ? s.dailyPlan.map((l) => (l.productId === productId ? { ...l, projetado } : l))
      : [...s.dailyPlan, { productId, demandaDia: 0, projetado, impresso: 0, bipado: 0, carteira: 0, saldoHub: 0 }],
  }
}

/**
 * Linhas sugeridas entram no plano de hoje só para produto que ainda não está nele: o que a encarregada
 * já ajustou (ou outra sugestão aplicada antes) nunca é sobrescrito. Linha com projetado zero não entra.
 */
export function adicionarAoPlano(s: Snapshot, linhas: DailyPlanLine[]): Resultado<DailyPlanLine[]> {
  const ja = new Set(s.dailyPlan.map((l) => l.productId))
  const novas: DailyPlanLine[] = []
  for (const l of linhas) {
    if (ja.has(l.productId) || !(l.projetado > 0)) continue
    ja.add(l.productId)
    novas.push({ ...l, impresso: 0, bipado: 0 })
  }
  return { estado: novas.length ? { ...s, dailyPlan: [...s.dailyPlan, ...novas] } : s, valor: novas }
}

export function printLabels(s: Snapshot, productId: string, qtd: number, tipo: 'unidade' | 'caixa' = 'unidade'): Resultado<Label[]> {
  const p = s.products.find((x) => x.id === productId)
  if (!p) return { estado: s, valor: [] }
  const dia = diaDoTenant(s)
  const diaCompacto = dia.replace(/-/g, '').slice(2)
  const perfil = s.tenant.perfisEtiqueta.find((x) => x.familia === p.familia)
  // Família sem perfil: o mesmo que a RPC reserve_label_batch grava (ET, 1 por caixa).
  const prefix = perfil?.prefixo ?? PERFIL_PADRAO.prefixo
  const porCaixa = perfil?.unidadesPorCaixa ?? PERFIL_PADRAO.unidadesPorCaixa
  const seqInicial = s.labels.filter((l) => l.productId === productId && l.dia === dia).length
  const novas: Label[] = []
  for (let i = 1; i <= qtd; i++) {
    const seq = seqInicial + i
    novas.push({ serial: `${prefix}${p.sku}${diaCompacto}${String(seq).padStart(4, '0')}`, productId, tipo, quantidade: tipo === 'caixa' ? porCaixa : 1, status: 'impressa', dia, seq })
  }
  const dailyPlan = s.dailyPlan.map((l) => (l.productId === productId ? { ...l, impresso: l.impresso + qtd } : l))
  return { estado: { ...s, labels: [...s.labels, ...novas], dailyPlan }, valor: novas }
}

export function annulLabel(s: Snapshot, serial: string): Snapshot {
  const label = s.labels.find((l) => l.serial === serial)
  if (!label || label.status === 'anulada') return s
  const dailyPlan = s.dailyPlan.map((l) => (l.productId === label.productId ? { ...l, impresso: Math.max(0, l.impresso - 1) } : l))
  return { ...s, labels: s.labels.map((l) => (l.serial === serial ? { ...l, status: 'anulada' as const } : l)), dailyPlan }
}

export function addStockMove(s: Snapshot, m: Omit<StockMove, 'id' | 'em'>, id: string): Snapshot {
  const move: StockMove = { ...m, id, em: agora() }
  const materials = s.materials.map((x) => (x.id === m.materialId ? { ...x, saldo: r3(x.saldo + m.delta) } : x))
  return { ...s, stockMoves: [move, ...s.stockMoves], materials }
}

export function saveBom(s: Snapshot, b: Bom): Snapshot {
  const boms = s.boms.some((x) => x.productId === b.productId) ? s.boms.map((x) => (x.productId === b.productId ? b : x)) : [...s.boms, b]
  const products = s.products.map((p) => (p.id === b.productId ? { ...p, temFicha: b.linhas.length > 0 } : p))
  return { ...s, boms, products }
}

export function createPurchaseOrder(s: Snapshot, po: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>, id: string): Resultado<PurchaseOrder> {
  const numero = Math.max(1000, ...s.purchaseOrders.map((x) => x.numero)) + 1
  const created: PurchaseOrder = { ...po, id, numero, criadaEm: agora() }
  return { estado: { ...s, purchaseOrders: [created, ...s.purchaseOrders] }, valor: created }
}

export function receiveNfe(s: Snapshot, chave: string, itens: NfeInbound['itens'], porOc: Record<string, number>, lote: string): Snapshot {
  const nfe = s.nfes.find((n) => n.chave === chave)
  if (!nfe) return s
  const moves: StockMove[] = []
  let materials = s.materials
  let i = 0
  for (const it of itens) {
    if (!it.materialId || !it.qtdConsumo) continue
    const custoUnit = it.vUnCom / (it.fator || 1)
    const qtd = it.qtdConsumo
    moves.push({ id: `${lote}-${i++}`, materialId: it.materialId, tipo: 'entrada_nfe', delta: qtd, custoUnit, ref: `NF-e ${nfe.numero}`, por: 'Recebimento', em: agora() })
    materials = materials.map((m) => {
      if (m.id !== it.materialId) return m
      const novoSaldo = m.saldo + qtd
      const novoCm = novoSaldo > 0 ? (m.saldo * m.custoMedio + qtd * custoUnit) / novoSaldo : custoUnit
      return { ...m, saldo: r3(novoSaldo), custoMedio: r2(novoCm) }
    })
  }
  const purchaseOrders = s.purchaseOrders.map((po) => {
    if (!nfe.poIds.includes(po.id)) return po
    const itensPo = po.itens.map((pi) => ({ ...pi, qtdRecebida: pi.qtdRecebida + (porOc[pi.id] ?? 0) }))
    const completo = itensPo.every((pi) => pi.qtdRecebida >= pi.qtd)
    const algum = itensPo.some((pi) => pi.qtdRecebida > 0)
    return { ...po, itens: itensPo, status: completo ? ('recebida' as const) : algum ? ('parcial' as const) : po.status }
  })
  const nfes = s.nfes.map((n) => (n.chave === chave ? { ...n, itens, status: 'recebida' as const } : n))
  return { ...s, materials, stockMoves: [...moves, ...s.stockMoves], purchaseOrders, nfes }
}

export const updateNfe = (s: Snapshot, n: NfeInbound): Snapshot => ({ ...s, nfes: s.nfes.map((x) => (x.chave === n.chave ? n : x)) })
export const addNfe = (s: Snapshot, n: NfeInbound): Snapshot => (s.nfes.some((x) => x.chave === n.chave) ? s : { ...s, nfes: [n, ...s.nfes] })
export const markNotification = (s: Snapshot, id: string): Snapshot => ({ ...s, notifications: s.notifications.map((n) => (n.id === id ? { ...n, lida: true } : n)) })
export const retryOutbox = (s: Snapshot, id: string): Snapshot => ({ ...s, outbox: s.outbox.map((o) => (o.id === id ? { ...o, status: 'aplicado' as const, erro: undefined } : o)) })
export const removeChannel = (s: Snapshot, id: string): Snapshot => ({ ...s, channels: s.channels.filter((c) => c.id !== id) })
export const removeMember = (s: Snapshot, id: string): Snapshot => ({ ...s, members: s.members.filter((m) => m.id !== id) })
export const removeDevice = (s: Snapshot, id: string): Snapshot => ({ ...s, devices: s.devices.filter((d) => d.id !== id) })
export const upsertChannel = (s: Snapshot, c: Channel): Snapshot => ({ ...s, channels: upsertLista(s.channels, c) })

export function setPrecoVenda(s: Snapshot, productId: string, channelId: string, preco: number | undefined): Snapshot {
  const products: Product[] = s.products.map((p) => (p.id === productId ? { ...p, precoVenda: { ...(p.precoVenda ?? {}), [channelId]: preco } } : p))
  return { ...s, products }
}

export function upsertOperator(s: Snapshot, o: { id?: string; nome: string; pin?: string }, id: string): Snapshot {
  const atual = o.id ? s.operators.find((x) => x.id === o.id) : undefined
  const op = { id: o.id ?? id, nome: o.nome, pin: o.pin ?? atual?.pin ?? '' }
  return { ...s, operators: upsertLista(s.operators, op) }
}

const ordemTamanho = (a: LabelSize, b: LabelSize) => a.larguraMm - b.larguraMm || a.alturaMm - b.alturaMm || a.nome.localeCompare(b.nome, 'pt-BR')

/**
 * Tamanho de etiqueta, como a RPC save_label_size: marcar padrão tira o do anterior e o primeiro tamanho vira
 * padrão. Desmarcar o único padrão não muda nada (a tela não deixa; o banco recusa).
 */
export function saveLabelSize(s: Snapshot, t: LabelSize): Snapshot {
  // Mudou a medida de um tamanho de fábrica: deixa de ser "de fábrica" (igual à RPC).
  const antes = s.labelSizes.find((x) => x.id === t.id)
  const novo = antes?.preset && (antes.larguraMm !== t.larguraMm || antes.alturaMm !== t.alturaMm) ? { ...t, preset: undefined } : t
  let lista = upsertLista(s.labelSizes, novo)
  if (t.padrao) lista = lista.map((x) => (x.id === t.id ? x : { ...x, padrao: false }))
  if (!lista.some((x) => x.padrao)) {
    if (lista.length > 1) return s
    lista = lista.map((x) => ({ ...x, padrao: true }))
  }
  return { ...s, labelSizes: [...lista].sort(ordemTamanho) }
}

/** Apaga um tamanho que não é o padrão; os perfis que o usavam voltam ao padrão (tamanhoId nulo). */
export function removeLabelSize(s: Snapshot, id: string): Snapshot {
  const alvo = s.labelSizes.find((x) => x.id === id)
  if (!alvo || alvo.padrao) return s
  const perfisEtiqueta = s.tenant.perfisEtiqueta.map((p) => (p.tamanhoId === id ? { ...p, tamanhoId: null } : p))
  return { ...s, labelSizes: s.labelSizes.filter((x) => x.id !== id), tenant: { ...s.tenant, perfisEtiqueta } }
}
