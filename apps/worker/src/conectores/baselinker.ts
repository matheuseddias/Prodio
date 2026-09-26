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
  type PaginaPedidos,
  type PedidoNormalizado,
  type ResultadoPush,
  type SaldoHub,
} from './tipos'

export const URL_BASELINKER = 'https://api.baselinker.com/connector.php'
export const LIMITE_PEDIDOS = 100
export const SOBREPOSICAO_S = 2 * 3600
// Teto de pullOrders (a leitura "de uma vez", fora do cron). O cron não usa: ele lê página por
// página com o teto de jobs/syncPedidos.ts (paginas_por_rodada).
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
  // Desde quando o pedido está no status atual (unix, segundos). O getOrders não tem
  // `date_status_change`: esse nome nunca veio, e o updatedAt caía sempre no date_confirmed.
  date_in_status?: number
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
    updatedAt: unixParaIso(p.date_in_status ?? p.date_confirmed ?? p.date_add),
    total: Math.round(total * 100) / 100,
    itens,
    // Sem `raw`: o pedido inteiro do BaseLinker (endereço, pagamento, dezenas de campos) não é lido
    // por ninguém no Prodio e custava uma serialização a mais por pedido em cada rodada do cron.
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

  // Uma página de getOrders: até 100 pedidos confirmados com date_confirmed >= date_confirmed_from,
  // em ordem crescente de date_confirmed (a documentação do BaseLinker manda paginar pelo
  // date_confirmed do último pedido lido).
  //
  // O CURSOR DEVOLVIDO É GRAVADO PELO CRON DEPOIS DE CADA PÁGINA, então ele nunca pode passar à
  // frente de um pedido não lido. As três regras, e por que cada uma existe:
  //  • Página cheia (há mais): continua do MAIOR date_confirmed desta página, inclusive. A
  //    documentação sugere "+1 segundo", mas aí os pedidos que dividem esse último segundo e ficaram
  //    para a página seguinte seriam pulados. Relê-se o segundo da borda; o upsert é idempotente.
  //    Caso extremo: a página inteira caiu num segundo só (100 ou mais pedidos confirmados no mesmo
  //    segundo — uma importação em massa de um canal novo faz isso). Reler dali não anda, e o "+1"
  //    da versão anterior pulava o resto daquele segundo em silêncio. Agora o cursor ganha `id_from`
  //    e as páginas seguintes percorrem o segundo por número de pedido (lerDentroDoSegundo).
  //  • Página incompleta (em dia): volta SOBREPOSICAO_S antes do maior lido. A documentação garante
  //    que um pedido não "salta" para dentro da base com data de confirmação anterior à dos já
  //    confirmados; a sobreposição cobre o que ela não cobre (relógio, pedido gravado no mesmo
  //    segundo logo depois da leitura, e as mudanças de status das últimas 2 h). Página vazia não
  //    mexe no ponto (a versão anterior recuava mais 2 h a cada rodada vazia).
  //  • Sem piso: `dias_iniciais` só vale quando NÃO há cursor. Um cursor antigo (robô parado dias) é
  //    drenado inteiro, em várias rodadas. A versão anterior, ao bater no teto de páginas com o
  //    cursor ainda velho, saltava para "3 dias atrás" e perdia o meio.
  async pullOrdersPagina(cursor: Cursor | null): Promise<PaginaPedidos> {
    const agoraS = Math.floor(this.agora() / 1000)
    const inicio = agoraS - (this.config.dias_iniciais ?? 3) * 86400
    const gravado = Math.floor(Number(cursor?.date_confirmed_from))
    // Cursor no futuro (relógio torto) não lê nada até o futuro chegar; reler desde agora é seguro.
    const desde = Number.isFinite(gravado) && gravado > 0 ? Math.min(gravado, agoraS) : inicio
    // `id_from` só vale para o segundo exato em que foi anotado (não para um cursor corrigido acima).
    const idFrom = Math.floor(Number(cursor?.id_from))
    if (desde === gravado && Number.isFinite(idFrom) && idFrom > 0) return this.lerDentroDoSegundo(desde, idFrom)
    const r = await this.chamar<RespostaBL & { orders?: PedidoBL[] }>('getOrders', {
      date_confirmed_from: desde,
      get_unconfirmed_orders: false,
    })
    const lote = r.orders ?? []
    let maior = 0
    for (const p of lote) {
      const confirmado = Number(p.date_confirmed)
      if (Number.isFinite(confirmado) && confirmado > maior) maior = confirmado
    }
    const pedidos = lote.map(normalizarPedidoBaseLinker)
    if (lote.length >= LIMITE_PEDIDOS) {
      if (maior > desde) return this.pagina(desde, pedidos, { date_confirmed_from: maior }, false)
      return this.pagina(desde, pedidos, this.depoisDoSegundo(desde, lote, 0), false)
    }
    return this.pagina(desde, pedidos, { date_confirmed_from: maior > 0 ? maior - SOBREPOSICAO_S : desde }, true)
  }

  // O segundo `segundo` tem 100 ou mais pedidos confirmados: continua nele pelo número do pedido
  // (`id_from` junto com `date_confirmed_from`). A página traz primeiro o que falta daquele segundo,
  // em ordem de order_id, e depois os segundos seguintes.
  private async lerDentroDoSegundo(segundo: number, idFrom: number): Promise<PaginaPedidos> {
    const r = await this.chamar<RespostaBL & { orders?: PedidoBL[] }>('getOrders', {
      date_confirmed_from: segundo,
      id_from: idFrom,
      get_unconfirmed_orders: false,
    })
    const lote = r.orders ?? []
    const pedidos = lote.map(normalizarPedidoBaseLinker)
    // Garantia contra a API não fazer o que a documentação diz: um pedido abaixo do id pedido (ou
    // antes do segundo) quer dizer que o filtro foi ignorado, e insistir repetiria a mesma página
    // para sempre. Aí não há como percorrer o segundo: anda +1 e grita no log (error, não warn).
    const fora = lote.some((p) => !(Number(p.order_id) >= idFrom) || !(Number(p.date_confirmed) >= segundo))
    if (fora) {
      log('error', 'baselinker.segundoLotado', { segundo, idFrom, pedidos: lote.length, motivo: 'a API ignorou id_from; o resto deste segundo pode ter ficado para trás' })
      return this.pagina(segundo, pedidos, { date_confirmed_from: segundo + 1 }, false)
    }
    const todosNoSegundo = lote.every((p) => Number(p.date_confirmed) === segundo)
    if (lote.length >= LIMITE_PEDIDOS && todosNoSegundo) return this.pagina(segundo, pedidos, this.depoisDoSegundo(segundo, lote, idFrom), false)
    // O segundo acabou: a resposta passou dele, ou veio incompleta. Não é "fim": pedidos de segundos
    // seguintes com número menor que idFrom ficaram de fora desta consulta e vêm na próxima.
    return this.pagina(segundo, pedidos, { date_confirmed_from: segundo + 1 }, false)
  }

  // Próximo ponto dentro de um segundo lotado: o maior order_id lido + 1. Sem número utilizável (a
  // API mudou), não há como continuar no segundo sem ficar preso: anda +1 e grita no log.
  private depoisDoSegundo(segundo: number, lote: PedidoBL[], idFrom: number): Cursor {
    const maiorId = lote.reduce((m, p) => Math.max(m, Number(p.order_id)), 0)
    if (Number.isFinite(maiorId) && maiorId >= idFrom) {
      log('warn', 'baselinker.segundoCheio', { segundo, pedidos: lote.length, idFrom: maiorId + 1 })
      return { date_confirmed_from: segundo, id_from: maiorId + 1 }
    }
    log('error', 'baselinker.segundoLotado', { segundo, pedidos: lote.length, motivo: 'pedidos sem order_id numérico; o resto deste segundo pode ter ficado para trás' })
    return { date_confirmed_from: segundo + 1 }
  }

  private pagina(desde: number, pedidos: PedidoNormalizado[], cursor: Cursor, fim: boolean): PaginaPedidos {
    log('info', 'baselinker.pagina', { desde, pedidos: pedidos.length, proximo: cursor, fim })
    return { pedidos, cursor, fim }
  }

  // Leitura "de uma vez" (até MAX_PAGINAS), pelas mesmas páginas e com o mesmo cursor seguro.
  async pullOrders(cursor: Cursor | null): Promise<{ pedidos: PedidoNormalizado[]; cursor: Cursor }> {
    const pedidos: PedidoNormalizado[] = []
    let atual: Cursor | null = cursor
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const p = await this.pullOrdersPagina(atual)
      pedidos.push(...p.pedidos)
      atual = p.cursor
      if (p.fim) break
    }
    return { pedidos, cursor: atual ?? {} }
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

  // Teste de conexão: getInventories é a chamada mais barata que exige token válido (uma página,
  // sem catálogo, sem escrita) e ainda devolve algo que o dono reconhece na tela.
  async testarConexao(): Promise<string> {
    const r = await this.chamar<RespostaBL & { inventories?: { inventory_id: number; name?: string; is_default?: boolean }[] }>('getInventories')
    const lista = r.inventories ?? []
    if (lista.length === 0) return 'o BaseLinker aceitou o token, mas esta conta ainda não tem nenhum inventário (catálogo) criado'
    const pedido = this.config.inventory_id
    if (pedido !== undefined && pedido !== '') {
      const alvo = lista.find((i) => String(i.inventory_id) === String(pedido))
      if (!alvo) return `o BaseLinker aceitou o token, mas não existe o inventário ${pedido} nesta conta; use um destes: ${lista.map((i) => i.inventory_id).join(', ')}`
      return `conectado ao BaseLinker: inventário "${alvo.name ?? alvo.inventory_id}" (id ${alvo.inventory_id})`
    }
    const padrao = lista.find((i) => i.is_default) ?? lista[0]
    return `conectado ao BaseLinker: ${lista.length} inventário(s), usando "${padrao.name ?? padrao.inventory_id}" (id ${padrao.inventory_id})`
  }

  async findInboundNfe(): Promise<typeof UNSUPPORTED> {
    return UNSUPPORTED
  }

  async verifyWebhook(): Promise<typeof UNSUPPORTED> {
    return UNSUPPORTED
  }
}
