import { ClienteHttp } from '../http'
import { silenciarLog } from '../log'
import { ConectorBaseLinker, LIMITE_PEDIDOS, SOBREPOSICAO_S, URL_BASELINKER } from './baselinker'

silenciarLog(true)

interface Chamada {
  method: string
  parameters: Record<string, unknown>
  headers: Record<string, string>
}

// fetch falso: registra method/parameters de cada chamada e responde pela função dada.
function fetchFalso(responder: (c: Chamada, n: number) => Response | Promise<Response>) {
  const chamadas: Chamada[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    expect(url).toBe(URL_BASELINKER)
    const corpo = new URLSearchParams(String(init?.body))
    const c: Chamada = {
      method: corpo.get('method') ?? '',
      parameters: JSON.parse(corpo.get('parameters') ?? '{}'),
      headers: (init?.headers ?? {}) as Record<string, string>,
    }
    chamadas.push(c)
    return responder(c, chamadas.length)
  }
  return { chamadas, fetchFn }
}

const ok = (dados: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ status: 'SUCCESS', ...dados }), { status, headers: { 'Content-Type': 'application/json' } })

const BASE = 1_700_000_000
const AGORA = (BASE + 86_400) * 1000

function montar(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, config = {}, sleep = async () => {}) {
  const cliente = new ClienteHttp({ nome: 'teste', intervaloMinMs: 0, fetchFn, sleep, agora: () => AGORA })
  return new ConectorBaseLinker({ connectorId: 'c1', credenciais: { token: 'tok' }, config, cliente, agora: () => AGORA })
}

describe('BaseLinker · pullOrders', () => {
  it('pagina por date_confirmed avançando o último +1 e devolve cursor com sobreposição de 2 h', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      const desde = Number(c.parameters.date_confirmed_from)
      const qtd = desde >= BASE + 200 ? 5 : LIMITE_PEDIDOS
      const orders = Array.from({ length: qtd }, (_, i) => ({
        order_id: desde + i,
        order_status_id: 7,
        date_confirmed: desde + i,
        products: [{ sku: i === 0 ? '' : 'CAM-01', product_id: 501, quantity: 2, price_brutto: '10.5' }],
        delivery_price: 1,
      }))
      return ok({ orders })
    })
    const c = montar(fetchFn)
    const r = await c.pullOrders({ date_confirmed_from: BASE })
    expect(chamadas.map((x) => x.method)).toEqual(['getOrders', 'getOrders', 'getOrders'])
    expect(chamadas.map((x) => x.parameters.date_confirmed_from)).toEqual([BASE, BASE + 100, BASE + 200])
    expect(chamadas[0].parameters.get_unconfirmed_orders).toBe(false)
    expect(chamadas[0].headers['X-BLToken']).toBe('tok')
    expect(r.pedidos).toHaveLength(205)
    expect(r.cursor).toEqual({ date_confirmed_from: BASE + 204 - SOBREPOSICAO_S })
    // sku vazio é preservado como string vazia; o banco resolve por product_id/alias
    expect(r.pedidos[0].itens[0]).toMatchObject({ skuExterno: '', produtoExternoId: '501', quantidade: 2, preco: 10.5 })
    expect(r.pedidos[0].total).toBe(22)
    expect(r.pedidos[0].confirmedAt).toBe(new Date(BASE * 1000).toISOString())
  })

  it('sem cursor começa N dias atrás', async () => {
    const { chamadas, fetchFn } = fetchFalso(() => ok({ orders: [] }))
    await montar(fetchFn, { dias_iniciais: 2 }).pullOrders(null)
    expect(chamadas[0].parameters.date_confirmed_from).toBe(BASE + 86_400 - 2 * 86_400)
  })

  it('status ERROR vira exceção com a mensagem da plataforma', async () => {
    const { fetchFn } = fetchFalso(() => ok({ status: 'ERROR', error_code: 'ERROR_AUTH_TOKEN', error_message: 'token inválido' }))
    await expect(montar(fetchFn).pullOrders(null)).rejects.toThrow(/token inválido/)
  })
})

