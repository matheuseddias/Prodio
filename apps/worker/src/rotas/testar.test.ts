import type { Env } from '../env'
import type { ConectorRow, Credenciais, Db } from '../db'
import { criarConector } from '../conectores'
import { ErroConector, type Conector } from '../conectores/tipos'
import { MSG_SEM_CREDENCIAIS } from '../jobs/semCredenciais'
import { silenciarLog } from '../log'
import { mensagemDaFalha, redigirSegredos, rotaTestarConector, type DepsTeste } from './testar'
import { ErroRota, type ConectorAutorizado, type Usuario } from './util'

silenciarLog(true)

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', CREDENTIALS_KEY: 'chave' } as Env
const ID = '0f9d2c3e-1111-4222-8333-444455556666'
const TOKEN_SECRETO = 'bl-token-super-secreto'

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.assinatura`
const jwtValido = () => jwt({ sub: 'u1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600, app_metadata: { tenant_id: 't1', role: 'admin' } })

const pedido = (comToken = true) =>
  new Request(`https://worker.prodio.app/connectors/${ID}/test`, { method: 'POST', headers: comToken ? { Authorization: `Bearer ${jwtValido()}` } : {} })

const conectorAutorizado = (plataforma = 'baselinker'): ConectorAutorizado => ({
  id: ID, tenant_id: 't1', plataforma, nome: 'BaseLinker', status: 'erro', config: { inventory_id: 42 },
})

function dbFalso(credenciais: Credenciais | null = { token: TOKEN_SECRETO }) {
  return {
    getCredentials: vi.fn(async () => credenciais),
    setCredentials: vi.fn(async () => {}),
    marcarStatusConector: vi.fn(async () => {}),
  }
}

// Adaptador falso: só o que a rota usa. `criar` recebe a linha montada a partir do que foi lido
// como o usuário, então dá para conferir que o config do conector chegou inteiro.
function criarFalso(testarConexao: () => Promise<string>, espiao?: (row: ConectorRow, c: Credenciais | null) => void) {
  return (row: ConectorRow, credenciais: Credenciais | null): Conector => {
    espiao?.(row, credenciais)
    return {
      plataforma: 'baselinker',
      capacidades: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false },
      pullOrders: async () => ({ pedidos: [], cursor: {} }),
      pullOrder: async () => null,
      pullCatalog: async () => [],
      pullFinishedStock: async () => [],
      pushFinishedStock: async () => [],
      findInboundNfe: async () => 'unsupported',
      verifyWebhook: async () => 'unsupported',
      testarConexao,
    }
  }
}

const deps = (extra: DepsTeste): DepsTeste => ({ autorizar: async () => conectorAutorizado(), ...extra })

