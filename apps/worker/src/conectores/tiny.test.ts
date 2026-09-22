import { ClienteHttp } from '../http'
import { silenciarLog } from '../log'
import { ConectorTiny, SOBREPOSICAO_MS, type CredenciaisTiny } from './tiny'
import { MAPA_TINY, dataTiny, extrairXmlTiny, mensagemErroTiny } from './tinyMapa'

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
const TOKENS = { access_token: 'novo', refresh_token: 'r2', expires_in: 14400 }
const URL_TOKEN = MAPA_TINY.token
const P = (caminho: string) => new URL(MAPA_TINY.api + caminho).pathname

function montar(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, creds: CredenciaisTiny, config = {}) {
  const persistir = vi.fn<(c: CredenciaisTiny) => Promise<void>>(async () => {})
  const cliente = new ClienteHttp({ nome: 'teste-tiny', intervaloMinMs: 0, fetchFn, sleep: async () => {}, agora: () => AGORA })
  const c = new ConectorTiny({ connectorId: 'c9', credenciais: creds, app: { clientId: 'id', clientSecret: 'segredo' }, config, cliente, persistir, agora: () => AGORA })
  return { c, persistir }
}

const VALIDO = { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 }

describe('Tiny · renovação de token', () => {
  it('token vencido: renova pelo Keycloak, persiste o par rotativo e usa o novo access_token', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.href === URL_TOKEN ? json(TOKENS) : json({ itens: [] })))
    const { c, persistir } = montar(fetchFn, { access_token: 'velho', refresh_token: 'r1', expires_at: AGORA - 1 })
    await c.pullCatalog()
    expect(chamadas[0].url.href).toBe(URL_TOKEN)
    const corpo = new URLSearchParams(chamadas[0].body)
    expect(corpo.get('grant_type')).toBe('refresh_token')
    expect(corpo.get('refresh_token')).toBe('r1')
    expect(corpo.get('client_id')).toBe('id')
    expect(corpo.get('client_secret')).toBe('segredo')
    expect(chamadas[0].headers.Authorization).toBeUndefined()
    expect(persistir).toHaveBeenCalledTimes(1)
    expect(persistir.mock.calls[0][0]).toMatchObject({ access_token: 'novo', refresh_token: 'r2' })
    expect(chamadas[1].headers.Authorization).toBe('Bearer novo')
  })

  it('401 no meio: renova uma vez e repete a chamada', async () => {
    const { chamadas, fetchFn } = fetchFalso((c, n) => {
      if (c.url.href === URL_TOKEN) return json(TOKENS)
      return n === 1 ? json({ error: 'invalid_token' }, 401) : json({ itens: [{ id: 9, sku: 'CAM-01', descricao: 'Camiseta' }] })
    })
    const { c, persistir } = montar(fetchFn, VALIDO)
    const r = await c.pullCatalog()
    expect(chamadas.map((x) => (x.url.href === URL_TOKEN ? URL_TOKEN : x.url.pathname))).toEqual([P('/produtos'), URL_TOKEN, P('/produtos')])
    expect(persistir).toHaveBeenCalledTimes(1)
    expect(r).toEqual([{ externalId: '9', skuExterno: 'CAM-01', nome: 'Camiseta', ean: undefined }])
  })

  it('sem refresh_token pede reconexão', async () => {
    const { fetchFn } = fetchFalso(() => json({}))
    const { c } = montar(fetchFn, { access_token: 'velho', expires_at: AGORA - 1 })
    await expect(c.pullCatalog()).rejects.toThrow(/reconecte/)
  })
})

