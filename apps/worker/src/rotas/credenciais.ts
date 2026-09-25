// Credenciais de conectores. O usuário (admin do tenant, conferido com o próprio JWT + RLS) manda o segredo;
// o worker cifra via worker_set_credentials com CREDENTIALS_KEY. Inclui os fluxos OAuth do Bling e do Tiny.
import type { Env } from '../env'
import { Db, type Credenciais } from '../db'
import { URL_BLING_AUTORIZAR, oauthTokenBling, type CredenciaisBling } from '../conectores/bling'
import { MAPA_TINY } from '../conectores/tinyMapa'
import { oauthTokenTiny } from '../conectores/tinyAuth'
import { log, mensagemErro } from '../log'
import { assinarState, cabecalhoCookie, chaveDeState, novoNonce, verificarState, vinculoConfere } from './oauthVinculo'
import { ErroRota, erro, exigirAdminDoConector, exigirUsuario, json, tratarErro } from './util'

export const CHAVES_PERMITIDAS: Record<string, string[]> = {
  baselinker: ['token'],
  bling: ['client_id', 'client_secret', 'access_token', 'refresh_token', 'expires_at'],
  tiny: ['client_id', 'client_secret', 'access_token', 'refresh_token', 'expires_at'],
  omie: ['app_key', 'app_secret'],
  magis5: ['token'],
}

// Endereçamento, não segredo: mora em `connectors.config` (RPC upsert_connector, gravada pela
// tela) e é de lá que o adaptador lê — ConfigBaseLinker em ../conectores/baselinker.ts nunca
// procura isto nas credenciais. Aceitar aqui também criaria um segundo lugar para a mesma
// informação, e o que fosse gravado cifrado nunca seria lido por ninguém. A mensagem diz isso em
// vez do genérico "campo não é aceito".
const SO_EM_CONFIG: Record<string, string[]> = { baselinker: ['inventory_id', 'warehouse_id'], tiny: ['deposito_id'] }

// Plataformas em que o segredo vem de um fluxo OAuth: gravar client_id/secret não pode apagar os tokens.
export type PlataformaOauth = 'bling' | 'tiny'
const OAUTH: PlataformaOauth[] = ['bling', 'tiny']
const ehOauth = (p: string): p is PlataformaOauth => (OAUTH as string[]).includes(p)

export function filtrarPayload(plataforma: string, corpo: unknown): Credenciais {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroRota(400, 'corpo deve ser um objeto JSON')
  const permitidas = CHAVES_PERMITIDAS[plataforma]
  if (!permitidas) throw new ErroRota(400, `plataforma ${plataforma} não suportada`)
  const saida: Credenciais = {}
  for (const [k, v] of Object.entries(corpo as Record<string, unknown>)) {
    if (SO_EM_CONFIG[plataforma]?.includes(k)) {
      throw new ErroRota(400, `campo "${k}" não é credencial: ele fica na configuração do conector, gravada pela própria tela ao conectar`)
    }
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
    // OAuth: trocar client_id/secret não deve apagar tokens já obtidos (e vice-versa).
    const atuais = ehOauth(c.plataforma) ? ((await db.getCredentials(c.id)) ?? {}) : {}
    await db.setCredentials(c.tenant_id, c.id, { ...atuais, ...payload })
    log('info', 'credenciais.gravadas', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId, campos: Object.keys(payload) })
    return json({ ok: true, campos: Object.keys(payload) })
  } catch (e) {
    return tratarErro(e)
  }
}

// Endereço público do worker.
//
// Sem PUBLIC_URL o redirect_uri virava "/connectors/tiny/oauth/callback" — um caminho relativo que
// o provedor recusa com uma mensagem dele, em inglês, sobre redirect_uri inválido. O dono ia
// procurar o erro no cadastro do aplicativo, não num segredo do worker que faltou. Falhar aqui,
// antes de mandar o usuário para a plataforma, diz o que fazer.
export function baseDoWorker(env: Env): string {
  const base = (env.PUBLIC_URL ?? '').trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(base)) {
    throw new ErroRota(500, 'o endereço público do worker (PUBLIC_URL) não está configurado: sem ele a plataforma não sabe para onde voltar depois da autorização')
  }
  return base
}

// URL de retorno do OAuth. Precisa estar cadastrada igualzinha no app da plataforma.
export function redirectUri(env: Env, plataforma: PlataformaOauth): string {
  return `${baseDoWorker(env)}/connectors/${plataforma}/oauth/callback`
}

