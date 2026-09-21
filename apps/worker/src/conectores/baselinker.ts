// Adaptador BaseLinker. API: POST connector.php, header X-BLToken, corpo x-www-form-urlencoded
// method=<nome>&parameters=<json>. Limite 100 req/min. Resposta {status:'SUCCESS'|'ERROR', error_code, error_message}.
import { ClienteHttp, obterCliente } from '../http'
import { log } from '../log'
import {
  ErroConector,
  UNSUPPORTED,
  numero,
  unixParaIso,
  type Capacidades,
  type Conector,
  type Cursor,
  type DeltaEstoque,
  type ItemCatalogo,
  type PedidoNormalizado,
  type ResultadoPush,
  type SaldoHub,
} from './tipos'

export const URL_BASELINKER = 'https://api.baselinker.com/connector.php'
export const LIMITE_PEDIDOS = 100
export const SOBREPOSICAO_S = 2 * 3600
const MAX_PAGINAS = 20
const INTERVALO_MS = 650 // < 100 req/min com folga

export interface CredenciaisBaseLinker {
  token: string
}
export interface ConfigBaseLinker {
  inventory_id?: string | number
  warehouse_id?: string // ex.: "bl_1234"
  dias_iniciais?: number // primeira sincronização olha N dias para trás (padrão 3)
}

interface RespostaBL {
  status: 'SUCCESS' | 'ERROR'
  error_code?: string
  error_message?: string
  [k: string]: unknown
}
interface PedidoBL {
  order_id: number | string
  order_status_id: number | string
  date_confirmed?: number
  date_add?: number
  date_status_change?: number
  delivery_price?: number | string
  products?: { sku?: string; product_id?: string | number; name?: string; quantity?: number | string; price_brutto?: number | string }[]
}
interface ProdutoBL {
  id?: string | number
  sku?: string
  ean?: string
  name?: string
}
interface EstoqueBL {
  product_id?: string | number
  stock?: Record<string, number | string>
}

export const CAPACIDADES_BASELINKER: Capacidades = {
  pedidos: true,
  webhooks: false,
  catalogo: true,
  pushEstoque: true,
  pushCatalogo: false,
  nfeCompra: false,
}

export function normalizarPedidoBaseLinker(p: PedidoBL): PedidoNormalizado {
  const itens = (p.products ?? []).map((it) => ({
    skuExterno: String(it.sku ?? '').trim(),
    quantidade: numero(it.quantity),
    preco: numero(it.price_brutto),
    nome: it.name,
    produtoExternoId: it.product_id === undefined ? undefined : String(it.product_id),
  }))
  const total = itens.reduce((s, it) => s + it.preco * it.quantidade, 0) + numero(p.delivery_price)
  return {
    externalId: String(p.order_id),
    status: String(p.order_status_id),
    confirmedAt: unixParaIso(p.date_confirmed),
    updatedAt: unixParaIso(p.date_status_change ?? p.date_confirmed ?? p.date_add),
    total: Math.round(total * 100) / 100,
    itens,
    raw: p,
  }
}

export class ConectorBaseLinker implements Conector {
  plataforma = 'baselinker' as const
  capacidades = CAPACIDADES_BASELINKER
  private token: string
  private config: ConfigBaseLinker
  private cliente: ClienteHttp
  private agora: () => number
  private catalogo?: Map<string, ItemCatalogo>

  constructor(opts: {
    connectorId: string
    credenciais: CredenciaisBaseLinker
    config?: ConfigBaseLinker
    cliente?: ClienteHttp
    agora?: () => number
  }) {
    if (!opts.credenciais?.token) throw new ErroConector('baselinker', 'token do BaseLinker ausente')
    this.token = opts.credenciais.token
    this.config = opts.config ?? {}
    this.cliente = opts.cliente ?? obterCliente({ nome: `baselinker:${opts.connectorId}`, intervaloMinMs: INTERVALO_MS })
    this.agora = opts.agora ?? Date.now
  }