describe('Tiny · pedidos', () => {
  it('lista por dataAtualizacao, busca o detalhe de cada pedido e devolve o cursor com sobreposição', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === P('/pedidos')) return json({ itens: [{ id: 1 }, { id: 2 }], paginacao: { total: 2 } })
      const id = Number(c.url.pathname.split('/').pop())
      return json({
        id,
        situacao: 3,
        data: '2026-09-20',
        dataAlteracao: '2026-09-21',
        valorTotalPedido: 50,
        itens: [{ produto: { id: 9, sku: 'CAM-01', descricao: 'Camiseta' }, quantidade: 2, valorUnitario: 25 }],
      })
    })
    const { c } = montar(fetchFn, VALIDO)
    const r = await c.pullOrders({ alterado_desde: AGORA - 3_600_000 })
    const lista = chamadas[0].url.searchParams
    expect(lista.get(MAPA_TINY.query.pedidoAlteradoDesde)).toBe(dataTiny(new Date(AGORA - 3_600_000)))
    expect(lista.get(MAPA_TINY.query.limite)).toBe(String(MAPA_TINY.limitePagina))
    expect(lista.get(MAPA_TINY.query.deslocamento)).toBe('0')
    expect(chamadas.map((x) => x.url.pathname)).toEqual([P('/pedidos'), P('/pedidos/1'), P('/pedidos/2')])
    expect(r.pedidos).toHaveLength(2)
    expect(r.pedidos[0]).toMatchObject({
      externalId: '1',
      status: '3',
      total: 50,
      itens: [{ skuExterno: 'CAM-01', quantidade: 2, preco: 25, produtoExternoId: '9', nome: 'Camiseta' }],
    })
    expect(r.pedidos[0].confirmedAt).toBe('2026-09-20T03:00:00.000Z')
    expect(r.cursor).toEqual({ alterado_desde: AGORA - SOBREPOSICAO_MS })
  })

  it('pagina a listagem até o lote vir incompleto', async () => {
    const cheio = Array.from({ length: MAPA_TINY.limitePagina }, (_, i) => ({ id: i + 1 }))
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname !== P('/pedidos')) return json({ id: Number(c.url.pathname.split('/').pop()), itens: [] })
      return json({ itens: c.url.searchParams.get(MAPA_TINY.query.deslocamento) === '0' ? cheio : [{ id: 999 }] })
    })
    const { c } = montar(fetchFn, VALIDO)
    const r = await c.pullOrders(null)
    const listagens = chamadas.filter((x) => x.url.pathname === P('/pedidos'))
    expect(listagens.map((x) => x.url.searchParams.get(MAPA_TINY.query.deslocamento))).toEqual(['0', '100'])
    expect(r.pedidos).toHaveLength(MAPA_TINY.limitePagina + 1)
  })

  it('erro da API vira ErroConector sem ecoar o corpo cru', async () => {
    const { c } = montar(fetchFalso(() => json({ mensagem: 'pedido inexistente', debug: 'Bearer ok' }, 404)).fetchFn, VALIDO)
    const e = await c.pullOrder('77').catch((x: unknown) => x)
    expect(e).toBeInstanceOf(Error)
    expect((e as Error).name).toBe('ErroConector')
    expect((e as Error).message).toContain('pedido inexistente')
    expect((e as Error).message).not.toContain('Bearer')
  })
})

// Catálogo falso: responde tanto à varredura completa quanto à busca por código.
const PRODUTOS = [{ id: 9, sku: 'CAM-01' }, { id: 10, sku: 'CAN-02' }]
const respostaProdutos = (c: Chamada) => {
  const codigo = c.url.searchParams.get(MAPA_TINY.query.produtoCodigo)
  return json({ itens: codigo ? PRODUTOS.filter((p) => p.sku === codigo) : PRODUTOS })
}

