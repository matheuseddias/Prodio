import { metodosDaRota, resolverRota } from '../index'
import { silenciarLog } from '../log'
import { filtrarPayload, redirectUri } from './credenciais'
import { idDoPedido, jaVisto } from './webhooks'
import { ErroRota, decodificarJwt, exigirAdminDoConector, exigirUsuario, lerBearer, tratarErro, type Usuario } from './util'
import type { Env } from '../env'

silenciarLog(true)

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.assinatura`

describe('roteador', () => {
  it('casa as rotas e extrai o id', () => {
    const id = '0f9d2c3e-1111-4222-8333-444455556666'
    expect(resolverRota('GET', '/health')).not.toBeNull()
    expect(resolverRota('POST', `/webhooks/bling/${id}`)?.params).toEqual([id])
    expect(resolverRota('POST', `/connectors/${id}/credentials`)?.params).toEqual([id])
    expect(resolverRota('POST', `/connectors/${id}/test`)?.params).toEqual([id])
    expect(resolverRota('GET', `/connectors/${id}/test`)).toBeNull()
    expect(metodosDaRota(`/connectors/${id}/test`)).toEqual(['POST'])
    expect(metodosDaRota('/health')).toEqual(['GET'])
    expect(metodosDaRota('/nao-existe')).toEqual([])
    expect(resolverRota('POST', `/connectors/${id}/bling/oauth/start`)?.params).toEqual([id, 'bling'])
    expect(resolverRota('POST', `/connectors/${id}/tiny/oauth/start`)?.params).toEqual([id, 'tiny'])
    expect(resolverRota('POST', `/connectors/${id}/omie/oauth/start`)).toBeNull()
    expect(resolverRota('GET', '/connectors/bling/oauth/callback')?.params).toEqual(['bling'])
    expect(resolverRota('GET', '/connectors/tiny/oauth/callback')?.params).toEqual(['tiny'])
    expect(resolverRota('POST', '/nfe/xml')).not.toBeNull()
    expect(resolverRota('GET', '/nfe/xml')).toBeNull()
    expect(resolverRota('POST', '/webhooks/bling/nao-uuid')).toBeNull()
  })
})

describe('JWT do usuário', () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' } as Env
  it('lê Bearer e as claims de tenant', () => {
    const t = jwt({ sub: 'u1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60, app_metadata: { tenant_id: 't1', role: 'admin' } })
    const req = new Request('https://w/nfe/xml', { headers: { Authorization: `Bearer ${t}` } })
    expect(lerBearer(req)).toBe(t)
    expect(decodificarJwt(t)?.app_metadata?.tenant_id).toBe('t1')
    const u = exigirUsuario(req, env)
    expect(u).toMatchObject({ userId: 'u1', tenantId: 't1' })
  })
  it('rejeita sem token, expirado ou não autenticado', () => {
    expect(() => exigirUsuario(new Request('https://w/'), env)).toThrow(/Bearer/)
    const vencido = jwt({ sub: 'u1', role: 'authenticated', exp: 1 })
    expect(() => exigirUsuario(new Request('https://w/', { headers: { Authorization: `Bearer ${vencido}` } }), env)).toThrow(/expirado/)
    const anon = jwt({ sub: 'u1', role: 'anon', exp: Math.floor(Date.now() / 1000) + 60 })
    expect(() => exigirUsuario(new Request('https://w/', { headers: { Authorization: `Bearer ${anon}` } }), env)).toThrow(/inválido/)
  })

  // A sessão anônima do aparelho do chão também tem role 'authenticated'. Ela é legítima em
  // /nfe/xml (o papel 'dispositivo' grava NF-e), então exigirUsuario a aceita e quem barra é
  // exigirAdminDoConector — por isso a marca precisa chegar até lá.
  it('marca a sessão anônima do aparelho do chão', () => {
    const base = { sub: 'u1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60, app_metadata: { tenant_id: 't1' } }
    const aparelho = jwt({ ...base, is_anonymous: true })
    expect(exigirUsuario(new Request('https://w/', { headers: { Authorization: `Bearer ${aparelho}` } }), env).anonimo).toBe(true)
    expect(exigirUsuario(new Request('https://w/', { headers: { Authorization: `Bearer ${jwt(base)}` } }), env).anonimo).toBe(false)
  })
})

describe('exigirAdminDoConector', () => {
  it('recusa o aparelho do chão antes de qualquer consulta', async () => {
    const espiao = vi.fn()
    const u = { anonimo: true, userId: 'u1', jwt: 'x', tenantId: 't1', sb: { from: espiao, rpc: espiao } } as unknown as Usuario
    await expect(exigirAdminDoConector(u, '0f9d2c3e-1111-4222-8333-444455556666')).rejects.toMatchObject({ status: 403 })
    expect(espiao).not.toHaveBeenCalled()
  })
})

describe('tratarErro', () => {
  it('mensagem nossa passa; mensagem interna vira "erro interno"', async () => {
    const nossa = tratarErro(new ErroRota(403, 'só o administrador mexe em conectores'))
    expect(nossa.status).toBe(403)
    expect(await nossa.json()).toEqual({ ok: false, erro: 'só o administrador mexe em conectores' })

    const interna = tratarErro(new Error('permission denied for function worker_set_credentials'))
    expect(interna.status).toBe(500)
    const corpo = await interna.text()
    expect(JSON.parse(corpo)).toEqual({ ok: false, erro: 'erro interno' })
    expect(corpo).not.toContain('permission denied')
  })
})

describe('credenciais', () => {
  it('filtra campos por plataforma', () => {
    expect(filtrarPayload('baselinker', { token: 'abc' })).toEqual({ token: 'abc' })
    expect(() => filtrarPayload('baselinker', { senha: 'x' })).toThrow(/não é aceito/)
    expect(() => filtrarPayload('baselinker', {})).toThrow(/token/)
    expect(filtrarPayload('bling', { client_id: 'a', client_secret: 'b', access_token: '' })).toEqual({ client_id: 'a', client_secret: 'b' })
    expect(filtrarPayload('tiny', { client_id: 'a', client_secret: 'b' })).toEqual({ client_id: 'a', client_secret: 'b' })
    expect(() => filtrarPayload('tiny', { token: 'x' })).toThrow(/não é aceito/)
  })
  // inventory_id/warehouse_id moram em connectors.config e só lá: o adaptador lê de row.config.
  // Se um dia alguém os aceitar de volta aqui, existem dois lugares para a mesma informação e o
  // que for gravado cifrado nunca será lido.
  it('endereçamento do BaseLinker é recusado como credencial, dizendo onde ele mora', () => {
    expect(() => filtrarPayload('baselinker', { token: 'abc', warehouse_id: 'bl_1' })).toThrow(/não é credencial/)
    expect(() => filtrarPayload('baselinker', { token: 'abc', inventory_id: '42' })).toThrow(/configuração do conector/)
  })
  it('sem PUBLIC_URL o OAuth falha aqui, com texto nosso, em vez de mandar redirect_uri relativo', () => {
    expect(redirectUri({ PUBLIC_URL: 'https://w.prodio.app/' } as Env, 'tiny')).toBe('https://w.prodio.app/connectors/tiny/oauth/callback')
    expect(() => redirectUri({} as Env, 'tiny')).toThrow(/PUBLIC_URL/)
    expect(() => redirectUri({ PUBLIC_URL: 'worker.prodio.app' } as Env, 'tiny')).toThrow(/PUBLIC_URL/)
  })
  // O state do OAuth mudou de forma e de guarda: os testes dele estão em ./oauthVinculo.test.ts
  // (assinatura, validade, nonce) e ./oauth.test.ts (as rotas /oauth/go e /oauth/callback).
})

describe('webhook Bling', () => {
  it('dedupe por eventId em memória', () => {
    expect(jaVisto('ev-1')).toBe(false)
    expect(jaVisto('ev-1')).toBe(true)
    expect(jaVisto(undefined)).toBe(false)
  })
  it('acha o id do pedido em formatos diferentes', () => {
    expect(idDoPedido({ data: { id: 42 } })).toBe('42')
    expect(idDoPedido({ data: { pedido: { id: 7 } } })).toBe('7')
    expect(idDoPedido({ data: {} })).toBeNull()
  })
})
