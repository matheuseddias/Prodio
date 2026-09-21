import { ClienteHttp } from '../http'
import { silenciarLog } from '../log'
import { ConectorBling, URL_BLING, URL_BLING_TOKEN, formatarDataBling, hmacSha256Hex, type CredenciaisBling } from './bling'

silenciarLog(true)

interface Chamada {
  url: URL
  method: string
  headers: Record<string, string>
  body: string | undefined
}

function fetchFalso(responder: (c: Chamada, n: number) => Response) {
  const chamadas: Chamada[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    const c: Chamada = { url: new URL(url), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined }
    chamadas.push(c)
    return responder(c, chamadas.length)
  }
  return { chamadas, fetchFn }
}

const json = (dados: unknown, status = 200) => new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json' } })
const AGORA = Date.UTC(2026, 8, 21, 15, 0, 0)
const TOKENS = { access_token: 'novo', refresh_token: 'r2', expires_in: 21600 }

function montar(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, creds: CredenciaisBling, config = {}) {
  const persistir = vi.fn<(c: CredenciaisBling) => Promise<void>>(async () => {})
  const cliente = new ClienteHttp({ nome: 'teste-bling', intervaloMinMs: 0, fetchFn, sleep: async () => {}, agora: () => AGORA })
  const c = new ConectorBling({ connectorId: 'c2', credenciais: creds, app: { clientId: 'id', clientSecret: 'segredo' }, config, cliente, persistir, agora: () => AGORA })
  return { c, persistir }
}

describe('Bling · renovação de token', () => {
  it('token vencido: renova antes da chamada, persiste e usa o novo access_token', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.href === URL_BLING_TOKEN ? json(TOKENS) : json({ data: [] })))
    const { c, persistir } = montar(fetchFn, { access_token: 'velho', refresh_token: 'r1', expires_at: AGORA - 1 })
    await c.pullCatalog()
    expect(chamadas[0].url.href).toBe(URL_BLING_TOKEN)
    expect(chamadas[0].headers.Authorization).toBe(`Basic ${btoa('id:segredo')}`)
    expect(chamadas[0].headers['enable-jwt']).toBe('1')
    expect(new URLSearchParams(chamadas[0].body).get('grant_type')).toBe('refresh_token')
    expect(new URLSearchParams(chamadas[0].body).get('refresh_token')).toBe('r1')
    expect(persistir).toHaveBeenCalledTimes(1)
    expect(persistir.mock.calls[0][0]).toMatchObject({ access_token: 'novo', refresh_token: 'r2' })
    expect(chamadas[1].headers.Authorization).toBe('Bearer novo')
    expect(chamadas[1].headers['enable-jwt']).toBe('1')
  })

  it('401 no meio: renova uma vez e repete a chamada', async () => {
    const { chamadas, fetchFn } = fetchFalso((c, n) => {
      if (c.url.href === URL_BLING_TOKEN) return json(TOKENS)
      return n === 1 ? json({ error: { message: 'expirado' } }, 401) : json({ data: [{ id: 9, codigo: 'CAM-01', nome: 'Camiseta' }] })
    })
    const { c, persistir } = montar(fetchFn, { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const r = await c.pullCatalog()
    expect(chamadas.map((x) => x.url.pathname)).toEqual(['/Api/v3/produtos', '/Api/v3/oauth/token', '/Api/v3/produtos'])
    expect(persistir).toHaveBeenCalledTimes(1)
    expect(r).toEqual([{ externalId: '9', skuExterno: 'CAM-01', nome: 'Camiseta', ean: undefined }])
  })

  it('sem refresh_token pede reconexão', async () => {
    const { fetchFn } = fetchFalso(() => json({}))
    const { c } = montar(fetchFn, { access_token: 'velho', expires_at: AGORA - 1 })
    await expect(c.pullCatalog()).rejects.toThrow(/reconecte/)
  })
})

