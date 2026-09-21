// Mapeadores das entidades de movimento: ficha ativa, plano do dia, etiquetas, bipes, ledger,
// ordens de compra, NF-e e outbox. Contrato em docs/schema.md.
import type { Bom, BomLine, DailyPlanLine, Label, MoveType, NfeInbound, NfeItem, OutboxItem, PurchaseOrder, PurchaseOrderItem, ScanEvent, StockMove } from '../domain/types'
import { num, numOpt, pctDoBanco, pctParaBanco, strOpt } from './mapeadoresCadastros'

// --- Ficha ativa (v_bom_active) -----------------------------------------------------------------
export interface BomActiveRow {
  product_id: string
  bom_version_id: string
  versao: number
  ativada_em: string
  line_id: string
  ordem: number
  tipo: BomLine['tipo']
  material_id: string | null
  component_product_id: string | null
  consumo: number | string
  unidade: string | null
  perda_pct: number | string | null
}
export function bomsDoBanco(rows: BomActiveRow[]): Bom[] {
  const porProduto = new Map<string, Bom>()
  for (const r of [...rows].sort((a, b) => a.ordem - b.ordem)) {
    let b = porProduto.get(r.product_id)
    if (!b) {
      b = { productId: r.product_id, versao: num(r.versao, 1), ativa: true, linhas: [], atualizadoEm: r.ativada_em }
      porProduto.set(r.product_id, b)
    }
    b.linhas.push({
      id: r.line_id,
      tipo: r.tipo,
      materialId: strOpt(r.material_id),
      componentId: strOpt(r.component_product_id),
      consumo: num(r.consumo),
      unidade: r.unidade ?? '',
      perdaPct: pctDoBanco(r.perda_pct),
    })
  }
  return [...porProduto.values()]
}
export function bomLinhasParaBanco(b: Bom) {
  return b.linhas.map((l, i) => ({
    ordem: i + 1,
    tipo: l.tipo,
    material_id: l.tipo === 'insumo' ? l.materialId ?? null : null,
    component_product_id: l.tipo === 'produto' ? l.componentId ?? null : null,
    consumo: l.consumo,
    unidade: l.unidade || null,
    perda_pct: pctParaBanco(l.perdaPct),
  }))
}

// --- Plano do dia (v_daily_plan) -----------------------------------------------------------------
export interface DailyPlanRow {
  product_id: string
  location_id: string
  dia: string
  demanda_dia: number | string
  projetado: number | string
  carteira: number | string
  saldo_hub: number | string
  impresso: number | string
  bipado: number | string
}
export function dailyPlanDoBanco(r: DailyPlanRow): DailyPlanLine {
  return { productId: r.product_id, demandaDia: num(r.demanda_dia), projetado: num(r.projetado), impresso: num(r.impresso), bipado: num(r.bipado), carteira: num(r.carteira), saldoHub: num(r.saldo_hub) }
}
export function dailyPlanParaBanco(l: DailyPlanLine) {
  return { product_id: l.productId, demanda_dia: l.demandaDia, projetado: l.projetado, carteira: l.carteira, saldo_hub: l.saldoHub }
}

// --- Etiquetas -----------------------------------------------------------------
export interface LabelRow {
  id: string
  serial: string
  product_id: string
  tipo: Label['tipo']
  quantidade: number | string
  status: Label['status']
  dia: string
  seq: number
}
export const labelDoBanco = (r: LabelRow): Label => ({ serial: r.serial, productId: r.product_id, tipo: r.tipo, quantidade: num(r.quantidade, 1), status: r.status, dia: r.dia, seq: num(r.seq) })

