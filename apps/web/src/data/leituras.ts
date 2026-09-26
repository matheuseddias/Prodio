// Leituras do Supabase via from()/views (RLS protege). Uma função por fatia do Snapshot.
import { diaISO } from '../domain/format'
import type { Bom, Channel, Connector, DailyPlanLine, Device, Historico, Label, Location, Material, Member, NfeInbound, Notification, Operator, Product, PurchaseOrder, ScanEvent, StockMove, Supplier, Tenant } from '../domain/types'
import { custoFicha } from '../domain/storeFicha'
import { checar } from './erros'
import * as M from './mapeadores'
import { lerTudo } from './paginar'
import { diaAtual, type Ctx } from './supabaseCtx'

export async function lerTenant(ctx: Ctx): Promise<Tenant> {
  const id = ctx.tenantId()
  const [t, perfis] = await Promise.all([
    ctx.sb.from('tenants').select('id,nome,cnpj,regime,credita_impostos,hora_virada,dias_uteis_mes,margem_projecao,dias_cobertura,margem_alvo_padrao,exigir_projecao_para_imprimir').eq('id', id).single(),
    ctx.sb.from('label_profiles').select('familia,prefixo,tipos,unidades_por_caixa,instrucao_montagem').eq('tenant_id', id).order('familia'),
  ])
  return M.tenantDoBanco(checar(t) as M.TenantRow, (checar(perfis) ?? []) as M.LabelProfileRow[])
}

export async function lerLocations(ctx: Ctx): Promise<Location[]> {
  const res = await ctx.sb.from('locations').select('id,nome,kind').eq('tenant_id', ctx.tenantId()).eq('ativo', true).order('created_at')
  return ((checar(res) ?? []) as M.LocationRow[]).map(M.locationDoBanco)
}

export async function lerOperators(ctx: Ctx): Promise<Operator[]> {
  const res = await ctx.sb.from('operators').select('id,nome,ativo').eq('tenant_id', ctx.tenantId()).eq('ativo', true).order('nome')
  return ((checar(res) ?? []) as M.OperatorRow[]).map(M.operatorDoBanco)
}

export async function lerSuppliers(ctx: Ctx): Promise<Supplier[]> {
  const id = ctx.tenantId()
  const rows = await lerTudo<M.SupplierRow>((de, ate) =>
    ctx.sb.from('suppliers').select('id,nome,cnpj,regime,lead_time_dias,condicao_pagamento,contato').eq('tenant_id', id).is('deleted_at', null).order('nome').order('id').range(de, ate),
  )
  return rows.map(M.supplierDoBanco)
}

export async function lerMaterials(ctx: Ctx): Promise<Material[]> {
  const id = ctx.tenantId()
  const [mats, stock] = await Promise.all([
    lerTudo<M.MaterialRow>((de, ate) =>
      ctx.sb.from('materials').select('id,sku,nome,ncm,unidade_compra,unidade_consumo,fator_conversao,minimo,custo_referencia,fornecedor_padrao_id,lead_time_dias').eq('tenant_id', id).is('deleted_at', null).order('sku').order('id').range(de, ate),
    ),
    lerTudo<M.StockRow>((de, ate) => ctx.sb.from('v_stock').select('material_id,saldo,custo_medio').eq('tenant_id', id).order('material_id').range(de, ate)),
  ])
  const saldos = new Map(stock.map((s) => [s.material_id, s]))
  return mats.map((r) => M.materialDoBanco(r, saldos.get(r.id)))
}

export async function lerBoms(ctx: Ctx): Promise<Bom[]> {
  const id = ctx.tenantId()
  const rows = await lerTudo<M.BomActiveRow>((de, ate) =>
    ctx.sb
      .from('v_bom_active')
      .select('product_id,bom_version_id,versao,ativada_em,line_id,ordem,tipo,material_id,component_product_id,consumo,unidade,perda_pct')
      .eq('tenant_id', id)
      .order('product_id')
      .order('ordem')
      .order('line_id')
      .range(de, ate),
  )
  return M.bomsDoBanco(rows)
}

export async function lerPrecos(ctx: Ctx): Promise<Record<string, Record<string, number>>> {
  const id = ctx.tenantId()
  const rows = await lerTudo<M.PriceRow>((de, ate) => ctx.sb.from('product_prices').select('product_id,channel_id,preco').eq('tenant_id', id).order('product_id').order('channel_id').range(de, ate))
  return M.precosPorProduto(rows)
}