describe('Bling · pedidos', () => {
  it('lista por dataAlteracao e busca os itens de cada pedido; cursor volta 2 h', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === '/Api/v3/pedidos/vendas') return json({ data: [{ id: 1 }, { id: 2 }] })
      const id = Number(c.url.pathname.split('/').pop())
      return json({ data: { id, data: '2026-09-20', total: 50, situacao: { id: 6 }, itens: [{ codigo: 'CAM-01', quantidade: 2, valor: 25, produto: { id: 9 } }] } })
    })
    const { c } = montar(fetchFn, { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const r = await c.pullOrders({ alterado_desde: AGORA - 3_600_000 })
    const lista = chamadas[0].url.searchParams
    expect(lista.get('dataAlteracaoInicial')).toBe(formatarDataBling(new Date(AGORA - 3_600_000)))
    expect(lista.get('limite')).toBe('100')
    expect(chamadas.map((x) => x.url.pathname)).toEqual(['/Api/v3/pedidos/vendas', '/Api/v3/pedidos/vendas/1', '/Api/v3/pedidos/vendas/2'])
    expect(r.pedidos).toHaveLength(2)
    expect(r.pedidos[0]).toMatchObject({ externalId: '1', status: '6', total: 50, itens: [{ skuExterno: 'CAM-01', quantidade: 2, preco: 25, produtoExternoId: '9' }] })
    expect(r.cursor).toEqual({ alterado_desde: AGORA - 2 * 3_600_000 })
  })

  it('formata data no fuso do tenant', () => {
    expect(formatarDataBling(new Date(Date.UTC(2026, 0, 1, 2, 30, 0)), 'America/Sao_Paulo')).toBe('2025-12-31 23:30:00')
  })
})

describe('Bling · estoque e NF-e', () => {
  it('pushFinishedStock manda operação E/S por delta no depósito configurado', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === '/Api/v3/produtos') return json({ data: [{ id: 9, codigo: 'CAM-01' }] })
      return json({ data: {} })
    })
    const { c } = montar(fetchFn, { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 }, { deposito_id: 77 })
    const r = await c.pushFinishedStock([{ sku: 'CAM-01', delta: 3 }, { sku: 'CAM-01', delta: -1 }, { sku: 'X', delta: 1 }], { dryRun: false })
    const posts = chamadas.filter((x) => x.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[0].body!)).toMatchObject({ produto: { id: 9 }, deposito: { id: 77 }, operacao: 'E', quantidade: 3 })
    expect(JSON.parse(posts[1].body!)).toMatchObject({ operacao: 'S', quantidade: 1 })
    expect(r.map((x) => x.ok)).toEqual([true, true, false])
  })

  it('findInboundNfe consulta por chave e devolve os itens', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === '/Api/v3/nfe') return json({ data: [{ id: 123 }] })
      return json({ data: { id: 123, numero: 55, serie: 1, contato: { nome: 'Fornecedor' }, itens: [{ codigo: 'SUE-PRT', descricao: 'Suede', quantidade: 100, valor: 9.5 }] } })
    })
    const { c } = montar(fetchFn, { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const r = await c.findInboundNfe('35260912345678000190550010000000011000000015')
    expect(chamadas[0].url.searchParams.get('tipo')).toBe('0')
    expect(chamadas[0].url.searchParams.get('chaveAcesso')).toBe('35260912345678000190550010000000011000000015')
    expect(chamadas[1].url.href).toBe(`${URL_BLING}/nfe/123`)
    expect(r).toMatchObject({ externalId: '123', numero: 55, emitente: 'Fornecedor', itens: [{ codigo: 'SUE-PRT', quantidade: 100 }] })
  })
})

describe('Bling · webhook HMAC', () => {
  const corpo = JSON.stringify({ eventId: 'e1', event: 'order.updated', companyId: 1, data: { id: 42 } })
  const montarReq = (assinatura: string) => new Request('https://w/webhooks/bling/x', { method: 'POST', body: corpo, headers: { 'X-Bling-Signature-256': assinatura } })

  it('aceita a assinatura correta e rejeita corpo adulterado', async () => {
    const { fetchFn } = fetchFalso(() => json({}))
    const { c } = montar(fetchFn, { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const assinatura = 'sha256=' + (await hmacSha256Hex('segredo', corpo))
    expect(await c.verifyWebhook(montarReq(assinatura), corpo)).toBe(true)
    expect(await c.verifyWebhook(montarReq(assinatura), corpo + ' ')).toBe(false)
    expect(await c.verifyWebhook(montarReq('sha256=' + (await hmacSha256Hex('outro', corpo))), corpo)).toBe(false)
    expect(await c.verifyWebhook(new Request('https://w/x', { method: 'POST', body: corpo }), corpo)).toBe(false)
  })
})