// --- Bipes -----------------------------------------------------------------
export interface ScanRow {
  id: string
  label_id: string
  product_id: string
  event_type: ScanEvent['tipo']
  quantidade: number | string
  operator_id: string | null
  device_id: string | null
  user_id: string | null
  competencia: string
  scanned_at: string
  reverses_id: string | null
  labels?: { serial: string } | null
  operators?: { nome: string } | null
  devices?: { nome: string } | null
  stages?: { codigo: string } | null
}
/** Converte a lista do dia. Um 'produzido' que já tem estorno some da lista, como no modo memória. */
export function scansDoBanco(rows: ScanRow[], nomes: Record<string, string> = {}): ScanEvent[] {
  const estornados = new Set(rows.filter((r) => r.event_type === 'estorno' && r.reverses_id).map((r) => r.reverses_id as string))
  return rows
    .filter((r) => !(r.event_type === 'produzido' && estornados.has(r.id)))
    .map((r) => ({
      id: r.id,
      serial: r.labels?.serial ?? '',
      productId: r.product_id,
      operador: r.operators?.nome ?? (r.user_id ? nomes[r.user_id] ?? 'Escritório' : '—'),
      dispositivo: r.devices?.nome ?? 'Escritório',
      etapa: r.stages?.codigo ?? 'final',
      tipo: r.event_type,
      quantidade: r.event_type === 'estorno' ? -Math.abs(num(r.quantidade, 1)) : num(r.quantidade, 1),
      em: r.scanned_at,
      competencia: r.competencia,
      sincronizado: true,
    }))
}

// --- Ledger -----------------------------------------------------------------
export interface StockMoveRow {
  id: string
  material_id: string
  move_type: string
  delta: number | string
  custo_unit: number | string | null
  ref_type: string | null
  ref_id: string | null
  motivo: string | null
  created_by: string | null
  created_at: string
}
const REF_LABEL: Record<string, string> = { scan_event: 'Bipe', nfe: 'NF-e', receipt: 'Recebimento', inventory_session: 'Inventário', purchase_order: 'OC', stock_move: 'Estorno' }
export function stockMoveDoBanco(r: StockMoveRow, nomes: Record<string, string> = {}): StockMove {
  const tipo = (r.move_type === 'transferencia' ? 'ajuste' : r.move_type) as MoveType
  return {
    id: r.id,
    materialId: r.material_id,
    tipo,
    delta: num(r.delta),
    custoUnit: numOpt(r.custo_unit),
    ref: r.ref_type ? `${REF_LABEL[r.ref_type] ?? r.ref_type}${r.ref_id ? ' ' + r.ref_id.slice(0, 8) : ''}` : undefined,
    motivo: strOpt(r.motivo),
    por: r.created_by ? nomes[r.created_by] ?? 'sistema' : 'sistema',
    em: r.created_at,
  }
}

// --- Ordens de compra -----------------------------------------------------------------
export interface PoItemRow {
  id: string
  material_id: string
  unidade_compra: string | null
  fator: number | string | null
  qtd: number | string
  qtd_recebida: number | string | null
  preco: number | string | null
  ipi_pct: number | string | null
}
export interface PoRow {
  id: string
  numero: number
  supplier_id: string
  status: PurchaseOrder['status']
  entrega_prevista: string | null
  condicao_pagamento: number[] | null
  observacao: string | null
  created_at: string
  purchase_order_items?: PoItemRow[] | null
}
export const poItemDoBanco = (r: PoItemRow): PurchaseOrderItem => ({
  id: r.id,
  materialId: r.material_id,
  unidadeCompra: r.unidade_compra ?? 'un',
  fator: num(r.fator, 1) || 1,
  qtd: num(r.qtd),
  qtdRecebida: num(r.qtd_recebida),
  preco: num(r.preco),
  ipiPct: pctDoBanco(r.ipi_pct),
})
export function purchaseOrderDoBanco(r: PoRow): PurchaseOrder {
  return {
    id: r.id,
    numero: num(r.numero),
    supplierId: r.supplier_id,
    status: r.status,
    criadaEm: r.created_at,
    entregaPrevista: strOpt(r.entrega_prevista),
    condicaoPagamento: r.condicao_pagamento ?? [0],
    itens: (r.purchase_order_items ?? []).map(poItemDoBanco),
    observacao: strOpt(r.observacao),
  }
}
export function poItensParaBanco(itens: PurchaseOrderItem[]) {
  return itens.map((it) => ({ material_id: it.materialId, unidade_compra: it.unidadeCompra, fator: it.fator || 1, qtd: it.qtd, preco: it.preco, ipi_pct: pctParaBanco(it.ipiPct) }))
}