/** Produtos dependem de fichas (temFicha/custoFicha), insumos (custo) e preços por canal. */
export async function lerProducts(ctx: Ctx, deps: { boms: Bom[]; materials: Material[]; precos: Record<string, Record<string, number>> }): Promise<Product[]> {
  const id = ctx.tenantId()
  const rows = await lerTudo<M.ProductRow>((de, ate) =>
    ctx.sb
      .from('products')
      .select('id,sku,nome,familia,atributos,ean,ncm,status,peso_kg,peso_cubado_kg,custo_manual,sku_aliases(sku_externo)')
      .eq('tenant_id', id)
      .is('deleted_at', null)
      .order('sku')
      .order('id')
      .range(de, ate),
  )
  return rows.map((r) => {
    const bom = deps.boms.find((b) => b.productId === r.id)
    return M.productDoBanco(r, { temFicha: !!bom && bom.linhas.length > 0, custoFicha: bom ? custoFicha(r.id, deps.boms, deps.materials) : undefined, precoVenda: deps.precos[r.id] })
  })
}

export async function lerDailyPlan(ctx: Ctx): Promise<DailyPlanLine[]> {
  const res = await ctx.sb.from('v_daily_plan').select('product_id,location_id,dia,demanda_dia,projetado,carteira,saldo_hub,impresso,bipado').eq('tenant_id', ctx.tenantId()).eq('dia', diaAtual(ctx))
  // Uma linha por produto: soma dos locais.
  const porProduto = new Map<string, DailyPlanLine>()
  for (const r of (checar(res) ?? []) as M.DailyPlanRow[]) {
    const l = M.dailyPlanDoBanco(r)
    const atual = porProduto.get(l.productId)
    porProduto.set(l.productId, atual ? { ...atual, demandaDia: atual.demandaDia + l.demandaDia, projetado: atual.projetado + l.projetado, impresso: atual.impresso + l.impresso, bipado: atual.bipado + l.bipado, carteira: atual.carteira + l.carteira, saldoHub: atual.saldoHub + l.saldoHub } : l)
  }
  return [...porProduto.values()]
}

export async function lerLabels(ctx: Ctx): Promise<Label[]> {
  const res = await ctx.sb.from('labels').select('id,serial,product_id,tipo,quantidade,status,dia,seq').eq('tenant_id', ctx.tenantId()).eq('dia', diaAtual(ctx)).order('seq')
  const rows = (checar(res) ?? []) as M.LabelRow[]
  for (const r of rows) ctx.mapas.labelIds.set(r.serial, r.id)
  return rows.map(M.labelDoBanco)
}

export async function lerScans(ctx: Ctx): Promise<ScanEvent[]> {
  const res = await ctx.sb
    .from('scan_events')
    .select('id,label_id,product_id,event_type,quantidade,operator_id,device_id,user_id,competencia,scanned_at,reverses_id,labels(serial),operators(nome),devices(nome),stages(codigo)')
    .eq('tenant_id', ctx.tenantId())
    .eq('competencia', diaAtual(ctx))
    .order('scanned_at', { ascending: false })
    .limit(2000)
  return M.scansDoBanco((checar(res) ?? []) as unknown as M.ScanRow[], ctx.mapas.nomes)
}

export async function lerStockMoves(ctx: Ctx): Promise<StockMove[]> {
  const res = await ctx.sb.from('stock_moves').select('id,material_id,move_type,delta,custo_unit,ref_type,ref_id,motivo,created_by,created_at').eq('tenant_id', ctx.tenantId()).order('created_at', { ascending: false }).limit(500)
  return ((checar(res) ?? []) as M.StockMoveRow[]).map((r) => M.stockMoveDoBanco(r, ctx.mapas.nomes))
}

export async function lerPurchaseOrders(ctx: Ctx): Promise<PurchaseOrder[]> {
  const res = await ctx.sb.from('purchase_orders').select('id,numero,supplier_id,status,entrega_prevista,condicao_pagamento,observacao,created_at,purchase_order_items(id,material_id,unidade_compra,fator,qtd,qtd_recebida,preco,ipi_pct)').eq('tenant_id', ctx.tenantId()).order('numero', { ascending: false }).limit(300)
  return ((checar(res) ?? []) as unknown as M.PoRow[]).map(M.purchaseOrderDoBanco)
}

export async function lerNfes(ctx: Ctx): Promise<NfeInbound[]> {
  const res = await ctx.sb
    .from('nfe_inbound')
    .select('id,chave,numero,serie,cnpj_emitente,emitente,supplier_id,emissao,valor_total,origem,status,nfe_inbound_items(id,n_item,c_prod,x_prod,ncm,cfop,u_com,q_com,v_un_com,v_prod,material_id,fator,qtd_consumo),nfe_po_links(purchase_order_id)')
    .eq('tenant_id', ctx.tenantId())
    .order('created_at', { ascending: false })
    .limit(300)
  const rows = (checar(res) ?? []) as unknown as M.NfeRow[]
  for (const r of rows) {
    ctx.mapas.nfeIds.set(r.chave, r.id)
    for (const it of r.nfe_inbound_items ?? []) if (it.id) ctx.mapas.nfeItemIds.set(`${r.chave}:${it.n_item}`, it.id)
  }
  return rows.map(M.nfeDoBanco)
}

