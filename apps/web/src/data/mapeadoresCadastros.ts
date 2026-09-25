// Mapeadores de ida e volta entre as linhas do banco (snake_case, docs/schema.md) e os tipos de
// domínio (@prodio/core/tipos): tenant, cadastros, canais, membros, aparelhos, operadores.
import type { Channel, Device, LabelProfile, Location, Material, Member, Notification, Operator, Product, Supplier, Tenant } from '../domain/types'

export const num = (v: unknown, padrao = 0): number => {
  const n = typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : padrao
}
export const numOpt = (v: unknown): number | undefined => (v == null || v === '' ? undefined : num(v))
export const strOpt = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v))
/** Fração do banco (0.18) → percentual da interface (18). */
export const pctDoBanco = (v: unknown): number => Math.round(num(v) * 100 * 100000) / 100000
/** Percentual da interface (18) → fração do banco (0.18). */
export const pctParaBanco = (v: number | undefined): number => Math.round(num(v) * 1000) / 100000

// --- Tenant -----------------------------------------------------------------
export interface TenantRow {
  id: string
  nome: string
  cnpj: string
  regime: Tenant['regime']
  credita_impostos: boolean
  hora_virada: string
  dias_uteis_mes: number
  margem_projecao: number | string
  dias_cobertura: number
  margem_alvo_padrao: number | string
  exigir_projecao_para_imprimir: boolean
}
export interface LabelProfileRow {
  familia: string
  prefixo: string
  tipos: string[]
  unidades_por_caixa: number
  instrucao_montagem: string | null
}

export function tenantDoBanco(r: TenantRow, perfis: LabelProfileRow[]): Tenant {
  return {
    id: r.id,
    nome: r.nome,
    cnpj: r.cnpj,
    regime: r.regime,
    creditaImpostos: !!r.credita_impostos,
    horaVirada: String(r.hora_virada ?? '05:00').slice(0, 5),
    diasUteisMes: num(r.dias_uteis_mes, 22),
    margemProjecao: num(r.margem_projecao, 0.1),
    diasCobertura: num(r.dias_cobertura, 15),
    margemAlvoPadrao: num(r.margem_alvo_padrao, 0.2),
    exigirProjecaoParaImprimir: !!r.exigir_projecao_para_imprimir,
    perfisEtiqueta: (Array.isArray(perfis) ? perfis : []).map(perfilDoBanco),
  }
}
export function perfilDoBanco(r: LabelProfileRow): LabelProfile {
  // `tipos` é text[] no banco, mas um perfil importado ou editado à mão pode chegar sem lista; sem
  // este piso a tela de Etiquetas quebra logo no cabeçalho (resumoPerfis percorre tipos).
  const tipos = (Array.isArray(r.tipos) ? r.tipos : []) as LabelProfile['tipos']
  return {
    familia: String(r.familia ?? ''),
    prefixo: String(r.prefixo ?? 'PR'),
    tipos: tipos.length ? tipos : ['produto'],
    unidadesPorCaixa: num(r.unidades_por_caixa, 1),
    instrucaoMontagem: strOpt(r.instrucao_montagem),
  }
}
export function tenantParaBanco(t: Tenant): Omit<TenantRow, 'id'> {
  return {
    nome: t.nome,
    cnpj: t.cnpj.replace(/\D/g, ''),
    regime: t.regime,
    credita_impostos: t.creditaImpostos,
    hora_virada: t.horaVirada,
    dias_uteis_mes: t.diasUteisMes,
    margem_projecao: t.margemProjecao,
    dias_cobertura: t.diasCobertura,
    margem_alvo_padrao: t.margemAlvoPadrao,
    exigir_projecao_para_imprimir: t.exigirProjecaoParaImprimir,
  }
}
export function perfilParaBanco(tenantId: string, p: LabelProfile): LabelProfileRow & { tenant_id: string } {
  return { tenant_id: tenantId, familia: p.familia, prefixo: p.prefixo, tipos: p.tipos, unidades_por_caixa: p.unidadesPorCaixa, instrucao_montagem: p.instrucaoMontagem ?? null }
}

