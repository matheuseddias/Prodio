// Para onde o access_token da sessão pode ir. Toda chamada de ./worker.ts leva
// `Authorization: Bearer <access_token>`; o destino vem de VITE_WORKER_URL, lido no build do
// Cloudflare Pages. Um http:// aí (ou um valor colado errado) mandaria a chave da conta do usuário
// por uma conexão que qualquer intermediário da rede da fábrica lê.
import { afterEach, describe, expect, it, vi } from 'vitest'

const SESSAO = { data: { session: { access_token: 'jwt-de-teste' } } }

async function carregar(url: string) {
  vi.resetModules()
  vi.doMock('./supabaseClient', () => ({
    workerUrl: url.replace(/\/$/, ''),
    modoDados: () => 'supabase' as const,
    clienteSupabase: () => ({ auth: { getSession: async () => SESSAO } }),
  }))
  return import('./worker')
}

afterEach(() => {
  vi.doUnmock('./supabaseClient')
  vi.unstubAllGlobals()
})

describe('baseSegura', () => {
  it('aceita https e o localhost do desenvolvimento', async () => {
    const { baseSegura } = await carregar('https://w.exemplo.dev')
    expect(baseSegura('https://prodio-worker.workers.dev')).toBe(true)
    expect(baseSegura('http://localhost:8787')).toBe(true)
    expect(baseSegura('http://127.0.0.1:8787')).toBe(true)
  })

  it('recusa http de fora, outros protocolos e lixo', async () => {
    const { baseSegura } = await carregar('https://w.exemplo.dev')
    expect(baseSegura('http://worker.prodio.com.br')).toBe(false)
    expect(baseSegura('http://localhost.atacante.com')).toBe(false)
    expect(baseSegura('javascript:alert(1)')).toBe(false)
    expect(baseSegura('worker.prodio.com.br')).toBe(false)
    expect(baseSegura('')).toBe(false)
  })
})

describe('chamarWorker com endereço inseguro', () => {
  it('não chega a montar a requisição: o token não sai do navegador', async () => {
    const { chamarWorker, ErroWorker } = await carregar('http://worker-de-alguem.com')
    const fetchFalso = vi.fn()
    vi.stubGlobal('fetch', fetchFalso)
    const e = (await chamarWorker('/connectors/1/test').catch((x: unknown) => x)) as InstanceType<typeof ErroWorker>
    expect(e).toBeInstanceOf(ErroWorker)
    expect(e.causa).toBe('configuracao')
    expect(e.message).toContain('https')
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})
