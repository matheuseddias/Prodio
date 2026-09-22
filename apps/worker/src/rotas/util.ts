// Utilidades das rotas HTTP: respostas JSON, leitura do JWT do usuário, cliente que age como ele.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../env'
import { criarClienteUsuario } from '../db'
import { log, mensagemErro } from '../log'

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
  // Sessão anônima: o aparelho do chão de fábrica (supabase.auth.signInAnonymously). O role dela
  // também é 'authenticated', então só esta claim separa o tablet da mesa de corte de uma pessoa.
  is_anonymous?: boolean
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
  /** Sessão anônima de aparelho do chão. Pode mandar NF-e; não mexe em conector. */
  anonimo: boolean
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
  return { jwt, userId: claims.sub, tenantId: claims.app_metadata?.tenant_id ?? null, anonimo: claims.is_anonymous === true, sb: criarClienteUsuario(env, jwt) }
}

export interface ConectorAutorizado {
  id: string
  tenant_id: string
  plataforma: string
  nome: string
  status: string
  config: Record<string, unknown> | null
}

// Confere, como o próprio usuário (RLS), que ele é admin do tenant do conector. Devolve o conector.
// `config` vem junto porque o teste de conexão monta o adaptador com ele — lido como o usuário,
// não com service role.
export async function exigirAdminDoConector(u: Usuario, connectorId: string): Promise<ConectorAutorizado> {
  // O banco já barraria (register_device só dá o papel 'dispositivo', e a exigência abaixo é
  // 'admin'), mas o JWT de aparelho é o que mais circula: fica num tablet destravado no chão de
  // fábrica, aceso o dia inteiro. Recusar antes de qualquer consulta é uma linha e tira o tablet
  // da lista de coisas que podem mexer em credencial de plataforma.
  if (u.anonimo) throw new ErroRota(403, 'aparelho do chão de fábrica não mexe em conectores; entre com a conta de um administrador')
  const r = await u.sb.from('connectors').select('id, tenant_id, plataforma, nome, status, config').eq('id', connectorId).maybeSingle()
  // Mensagem do Postgres fica no log (wrangler tail), não na tela: descreve o lado de dentro.
  if (r.error) {
    log('error', 'conector.consulta', { connector: connectorId, user: u.userId, erro: r.error.message })
    throw new ErroRota(502, 'não foi possível consultar o conector agora; tente de novo')
  }
  if (!r.data) throw new ErroRota(404, 'conector não encontrado neste tenant')
  const papel = await u.sb.rpc('current_member_role')
  if (papel.error) {
    log('error', 'conector.papel', { connector: connectorId, user: u.userId, erro: papel.error.message })
    throw new ErroRota(502, 'não foi possível confirmar o seu papel neste tenant; tente de novo')
  }
  if (papel.data !== 'admin') throw new ErroRota(403, 'só o administrador mexe em conectores')
  return r.data as ConectorAutorizado
}

// ErroRota são mensagens escritas por nós, para o usuário: passam. Qualquer outra exceção vira
// "erro interno" — a mensagem crua (do Postgres, do fetch, de um JSON.parse) fica só no log,
// porque descreve o lado de dentro do worker e não ajuda quem está na tela.
export function tratarErro(e: unknown, evento = 'rota.erro'): Response {
  if (e instanceof ErroRota) return erro(e.status, e.message)
  log('error', evento, { erro: mensagemErro(e) })
  return erro(500, 'erro interno')
}
