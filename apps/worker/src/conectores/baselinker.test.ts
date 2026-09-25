import { ClienteHttp } from '../http'
import { silenciarLog } from '../log'
import { ConectorBaseLinker, LIMITE_PEDIDOS, SOBREPOSICAO_S, URL_BASELINKER, normalizarPedidoBaseLinker } from './baselinker'
import { baseLinkerFalso } from './baselinkerFalso'

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
  it('lê página por página e devolve o cursor de retomada com sobreposição de 2 h no fim', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      const desde = Number(c.parameters.date_confirmed_from)
      const qtd = desde >= BASE + 150 ? 5 : LIMITE_PEDIDOS
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
    // Página cheia continua do MAIOR segundo lido, inclusive (sem o +1): BASE+99, depois BASE+198.
    expect(chamadas.map((x) => x.parameters.date_confirmed_from)).toEqual([BASE, BASE + 99, BASE + 198])
    expect(chamadas[0].parameters.get_unconfirmed_orders).toBe(false)
    expect(chamadas[0].headers['X-BLToken']).toBe('tok')
    expect(r.pedidos).toHaveLength(205)
    expect(r.cursor).toEqual({ date_confirmed_from: BASE + 202 - SOBREPOSICAO_S })
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

  // O pedido inteiro do BaseLinker não vai para orders.raw: ninguém lê, e custava CPU a cada rodada.
  it('não carrega o pedido cru da plataforma', () => {
    const p = normalizarPedidoBaseLinker({ order_id: 1, order_status_id: 7, date_confirmed: BASE, products: [] })
    expect('raw' in p).toBe(false)
  })
})