interface DefinicaoOauth {
  nome: string
  autorizar: string
  envId?: string
  envSecret?: string
  // O Tiny (Keycloak) exige redirect_uri no consentimento e na troca do code; o Bling não.
  usaRedirect: boolean
  trocar: (app: { clientId: string; clientSecret: string }, params: Record<string, string>) => Promise<Credenciais>
}

function definicao(env: Env, plataforma: PlataformaOauth): DefinicaoOauth {
  if (plataforma === 'tiny') {
    return {
      nome: 'Tiny',
      autorizar: MAPA_TINY.autorizar,
      envId: env.TINY_CLIENT_ID,
      envSecret: env.TINY_CLIENT_SECRET,
      usaRedirect: true,
      trocar: async (app, params) => (await oauthTokenTiny(app, params)) as Credenciais,
    }
  }
  return {
    nome: 'Bling',
    autorizar: URL_BLING_AUTORIZAR,
    envId: env.BLING_CLIENT_ID,
    envSecret: env.BLING_CLIENT_SECRET,
    usaRedirect: false,
    trocar: async (app, params) => (await oauthTokenBling(app, params)) as Credenciais,
  }
}

function appDoConector(creds: CredenciaisBling | null, def: DefinicaoOauth): { clientId: string; clientSecret: string } {
  const clientId = creds?.client_id ?? def.envId
  const clientSecret = creds?.client_secret ?? def.envSecret
  if (!clientId || !clientSecret) throw new ErroRota(500, `client_id/client_secret do ${def.nome} não configurados`)
  return { clientId, clientSecret }
}

// URL de consentimento da plataforma, montada com o app do conector.
async function urlDeAutorizacao(env: Env, plataforma: PlataformaOauth, connectorId: string, state: string, db: Db): Promise<string> {
  const def = definicao(env, plataforma)
  const app = appDoConector((await db.getCredentials(connectorId)) as CredenciaisBling | null, def)
  const url = new URL(def.autorizar)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', app.clientId)
  url.searchParams.set('state', state)
  if (def.usaRedirect) url.searchParams.set('redirect_uri', redirectUri(env, plataforma))
  return url.toString()
}

// POST /connectors/:id/:plataforma/oauth/start → {url} para o admin autorizar na plataforma.
//
// A URL devolvida é do PRÓPRIO worker (/oauth/go), não da plataforma: é lá que o cookie de vínculo
// é gravado antes do desvio. Ver o cabeçalho de ./oauthVinculo.ts para o porquê. O contrato com a
// interface não muda — continua sendo { ok: true, url } para abrir numa janela.
export async function rotaOauthStart(req: Request, env: Env, connectorId: string, plataforma: PlataformaOauth, db = new Db(env)): Promise<Response> {
  try {
    const u = exigirUsuario(req, env)
    const c = await exigirAdminDoConector(u, connectorId)
    if (c.plataforma !== plataforma) return erro(400, `este conector não é ${definicao(env, plataforma).nome}`)
    // PUBLIC_URL e client_id/secret são conferidos AGORA, com o admin olhando a tela, e não lá na
    // frente dentro da janela de autorização: erro de configuração precisa aparecer onde dá para
    // consertar, com o texto nosso.
    const base = baseDoWorker(env)
    appDoConector((await db.getCredentials(c.id)) as CredenciaisBling | null, definicao(env, plataforma))
    const state = await assinarState({ connectorId: c.id, userId: u.userId, nonce: novoNonce() }, await chaveDeState(env.CREDENTIALS_KEY))
    return json({ ok: true, url: `${base}/connectors/${plataforma}/oauth/go?state=${encodeURIComponent(state)}` })
  } catch (e) {
    return tratarErro(e)
  }
}