// --- Produtos -----------------------------------------------------------------
export interface ProductRow {
  id: string
  sku: string
  nome: string
  familia: string | null
  atributos: Record<string, string> | null
  ean: string | null
  ncm: string | null
  status: Product['status']
  peso_kg: number | string | null
  peso_cubado_kg: number | string | null
  custo_manual: number | string | null
  sku_aliases?: Array<{ sku_externo: string }> | null
}
export function productDoBanco(r: ProductRow, extras: { temFicha?: boolean; custoFicha?: number; precoVenda?: Record<string, number> } = {}): Product {
  return {
    id: r.id,
    sku: r.sku,
    nome: r.nome,
    familia: r.familia ?? '',
    atributos: r.atributos ?? {},
    ean: strOpt(r.ean),
    ncm: strOpt(r.ncm),
    status: r.status,
    aliases: (r.sku_aliases ?? []).map((a) => a.sku_externo),
    temFicha: !!extras.temFicha,
    custoFicha: extras.custoFicha ?? numOpt(r.custo_manual),
    pesoKg: numOpt(r.peso_kg),
    pesoCubadoKg: numOpt(r.peso_cubado_kg),
    precoVenda: extras.precoVenda && Object.keys(extras.precoVenda).length ? extras.precoVenda : undefined,
  }
}
export function productParaBanco(tenantId: string, p: Product, id?: string) {
  return {
    ...(id ? { id } : {}),
    tenant_id: tenantId,
    sku: p.sku.trim(),
    nome: p.nome,
    familia: p.familia || null,
    atributos: p.atributos ?? {},
    ean: p.ean || null,
    ncm: p.ncm || null,
    status: p.status,
    peso_kg: p.pesoKg ?? null,
    peso_cubado_kg: p.pesoCubadoKg ?? null,
  }
}

// --- Insumos -----------------------------------------------------------------
export interface MaterialRow {
  id: string
  sku: string
  nome: string
  ncm: string | null
  unidade_compra: string
  unidade_consumo: string
  fator_conversao: number | string
  minimo: number | string
  custo_referencia: number | string | null
  fornecedor_padrao_id: string | null
  lead_time_dias: number
}
export interface StockRow {
  material_id: string
  saldo: number | string
  custo_medio: number | string
}
export function materialDoBanco(r: MaterialRow, saldo?: StockRow): Material {
  return {
    id: r.id,
    sku: r.sku,
    nome: r.nome,
    unidadeCompra: r.unidade_compra,
    unidadeConsumo: r.unidade_consumo,
    fatorConversao: num(r.fator_conversao, 1),
    ncm: strOpt(r.ncm),
    minimo: num(r.minimo),
    saldo: num(saldo?.saldo),
    custoMedio: saldo && num(saldo.custo_medio) > 0 ? num(saldo.custo_medio) : num(r.custo_referencia),
    fornecedorPadraoId: strOpt(r.fornecedor_padrao_id),
    leadTimeDias: num(r.lead_time_dias),
  }
}
export function materialParaBanco(tenantId: string, m: Material, id?: string) {
  return {
    ...(id ? { id } : {}),
    tenant_id: tenantId,
    sku: m.sku.trim(),
    nome: m.nome,
    ncm: m.ncm || null,
    unidade_compra: m.unidadeCompra,
    unidade_consumo: m.unidadeConsumo,
    fator_conversao: m.fatorConversao > 0 ? m.fatorConversao : 1,
    minimo: m.minimo,
    custo_referencia: m.custoMedio || null,
    fornecedor_padrao_id: m.fornecedorPadraoId || null,
    lead_time_dias: Math.max(0, Math.round(m.leadTimeDias || 0)),
  }
}

// --- Fornecedores -----------------------------------------------------------------
export interface SupplierRow {
  id: string
  nome: string
  cnpj: string
  regime: Supplier['regime']
  lead_time_dias: number
  condicao_pagamento: number[] | null
  contato: string | null
}
export function supplierDoBanco(r: SupplierRow): Supplier {
  return { id: r.id, nome: r.nome, cnpj: r.cnpj, regime: r.regime, leadTimeDias: num(r.lead_time_dias), condicaoPagamento: r.condicao_pagamento ?? [0], contato: strOpt(r.contato) }
}
export function supplierParaBanco(tenantId: string, s: Supplier, id?: string) {
  return {
    ...(id ? { id } : {}),
    tenant_id: tenantId,
    nome: s.nome,
    cnpj: s.cnpj.replace(/\D/g, ''),
    regime: s.regime,
    lead_time_dias: Math.max(0, Math.round(s.leadTimeDias || 0)),
    condicao_pagamento: s.condicaoPagamento.length ? s.condicaoPagamento : [0],
    contato: s.contato || null,
  }
}

