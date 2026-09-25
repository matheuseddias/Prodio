// Fluxo OAuth de ponta a ponta, do ponto de vista de quem tenta abusar dele.
//
// O caso que precisa continuar barrado: um atacante que é admin de um tenant qualquer pede
// /oauth/start no PRÓPRIO conector, recebe uma URL de autorização legítima e manda para a vítima.
// A vítima autoriza a conta dela no Tiny/Bling e o provedor chama o callback com um code válido e
// o state do atacante. Sem o cookie de vínculo, o token da vítima era gravado no conector do
// atacante. Ver rotas/oauthVinculo.ts.
import type { Env } from '../env'
import type { Db } from '../db'
import { comCors } from '../cors'
import { silenciarLog } from '../log'
import { rotaOauthCallback, rotaOauthIr } from './credenciais'
import { COOKIE_VINCULO, assinarState, chaveDeState, novoNonce, verificarState } from './oauthVinculo'

silenciarLog(true)

const CONECTOR = '0f9d2c3e-1111-4222-8333-444455556666'
const CONECTOR_DO_ATACANTE = '11112222-3333-4444-8555-666677778888'
const ACCESS_DA_VITIMA = 'tiny-access-token-da-vitima'

const env = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  CREDENTIALS_KEY: 'chave-mestra',
  PUBLIC_URL: 'https://worker.prodio.app',
} as Env

function dbFalso(id = CONECTOR) {
  return {
    getConector: vi.fn(async () => ({ id, tenant_id: 't1', plataforma: 'tiny', nome: 'Tiny', status: 'desconectado', config: {}, tenants: null })),
    getCredentials: vi.fn(async () => ({ client_id: 'cid', client_secret: 'csecret' })),
    setCredentials: vi.fn(async () => {}),
    setSyncState: vi.fn(async () => {}),
    marcarCredencialNova: vi.fn(async () => {}),
  } as unknown as Db & { setCredentials: ReturnType<typeof vi.fn>; setSyncState: ReturnType<typeof vi.fn>; marcarCredencialNova: ReturnType<typeof vi.fn> }
}

const stateValido = async (id = CONECTOR, nonce = novoNonce()) => ({
  nonce,
  state: await assinarState({ connectorId: id, userId: 'u1', nonce }, await chaveDeState(env.CREDENTIALS_KEY)),
})

const irPara = (state: string) => new Request(`https://worker.prodio.app/connectors/tiny/oauth/go?state=${encodeURIComponent(state)}`)
const voltarDe = (state: string, cookie?: string) =>
  new Request(`https://worker.prodio.app/connectors/tiny/oauth/callback?code=code-da-vitima&state=${encodeURIComponent(state)}`, {
    headers: cookie ? { Cookie: cookie } : {},
  })

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ access_token: ACCESS_DA_VITIMA, refresh_token: 'refresh', expires_in: 3600 }), { status: 200 })),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /connectors/tiny/oauth/go', () => {
  it('state válido: grava o cookie de vínculo e desvia para a plataforma', async () => {
    const { state, nonce } = await stateValido()
    const res = await rotaOauthIr(irPara(state), env, 'tiny', dbFalso())
    expect(res.status).toBe(302)
    const destino = new URL(res.headers.get('Location') ?? '')
    expect(destino.searchParams.get('client_id')).toBe('cid')
    expect(destino.searchParams.get('state')).toBe(state)
    expect(destino.searchParams.get('redirect_uri')).toBe('https://worker.prodio.app/connectors/tiny/oauth/callback')
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toContain(`${COOKIE_VINCULO}=${nonce}`)
    expect(cookie).toContain('HttpOnly')
    // O client_secret monta a troca do code, mas nunca vai para a URL de consentimento.
    expect(destino.toString()).not.toContain('csecret')
  })

  it('state inventado não abre nada e não grava cookie', async () => {
    const res = await rotaOauthIr(irPara('inventado.abc'), env, 'tiny', dbFalso())
    expect(res.status).toBe(400)
    expect(res.headers.get('Location')).toBeNull()
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
})