// GET /connectors/:plataforma/oauth/go?state= — grava o cookie de vínculo e desvia para a plataforma.
//
// Roda sem JWT (é navegação de janela, não fetch), e o que a autoriza é o próprio state assinado:
// só /oauth/start emite um, e /oauth/start exige admin do tenant do conector.
export async function rotaOauthIr(req: Request, env: Env, plataforma: PlataformaOauth, db = new Db(env)): Promise<Response> {
  const def = definicao(env, plataforma)
  const state = new URL(req.url).searchParams.get('state') ?? ''
  const st = await verificarState(state, await chaveDeState(env.CREDENTIALS_KEY))
  if (!st) return pagina(400, 'Link de autorização expirado ou inválido. Volte ao Prodio e comece a conexão de novo.')
  try {
    const row = await db.getConector(st.connectorId)
    if (!row || row.plataforma !== plataforma) return pagina(404, 'Conector não encontrado.')
    const destino = await urlDeAutorizacao(env, plataforma, row.id, state, db)
    log('info', 'oauth.inicio', { plataforma, connector: row.id, tenant: row.tenant_id, user: st.userId })
    return new Response(null, {
      status: 302,
      headers: { Location: destino, 'Set-Cookie': cabecalhoCookie(st.nonce), 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    log('error', 'oauth.inicio.falha', { plataforma, connector: st.connectorId, erro: mensagemErro(e) })
    return pagina(502, e instanceof ErroRota ? e.message : `Não foi possível começar a conexão com o ${def.nome}. Tente de novo.`)
  }
}

const AVISO_SEM_VINCULO =
  'Esta autorização não começou neste navegador. Por segurança o Prodio não grava um acesso vindo de um link de fora: ' +
  'abra o Prodio, vá em Sistema &gt; Conectores e clique em Conectar de novo.'

// GET /connectors/:plataforma/oauth/callback?code=&state= — troca o code por tokens e grava cifrado.
export async function rotaOauthCallback(req: Request, env: Env, plataforma: PlataformaOauth, db = new Db(env)): Promise<Response> {
  const def = definicao(env, plataforma)
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') ?? ''
  if (!code) return pagina(400, 'Autorização recusada ou sem código.')
  const st = await verificarState(state, await chaveDeState(env.CREDENTIALS_KEY))
  if (!st) return pagina(400, 'Link expirado ou inválido. Recomece a conexão no Prodio.')
  // O guarda que impede o code de um estranho virar token no conector de outra pessoa: o nonce do
  // state tem de bater com o cookie que /oauth/go gravou no navegador que começou o fluxo.
  if (!vinculoConfere(req, st.nonce)) {
    log('warn', 'oauth.semVinculo', { plataforma, connector: st.connectorId, user: st.userId })
    return pagina(403, AVISO_SEM_VINCULO)
  }
  try {
    const row = await db.getConector(st.connectorId)
    if (!row || row.plataforma !== plataforma) return pagina(404, 'Conector não encontrado.')
    const atuais = ((await db.getCredentials(row.id)) ?? {}) as CredenciaisBling
    const app = appDoConector(atuais, def)
    const params: Record<string, string> = { grant_type: 'authorization_code', code }
    if (def.usaRedirect) params.redirect_uri = redirectUri(env, plataforma)
    const tokens = await def.trocar(app, params)
    await db.setCredentials(row.tenant_id, row.id, { ...atuais, ...tokens } as Credenciais)
    // Credencial nova: o erro antigo deixa de valer. NÃO é sincronização — antes isto chamava
    // worker_set_sync_state(ok), que gravava ultimo_sync e o diário do robô (sync_state) sem pedido
    // nenhum lido, e o cartão dizia "O robô está sincronizando sozinho" logo depois de conectar.
    await db.marcarCredencialNova(row.id, row.tenant_id)
    log('info', 'oauth.ok', { plataforma, connector: row.id, tenant: row.tenant_id, user: st.userId })
    return pagina(200, `${def.nome} conectado. Pode fechar esta janela e voltar ao Prodio.`, true)
  } catch (e) {
    log('error', 'oauth.falha', { plataforma, connector: st.connectorId, erro: mensagemErro(e) })
    // ErroRota é texto nosso, escrito para quem está na tela (ex.: PUBLIC_URL faltando). O resto
    // é mensagem de dentro do worker e fica só no log.
    return pagina(502, e instanceof ErroRota ? e.message : `Não foi possível concluir a conexão com o ${def.nome}. Tente de novo.`)
  }
}

// A modal que abriu esta janela percebe a volta pelo fechamento dela (não dá para conversar entre
// origens diferentes sem postMessage, e o `opener` some se o provedor navegar em cima). Então a
// página de sucesso se fecha sozinha: `window.close()` vale para janela aberta por script, que é o
// caso do popup do OAuth. Quando o popup foi bloqueado e o dono abriu o link numa aba comum, o
// navegador ignora o close — por isso o texto continua ali, e a modal tem o botão manual.
//
// Toda página aqui é o fim do fluxo (deu certo ou não), então ela apaga o cookie de vínculo: um
// nonce que sobrasse no navegador só serviria para um segundo callback aproveitar carona.
function pagina(status: number, texto: string, fecharSozinha = false): Response {
  const fechar = fecharSozinha ? '<script>setTimeout(function(){try{window.close()}catch(e){}},1200)</script>' : ''
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prodio</title><body style="font-family:system-ui;padding:2rem"><p>${texto}</p>${fechar}</body></html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': cabecalhoCookie(null), 'Cache-Control': 'no-store' },
  })
}
