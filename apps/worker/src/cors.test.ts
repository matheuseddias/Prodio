import worker from './index'
import type { Env } from './env'
import { ORIGENS_PADRAO, comCors, lerOrigensPermitidas, origemCasa, origemPermitida } from './cors'
import { silenciarLog } from './log'

silenciarLog(true)

const PAGES = 'https://prodio-web.pages.dev'
const APP = 'https://app.prodio.com.br'
const PREVIEW = 'https://40c39f1e.prodio-web.pages.dev'
const LISTA = `${PAGES}, ${APP}, http://localhost:5173, https://*.prodio-web.pages.dev`

const env = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_KEY: 'service',
  SUPABASE_ANON_KEY: 'anon',
  CREDENTIALS_KEY: 'chave',
  CORS_ORIGENS: LISTA,
} as Env

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext
const ID = '0f9d2c3e-1111-4222-8333-444455556666'

const chamar = (metodo: string, caminho: string, origem?: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://worker.prodio.app${caminho}`, { method: metodo, headers: { ...(origem ? { Origin: origem } : {}), ...headers } }), env, ctx)

describe('lista de origens', () => {
  it('lê a variável separada por vírgula e cai no localhost quando vazia', () => {
    expect(lerOrigensPermitidas(LISTA)).toEqual([PAGES, APP, 'http://localhost:5173', 'https://*.prodio-web.pages.dev'])
    expect(lerOrigensPermitidas(undefined)).toEqual(ORIGENS_PADRAO)
    expect(lerOrigensPermitidas('   ')).toEqual(ORIGENS_PADRAO)
  })

  it('casa origem exata comparando protocolo, host e porta', () => {
    expect(origemCasa(APP, APP)).toBe(true)
    expect(origemCasa('http://app.prodio.com.br', APP)).toBe(false) // http não é https
    expect(origemCasa('https://app.prodio.com.br:8443', APP)).toBe(false)
    expect(origemCasa('http://localhost:5174', 'http://localhost:5173')).toBe(false)
    expect(origemCasa('https://outra.com', APP)).toBe(false)
    expect(origemCasa('nem-url', APP)).toBe(false)
  })

  it('curinga casa rótulo inteiro de host, não sufixo de texto', () => {
    const p = 'https://*.prodio-web.pages.dev'
    expect(origemCasa(PREVIEW, p)).toBe(true)
    expect(origemCasa('https://branch.prodio-web.pages.dev', p)).toBe(true)
    // As três armadilhas de um endsWith/includes ingênuo:
    expect(origemCasa('https://prodio-web.pages.dev.invasor.com', p)).toBe(false)
    expect(origemCasa('https://maliciosoprodio-web.pages.dev', p)).toBe(false)
    expect(origemCasa('http://abc.prodio-web.pages.dev', p)).toBe(false)
  })

  it('devolve a origem normalizada só quando permitida', () => {
    const origens = lerOrigensPermitidas(LISTA)
    expect(origemPermitida(PREVIEW, origens)).toBe(PREVIEW)
    expect(origemPermitida(`${APP}/`, origens)).toBe(APP) // Origin não tem caminho: normaliza
    expect(origemPermitida('https://site-do-mal.com', origens)).toBeNull()
    expect(origemPermitida(null, origens)).toBeNull()
  })

  it('comCors não duplica Allow-Origin de quem já respondeu aberto', () => {
    const aberta = new Response('{}', { headers: { 'Access-Control-Allow-Origin': '*' } })
    expect(comCors(aberta, APP).headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('preflight (OPTIONS)', () => {
  it('origem permitida recebe a origem exata, os métodos e os cabeçalhos', async () => {
    const res = await chamar('OPTIONS', `/connectors/${ID}/test`, PREVIEW, { 'Access-Control-Request-Method': 'POST' })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PREVIEW)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
    expect(res.headers.get('Vary')).toBe('Origin')
    // Token vai no header, não em cookie: nada de allow-credentials.
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('nunca responde "*", mesmo para origem permitida', async () => {
    for (const o of [APP, PAGES, 'http://localhost:5173']) {
      const res = await chamar('OPTIONS', `/connectors/${ID}/credentials`, o)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(o)
    }
  })

  it('origem proibida recebe 204 sem cabeçalho de CORS (o navegador barra a requisição real)', async () => {
    const res = await chamar('OPTIONS', `/connectors/${ID}/credentials`, 'https://site-do-mal.com')
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull()
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  // Interface nova contra worker antigo é o caso mais provável de caminho desconhecido. Se o
  // preflight falhasse aqui, o navegador nunca mandaria a requisição real e a tela mostraria a
  // mensagem de rede/CORS — mandando o dono conferir CORS_ORIGENS quando falta é publicar o
  // worker. Liberando o OPTIONS, o 404 chega à tela com o texto que explica a causa.
  it('caminho que não existe libera o preflight para o 404 de verdade chegar na tela', async () => {
    const pre = await chamar('OPTIONS', '/rota-que-so-existe-na-interface-nova', APP, { 'Access-Control-Request-Method': 'POST' })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(APP)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('POST')

    const res = await chamar('POST', '/rota-que-so-existe-na-interface-nova', APP)
    expect(res.status).toBe(404)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP)
    expect(await res.json()).toEqual({ ok: false, erro: expect.stringContaining('publique o worker de novo') })
  })

  it('origem proibida continua sem cabeçalho, mesmo em caminho desconhecido', async () => {
    const res = await chamar('OPTIONS', '/nao-existe', 'https://site-do-mal.com')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('/nfe/xml também aceita preflight (a tela manda XML com Authorization)', async () => {
    const res = await chamar('OPTIONS', '/nfe/xml', APP)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
  })
})

describe('cabeçalhos na resposta real', () => {
  it('erro de rota permitida sai com CORS, para o navegador mostrar o 401 em vez de culpar o CORS', async () => {
    const res = await chamar('POST', `/connectors/${ID}/credentials`, APP)
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP)
    expect(await res.json()).toEqual({ ok: false, erro: expect.stringContaining('Bearer') })
  })

  it('origem proibida não recebe cabeçalho nenhum', async () => {
    const res = await chamar('POST', `/connectors/${ID}/test`, 'https://site-do-mal.com')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('rota de máquina (sem Origin) segue sem CORS', async () => {
    const res = await chamar('POST', '/nfe/xml')
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('/health é aberto', async () => {
    const res = await chamar('GET', '/health', 'https://qualquer-monitor.com')
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

// Tentativas de burlar a lista, uma a uma. Nenhuma achou furo: o casamento é por partes da URL
// (protocolo, host, porta) e a origem devolvida é sempre `new URL(...).origin`, nunca o texto que
// o cliente mandou. Ficam aqui para que uma troca futura por `endsWith`/`includes` quebre o build.
describe('origens hostis', () => {
  const origens = lerOrigensPermitidas(LISTA)
  const recusa = (o: string) => expect(origemPermitida(o, origens)).toBeNull()

  it('sufixo, prefixo e profundidade do curinga', () => {
    recusa('https://prodio-web.pages.dev.atacante.com')
    recusa('https://evilprodio-web.pages.dev')
    recusa('https://prodio-web.pages.dev@atacante.com') // userinfo: o host de verdade é atacante.com
    recusa('https://app.prodio.com.br.atacante.com')
    // Subdomínio de subdomínio do curinga continua dentro do projeto do Pages: pode.
    expect(origemPermitida('https://a.b.prodio-web.pages.dev', origens)).toBe('https://a.b.prodio-web.pages.dev')
  })

  it('ponto final do FQDN não vira um host novo', () => {
    recusa('https://app.prodio.com.br.')
    recusa('https://abc.prodio-web.pages.dev.')
  })

  it('"null" (iframe sandbox), vazio e origem ausente', () => {
    recusa('null')
    recusa('')
    expect(origemPermitida(null, origens)).toBeNull()
  })

  it('maiúsculas casam e voltam normalizadas — é o mesmo host', () => {
    expect(origemPermitida('HTTPS://APP.PRODIO.COM.BR', origens)).toBe(APP)
  })

  it('porta e protocolo diferentes não entram de carona', () => {
    recusa('https://app.prodio.com.br:8443')
    recusa('http://app.prodio.com.br')
    recusa('http://prodio-web.pages.dev')
  })

  it('a origem devolvida é sempre normalizada, então não dá para injetar cabeçalho', () => {
    // Caminho e query não fazem parte de uma Origin; o que volta é só protocolo+host+porta.
    expect(origemPermitida(`${APP}/qualquer/coisa?x=1`, origens)).toBe(APP)
  })

  it('rota com Bearer nunca responde "*", nem para origem permitida', async () => {
    for (const caminho of [`/connectors/${ID}/credentials`, `/connectors/${ID}/test`, '/nfe/xml']) {
      const real = await chamar('POST', caminho, APP)
      expect(real.headers.get('Access-Control-Allow-Origin')).not.toBe('*')
      // Vary: Origin é o que impede um cache no meio de servir a resposta de uma origem para outra.
      expect(real.headers.get('Vary')).toContain('Origin')
    }
  })
})

describe('curinga sobre sufixo compartilhado', () => {
  it('"https://*.pages.dev" não vale como lista de origens', () => {
    // Um projeto novo no Cloudflare Pages ganha um <qualquer>.pages.dev em minutos: com este
    // padrão, o site de qualquer pessoa chamaria o worker com o JWT de quem está logado.
    expect(origemCasa('https://site-de-qualquer-um.pages.dev', 'https://*.pages.dev')).toBe(false)
    expect(origemCasa(PREVIEW, 'https://*.pages.dev')).toBe(false)
    for (const s of ['workers.dev', 'vercel.app', 'netlify.app', 'github.io', 'trycloudflare.com']) {
      expect(origemCasa(`https://alguem.${s}`, `https://*.${s}`)).toBe(false)
    }
  })

  it('o curinga do projeto continua valendo, e domínio próprio também', () => {
    expect(origemCasa(PREVIEW, 'https://*.prodio-web.pages.dev')).toBe(true)
    expect(origemCasa('https://staging.prodio.com.br', 'https://*.prodio.com.br')).toBe(true)
  })
})