describe('Tiny · estoque', () => {
  it('pullFinishedStock usa o depósito configurado e cai no saldo total sem ele', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === P('/produtos')) return respostaProdutos(c)
      return json({ saldo: 12, disponivel: 8, depositos: [{ id: 77, saldo: 5 }, { id: 78, saldo: 7 }] })
    })
    const { c } = montar(fetchFn, VALIDO, { deposito_id: 77 })
    expect(await c.pullFinishedStock(['CAM-01'])).toEqual([{ sku: 'CAM-01', externalId: '9', saldo: 5 }])
    // Poucos SKUs: busca direta por código, sem varrer o catálogo.
    expect(chamadas[0].url.searchParams.get(MAPA_TINY.query.produtoCodigo)).toBe('CAM-01')
    const { fetchFn: f2 } = fetchFalso((x) => (x.url.pathname === P('/produtos') ? respostaProdutos(x) : json({ saldo: 12 })))
    const { c: c2 } = montar(f2, VALIDO)
    expect(await c2.pullFinishedStock(['CAM-01', 'INEXISTENTE'])).toEqual([{ sku: 'CAM-01', externalId: '9', saldo: 12 }])
  })

  it('sem lista de SKUs lê o catálogo inteiro e devolve o saldo de todos', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.pathname === P('/produtos') ? respostaProdutos(c) : json({ saldo: 4 })))
    const { c } = montar(fetchFn, VALIDO)
    expect(await c.pullFinishedStock()).toEqual([
      { sku: 'CAM-01', externalId: '9', saldo: 4 },
      { sku: 'CAN-02', externalId: '10', saldo: 4 },
    ])
    expect(chamadas[0].url.searchParams.get(MAPA_TINY.query.produtoCodigo)).toBeNull()
  })

  it('pushFinishedStock manda E/S por delta e para na primeira falha', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.pathname === P('/produtos') ? respostaProdutos(c) : json({ ok: true })))
    const { c } = montar(fetchFn, VALIDO, { deposito_id: 77 })
    const r = await c.pushFinishedStock(
      [{ sku: 'CAM-01', delta: 3 }, { sku: 'CAN-02', delta: -1 }, { sku: 'CAM-01', delta: 0 }, { sku: 'X', delta: 5 }, { sku: 'CAN-02', delta: 9 }],
      { dryRun: false },
    )
    const posts = chamadas.filter((x) => x.method === 'POST')
    expect(posts.map((x) => x.url.pathname)).toEqual([P('/estoque/9'), P('/estoque/10')])
    expect(JSON.parse(posts[0].body!)).toMatchObject({ tipo: 'E', quantidade: 3, deposito: { id: 77 } })
    expect(JSON.parse(posts[1].body!)).toMatchObject({ tipo: 'S', quantidade: 1 })
    // SKU desconhecido interrompe o lote: o delta seguinte não é aplicado.
    expect(r.map((x) => x.ok)).toEqual([true, true, true, false])
    expect(r[3].erro).toMatch(/não encontrado/)
  })

  it('dryRun não escreve nada e marca o resultado', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.pathname === P('/produtos') ? respostaProdutos(c) : json({ ok: true })))
    const { c } = montar(fetchFn, VALIDO)
    const r = await c.pushFinishedStock([{ sku: 'CAM-01', delta: 3 }, { sku: 'CAN-02', delta: -2 }], { dryRun: true })
    expect(chamadas.filter((x) => x.method === 'POST')).toHaveLength(0)
    expect(r).toEqual([{ sku: 'CAM-01', ok: true, dryRun: true }, { sku: 'CAN-02', ok: true, dryRun: true }])
  })

  it('sem depósito configurado o corpo não manda deposito', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.pathname === P('/produtos') ? respostaProdutos(c) : json({ ok: true })))
    const { c } = montar(fetchFn, VALIDO)
    await c.pushFinishedStock([{ sku: 'CAM-01', delta: 1 }], { dryRun: false })
    const post = chamadas.find((x) => x.method === 'POST')!
    expect(JSON.parse(post.body!).deposito).toBeUndefined()
  })
})

