// As três falhas que o dono vai encontrar de verdade no cliente do worker, mais o caminho feliz.
// O módulo lê `workerUrl` na importação, então cada caso recarrega o módulo com o ambiente do caso.
import { afterEach, describe, expect, it, vi } from 'vitest'

const SESSAO = { data: { session: { access_token: 'jwt-de-teste' } } }

async function carregar(url: string | undefined, modo: 'supabase' | 'memoria' = 'supabase') {
  vi.resetModules()
  vi.doMock('./supabaseClient', () => ({
    workerUrl: (url ?? '').replace(/\/$/, ''),
    modoDados: () => modo,
    clienteSupabase: () => ({ auth: { getSession: async () => SESSAO } }),
  }))
  return import('./worker')
}

afterEach(() => {
  vi.doUnmock('./supabaseClient')
  vi.unstubAllGlobals()
})

describe('chamarWorker', () => {
  it('(a) sem VITE_WORKER_URL, avisa que o worker ainda não foi publicado', async () => {
    const { chamarWorker, ErroWorker, workerConfigurado } = await carregar('')
    expect(workerConfigurado()).toBe(false)
    const chamada = chamarWorker('/connectors/1/test')
    await expect(chamada).rejects.toBeInstanceOf(ErroWorker)
    await expect(chamada).rejects.toThrow(/VITE_WORKER_URL/)
  })

  it('(b) falha de fetch fala das duas causas possíveis (rede e CORS) sem escolher uma', async () => {
    const { chamarWorker } = await carregar('https://w.exemplo.dev')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const erro = (await chamarWorker('/connectors/1/test').catch((e: unknown) => e)) as { causa: string; status: number; message: string }
    expect(erro.causa).toBe('rede')
    expect(erro.message).toContain('https://w.exemplo.dev')
    expect(erro.message).toContain('CORS_ORIGENS')
    expect(erro.message).toContain('/health')
  })

  it('(c) erro do worker aparece com o texto que o worker escreveu', async () => {
    const { chamarWorker } = await carregar('https://w.exemplo.dev')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, erro: 'o token foi recusado pelo BaseLinker; gere um novo em Minha conta > API' }), { status: 502 })))
    const erro = (await chamarWorker('/connectors/1/test').catch((e: unknown) => e)) as { causa: string; status: number; message: string }
    expect(erro.causa).toBe('worker')
    expect(erro.status).toBe(502)
    expect(erro.message).toBe('O token foi recusado pelo BaseLinker; gere um novo em Minha conta > API.')
  })

  it('manda o token da sessão e devolve o JSON do worker', async () => {
    const { chamarWorker } = await carregar('https://w.exemplo.dev/')
    const fetchFalso = vi.fn(async () => new Response(JSON.stringify({ ok: true, detalhe: 'conectado ao BaseLinker' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchFalso)
    const r = await chamarWorker<{ detalhe: string }>('/connectors/abc/test', { corpo: { a: 1 } })
    expect(r.detalhe).toBe('conectado ao BaseLinker')
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://w.exemplo.dev/connectors/abc/test')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-de-teste')
    expect(init.body).toBe('{"a":1}')
  })

  it('sem banco configurado, não tenta falar com o worker', async () => {
    const { chamarWorker } = await carregar('https://w.exemplo.dev', 'memoria')
    const fetchFalso = vi.fn()
    vi.stubGlobal('fetch', fetchFalso)
    await expect(chamarWorker('/connectors/1/test')).rejects.toThrow(/dados de exemplo/)
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})
