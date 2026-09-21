import { resolverRota } from '../index'
import { silenciarLog } from '../log'
import { assinarState, filtrarPayload, verificarState } from './credenciais'
import { idDoPedido, jaVisto } from './webhooks'
import { decodificarJwt, exigirUsuario, lerBearer } from './util'
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
    expect(resolverRota('POST', `/connectors/${id}/bling/oauth/start`)?.params).toEqual([id])
    expect(resolverRota('GET', '/connectors/bling/oauth/callback')).not.toBeNull()
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
})

describe('credenciais', () => {
  it('filtra campos por plataforma', () => {
    expect(filtrarPayload('baselinker', { token: 'abc', warehouse_id: 'bl_1' })).toEqual({ token: 'abc', warehouse_id: 'bl_1' })
    expect(() => filtrarPayload('baselinker', { senha: 'x' })).toThrow(/não é aceito/)
    expect(() => filtrarPayload('baselinker', {})).toThrow(/token/)
    expect(filtrarPayload('bling', { client_id: 'a', client_secret: 'b', access_token: '' })).toEqual({ client_id: 'a', client_secret: 'b' })
  })
  it('state do OAuth é assinado, expira e aponta o conector', async () => {
    const s = await assinarState('conn-1', 'chave', 1000)
    expect(await verificarState(s, 'chave', 2000)).toBe('conn-1')
    expect(await verificarState(s, 'outra', 2000)).toBeNull()
    expect(await verificarState(s, 'chave', 1000 + 16 * 60_000)).toBeNull()
    expect(await verificarState(s.replace('conn-1', 'conn-2'), 'chave', 2000)).toBeNull()
  })
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
