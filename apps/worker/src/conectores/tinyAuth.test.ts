// Token, reconexão e robustez de resposta do Tiny. O resto do adaptador está em tiny.test.ts.
import { ClienteHttp } from '../http'
import { silenciarLog } from '../log'
import { ConectorTiny } from './tiny'
import { mesclarCredenciaisTiny, type CredenciaisTiny } from './tinyAuth'
import { MAPA_TINY, ehErroDeReauth } from './tinyMapa'
import { ErroConector } from './tipos'

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
const URL_TOKEN = MAPA_TINY.token
const VENCIDAS: CredenciaisTiny = { access_token: 'velho', refresh_token: 'r1', expires_at: AGORA - 1 }

function montar(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, creds: CredenciaisTiny, recarregar?: () => Promise<CredenciaisTiny | null>) {
  const persistir = vi.fn<(c: CredenciaisTiny) => Promise<void>>(async () => {})
  const cliente = new ClienteHttp({ nome: 'teste-tiny-auth', intervaloMinMs: 0, fetchFn, sleep: async () => {}, agora: () => AGORA })
  const c = new ConectorTiny({ connectorId: 'c9', credenciais: creds, app: { clientId: 'id', clientSecret: 'segredo' }, cliente, persistir, recarregar, agora: () => AGORA })
  return { c, persistir }
}

const erroDe = async (p: Promise<unknown>): Promise<ErroConector> => (await p.catch((e: unknown) => e)) as ErroConector

describe('Tiny · token rotativo', () => {
  it('resposta sem refresh_token novo mantém o que já estava gravado', async () => {
    // O refresh do Tiny é rotativo: deixar `refresh_token: undefined` sobrescrever o
    // guardado mataria a conexão até reautorização manual.
    const { fetchFn } = fetchFalso((c) => (c.url.href === URL_TOKEN ? json({ access_token: 'novo', expires_in: 14400 }) : json({ itens: [] })))
    const { c, persistir } = montar(fetchFn, VENCIDAS)
    await c.pullCatalog()
    expect(persistir.mock.calls[0][0]).toEqual({ access_token: 'novo', refresh_token: 'r1', expires_at: AGORA + 14_400_000 })
  })

  it('sem expires_in assume 4 h em vez de nascer vencido', async () => {
    const { fetchFn } = fetchFalso((c) => (c.url.href === URL_TOKEN ? json({ access_token: 'novo', refresh_token: 'r2' }) : json({ itens: [] })))
    const { c, persistir } = montar(fetchFn, VENCIDAS)
    await c.pullCatalog()
    expect(persistir.mock.calls[0][0].expires_at).toBe(AGORA + 4 * 3600 * 1000)
  })

  it('refresh vencido (invalid_grant) pede reconexão com codigo reauth', async () => {
    const { fetchFn } = fetchFalso(() => json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400))
    const { c, persistir } = montar(fetchFn, VENCIDAS)
    const e = await erroDe(c.pullCatalog())
    expect(e.name).toBe('ErroConector')
    expect(e.codigo).toBe('reauth')
    expect(e.message).toMatch(/reconecte o Tiny/)
    expect(persistir).not.toHaveBeenCalled() // não regrava nada com a autorização morta
  })

  it('token 200 sem access_token não vira "Bearer undefined"', async () => {
    const { chamadas, fetchFn } = fetchFalso(() => json({ erro: 'nada aqui' }))
    const { c } = montar(fetchFn, VENCIDAS)
    const e = await erroDe(c.pullCatalog())
    expect(e.codigo).toBe('reauth')
    expect(chamadas).toHaveLength(1) // parou no token, não chamou a API
  })

  it('401 depois de renovar não entra em laço: erro claro de reconexão', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.href === URL_TOKEN ? json({ access_token: 'novo', refresh_token: 'r2', expires_in: 14400 }) : json({ error: 'invalid_token' }, 401)))
    const { c } = montar(fetchFn, { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const e = await erroDe(c.pullCatalog())
    expect(e.codigo).toBe('reauth')
    expect(e.status).toBe(401)
    expect(chamadas.filter((x) => x.url.href !== URL_TOKEN)).toHaveLength(2) // uma antes, uma depois da renovação
  })

  it('adota o par que outra execução do cron acabou de gravar, sem queimar o refresh', async () => {
    const { chamadas, fetchFn } = fetchFalso(() => json({ itens: [] }))
    const recarregar = vi.fn(async () => ({ access_token: 'de-outro', refresh_token: 'r9', expires_at: AGORA + 3_600_000 }))
    const { c, persistir } = montar(fetchFn, VENCIDAS, recarregar)
    await c.pullCatalog()
    expect(chamadas.some((x) => x.url.href === URL_TOKEN)).toBe(false)
    expect(chamadas[0].headers.Authorization).toBe('Bearer de-outro')
    expect(persistir).not.toHaveBeenCalled()
  })

  it('par guardado mais velho não atrapalha: renova normalmente', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.href === URL_TOKEN ? json({ access_token: 'novo', refresh_token: 'r2', expires_in: 14400 }) : json({ itens: [] })))
    const recarregar = vi.fn(async () => ({ access_token: 'antigo', refresh_token: 'r0', expires_at: AGORA - 99_999 }))
    const { c, persistir } = montar(fetchFn, VENCIDAS, recarregar)
    await c.pullCatalog()
    expect(chamadas[0].url.href).toBe(URL_TOKEN)
    expect(new URLSearchParams(chamadas[0].body).get('refresh_token')).toBe('r1') // o da memória, não o velho do banco
    expect(persistir).toHaveBeenCalledTimes(1)
  })

  it('duas chamadas simultâneas renovam uma vez só', async () => {
    const { chamadas, fetchFn } = fetchFalso((c) => (c.url.href === URL_TOKEN ? json({ access_token: 'novo', refresh_token: 'r2', expires_in: 14400 }) : json({ itens: [] })))
    const { c, persistir } = montar(fetchFn, VENCIDAS)
    await Promise.all([c.pullCatalog(), c.pullCatalog()])
    expect(chamadas.filter((x) => x.url.href === URL_TOKEN)).toHaveLength(1)
    expect(persistir).toHaveBeenCalledTimes(1)
  })
})

