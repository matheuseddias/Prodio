// CORS do worker.
//
// As rotas acionadas pelo navegador recebem "Authorization: Bearer <JWT do usuário>". Por isso
// Access-Control-Allow-Origin NUNCA é "*": devolvemos a origem exata que chamou e só quando ela
// está na lista. Com "*" e credencial de portador, qualquer site aberto na mesma máquina poderia
// chamar o worker com o token de quem está logado no Prodio.
//
// A lista vem da variável CORS_ORIGENS (ver README do worker e docs/deploy-web.md), separada por
// vírgula. Cada item é uma origem exata (`https://app.prodio.com.br`) ou um curinga de subdomínio
// (`https://*.prodio-web.pages.dev`), que existe porque cada publicação do Cloudflare Pages ganha
// um endereço novo com hash.
//
// Não mandamos Access-Control-Allow-Credentials: o token vai no header, não em cookie. Sem esse
// cabeçalho o navegador nem envia cookie nem sessão junto, o que é exatamente o que queremos.
import { log } from './log'

// Só o que a interface manda: o JWT e o tipo do corpo (JSON, XML ou multipart do upload de NF-e).
export const CABECALHOS_PERMITIDOS = 'Authorization, Content-Type'
export const MAX_AGE_PREFLIGHT = '86400'

// Sem CORS_ORIGENS configurada, só o desenvolvimento local passa: publicar o worker sem configurar
// nada não abre o worker para origem nenhuma da internet.
export const ORIGENS_PADRAO = ['http://localhost:5173', 'http://localhost:4173']

export function lerOrigensPermitidas(bruto: string | undefined): string[] {
  const itens = (bruto ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return itens.length ? itens : [...ORIGENS_PADRAO]
}

const CURINGA = '://*.'

// Sufixos compartilhados: qualquer pessoa cria um site debaixo deles de graça, em minutos. Um
// curinga sobre um sufixo desses (`https://*.pages.dev` em vez de
// `https://*.prodio-web.pages.dev`) não é uma lista de origens, é o mundo inteiro — e como estas
// rotas recebem o JWT do usuário, valeria tanto quanto Allow-Origin "*". É um erro de digitação
// plausível no `wrangler secret put`, então o worker recusa o padrão em vez de confiar em revisão.
// Domínio próprio pode ser curinga normalmente (`https://*.prodio.com.br`): a lista é só de
// sufixos onde o cadastro é aberto a estranhos.
const SUFIXOS_COMPARTILHADOS = ['pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'github.io', 'herokuapp.com', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com']

export function curingaAmploDemais(hostnameBase: string): boolean {
  return SUFIXOS_COMPARTILHADOS.includes(hostnameBase)
}

// Compara origem por partes (protocolo + host + porta), nunca por texto solto. O curinga casa
// rótulo inteiro de host: `https://*.prodio-web.pages.dev` aceita `https://abc.prodio-web.pages.dev`
// e recusa `https://prodio-web.pages.dev.invasor.com` e `https://maliciosoprodio-web.pages.dev`
// — que um `includes`/`endsWith` no texto da origem deixaria passar.
export function origemCasa(origem: string, padrao: string): boolean {
  const curinga = padrao.includes(CURINGA)
  let o: URL
  let p: URL
  try {
    o = new URL(origem)
    p = new URL(curinga ? padrao.replace(CURINGA, '://') : padrao)
  } catch {
    return false
  }
  if (curinga && curingaAmploDemais(p.hostname)) {
    log('error', 'cors.curingaAmploDemais', { padrao, sufixo: p.hostname })
    return false
  }
  if (o.protocol !== p.protocol || o.port !== p.port) return false
  return curinga ? o.hostname.endsWith(`.${p.hostname}`) : o.hostname === p.hostname
}

// Devolve a origem normalizada quando permitida, senão null. Normalizar evita ecoar de volta um
// header esquisito de cliente que não é navegador.
export function origemPermitida(origemBruta: string | null, origens: string[]): string | null {
  if (!origemBruta) return null
  if (!origens.some((p) => origemCasa(origemBruta, p))) {
    log('warn', 'cors.origemRecusada', { origem: origemBruta })
    return null
  }
  try {
    return new URL(origemBruta).origin
  } catch {
    return null
  }
}

// Acrescenta os cabeçalhos de CORS a uma resposta já pronta. Origem fora da lista (ou requisição
// sem Origin, como webhook e cron) não recebe cabeçalho nenhum.
export function comCors(res: Response, origem: string | null): Response {
  if (res.headers.has('Access-Control-Allow-Origin')) return res // /health já responde aberto
  const headers = new Headers(res.headers)
  headers.append('Vary', 'Origin')
  if (origem) headers.set('Access-Control-Allow-Origin', origem)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// Métodos anunciados quando o caminho não existe neste worker: o preflight passa e a requisição
// real volta 404 com a explicação (ver o comentário em index.ts).
const METODOS_PADRAO = ['GET', 'POST']

// Resposta do preflight (OPTIONS).
//
// Origem não permitida recebe 204 SEM cabeçalho de CORS, de propósito — e não 403. Sem
// Allow-Origin o navegador diz "No 'Access-Control-Allow-Origin' header is present on the
// requested resource", que aponta direto para o problema (origem faltando na lista). Com 403 o
// console fala em "response to preflight request doesn't pass access control check: it does not
// have HTTP ok status" e esconde a causa. Nos dois casos a requisição real não sai do navegador.
export function respostaPreflight(origem: string | null, metodos: string[]): Response {
  const headers = new Headers({ Vary: 'Origin' })
  if (origem) {
    headers.set('Access-Control-Allow-Origin', origem)
    headers.set('Access-Control-Allow-Methods', [...new Set([...(metodos.length ? metodos : METODOS_PADRAO), 'OPTIONS'])].join(', '))
    headers.set('Access-Control-Allow-Headers', CABECALHOS_PERMITIDOS)
    headers.set('Access-Control-Max-Age', MAX_AGE_PREFLIGHT)
  }
  return new Response(null, { status: 204, headers })
}