describe('Tiny · NF-e de entrada', () => {
  const CHAVE = '35260912345678000190550010000000011000000015'

  it('varre as notas de entrada, casa pela chave e traz detalhe, itens e XML', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === P('/notas')) return json({ itens: [{ id: 1, chaveAcesso: '3526091111' }, { id: 123, chaveAcesso: CHAVE }] })
      if (c.url.pathname === P('/notas/123/xml')) return json({ xml: '<nfeProc><NFe/></nfeProc>' })
      return json({ id: 123, numero: 55, serie: 1, fornecedor: { nome: 'Fornecedor SA' }, itens: [{ codigo: 'SUE-PRT', descricao: 'Suede', quantidade: 100, valorUnitario: 9.5 }] })
    })
    const { c } = montar(fetchFn, VALIDO, { dias_nfe: 30 })
    const r = await c.findInboundNfe(CHAVE)
    const lista = chamadas[0].url.searchParams
    expect(lista.get(MAPA_TINY.query.notaTipo)).toBe(MAPA_TINY.valores.notaEntrada)
    expect(lista.get(MAPA_TINY.query.notaDataInicial)).toBe(dataTiny(new Date(AGORA - 30 * 86400_000)))
    expect(lista.get(MAPA_TINY.query.notaDataFinal)).toBe(dataTiny(new Date(AGORA)))
    expect(chamadas.map((x) => x.url.pathname)).toEqual([P('/notas'), P('/notas/123'), P('/notas/123/xml')])
    expect(r).toMatchObject({
      externalId: '123',
      chave: CHAVE,
      numero: 55,
      serie: 1,
      emitente: 'Fornecedor SA',
      xml: '<nfeProc><NFe/></nfeProc>',
      itens: [{ codigo: 'SUE-PRT', descricao: 'Suede', quantidade: 100, valor: 9.5 }],
    })
  })

  it('devolve null quando a chave não está na janela e nem consulta detalhe', async () => {
    const { chamadas, fetchFn } = fetchFalso(() => json({ itens: [{ id: 1, chaveAcesso: '3526091111' }] }))
    const { c } = montar(fetchFn, VALIDO)
    expect(await c.findInboundNfe(CHAVE)).toBeNull()
    expect(chamadas).toHaveLength(1)
  })

  it('chave malformada nem chega a chamar a API', async () => {
    const { chamadas, fetchFn } = fetchFalso(() => json({ itens: [] }))
    const { c } = montar(fetchFn, VALIDO)
    expect(await c.findInboundNfe('123')).toBeNull()
    expect(chamadas).toHaveLength(0)
  })

  it('falha no XML não derruba a busca', async () => {
    const { fetchFn } = fetchFalso((c) => {
      if (c.url.pathname === P('/notas')) return json({ itens: [{ id: 123, chaveAcesso: CHAVE }] })
      if (c.url.pathname === P('/notas/123/xml')) return json({ mensagem: 'sem xml' }, 404)
      return json({ id: 123, numero: 55 })
    })
    const { c } = montar(fetchFn, VALIDO)
    const r = await c.findInboundNfe(CHAVE)
    expect(r?.xml).toBeUndefined()
    expect(r?.numero).toBe(55)
  })
})

describe('Tiny · sem webhooks', () => {
  it('verifyWebhook devolve unsupported em vez de lançar', async () => {
    const { c } = montar(fetchFalso(() => json({})).fetchFn, VALIDO)
    expect(await c.verifyWebhook()).toBe('unsupported')
    expect(c.capacidades.webhooks).toBe(false)
  })
})

describe('Tiny · mapa', () => {
  it('formata a data no fuso do tenant', () => {
    expect(dataTiny(new Date(Date.UTC(2026, 0, 1, 2, 30, 0)), 'America/Sao_Paulo')).toBe('2025-12-31')
  })

  it('extrai o XML cru, o embrulhado em JSON e o base64', () => {
    expect(extrairXmlTiny('  <nfeProc/>  ')).toBe('<nfeProc/>')
    expect(extrairXmlTiny(JSON.stringify({ xml: '<nfeProc/>' }))).toBe('<nfeProc/>')
    expect(extrairXmlTiny(JSON.stringify({ xml: btoa('<nfeProc/>') }))).toBe('<nfeProc/>')
    expect(extrairXmlTiny(JSON.stringify({ outro: 1 }))).toBeUndefined()
    expect(extrairXmlTiny('nao e xml')).toBeUndefined()
  })

  it('lê só campos conhecidos da mensagem de erro', () => {
    expect(mensagemErroTiny(JSON.stringify({ error_description: 'token expirado' }))).toBe('token expirado')
    expect(mensagemErroTiny(JSON.stringify({ errors: [{ mensagem: 'campo x' }, { mensagem: 'campo y' }] }))).toBe('campo x; campo y')
    expect(mensagemErroTiny('<html>500</html>')).toBe('sem detalhe')
  })
})