describe('POST /connectors/:id/test', () => {
  it('credencial boa: devolve o detalhe e marca o conector como conectado', async () => {
    const db = dbFalso()
    let recebido: { row: ConectorRow; creds: Credenciais | null } | null = null
    const res = await rotaTestarConector(pedido(), env, ID, deps({
      db: db as unknown as Db,
      criar: criarFalso(async () => 'conectado ao BaseLinker: inventário "Casa" (id 42)', (row, creds) => { recebido = { row, creds } }),
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, detalhe: 'conectado ao BaseLinker: inventário "Casa" (id 42)' })
    expect(db.marcarStatusConector).toHaveBeenCalledWith(ID, 't1', 'conectado', null)
    expect(recebido!.row.config).toEqual({ inventory_id: 42 })
    expect(recebido!.creds).toEqual({ token: TOKEN_SECRETO })
  })

  it('credencial ruim: 502 com instrução em português, status erro no banco e nada do token na resposta', async () => {
    const db = dbFalso()
    const res = await rotaTestarConector(pedido(), env, ID, deps({
      db: db as unknown as Db,
      criar: criarFalso(async () => {
        throw new ErroConector('baselinker', 'getInventories: Invalid token', { codigo: 'ERROR_AUTH_TOKEN' })
      }),
    }))
    expect(res.status).toBe(502)
    const corpo = await res.text()
    expect(JSON.parse(corpo)).toEqual({ ok: false, erro: 'o token foi recusado pelo BaseLinker; gere um novo em Minha conta > API e salve aqui' })
    expect(corpo).not.toContain(TOKEN_SECRETO)
    expect(corpo).not.toContain('Invalid token') // mensagem do provedor fica no log
    expect(db.marcarStatusConector).toHaveBeenCalledWith(ID, 't1', 'erro', expect.stringContaining('recusado pelo BaseLinker'))
  })

  it('quem não é admin leva 403 e nem chega a ler a credencial', async () => {
    const db = dbFalso()
    const res = await rotaTestarConector(pedido(), env, ID, {
      db: db as unknown as Db,
      autorizar: async () => {
        throw new ErroRota(403, 'só o administrador mexe em conectores')
      },
      criar: criarFalso(async () => 'nunca'),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, erro: 'só o administrador mexe em conectores' })
    expect(db.getCredentials).not.toHaveBeenCalled()
    expect(db.marcarStatusConector).not.toHaveBeenCalled()
  })

  it('sem Authorization leva 401 antes de qualquer coisa', async () => {
    const db = dbFalso()
    const res = await rotaTestarConector(pedido(false), env, ID, deps({ db: db as unknown as Db, criar: criarFalso(async () => 'nunca') }))
    expect(res.status).toBe(401)
    expect(db.getCredentials).not.toHaveBeenCalled()
  })

  it('conector sem credencial: 400 e desconectado (mesma cura do cron), com a fábrica de verdade', async () => {
    const db = dbFalso(null)
    const res = await rotaTestarConector(pedido(), env, ID, deps({ db: db as unknown as Db, criar: criarConector }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, erro: expect.stringContaining('nenhuma credencial salva') })
    expect(db.marcarStatusConector).toHaveBeenCalledWith(ID, 't1', 'desconectado', MSG_SEM_CREDENCIAIS)
  })

  it('credencial incompleta (token faltando) explica o que falta, sem 500', async () => {
    const db = dbFalso({ warehouse_id: 'bl_1' })
    const res = await rotaTestarConector(pedido(), env, ID, deps({ db: db as unknown as Db, criar: criarConector }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, erro: expect.stringContaining('token do BaseLinker ausente') })
  })

  it('falha ao ler a credencial não vira 500 cru nem vaza a mensagem do banco', async () => {
    const db = dbFalso()
    db.getCredentials.mockRejectedValueOnce(new Error('worker_get_credentials: permission denied for schema public'))
    const res = await rotaTestarConector(pedido(), env, ID, deps({ db: db as unknown as Db, criar: criarFalso(async () => 'nunca') }))
    expect(res.status).toBe(502)
    const corpo = await res.text()
    expect(corpo).not.toContain('permission denied')
  })

  it('teste que passou mas não conseguiu gravar o status avisa em vez de mentir', async () => {
    const db = dbFalso()
    db.marcarStatusConector.mockRejectedValueOnce(new Error('sem conexão com o banco'))
    const res = await rotaTestarConector(pedido(), env, ID, deps({ db: db as unknown as Db, criar: criarFalso(async () => 'conectado ao BaseLinker') }))
    expect(res.status).toBe(200)
    expect((await res.json()) as { detalhe: string }).toEqual({ ok: true, detalhe: expect.stringContaining('status do conector não pôde ser atualizado') })
  })
})

describe('mensagemDaFalha', () => {
  const erroConector = (p: 'baselinker' | 'bling' | 'tiny', msg: string, extra = {}) => new ErroConector(p, msg, extra)

  it('token recusado vira instrução da plataforma certa', () => {
    expect(mensagemDaFalha('baselinker', erroConector('baselinker', 'x', { codigo: 'ERROR_AUTH' }))).toContain('Minha conta > API')
    expect(mensagemDaFalha('tiny', erroConector('tiny', 'x', { codigo: 'reauth' }))).toContain('Conectar o Tiny')
    expect(mensagemDaFalha('bling', erroConector('bling', 'x', { status: 401 }))).toContain('Conectar o Bling')
  })

  it('limite, erro do servidor e queda de rede dizem o que fazer', () => {
    expect(mensagemDaFalha('tiny', erroConector('tiny', 'x', { status: 429 }))).toContain('espere um minuto')
    expect(mensagemDaFalha('tiny', erroConector('tiny', 'x', { status: 503 }))).toContain('erro no servidor dele')
    expect(mensagemDaFalha('baselinker', new TypeError('fetch failed'))).toContain('não foi possível falar com o BaseLinker')
    expect(mensagemDaFalha('baselinker', new TypeError('fetch failed'))).not.toContain('fetch failed')
  })

  it('erro desconhecido leva a mensagem curta da plataforma, cortada', () => {
    const longo = 'a'.repeat(400)
    const m = mensagemDaFalha('tiny', erroConector('tiny', longo, { status: 422 }))
    expect(m.length).toBeLessThan(260)
    expect(m).toContain('o Tiny recusou a chamada de teste')
  })

  // O caminho genérico repassa e.message, e alguns adaptadores embutem ali um pedaço do corpo cru
  // da plataforma (oauthTokenBling manda `texto.slice(0, 200)`). Se o provedor ecoar o que recebeu,
  // o segredo vinha junto. redigirSegredos é a barreira final, com as credenciais em mãos.
  it('segredo que volte na resposta da plataforma não chega ao navegador', () => {
    const creds = { client_id: 'cid-publico', client_secret: 'segredo-do-app-do-bling', access_token: 'tok-abcdefghijklmno' }
    const eco = erroConector('bling', `OAuth Bling falhou (400): {"error":"invalid_client","sent":"segredo-do-app-do-bling","tok":"tok-abcdefghijklmno"}`, { status: 400 })
    const m = mensagemDaFalha('bling', eco, creds)
    expect(m).not.toContain('segredo-do-app-do-bling')
    expect(m).not.toContain('tok-abcdefghijklmno')
    expect(m).toContain('[credencial oculta]')
    // Sem as credenciais em mãos não há o que esconder — é o comportamento antigo, e é o furo.
    expect(mensagemDaFalha('bling', eco)).toContain('segredo-do-app-do-bling')
  })

  it('esconde o segredo antes de cortar o texto, senão sobraria metade dele', () => {
    const segredo = `z${'9'.repeat(200)}`
    const m = mensagemDaFalha('tiny', erroConector('tiny', `erro: ${segredo}`, { status: 422 }), { access_token: segredo })
    expect(m).not.toContain('99999999')
    expect(m).toContain('[credencial oculta]')
  })

  it('config curta não vira "[credencial oculta]" no meio da frase', () => {
    expect(redigirSegredos('não existe o inventário 42 nesta conta', { inventory_id: '42' })).toContain('inventário 42')
  })
})

describe('redigirSegredos no detalhe de sucesso', () => {
  it('nem o caminho feliz devolve credencial, se a plataforma ecoar uma', async () => {
    const db = dbFalso()
    const res = await rotaTestarConector(pedido(), env, ID, deps({
      db: db as unknown as Db,
      criar: criarFalso(async () => `conectado: token ${TOKEN_SECRETO}`),
    }))
    const corpo = await res.text()
    expect(res.status).toBe(200)
    expect(corpo).not.toContain(TOKEN_SECRETO)
  })
})

describe('usuário do teste', () => {
  it('a rota confere o conector como o próprio usuário antes de usar service role', async () => {
    const vistos: { u: Usuario; id: string }[] = []
    const db = dbFalso()
    await rotaTestarConector(pedido(), env, ID, {
      db: db as unknown as Db,
      autorizar: async (u, id) => {
        vistos.push({ u, id })
        return conectorAutorizado()
      },
      criar: criarFalso(async () => 'ok'),
    })
    expect(vistos).toHaveLength(1)
    expect(vistos[0].id).toBe(ID)
    expect(vistos[0].u.userId).toBe('u1')
    // getCredentials (service role) só depois da autorização.
    expect(db.getCredentials).toHaveBeenCalledTimes(1)
  })
})
