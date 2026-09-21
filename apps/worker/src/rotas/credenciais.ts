// Credenciais de conectores. O usuário (admin do tenant, conferido com o próprio JWT + RLS) manda o segredo;
// o worker cifra via worker_set_credentials com CREDENTIALS_KEY. Inclui o fluxo OAuth do Bling.
import type { Env } from '../env'
import { Db, type Credenciais } from '../db'
import { URL_BLING_AUTORIZAR, hmacSha256Hex, oauthTokenBling, type CredenciaisBling } from '../conectores/bling'
import { log, mensagemErro } from '../log'
import { ErroRota, erro, exigirAdminDoConector, exigirUsuario, json, tratarErro } from './util'

const CHAVES_PERMITIDAS: Record<string, string[]> = {
  baselinker: ['token', 'inventory_id', 'warehouse_id'],
  bling: ['client_id', 'client_secret', 'access_token', 'refresh_token', 'expires_at'],
  tiny: ['token'],
  omie: ['app_key', 'app_secret'],
  magis5: ['token'],
}

export function filtrarPayload(plataforma: string, corpo: unknown): Credenciais {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroRota(400, 'corpo deve ser um objeto JSON')
  const permitidas = CHAVES_PERMITIDAS[plataforma]
  if (!permitidas) throw new ErroRota(400, `plataforma ${plataforma} não suportada`)
  const saida: Credenciais = {}
  for (const [k, v] of Object.entries(corpo as Record<string, unknown>)) {
    if (!permitidas.includes(k)) throw new ErroRota(400, `campo "${k}" não é aceito para ${plataforma}`)
    if (v === null || v === undefined || v === '') continue
    if (typeof v !== 'string' && typeof v !== 'number') throw new ErroRota(400, `campo "${k}" deve ser texto`)
    saida[k] = v
  }
  if (plataforma === 'baselinker' && !saida.token) throw new ErroRota(400, 'informe o token do BaseLinker')
  if (Object.keys(saida).length === 0) throw new ErroRota(400, 'nenhuma credencial informada')
  return saida
}

// POST /connectors/:id/credentials
export async function rotaSetCredentials(req: Request, env: Env, connectorId: string, db = new Db(env)): Promise<Response> {
  try {
    const u = exigirUsuario(req, env)
    const c = await exigirAdminDoConector(u, connectorId)
    const payload = filtrarPayload(c.plataforma, await req.json().catch(() => null))
    // Bling: trocar client_id/secret não deve apagar tokens já obtidos (e vice-versa).
    const atuais = c.plataforma === 'bling' ? ((await db.getCredentials(c.id)) ?? {}) : {}
    await db.setCredentials(c.tenant_id, c.id, { ...atuais, ...payload })
    log('info', 'credenciais.gravadas', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId, campos: Object.keys(payload) })
    return json({ ok: true, campos: Object.keys(payload) })
  } catch (e) {
    return tratarErro(e)
  }
}

// state assinado: <connectorId>.<expira>.<hmac> — impede que um code alheio grave tokens em outro conector.
const VALIDADE_STATE_MS = 15 * 60_000
export async function assinarState(connectorId: string, chave: string, agora = Date.now()): Promise<string> {
  const exp = agora + VALIDADE_STATE_MS
  const mac = await hmacSha256Hex(chave, `${connectorId}.${exp}`)
  return `${connectorId}.${exp}.${mac}`
}
export async function verificarState(state: string, chave: string, agora = Date.now()): Promise<string | null> {
  const [connectorId, expTxt, mac] = state.split('.')
  if (!connectorId || !expTxt || !mac) return null
  if (Number(expTxt) < agora) return null
  const esperado = await hmacSha256Hex(chave, `${connectorId}.${expTxt}`)
  return esperado === mac ? connectorId : null
}

function appDoConector(creds: CredenciaisBling | null, env: Env): { clientId: string; clientSecret: string } {
  const clientId = creds?.client_id ?? env.BLING_CLIENT_ID
  const clientSecret = creds?.client_secret ?? env.BLING_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new ErroRota(500, 'client_id/client_secret do Bling não configurados')
  return { clientId, clientSecret }
}

// POST /connectors/:id/bling/oauth/start → {url} para o admin autorizar no Bling.
export async function rotaOauthStart(req: Request, env: Env, connectorId: string, db = new Db(env)): Promise<Response> {
  try {
    const u = exigirUsuario(req, env)
    const c = await exigirAdminDoConector(u, connectorId)
    if (c.plataforma !== 'bling') return erro(400, 'OAuth só se aplica ao Bling')
    const app = appDoConector((await db.getCredentials(c.id)) as CredenciaisBling | null, env)
    const state = await assinarState(c.id, env.CREDENTIALS_KEY)
    const url = new URL(URL_BLING_AUTORIZAR)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', app.clientId)
    url.searchParams.set('state', state)
    return json({ ok: true, url: url.toString() })
  } catch (e) {
    return tratarErro(e)
  }
}

// GET /connectors/bling/oauth/callback?code=&state= — troca o code por tokens e grava cifrado.
export async function rotaOauthCallback(req: Request, env: Env, db = new Db(env)): Promise<Response> {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  if (!code) return pagina(400, 'Autorização recusada ou sem código.')
  const connectorId = await verificarState(state, env.CREDENTIALS_KEY)
  if (!connectorId) return pagina(400, 'Link expirado ou inválido. Recomece a conexão no Prodio.')
  try {
    const row = await db.getConector(connectorId)
    if (!row || row.plataforma !== 'bling') return pagina(404, 'Conector não encontrado.')
    const atuais = ((await db.getCredentials(row.id)) ?? {}) as CredenciaisBling
    const app = appDoConector(atuais, env)
    const tokens = await oauthTokenBling(app, { grant_type: 'authorization_code', code })
    await db.setCredentials(row.tenant_id, row.id, { ...atuais, ...tokens } as Credenciais)
    await db.setSyncState(row.id, null, true, null)
    log('info', 'bling.oauth.ok', { connector: row.id, tenant: row.tenant_id })
    return pagina(200, 'Bling conectado. Pode fechar esta janela e voltar ao Prodio.')
  } catch (e) {
    log('error', 'bling.oauth.falha', { connector: connectorId, erro: mensagemErro(e) })
    return pagina(502, 'Não foi possível concluir a conexão com o Bling. Tente de novo.')
  }
}

function pagina(status: number, texto: string): Response {
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prodio</title><body style="font-family:system-ui;padding:2rem"><p>${texto}</p></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
