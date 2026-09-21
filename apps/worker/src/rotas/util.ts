// Utilidades das rotas HTTP: respostas JSON, leitura do JWT do usuário, cliente que age como ele.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../env'
import { criarClienteUsuario } from '../db'

export class ErroRota extends Error {
  status: number
  constructor(status: number, mensagem: string) {
    super(mensagem)
    this.name = 'ErroRota'
    this.status = status
  }
}

export function json(dados: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } })
}

export function erro(status: number, mensagem: string): Response {
  return json({ ok: false, erro: mensagem }, status)
}

export function lerBearer(req: Request): string | null {
  const h = req.headers.get('Authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

function base64UrlParaTexto(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
}

export interface ClaimsJwt {
  sub?: string
  exp?: number
  role?: string
  app_metadata?: { tenant_id?: string; role?: string }
}

// Só decodifica (sem verificar): quem valida a assinatura é o Supabase quando o cliente do usuário chama o banco.
export function decodificarJwt(jwt: string): ClaimsJwt | null {
  const partes = jwt.split('.')
  if (partes.length !== 3) return null
  try {
    return JSON.parse(base64UrlParaTexto(partes[1])) as ClaimsJwt
  } catch {
    return null
  }
}

export interface Usuario {
  jwt: string
  userId: string
  tenantId: string | null
  sb: SupabaseClient
}

// Exige Authorization: Bearer <JWT>. O tenant vem da claim app_metadata.tenant_id (hook de token).
export function exigirUsuario(req: Request, env: Env): Usuario {
  const jwt = lerBearer(req)
  if (!jwt) throw new ErroRota(401, 'informe o token do usuário (Authorization: Bearer)')
  const claims = decodificarJwt(jwt)
  if (!claims?.sub || claims.role !== 'authenticated') throw new ErroRota(401, 'token inválido')
  if (claims.exp && claims.exp * 1000 < Date.now()) throw new ErroRota(401, 'token expirado')
  if (!env.SUPABASE_ANON_KEY) throw new ErroRota(500, 'SUPABASE_ANON_KEY não configurada')
  return { jwt, userId: claims.sub, tenantId: claims.app_metadata?.tenant_id ?? null, sb: criarClienteUsuario(env, jwt) }
}

// Confere, como o próprio usuário (RLS), que ele é admin do tenant do conector. Devolve o conector.
export async function exigirAdminDoConector(u: Usuario, connectorId: string): Promise<{ id: string; tenant_id: string; plataforma: string }> {
  const r = await u.sb.from('connectors').select('id, tenant_id, plataforma').eq('id', connectorId).maybeSingle()
  if (r.error) throw new ErroRota(502, `banco: ${r.error.message}`)
  if (!r.data) throw new ErroRota(404, 'conector não encontrado neste tenant')
  const papel = await u.sb.rpc('current_member_role')
  if (papel.error) throw new ErroRota(502, `banco: ${papel.error.message}`)
  if (papel.data !== 'admin') throw new ErroRota(403, 'só o administrador altera credenciais')
  return r.data as { id: string; tenant_id: string; plataforma: string }
}

export function tratarErro(e: unknown): Response {
  if (e instanceof ErroRota) return erro(e.status, e.message)
  return erro(500, e instanceof Error ? e.message : 'erro interno')
}