describe('Tiny · resposta estranha', () => {
  it('corpo não-JSON vira ErroConector sem ecoar o HTML', async () => {
    const { c } = montar(async () => new Response('<html><body>Gateway</body></html>', { status: 200 }), { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const e = await erroDe(c.pullCatalog())
    expect(e.name).toBe('ErroConector')
    expect(e.message).toMatch(/não é JSON/)
    expect(e.message).not.toContain('<html')
  })

  it('erro 5xx com página HTML não vaza o corpo na mensagem', async () => {
    const { c } = montar(async () => new Response('<html>erro interno do provedor</html>', { status: 503 }), { access_token: 'ok', refresh_token: 'r1', expires_at: AGORA + 3_600_000 })
    const e = await erroDe(c.pullCatalog())
    expect(e.status).toBe(503)
    expect(e.message).toContain('sem detalhe')
    expect(e.message).not.toContain('provedor')
  })

  it('nenhuma mensagem de erro carrega token ou client_secret', async () => {
    const { c } = montar(async () => json({ mensagem: 'falhou', echo: { authorization: 'Bearer ok', client_secret: 'segredo' } }, 422), {
      access_token: 'ok',
      refresh_token: 'r1',
      expires_at: AGORA + 3_600_000,
    })
    const e = await erroDe(c.pullCatalog())
    expect(e.message).toContain('falhou')
    expect(e.message).not.toContain('segredo')
    expect(e.message).not.toContain('Bearer')
  })
})

describe('Tiny · utilitários de credencial', () => {
  it('mescla só o que veio preenchido', () => {
    expect(mesclarCredenciaisTiny({ access_token: 'a', refresh_token: 'r', client_id: 'i' }, { access_token: 'b' })).toEqual({
      access_token: 'b',
      refresh_token: 'r',
      client_id: 'i',
    })
    expect(mesclarCredenciaisTiny({ refresh_token: 'r' }, { refresh_token: '' })).toEqual({ refresh_token: 'r' })
  })

  it('reconhece os erros que só a reautorização resolve', () => {
    expect(ehErroDeReauth(400, '{"error":"invalid_grant"}')).toBe(true)
    expect(ehErroDeReauth(401, 'Token is not active')).toBe(true)
    expect(ehErroDeReauth(500, 'invalid_grant')).toBe(false)
    expect(ehErroDeReauth(400, '{"error":"invalid_request"}')).toBe(false)
  })
})