export async function lerOutbox(ctx: Ctx) {
  const res = await ctx.sb.from('integration_outbox').select('id,connector_id,product_id,delta,status,erro,created_at').eq('tenant_id', ctx.tenantId()).order('created_at', { ascending: false }).limit(300)
  return ((checar(res) ?? []) as M.OutboxRow[]).map(M.outboxDoBanco)
}

/**
 * Conectores com o que só o robô grava (`sync_state`) e a contagem de pedidos das últimas 24 h.
 * As duas leituras extras são acessórias: se falharem, o cartão perde o diagnóstico do robô e o
 * número, mas o conector continua na tela (e o cartão diz "—" em vez de inventar).
 */
export async function lerConnectors(ctx: Ctx, outboxPendentes: Record<string, number> = {}): Promise<Connector[]> {
  const [res, syncs] = await Promise.all([
    ctx.sb.from('connectors').select('id,plataforma,nome,status,config,ultimo_sync,ultimo_erro').eq('tenant_id', ctx.tenantId()).order('created_at'),
    lerSyncState(ctx),
  ])
  const rows = (checar(res) ?? []) as M.ConnectorRow[]
  const pedidos = await contarPedidos24h(ctx, rows.filter((r) => r.status !== 'desconectado').map((r) => r.id))
  return rows.map((r) => M.connectorDoBanco(r, { outboxPendentes: outboxPendentes[r.id] ?? 0, sync: syncs ? (syncs.get(r.id) ?? null) : undefined, pedidos24h: pedidos[r.id] }))
}

/** `sync_state` do tenant por conector, ou null quando a leitura falhou (a tela não afirma nada sobre o robô). */
async function lerSyncState(ctx: Ctx): Promise<Map<string, M.SyncStateRow> | null> {
  try {
    const res = await ctx.sb.from('sync_state').select('connector_id,cursor,last_run_at,last_ok_at,runs').eq('tenant_id', ctx.tenantId())
    if (res.error) throw new Error(res.error.message)
    return new Map(((res.data ?? []) as M.SyncStateRow[]).map((r) => [r.connector_id, r]))
  } catch (e) {
    console.warn('[prodio] sync_state indisponível:', (e as Error)?.message)
    return null
  }
}

/**
 * Pedidos com `confirmed_at` nas últimas 24 h, por conector: uma contagem sem trazer linhas
 * (`head`), pela RLS de `orders` (policy orders_select). Conector sem contagem fica de fora e a
 * tela mostra "—".
 */