describe('GET /connectors/tiny/oauth/callback', () => {
  it('ATAQUE: code de fora, sem o cookie do navegador que começou — recusa e não grava token', async () => {
    const db = dbFalso(CONECTOR_DO_ATACANTE)
    const { state } = await stateValido(CONECTOR_DO_ATACANTE)
    const res = await rotaOauthCallback(voltarDe(state), env, 'tiny', db)
    expect(res.status).toBe(403)
    expect(db.setCredentials).not.toHaveBeenCalled()
    expect(await res.text()).toContain('não começou neste navegador')
  })

  it('ATAQUE: cookie de outro fluxo (nonce diferente) também é recusado', async () => {
    const db = dbFalso()
    const { state } = await stateValido()
    const res = await rotaOauthCallback(voltarDe(state, `${COOKIE_VINCULO}=${novoNonce()}`), env, 'tiny', db)
    expect(res.status).toBe(403)
    expect(db.setCredentials).not.toHaveBeenCalled()
  })

  it('caminho normal: cookie bate, o token é gravado e a página não mostra segredo nenhum', async () => {
    const db = dbFalso()
    const { state, nonce } = await stateValido()
    const res = await rotaOauthCallback(voltarDe(state, `${COOKIE_VINCULO}=${nonce}`), env, 'tiny', db)
    expect(res.status).toBe(200)
    expect(db.setCredentials).toHaveBeenCalledWith('t1', CONECTOR, expect.objectContaining({ access_token: ACCESS_DA_VITIMA }))
    const html = await res.text()
    expect(html).not.toContain(ACCESS_DA_VITIMA)
    expect(html).not.toContain('csecret')
    expect(html).not.toContain('code-da-vitima')
  })

  // Autorizar não é sincronizar. Antes o callback chamava worker_set_sync_state(ok): gravava
  // ultimo_sync ("Último sync: agora") e o diário do robô, e o cartão afirmava "O robô está
  // sincronizando sozinho" sem o robô ter rodado uma vez.
  it('caminho normal: não escreve no diário do robô nem finge uma sincronização', async () => {
    const db = dbFalso()
    const { state, nonce } = await stateValido()
    await rotaOauthCallback(voltarDe(state, `${COOKIE_VINCULO}=${nonce}`), env, 'tiny', db)
    expect(db.setSyncState).not.toHaveBeenCalled()
    expect(db.marcarCredencialNova).toHaveBeenCalledWith(CONECTOR, 't1')
  })

  it('REPLAY: o cookie é apagado no fim, então o mesmo state não serve para um segundo code', async () => {
    const db = dbFalso()
    const { state, nonce } = await stateValido()
    const ok = await rotaOauthCallback(voltarDe(state, `${COOKIE_VINCULO}=${nonce}`), env, 'tiny', db)
    expect(ok.headers.get('Set-Cookie')).toContain('Max-Age=0')
    // O navegador já não tem o cookie; o state ainda é válido, mas sozinho não basta.
    const segunda = await rotaOauthCallback(voltarDe(state), env, 'tiny', db)
    expect(segunda.status).toBe(403)
    expect(db.setCredentials).toHaveBeenCalledTimes(1)
  })

  it('state de conector de outra plataforma não vale', async () => {
    const { state, nonce } = await stateValido()
    const db = dbFalso()
    const res = await rotaOauthCallback(voltarDe(state, `${COOKIE_VINCULO}=${nonce}`), env, 'bling', db)
    expect(res.status).toBe(404)
    expect(db.setCredentials).not.toHaveBeenCalled()
  })

  it('sem code, nem chega a olhar o resto', async () => {
    const db = dbFalso()
    const res = await rotaOauthCallback(new Request('https://worker.prodio.app/connectors/tiny/oauth/callback'), env, 'tiny', db)
    expect(res.status).toBe(400)
    expect(db.setCredentials).not.toHaveBeenCalled()
  })
})

describe('o envelope de CORS não pode comer o cookie', () => {
  it('comCors preserva Set-Cookie e Location do desvio', async () => {
    const { state } = await stateValido()
    const res = comCors(await rotaOauthIr(irPara(state), env, 'tiny', dbFalso()), 'https://app.prodio.com.br')
    expect(res.status).toBe(302)
    expect(res.headers.get('Set-Cookie')).toContain(COOKIE_VINCULO)
    expect(res.headers.get('Location')).toContain('state=')
  })
})

describe('a chave do state não é a que cifra credencial', () => {
  it('um state assinado com a CREDENTIALS_KEY crua não é aceito', async () => {
    const nonce = novoNonce()
    const comMestra = await assinarState({ connectorId: CONECTOR, userId: 'u1', nonce }, env.CREDENTIALS_KEY)
    expect(await verificarState(comMestra, await chaveDeState(env.CREDENTIALS_KEY))).toBeNull()
  })
})