  async chamar<T extends RespostaBL>(method: string, parameters: Record<string, unknown> = {}): Promise<T> {
    const corpo = new URLSearchParams({ method, parameters: JSON.stringify(parameters) }).toString()
    const res = await this.cliente.requisitar(URL_BASELINKER, {
      method: 'POST',
      headers: { 'X-BLToken': this.token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
    })
    const texto = await res.text()
    if (!res.ok) throw new ErroConector('baselinker', `BaseLinker HTTP ${res.status} em ${method}`, { status: res.status })
    let dados: T
    try {
      dados = JSON.parse(texto) as T
    } catch {
      throw new ErroConector('baselinker', `resposta inválida de ${method}`)
    }
    if (dados.status !== 'SUCCESS') {
      throw new ErroConector('baselinker', `${method}: ${dados.error_message ?? 'erro'}`, { codigo: dados.error_code })
    }
    return dados
  }

  // Pagina por date_confirmed: avança para o último +1 dentro da rodada; o cursor persistido
  // volta 2 h para não perder pedidos com o mesmo segundo na borda da página (upsert é idempotente).
  async pullOrders(cursor: Cursor | null): Promise<{ pedidos: PedidoNormalizado[]; cursor: Cursor }> {
    const dias = this.config.dias_iniciais ?? 3
    const inicio = Math.floor(this.agora() / 1000) - dias * 86400
    let desde = Number(cursor?.date_confirmed_from ?? inicio)
    if (!Number.isFinite(desde) || desde <= 0) desde = inicio
    const pedidos: PedidoNormalizado[] = []
    let maior = desde
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const r = await this.chamar<RespostaBL & { orders?: PedidoBL[] }>('getOrders', {
        date_confirmed_from: desde,
        get_unconfirmed_orders: false,
      })
      const lote = r.orders ?? []
      for (const p of lote) {
        pedidos.push(normalizarPedidoBaseLinker(p))
        maior = Math.max(maior, Number(p.date_confirmed ?? 0))
      }
      if (lote.length < LIMITE_PEDIDOS) break
      desde = maior + 1
    }
    const proximo = Math.max(inicio, maior - SOBREPOSICAO_S)
    log('info', 'baselinker.pullOrders', { pedidos: pedidos.length, cursor: proximo })
    return { pedidos, cursor: { date_confirmed_from: proximo } }
  }

  async pullOrder(externalId: string): Promise<PedidoNormalizado | null> {
    const r = await this.chamar<RespostaBL & { orders?: PedidoBL[] }>('getOrders', { order_id: Number(externalId) })
    const p = (r.orders ?? [])[0]
    return p ? normalizarPedidoBaseLinker(p) : null
  }

  async pullStatusList(): Promise<{ id: string; nome: string }[]> {
    const r = await this.chamar<RespostaBL & { statuses?: { id: number | string; name: string }[] }>('getOrderStatusList')
    return (r.statuses ?? []).map((s) => ({ id: String(s.id), nome: s.name }))
  }

  private async inventoryId(): Promise<number> {
    if (this.config.inventory_id !== undefined && this.config.inventory_id !== '') return Number(this.config.inventory_id)
    const r = await this.chamar<RespostaBL & { inventories?: { inventory_id: number; is_default?: boolean }[] }>('getInventories')
    const lista = r.inventories ?? []
    const padrao = lista.find((i) => i.is_default) ?? lista[0]
    if (!padrao) throw new ErroConector('baselinker', 'nenhum inventário (catálogo) no BaseLinker')
    this.config.inventory_id = padrao.inventory_id
    return padrao.inventory_id
  }

  // Catálogo por SKU (cache por instância). Produto sem SKU é ignorado: não há como casar com o Prodio.
  private async mapaCatalogo(): Promise<Map<string, ItemCatalogo>> {
    if (this.catalogo) return this.catalogo
    const inventory_id = await this.inventoryId()
    const mapa = new Map<string, ItemCatalogo>()
    for (let page = 1; page <= 100; page++) {
      const r = await this.chamar<RespostaBL & { products?: Record<string, ProdutoBL> }>('getInventoryProductsList', { inventory_id, page })
      const entradas = Object.entries(r.products ?? {})
      for (const [id, p] of entradas) {
        const sku = String(p.sku ?? '').trim()
        if (!sku) continue
        mapa.set(sku, { externalId: String(p.id ?? id), skuExterno: sku, nome: String(p.name ?? ''), ean: p.ean || undefined })
      }
      if (entradas.length < 1000) break
    }
    this.catalogo = mapa
    return mapa
  }

