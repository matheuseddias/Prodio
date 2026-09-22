// Vínculo do OAuth com o navegador que começou a conexão.
//
// O PROBLEMA. O callback do OAuth (GET /connectors/:plataforma/oauth/callback) chega como uma
// navegação vinda da plataforma: não tem JWT e não tem como ter. Até aqui o único guarda era o
// `state` assinado, que diz EM QUAL CONECTOR gravar o token — mas não diz QUEM pediu. Quem fosse
// admin de um tenant qualquer (basta abrir uma conta) conseguia:
//   1. chamar /oauth/start no PRÓPRIO conector e receber a URL de autorização com o state dele;
//   2. mandar essa URL para a vítima ("autorize o Prodio a ler seus pedidos");
//   3. a vítima autoriza a CONTA DELA no Bling/Tiny e o token vai para o conector do ATACANTE.
// No Bling é pior: o app OAuth é global do Prodio, então a tela de consentimento diz "Prodio" e não
// levanta suspeita. O resultado é o atacante lendo pedidos e mexendo no estoque do ERP da vítima.
// Assinar o state não resolvia nada disso — o state do atacante é legítimo, foi ele que começou.
//
// A CORREÇÃO. O state passa a carregar um `nonce` aleatório, e o navegador que começa a conexão
// passa a guardar esse mesmo nonce num cookie do domínio do worker. O callback só grava token
// quando os dois batem. O cookie é HttpOnly e do domínio do worker: o atacante não planta cookie no
// navegador da vítima, e o link que ele mandaria chega sem cookie nenhum — o callback recusa.
//
// Para o cookie existir, a autorização deixou de ser um link direto para a plataforma:
// /oauth/start devolve uma URL do PRÓPRIO worker (/connectors/:plataforma/oauth/go?state=…). A
// janela abre nela, o worker grava o cookie e redireciona para a plataforma. Como /go e /callback
// são navegações de primeiro nível no domínio do worker, SameSite=Lax entrega o cookie na volta
// (Lax vale justamente para navegação de topo por GET) e nenhum bloqueio de cookie de terceiro
// atrapalha: dentro da janela, o worker é o site de primeiro plano.
import { hmacSha256Hex, igualConstante } from '../conectores/bling'

export const VALIDADE_STATE_MS = 10 * 60_000
export const COOKIE_VINCULO = 'prodio_oauth'

// Chave própria para assinar o state, derivada da mestra. CREDENTIALS_KEY é a senha que cifra as
// credenciais no banco; usá-la também como chave de HMAC mistura dois usos da mesma chave sem
// necessidade — o rótulo separa os domínios e sai de graça.
const ROTULO_CHAVE = 'prodio.oauth.state.v1'
export function chaveDeState(chaveMestra: string): Promise<string> {
  return hmacSha256Hex(chaveMestra, ROTULO_CHAVE)
}

export interface EstadoOauth {
  connectorId: string
  /** Quem começou a conexão. Vai no state para o log do callback dizer de quem era o fluxo. */
  userId: string
  nonce: string
  exp: number
}

const paraB64url = (s: string): string => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const deB64url = (s: string): string => atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))

export function novoNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// state = <payload base64url>.<hmac do payload>. Só campos ASCII entram (uuid, hex, número).
export async function assinarState(dados: { connectorId: string; userId: string; nonce: string }, chave: string, agora = Date.now()): Promise<string> {
  const corpo = paraB64url(JSON.stringify({ c: dados.connectorId, u: dados.userId, n: dados.nonce, exp: agora + VALIDADE_STATE_MS }))
  return `${corpo}.${await hmacSha256Hex(chave, corpo)}`
}

export async function verificarState(state: string, chave: string, agora = Date.now()): Promise<EstadoOauth | null> {
  const partes = (state ?? '').split('.')
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null
  // Comparação em tempo constante: o MAC é um segredo e a resposta é observável de fora.
  const esperado = await hmacSha256Hex(chave, partes[0])
  if (!igualConstante(esperado, partes[1])) return null
  let d: { c?: unknown; u?: unknown; n?: unknown; exp?: unknown }
  try {
    d = JSON.parse(deB64url(partes[0])) as typeof d
  } catch {
    return null
  }
  if (typeof d.c !== 'string' || !d.c || typeof d.n !== 'string' || !d.n || typeof d.exp !== 'number') return null
  // `> agora` e não `< agora`: assim NaN e Infinity também caem fora em vez de passarem.
  if (!(d.exp > agora)) return null
  return { connectorId: d.c, userId: typeof d.u === 'string' ? d.u : '', nonce: d.n, exp: d.exp }
}

// Path=/connectors cobre /oauth/go e /oauth/callback e não vaza o cookie para o resto do worker.
export function cabecalhoCookie(nonce: string | null): string {
  const base = `${COOKIE_VINCULO}=${nonce ?? ''}; Path=/connectors; HttpOnly; Secure; SameSite=Lax`
  return nonce ? `${base}; Max-Age=${Math.floor(VALIDADE_STATE_MS / 1000)}` : `${base}; Max-Age=0`
}

export function lerCookieVinculo(req: Request): string | null {
  for (const parte of (req.headers.get('Cookie') ?? '').split(';')) {
    const bruto = parte.trim()
    const corte = bruto.indexOf('=')
    if (corte > 0 && bruto.slice(0, corte) === COOKIE_VINCULO) return bruto.slice(corte + 1).trim() || null
  }
  return null
}

export function vinculoConfere(req: Request, nonce: string): boolean {
  const doCookie = lerCookieVinculo(req)
  return doCookie !== null && igualConstante(doCookie, nonce)
}