// O cursor de pullOrdersPagina é gravado pelo cron depois de CADA página: ele nunca pode passar à
// frente de um pedido não lido. Cada teste aqui é uma borda onde isso já quebrou ou quebraria.
describe('BaseLinker · cursor por página nunca pula pedido', () => {
  const T = 1_800_000_000

  it('pedidos que dividem o segundo da borda da página são relidos, não pulados', async () => {
    // 99 pedidos em segundos distintos e 3 no segundo T+99: a página corta no meio desse segundo.
    const pedidos = [
      ...Array.from({ length: 99 }, (_, i) => ({ order_id: i + 1, date_confirmed: T + i })),
      { order_id: 1000, date_confirmed: T + 99 },
      { order_id: 1001, date_confirmed: T + 99 },
      { order_id: 1002, date_confirmed: T + 99 },
    ]
    const bl = baseLinkerFalso(pedidos, T + 3600)
    const c = bl.conector()
    const p1 = await c.pullOrdersPagina({ date_confirmed_from: T })
    expect(p1.pedidos).toHaveLength(100)
    expect(p1.fim).toBe(false)
    // Com o "+1" da documentação seria T+100, e 1001 e 1002 nunca seriam lidos.
    expect(p1.cursor).toEqual({ date_confirmed_from: T + 99 })
    const p2 = await c.pullOrdersPagina(p1.cursor)
    expect(p2.fim).toBe(true)
    const lidos = new Set([...p1.pedidos, ...p2.pedidos].map((p) => p.externalId))
    expect(lidos).toEqual(new Set(pedidos.map((p) => String(p.order_id))))
  })

  // Lê até o fim, página por página, como o cron (sem teto): devolve o que foi lido e as consultas.
  async function lerTudo(c: ReturnType<ReturnType<typeof baseLinkerFalso>['conector']>, cursor: Record<string, unknown>) {
    const lidos = new Set<string>()
    const cursores: Record<string, unknown>[] = []
    for (let i = 0; i < 50; i++) {
      const p = await c.pullOrdersPagina(cursor)
      for (const x of p.pedidos) lidos.add(x.externalId)
      cursor = p.cursor
      cursores.push(cursor)
      if (p.fim) return { lidos, cursores }
    }
    throw new Error('não terminou em 50 páginas: ficou preso')
  }

  // Mais de 100 pedidos confirmados no MESMO segundo (importação em massa de um canal novo). A
  // versão anterior andava +1 depois da primeira página desse segundo: os outros 150 sumiam.
  it('segundo com mais de 100 pedidos é percorrido por número de pedido, sem pular nenhum', async () => {
    const pedidos = [
      ...Array.from({ length: 30 }, (_, i) => ({ order_id: 10 + i, date_confirmed: T - 100 + i })),
      ...Array.from({ length: 250 }, (_, i) => ({ order_id: 1000 + i, date_confirmed: T })),
      // Confirmados depois, mas com número MENOR que os do segundo lotado (criados antes, confirmados
      // depois): o filtro por id_from não pode escondê-los.
      { order_id: 5, date_confirmed: T + 1 },
      { order_id: 6, date_confirmed: T + 50 },
      ...Array.from({ length: 20 }, (_, i) => ({ order_id: 2000 + i, date_confirmed: T + 10 + i })),
    ]
    const bl = baseLinkerFalso(pedidos, T + 3600)
    const { lidos, cursores } = await lerTudo(bl.conector(), { date_confirmed_from: T - 200 })
    expect(lidos).toEqual(new Set(pedidos.map((p) => String(p.order_id))))
    // Dentro do segundo, o cursor anota o próximo número de pedido; depois sai dele sem id_from.
    expect(cursores).toContainEqual({ date_confirmed_from: T, id_from: 1100 })
    expect(cursores).toContainEqual({ date_confirmed_from: T, id_from: 1200 })
    expect(cursores.at(-1)).toEqual({ date_confirmed_from: T + 50 - SOBREPOSICAO_S })
    expect(bl.idsFrom.filter((x) => x !== undefined).length).toBeGreaterThan(0)
  })

  it('segundo lotado sobrevive a rodadas curtas: o id_from gravado retoma do pedido seguinte', async () => {
    const pedidos = Array.from({ length: 230 }, (_, i) => ({ order_id: 1 + i, date_confirmed: T }))
    const bl = baseLinkerFalso(pedidos, T + 3600)
    const p1 = await bl.conector().pullOrdersPagina({ date_confirmed_from: T })
    expect(p1.cursor).toEqual({ date_confirmed_from: T, id_from: 101 })
    // Outra execução (outro objeto, como a próxima rodada do cron) continua do cursor gravado.
    const p2 = await bl.conector().pullOrdersPagina(p1.cursor)
    expect(p2.pedidos.map((p) => Number(p.externalId))).toEqual(Array.from({ length: 100 }, (_, i) => 101 + i))
    expect(p2.cursor).toEqual({ date_confirmed_from: T, id_from: 201 })
    const p3 = await bl.conector().pullOrdersPagina(p2.cursor)
    expect(p3.pedidos).toHaveLength(30)
    expect(p3).toMatchObject({ cursor: { date_confirmed_from: T + 1 }, fim: false })
  })

  it('se a API ignorar id_from, não fica preso para sempre na mesma página', async () => {
    const pedidos = Array.from({ length: 150 }, (_, i) => ({ order_id: i + 1, date_confirmed: T }))
    const bl = baseLinkerFalso(pedidos, T + 3600)
    bl.ignorarIdFrom = true
    const { cursores } = await lerTudo(bl.conector(), { date_confirmed_from: T - 10 })
    // Sem como percorrer o segundo, anda +1 (com log de erro) em vez de repetir a página.
    expect(cursores).toContainEqual({ date_confirmed_from: T + 1 })
    expect(bl.consultas.length).toBeLessThan(6)
  })

  it('id_from só vale para o segundo em que foi anotado, nunca para um cursor corrigido', async () => {
    const bl = baseLinkerFalso([], T)
    await bl.conector().pullOrdersPagina({ date_confirmed_from: T + 86_400, id_from: 500 })
    expect(bl.consultas).toEqual([T])
    expect(bl.idsFrom).toEqual([undefined])
  })

  it('em dia: volta 2 h do maior lido, e a borda exata da sobreposição é relida', async () => {
    const bl = baseLinkerFalso([{ order_id: 1, date_confirmed: T - SOBREPOSICAO_S }, { order_id: 2, date_confirmed: T }], T + 60)
    const c = bl.conector()
    const p = await c.pullOrdersPagina({ date_confirmed_from: T - 10 })
    expect(p.fim).toBe(true)
    expect(p.cursor).toEqual({ date_confirmed_from: T - SOBREPOSICAO_S })
    // A próxima leitura começa exatamente na borda e inclui o pedido que está nela (>=).
    const releitura = await c.pullOrdersPagina(p.cursor)
    expect(releitura.pedidos.map((x) => x.externalId)).toEqual(['1', '2'])
  })

  it('pedido que aparece atrasado, com confirmação no passado, entra pela sobreposição', async () => {
    const bl = baseLinkerFalso([{ order_id: 1, date_confirmed: T }], T + 60)
    const c = bl.conector()
    const p1 = await c.pullOrdersPagina({ date_confirmed_from: T - 10 })
    // Depois da leitura surge um pedido confirmado 1 h antes do último lido.
    bl.pedidos.push({ order_id: 2, date_confirmed: T - 3600, visivel_em: T + 120 })
    bl.agoraS = T + 300
    const p2 = await c.pullOrdersPagina(p1.cursor)
    expect(p2.pedidos.map((x) => x.externalId)).toContain('2')
  })

  it('página vazia não recua o cursor (a versão anterior voltava 2 h a cada rodada sem pedido)', async () => {
    const bl = baseLinkerFalso([], T)
    const p = await bl.conector().pullOrdersPagina({ date_confirmed_from: T - 500 })
    expect(p).toEqual({ pedidos: [], cursor: { date_confirmed_from: T - 500 }, fim: true })
  })

  it('cursor antigo é drenado de onde parou, sem saltar para "N dias atrás"', async () => {
    const dezDias = T - 10 * 86_400
    const bl = baseLinkerFalso([{ order_id: 1, date_confirmed: dezDias + 5 }], T)
    const p = await bl.conector({ dias_iniciais: 3 }).pullOrdersPagina({ date_confirmed_from: dezDias })
    expect(bl.consultas).toEqual([dezDias])
    expect(p.pedidos.map((x) => x.externalId)).toEqual(['1'])
  })

  it('cursor no futuro (relógio torto) lê a partir de agora em vez de não ler nada', async () => {
    const bl = baseLinkerFalso([], T)
    await bl.conector().pullOrdersPagina({ date_confirmed_from: T + 86_400 })
    expect(bl.consultas).toEqual([T])
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

describe('BaseLinker · testarConexao', () => {
  const inventarios = { inventories: [{ inventory_id: 41, name: 'Loja', is_default: false }, { inventory_id: 42, name: 'Casa', is_default: true }] }

  it('credencial boa: uma chamada só, somente leitura, e devolve o inventário configurado', async () => {
    const { chamadas, fetchFn } = fetchFalso(() => ok(inventarios))
    const detalhe = await montar(fetchFn, { inventory_id: 41 }).testarConexao()
    expect(chamadas.map((c) => c.method)).toEqual(['getInventories'])
    expect(detalhe).toBe('conectado ao BaseLinker: inventário "Loja" (id 41)')
  })

  it('sem inventory_id no config, mostra o padrão e não vaza o token', async () => {
    const { fetchFn } = fetchFalso(() => ok(inventarios))
    const detalhe = await montar(fetchFn).testarConexao()
    expect(detalhe).toContain('"Casa" (id 42)')
    expect(detalhe).not.toContain('tok')
  })

  it('inventário configurado que não existe na conta é apontado', async () => {
    const { fetchFn } = fetchFalso(() => ok(inventarios))
    expect(await montar(fetchFn, { inventory_id: 99 }).testarConexao()).toContain('não existe o inventário 99')
  })

  it('credencial ruim: erro do BaseLinker com o error_code, para a rota traduzir', async () => {
    const { fetchFn } = fetchFalso(() => new Response(JSON.stringify({ status: 'ERROR', error_code: 'ERROR_AUTH_TOKEN', error_message: 'Invalid token' }), { status: 200 }))
    await expect(montar(fetchFn).testarConexao()).rejects.toMatchObject({ name: 'ErroConector', codigo: 'ERROR_AUTH_TOKEN' })
  })
})