  async pullCatalog(): Promise<ItemCatalogo[]> {
    return [...(await this.mapaCatalogo()).values()]
  }

  private saldoDe(e: EstoqueBL | undefined): number {
    const stock = e?.stock ?? {}
    if (this.config.warehouse_id) return numero(stock[this.config.warehouse_id])
    return Object.values(stock).reduce<number>((s, v) => s + numero(v), 0)
  }

  // Lê o estoque de todos os produtos do inventário (paginado), indexado por product_id.
  private async estoquePorProduto(): Promise<Map<string, EstoqueBL>> {
    const inventory_id = await this.inventoryId()
    const mapa = new Map<string, EstoqueBL>()
    for (let page = 1; page <= 100; page++) {
      const r = await this.chamar<RespostaBL & { products?: Record<string, EstoqueBL> }>('getInventoryProductsStock', { inventory_id, page })
      const entradas = Object.entries(r.products ?? {})
      for (const [id, e] of entradas) mapa.set(String(e.product_id ?? id), e)
      if (entradas.length < 1000) break
    }
    return mapa
  }

  async pullFinishedStock(skus?: string[]): Promise<SaldoHub[]> {
    const catalogo = await this.mapaCatalogo()
    const estoque = await this.estoquePorProduto()
    const alvo = skus ? skus.filter((s) => catalogo.has(s)) : [...catalogo.keys()]
    return alvo.map((sku) => {
      const item = catalogo.get(sku)!
      return { sku, externalId: item.externalId, saldo: this.saldoDe(estoque.get(item.externalId)) }
    })
  }

  // updateInventoryProductsStock é ABSOLUTO: lê o saldo atual, soma o delta e grava. Um produto por chamada,
  // em série (a fila do cliente garante), para que uma falha não deixe o lote pela metade.
  async pushFinishedStock(deltas: DeltaEstoque[], opts: { dryRun: boolean }): Promise<ResultadoPush[]> {
    const resultados: ResultadoPush[] = []
    if (deltas.length === 0) return resultados
    const warehouse = this.config.warehouse_id
    if (!warehouse) throw new ErroConector('baselinker', 'warehouse_id não configurado no conector')
    const inventory_id = await this.inventoryId()
    const catalogo = await this.mapaCatalogo()
    const estoque = await this.estoquePorProduto()
    for (const d of deltas) {
      const item = catalogo.get(d.sku)
      if (!item) {
        resultados.push({ sku: d.sku, ok: false, erro: 'SKU não encontrado no catálogo do BaseLinker' })
        break
      }
      const antes = this.saldoDe(estoque.get(item.externalId))
      const depois = Math.max(0, antes + d.delta)
      if (antes + d.delta < 0) log('warn', 'baselinker.saldoNegativo', { sku: d.sku, antes, delta: d.delta })
      if (opts.dryRun) {
        log('info', 'baselinker.push.dryRun', { sku: d.sku, antes, depois })
        resultados.push({ sku: d.sku, ok: true, dryRun: true, saldoAntes: antes, saldoDepois: depois })
        continue
      }
      try {
        const r = await this.chamar<RespostaBL & { warnings?: Record<string, string> }>('updateInventoryProductsStock', {
          inventory_id,
          products: { [item.externalId]: { [warehouse]: depois } },
        })
        const aviso = r.warnings?.[item.externalId]
        if (aviso) {
          resultados.push({ sku: d.sku, ok: false, erro: aviso, saldoAntes: antes })
          break
        }
        // Atualiza a leitura local para o caso de o mesmo produto aparecer de novo no lote.
        estoque.set(item.externalId, { product_id: item.externalId, stock: { ...(estoque.get(item.externalId)?.stock ?? {}), [warehouse]: depois } })
        resultados.push({ sku: d.sku, ok: true, saldoAntes: antes, saldoDepois: depois })
      } catch (e) {
        resultados.push({ sku: d.sku, ok: false, erro: e instanceof Error ? e.message : String(e), saldoAntes: antes })
        break
      }
    }
    return resultados
  }

  async findInboundNfe(): Promise<typeof UNSUPPORTED> {
    return UNSUPPORTED
  }

  async verifyWebhook(): Promise<typeof UNSUPPORTED> {
    return UNSUPPORTED
  }
}