// --- Canais e preços -----------------------------------------------------------------
export interface ChannelRow {
  id: string
  nome: string
  preset: string | null
  ativo: boolean
  comissao_pct: number | string | null
  taxa_fixa: number | string | null
  taxa_fixa_abaixo_de: number | string | null
  frete_vendedor: Array<{ ateKg: number; valor: number }> | null
  frete_gratis_acima_de: number | string | null
  imposto_venda_pct: number | string | null
  ads_pct: number | string | null
  parcelamento_pct: number | string | null
  outros_pct: number | string | null
  observacao: string | null
}
export function channelDoBanco(r: ChannelRow): Channel {
  return {
    id: r.id,
    nome: r.nome,
    preset: (r.preset ?? undefined) as Channel['preset'],
    ativo: !!r.ativo,
    comissaoPct: pctDoBanco(r.comissao_pct),
    taxaFixa: num(r.taxa_fixa),
    taxaFixaAbaixoDe: numOpt(r.taxa_fixa_abaixo_de),
    freteVendedor: (r.frete_vendedor ?? []).map((f) => ({ ateKg: num(f.ateKg), valor: num(f.valor) })),
    freteGratisAcimaDe: numOpt(r.frete_gratis_acima_de),
    impostoVendaPct: pctDoBanco(r.imposto_venda_pct),
    adsPct: pctDoBanco(r.ads_pct),
    parcelamentoPct: pctDoBanco(r.parcelamento_pct),
    outrosPct: pctDoBanco(r.outros_pct),
    observacao: strOpt(r.observacao),
  }
}
export function channelParaBanco(tenantId: string, c: Channel, id?: string) {
  return {
    ...(id ? { id } : {}),
    tenant_id: tenantId,
    nome: c.nome,
    preset: c.preset ?? null,
    ativo: c.ativo,
    comissao_pct: pctParaBanco(c.comissaoPct),
    taxa_fixa: c.taxaFixa,
    taxa_fixa_abaixo_de: c.taxaFixaAbaixoDe ?? null,
    frete_vendedor: c.freteVendedor,
    frete_gratis_acima_de: c.freteGratisAcimaDe ?? null,
    imposto_venda_pct: pctParaBanco(c.impostoVendaPct),
    ads_pct: pctParaBanco(c.adsPct),
    parcelamento_pct: pctParaBanco(c.parcelamentoPct),
    outros_pct: pctParaBanco(c.outrosPct),
    observacao: c.observacao ?? null,
  }
}
export interface PriceRow {
  product_id: string
  channel_id: string
  preco: number | string
}
export function precosPorProduto(rows: PriceRow[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {}
  for (const r of rows) (out[r.product_id] ??= {})[r.channel_id] = num(r.preco)
  return out
}

// --- Membros, aparelhos, operadores, locais, avisos ----------------------------------------
export interface MembershipRow {
  user_id: string
  role: Member['papel']
  location_id: string | null
  nome: string | null
  accepted_at: string | null
  invited_at?: string | null
}
export function memberDoBanco(r: MembershipRow): Member {
  return { id: r.user_id, nome: r.nome || 'Usuário', papel: r.role, localId: strOpt(r.location_id), ultimoAcesso: strOpt(r.accepted_at ?? r.invited_at) }
}
export interface DeviceRow {
  id: string
  nome: string
  location_id: string | null
  registered_at: string | null
  created_at: string
  last_scan_at: string | null
  revoked_at?: string | null
}
export function deviceDoBanco(r: DeviceRow): Device {
  return { id: r.id, nome: r.nome, localId: r.location_id ?? '', registradoEm: r.registered_at ?? r.created_at, ultimoBipe: strOpt(r.last_scan_at), pendentesOffline: 0 }
}
export interface OperatorRow {
  id: string
  nome: string
  ativo?: boolean
}
export const operatorDoBanco = (r: OperatorRow): Operator => ({ id: r.id, nome: r.nome, pin: '' })
export interface LocationRow {
  id: string
  nome: string
  kind: Location['tipo']
}
export const locationDoBanco = (r: LocationRow): Location => ({ id: r.id, nome: r.nome, tipo: r.kind })
export interface NotificationRow {
  id: string
  tipo: Notification['tipo']
  texto: string
  lida: boolean
  created_at: string
}
export const notificationDoBanco = (r: NotificationRow): Notification => ({ id: r.id, tipo: r.tipo, texto: r.texto, em: r.created_at, lida: !!r.lida })