describe('BaseLinker · estoque absoluto', () => {
  const catalogo = { products: { '501': { id: 501, sku: 'CAM-01', name: 'Camiseta' }, '502': { id: 502, sku: '', name: 'sem sku' } } }
  const estoque = { products: { '501': { product_id: 501, stock: { bl_1: 10, bl_2: 4 } } } }

  it('lê o saldo, soma o delta e grava o valor absoluto por produto', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.method === 'getInventoryProductsList') return ok(catalogo)
      if (c.method === 'getInventoryProductsStock') return ok(estoque)
      if (c.method === 'updateInventoryProductsStock') return ok({ counter: 1, warnings: {} })
      throw new Error('inesperado ' + c.method)
    })
    const c = montar(fetchFn, { inventory_id: 1, warehouse_id: 'bl_1' })
    const r = await c.pushFinishedStock([{ sku: 'CAM-01', delta: 3 }, { sku: 'CAM-01', delta: -5 }], { dryRun: false })
    const updates = chamadas.filter((x) => x.method === 'updateInventoryProductsStock')
    expect(updates).toHaveLength(2)
    expect(updates[0].parameters).toEqual({ inventory_id: 1, products: { '501': { bl_1: 13 } } })
    expect(updates[1].parameters).toEqual({ inventory_id: 1, products: { '501': { bl_1: 8 } } })
    expect(r).toEqual([
      { sku: 'CAM-01', ok: true, saldoAntes: 10, saldoDepois: 13 },
      { sku: 'CAM-01', ok: true, saldoAntes: 13, saldoDepois: 8 },
    ])
    // ordem: catálogo e estoque lidos ANTES de qualquer escrita
    expect(chamadas.map((x) => x.method).slice(0, 2)).toEqual(['getInventoryProductsList', 'getInventoryProductsStock'])
  })

  it('dry run não escreve', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.method === 'getInventoryProductsList' ? ok(catalogo) : ok(estoque)))
    const r = await montar(fetchFn, { inventory_id: 1, warehouse_id: 'bl_1' }).pushFinishedStock([{ sku: 'CAM-01', delta: 2 }], { dryRun: true })
    expect(chamadas.some((x) => x.method === 'updateInventoryProductsStock')).toBe(false)
    expect(r[0]).toMatchObject({ ok: true, dryRun: true, saldoAntes: 10, saldoDepois: 12 })
  })

  it('para na primeira falha (SKU desconhecido) e não toca nos seguintes', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.method === 'getInventoryProductsList' ? ok(catalogo) : ok(estoque)))
    const r = await montar(fetchFn, { inventory_id: 1, warehouse_id: 'bl_1' }).pushFinishedStock(
      [{ sku: 'NAO-EXISTE', delta: 1 }, { sku: 'CAM-01', delta: 1 }],
      { dryRun: false },
    )
    expect(r).toHaveLength(1)
    expect(r[0].ok).toBe(false)
    expect(chamadas.some((x) => x.method === 'updateInventoryProductsStock')).toBe(false)
  })

  it('pullFinishedStock devolve o saldo do depósito configurado ou o total', async () => {
    const { fetchFn } = fetchFalso((c) => (c.method === 'getInventoryProductsList' ? ok(catalogo) : ok(estoque)))
    expect(await montar(fetchFn, { inventory_id: 1, warehouse_id: 'bl_2' }).pullFinishedStock(['CAM-01'])).toEqual([{ sku: 'CAM-01', externalId: '501', saldo: 4 }])
    expect(await montar(fetchFn, { inventory_id: 1 }).pullFinishedStock()).toEqual([{ sku: 'CAM-01', externalId: '501', saldo: 14 }])
  })
})

describe('BaseLinker · 429 e backoff', () => {
  it('espera e repete após 429, respeitando Retry-After', async () => {
    const sleep = vi.fn(async () => {})
    const { chamadas, fetchFn } = fetchFalso((_c, n) =>
      n === 1 ? new Response('{"error":"rate"}', { status: 429, headers: { 'Retry-After': '2' } }) : ok({ orders: [] }),
    )
    const r = await montar(fetchFn, {}, sleep).pullOrders({ date_confirmed_from: BASE })
    expect(r.pedidos).toEqual([])
    expect(chamadas).toHaveLength(2)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('desiste depois das tentativas e propaga o erro HTTP', async () => {
    const sleep = vi.fn(async () => {})
    const { chamadas, fetchFn } = fetchFalso(() => new Response('down', { status: 503 }))
    await expect(montar(fetchFn, {}, sleep).pullOrders(null)).rejects.toThrow(/HTTP 503/)
    expect(chamadas).toHaveLength(4) // 1 + 3 repetições
    expect(sleep).toHaveBeenCalledTimes(3)
  })
})