// --- NF-e -----------------------------------------------------------------
export interface NfeItemRow {
  id?: string
  n_item: number
  c_prod: string | null
  x_prod: string | null
  ncm: string | null
  cfop: string | null
  u_com: string | null
  q_com: number | string
  v_un_com: number | string
  v_prod: number | string
  material_id: string | null
  fator: number | string | null
  qtd_consumo: number | string | null
}
export interface NfeRow {
  id: string
  chave: string
  numero: number
  serie: number
  cnpj_emitente: string
  emitente: string
  supplier_id: string | null
  emissao: string
  valor_total: number | string
  origem: NfeInbound['origem']
  status: NfeInbound['status']
  nfe_inbound_items?: NfeItemRow[] | null
  nfe_po_links?: Array<{ purchase_order_id: string }> | null
}
export const nfeItemDoBanco = (r: NfeItemRow): NfeItem => ({
  nItem: num(r.n_item),
  cProd: r.c_prod ?? '',
  xProd: r.x_prod ?? '',
  ncm: r.ncm ?? '',
  cfop: r.cfop ?? '',
  uCom: r.u_com ?? '',
  qCom: num(r.q_com),
  vUnCom: num(r.v_un_com),
  vProd: num(r.v_prod),
  materialId: strOpt(r.material_id),
  fator: numOpt(r.fator),
  qtdConsumo: numOpt(r.qtd_consumo),
})
export function nfeDoBanco(r: NfeRow): NfeInbound {
  return {
    chave: r.chave,
    numero: num(r.numero),
    serie: num(r.serie),
    cnpjEmitente: r.cnpj_emitente,
    emitente: r.emitente,
    supplierId: strOpt(r.supplier_id),
    emissao: r.emissao,
    valorTotal: num(r.valor_total),
    origem: r.origem,
    status: r.status,
    poIds: (r.nfe_po_links ?? []).map((l) => l.purchase_order_id),
    itens: [...(r.nfe_inbound_items ?? [])].sort((a, b) => num(a.n_item) - num(b.n_item)).map(nfeItemDoBanco),
  }
}
/** Cabeçalho e itens no formato da RPC upsert_nfe_inbound (colunas de nfe_inbound e nfe_inbound_items). */
export function nfeParaBanco(n: NfeInbound) {
  return {
    chave: n.chave,
    numero: n.numero,
    serie: n.serie,
    cnpj_emitente: n.cnpjEmitente.replace(/\D/g, ''),
    emitente: n.emitente,
    supplier_id: n.supplierId ?? null,
    emissao: n.emissao.slice(0, 10),
    valor_total: n.valorTotal,
    origem: n.origem,
    status: n.status,
    po_ids: n.poIds,
  }
}
export function nfeItensParaBanco(itens: NfeItem[]) {
  return itens.map((it) => ({
    n_item: it.nItem,
    c_prod: it.cProd,
    x_prod: it.xProd,
    ncm: it.ncm,
    cfop: it.cfop,
    u_com: it.uCom,
    q_com: it.qCom,
    v_un_com: it.vUnCom,
    v_prod: it.vProd,
    material_id: it.materialId ?? null,
    fator: it.fator ?? null,
    qtd_consumo: it.qtdConsumo ?? null,
  }))
}

// --- Outbox -----------------------------------------------------------------
export interface OutboxRow {
  id: number | string
  connector_id: string
  product_id: string
  delta: number | string
  status: string
  erro: string | null
  created_at: string
}
export function outboxDoBanco(r: OutboxRow): OutboxItem {
  const status: OutboxItem['status'] = r.status === 'erro' ? 'erro' : r.status === 'aplicado' || r.status === 'ignorado' ? 'aplicado' : 'pendente'
  return { id: String(r.id), connectorId: r.connector_id, productId: r.product_id, delta: num(r.delta), status, em: r.created_at, erro: strOpt(r.erro) }
}