async function contarPedidos24h(ctx: Ctx, ids: string[], agora = Date.now()): Promise<Record<string, number>> {
  const desde = new Date(agora - 24 * 3600_000).toISOString()
  const pares = await Promise.all(
    ids.map(async (id): Promise<[string, number] | null> => {
      try {
        const res = await ctx.sb.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId()).eq('connector_id', id).gte('confirmed_at', desde)
        if (res.error || typeof res.count !== 'number') return null
        return [id, res.count]
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(pares.filter((p): p is [string, number] => p !== null))
}

export async function lerMembers(ctx: Ctx): Promise<Member[]> {
  const res = await ctx.sb.from('memberships').select('user_id,role,location_id,nome,accepted_at,invited_at').eq('tenant_id', ctx.tenantId()).order('invited_at')
  const rows = (checar(res) ?? []) as M.MembershipRow[]
  for (const r of rows) if (r.nome) ctx.mapas.nomes[r.user_id] = r.nome
  return rows.filter((r) => r.role !== 'dispositivo').map(M.memberDoBanco)
}

export async function lerDevices(ctx: Ctx): Promise<Device[]> {
  const res = await ctx.sb.from('devices').select('id,nome,location_id,registered_at,created_at,last_scan_at').eq('tenant_id', ctx.tenantId()).is('revoked_at', null).order('created_at')
  return ((checar(res) ?? []) as M.DeviceRow[]).map(M.deviceDoBanco)
}

export async function lerNotifications(ctx: Ctx): Promise<Notification[]> {
  const res = await ctx.sb.from('notifications').select('id,tipo,texto,lida,created_at').eq('tenant_id', ctx.tenantId()).order('created_at', { ascending: false }).limit(100)
  return ((checar(res) ?? []) as M.NotificationRow[]).map(M.notificationDoBanco)
}

export async function lerChannels(ctx: Ctx): Promise<Channel[]> {
  const res = await ctx.sb.from('channels').select('id,nome,preset,ativo,comissao_pct,taxa_fixa,taxa_fixa_abaixo_de,frete_vendedor,frete_gratis_acima_de,imposto_venda_pct,ads_pct,parcelamento_pct,outros_pct,observacao').eq('tenant_id', ctx.tenantId()).is('deleted_at', null).order('nome')
  return ((checar(res) ?? []) as M.ChannelRow[]).map(M.channelDoBanco)
}

// --- Histórico dos gráficos ----------------------------------------------------------------------
// Não há view agregada por dia: o PostgREST não agrupa, então a soma por dia é feita aqui, no
// mapeador. O limite de linhas é tratado encurtando o período (série menor e verdadeira) em vez de
// mostrar um total pela metade como se fosse o do dia inteiro.

/** Janela do histórico de produção: o maior período oferecido na aba Produtividade. */
export const DIAS_PRODUCAO = 90
/** Janela do histórico de vendas: o período do cartão do Painel. */
export const DIAS_VENDAS = 14
/** Teto de linhas por leitura. Acima dele a série sai marcada como truncada. */
const LIMITE_LINHAS = 5000

export async function lerHistorico(ctx: Ctx): Promise<Historico> {
  const [producao, vendas] = await Promise.all([
    semQuebrar(lerHistoricoProducao(ctx), 'histórico de produção'),
    semQuebrar(lerHistoricoVendas(ctx), 'histórico de vendas'),
  ])
  return { producao: producao.dias, vendas: vendas.dias, exemplo: false, truncada: { producao: producao.truncada, vendas: vendas.truncada } }
}

/** Gráfico que não carrega não pode derrubar o Painel inteiro: vira série vazia e fica o aviso no console. */
async function semQuebrar<T>(p: Promise<{ dias: T[]; truncada: boolean }>, oque: string): Promise<{ dias: T[]; truncada: boolean }> {
  try {
    return await p
  } catch (e) {
    console.warn(`[prodio] ${oque} indisponível:`, (e as Error)?.message ?? e)
    return { dias: [], truncada: false }
  }
}

/** Projetado e bipado por dia, de v_daily_plan. O eixo é o dia de produção (respeita a hora de virada). */
async function lerHistoricoProducao(ctx: Ctx) {
  const ate = diaAtual(ctx)
  const desde = M.somaDias(ate, -(DIAS_PRODUCAO - 1))
  const res = await ctx.sb
    .from('v_daily_plan')
    .select('dia,product_id,projetado,bipado', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId())
    .gte('dia', desde)
    .lte('dia', ate)
    .order('dia', { ascending: false })
    .limit(LIMITE_LINHAS)
  const rows = (checar(res) ?? []) as M.HistoricoProducaoRow[]
  const truncada = typeof res.count === 'number' && res.count > rows.length
  const inicio = truncada ? M.primeiroDiaCompleto(rows.map(M.diaDaLinha), ate) : desde
  return { dias: M.serieProducaoDoBanco(rows, M.intervaloDias(inicio, ate)), truncada }
}

/** Unidades vendidas por dia, de orders + order_items. Só pedido que virou demanda ou carteira. */
async function lerHistoricoVendas(ctx: Ctx) {
  const ate = diaISO() // venda é do dia de calendário do pedido; hora de virada é de produção
  const desde = M.somaDias(ate, -(DIAS_VENDAS - 1))
  const res = await ctx.sb
    .from('orders')
    .select('confirmed_at,order_items(quantidade)', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId())
    .in('significado', ['demanda', 'carteira'])
    .gte('confirmed_at', new Date(`${desde}T00:00:00`).toISOString())
    .lt('confirmed_at', new Date(`${M.somaDias(ate, 1)}T00:00:00`).toISOString())
    .order('confirmed_at', { ascending: false })
    .limit(LIMITE_LINHAS)
  const rows = (checar(res) ?? []) as unknown as M.HistoricoVendasRow[]
  const truncada = typeof res.count === 'number' && res.count > rows.length
  const inicio = truncada ? M.primeiroDiaCompleto(rows.map(M.diaDaVenda), ate) : desde
  return { dias: M.serieVendasDoBanco(rows, M.intervaloDias(inicio, ate)), truncada }
}

/** Tabelas que podem ainda não existir (migrations de outra frente): devolve vazio em vez de derrubar a tela. */
export async function tolerante<T>(p: Promise<T>, vazio: T): Promise<T> {
  try {
    return await p
  } catch (e) {
    const msg = (e as Error)?.message ?? ''
    if (/migration pendente|does not exist|schema cache/i.test(msg)) {
      console.warn('[prodio] fatia indisponível:', msg)
      return vazio
    }
    throw e
  }
}
