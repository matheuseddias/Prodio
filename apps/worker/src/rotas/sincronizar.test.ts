import { metodosDaRota, resolverRota } from '../index'
import { respostaPreflight } from '../cors'
import type { Env } from '../env'
import type { ConectorRow, Credenciais, Db } from '../db'
import { ErroConector, type Conector, type PedidoNormalizado } from '../conectores/tipos'
import { MSG_SEM_CREDENCIAIS } from '../jobs/semCredenciais'
import { silenciarLog } from '../log'
import { JANELA_JUNTAR_MS, detalheSucesso, juntarSeJaRoda, rotaSincronizarConector, type DepsSync } from './sincronizar'
import { ErroRota, type ConectorAutorizado } from './util'

silenciarLog(true)

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', CREDENTIALS_KEY: 'chave' } as Env
const TOKEN_SECRETO = 'bl-token-super-secreto'
// Um id por teste: a execução em andamento é guardada num mapa por conector (duplo clique).
const id = (n: number) => `0f9d2c3e-1111-4222-8333-4444555566${String(n).padStart(2, '0')}`

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.assinatura`
const base = () => ({ sub: 'u1', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600, app_metadata: { tenant_id: 't1', role: 'admin' } })
const jwtValido = () => jwt(base())
const jwtAparelho = () => jwt({ ...base(), is_anonymous: true })

const pedidoHttp = (connectorId: string, token = jwtValido()) =>
  new Request(`https://worker.prodio.app/connectors/${connectorId}/sync`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

const conectorAutorizado = (connectorId: string, plataforma = 'baselinker'): ConectorAutorizado => ({
  id: connectorId, tenant_id: 't1', plataforma, nome: 'BaseLinker', status: 'conectado', config: { inventory_id: 42 },
})

const PEDIDO: PedidoNormalizado = {
  externalId: '900', status: '7', confirmedAt: '2026-09-22T10:00:00.000Z', updatedAt: '2026-09-22T10:00:00.000Z', total: 120.5,
  itens: [{ skuExterno: 'CAM-01', quantidade: 2, preco: 60.25 }],
}

function dbFalso(credenciais: Credenciais | null = { token: TOKEN_SECRETO }) {
  return {
    getCredentials: vi.fn(async () => credenciais),
    setCredentials: vi.fn(async () => {}),
    marcarStatusConector: vi.fn(async () => {}),
    getSyncState: vi.fn(async () => ({ connector_id: 'x', cursor: { date_confirmed_from: 100 }, last_run_at: null, last_ok_at: null, runs: 3 })),
    setSyncState: vi.fn(async () => {}),
    marcarPulso: vi.fn(async () => {}),
    gravarCursor: vi.fn(async () => {}),
    marcarRodadaManual: vi.fn(async () => {}),
    upsertOrders: vi.fn(async (_t: string, _c: string, pedidos: unknown[]) => pedidos.length),
  }
}
type DbFalso = ReturnType<typeof dbFalso>

// Adaptador falso: só o que a sincronização usa.
function criarFalso(pullOrders: Conector['pullOrders'], capacidadePedidos = true, espiao?: (row: ConectorRow) => void) {
  return (row: ConectorRow): Conector => {
    espiao?.(row)
    return {
      plataforma: 'baselinker',
      capacidades: { pedidos: capacidadePedidos, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false },
      pullOrders,
      pullOrder: async () => null,
      pullCatalog: async () => [],
      pullFinishedStock: async () => [],
      pushFinishedStock: async () => [],
      findInboundNfe: async () => 'unsupported',
      verifyWebhook: async () => 'unsupported',
    }
  }
}

const ctxFalso = () => ({ waitUntil: vi.fn((_promessa: Promise<unknown>) => {}) })

// Autorização e leitura do tenant já resolvidas: o que cada teste quer exercitar é o sync.
const depsDo = (connectorId: string, db: DbFalso, extra: Partial<DepsSync> = {}): DepsSync => ({
  db: db as unknown as Db,
  autorizar: async () => conectorAutorizado(connectorId),
  lerTenant: async () => ({ slug: 'eddias', fuso: 'America/Sao_Paulo' }),
  ...extra,
})

describe('POST /connectors/:id/sync', () => {
  it('trouxe pedidos: 200 com a contagem, grava os pedidos e marca a rodada', async () => {
    const c = id(1)
    const db = dbFalso()
    let cursorVisto: unknown
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: criarFalso(async (cursor) => {
        cursorVisto = cursor
        return { pedidos: [PEDIDO, { ...PEDIDO, externalId: '901' }], cursor: { date_confirmed_from: 999 } }
      }),
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, pedidos: 2, detalhe: '2 pedidos lidos do BaseLinker e gravados no Prodio' })
    // Leu do cursor que o cron deixou e gravou os pedidos como o cron grava.
    expect(cursorVisto).toEqual({ date_confirmed_from: 100 })
    expect(db.upsertOrders).toHaveBeenCalledWith('t1', c, [
      { external_id: '900', external_status: '7', confirmed_at: '2026-09-22T10:00:00.000Z', updated_at_external: '2026-09-22T10:00:00.000Z', total: 120.5, itens: [{ sku_externo: 'CAM-01', quantidade: 2, preco: 60.25 }] },
      { external_id: '901', external_status: '7', confirmed_at: '2026-09-22T10:00:00.000Z', updated_at_external: '2026-09-22T10:00:00.000Z', total: 120.5, itens: [{ sku_externo: 'CAM-01', quantidade: 2, preco: 60.25 }] },
    ])
  })

  // DECISÃO 1: o cursor tem um dono só, o cron. Se um dia alguém "consertar" isto passando o
  // cursor adiante, duas execuções simultâneas (cron + botão) voltam a poder gravar cursores
  // diferentes a partir da mesma leitura — e a que chegar por último manda, podendo pular pedidos.
  it('não move o cursor: quem grava cursor é o cron, o botão só marca a rodada', async () => {
    const c = id(2)
    const db = dbFalso()
    await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: criarFalso(async () => ({ pedidos: [PEDIDO], cursor: { date_confirmed_from: 777 } })),
    }))
    expect(db.gravarCursor).not.toHaveBeenCalled()
    expect(db.marcarRodadaManual).toHaveBeenCalledTimes(1)
    expect(db.marcarRodadaManual).toHaveBeenCalledWith(c, 't1', true, null)
  })

  // sync_state é o diário do ROBÔ. Se o botão gravasse ali (pulso, last_ok_at, runs — que é o que
  // worker_set_sync_state faz), um clique com o cron morto faria o robô parecer vivo na tela, e o
  // pulso deixaria de separar "o robô não roda" de "o robô roda e morre".
  it('não escreve nada em sync_state, nem no sucesso nem na falha', async () => {
    for (const [n, falhar] of [[16, false], [17, true]] as const) {
      const c = id(n)
      const db = dbFalso()
      await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
        criar: criarFalso(async () => {
          if (falhar) throw new ErroConector('baselinker', 'getOrders: fora do ar', { status: 503 })
          return { pedidos: [PEDIDO], cursor: { date_confirmed_from: 777 } }
        }),
      }))
      expect(db.setSyncState).not.toHaveBeenCalled()
      expect(db.gravarCursor).not.toHaveBeenCalled()
      expect(db.marcarPulso).not.toHaveBeenCalled()
      expect(db.marcarRodadaManual).toHaveBeenCalledWith(c, 't1', !falhar, falhar ? expect.any(String) : null)
    }
  })

  it('lê no máximo o teto de páginas do cron e diz quando ainda há fila', async () => {
    const c = id(18)
    const db = dbFalso()
    const pagina = vi.fn(async () => ({ pedidos: [PEDIDO], cursor: { date_confirmed_from: 100 }, fim: false }))
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: (row) => ({ ...criarFalso(async () => ({ pedidos: [], cursor: {} }))(row), pullOrdersPagina: pagina }),
    }))
    expect(pagina).toHaveBeenCalledTimes(2)
    const corpo = (await res.json()) as { ok: boolean; pedidos: number; detalhe: string }
    expect(corpo).toMatchObject({ ok: true, pedidos: 2 })
    expect(corpo.detalhe).toContain('ainda há pedidos mais novos na fila')
  })

  it('zero pedidos é sucesso, e a frase diz isso com todas as letras', async () => {
    const c = id(3)
    const db = dbFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: criarFalso(async () => ({ pedidos: [], cursor: { date_confirmed_from: 500 } })),
    }))
    expect(res.status).toBe(200)
    const corpo = (await res.json()) as { ok: boolean; pedidos: number; detalhe: string }
    expect(corpo.ok).toBe(true)
    expect(corpo.pedidos).toBe(0)
    expect(corpo.detalhe).toBe('a conta do BaseLinker respondeu, nenhum pedido novo desde a última leitura')
    expect(corpo.detalhe).not.toMatch(/erro|falh/i)
    // Nada a gravar, mas a rodada conta: é o "Último sync" do cartão.
    expect(db.upsertOrders).not.toHaveBeenCalled()
    expect(db.marcarRodadaManual).toHaveBeenCalledWith(c, 't1', true, null)
  })

  it('conector sem credencial: 400 dizendo o que fazer, e o conector vira desconectado', async () => {
    const c = id(4)
    const db = dbFalso(null)
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: undefined, // usa criarConector de verdade, que é quem detecta a falta de credencial
    }))
    expect(res.status).toBe(400)
    const corpo = (await res.json()) as { ok: boolean; erro: string }
    expect(corpo.ok).toBe(false)
    expect(corpo.erro).toBe('nenhuma credencial salva para o BaseLinker: salve a credencial antes de sincronizar')
    expect(db.marcarStatusConector).toHaveBeenCalledWith(c, 't1', 'desconectado', MSG_SEM_CREDENCIAIS)
    expect(db.setSyncState).not.toHaveBeenCalled()
  })

  it('falha da plataforma: 502 com instrução em português, erro no cartão e nada do token na resposta', async () => {
    const c = id(5)
    const db = dbFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: criarFalso(async () => {
        throw new ErroConector('baselinker', `getOrders: Invalid token ${TOKEN_SECRETO}`, { codigo: 'ERROR_AUTH_TOKEN' })
      }),
    }))
    expect(res.status).toBe(502)
    const texto = await res.text()
    expect(texto).not.toContain(TOKEN_SECRETO)
    const corpo = JSON.parse(texto) as { ok: boolean; erro: string }
    expect(corpo.ok).toBe(false)
    expect(corpo.erro).toBe('o token foi recusado pelo BaseLinker; gere um novo em Minha conta > API e salve aqui')
    // O cartão passa a mostrar o mesmo texto que o dono acabou de ler na tela.
    expect(db.marcarRodadaManual).toHaveBeenCalledWith(c, 't1', false, corpo.erro)
  })

  it('erro genérico da plataforma fala de leitura de pedidos, não de teste de conexão', async () => {
    const c = id(6)
    const db = dbFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: criarFalso(async () => {
        throw new ErroConector('baselinker', 'getOrders: parâmetro inválido', { status: 400 })
      }),
    }))
    const corpo = (await res.json()) as { erro: string }
    expect(corpo.erro).toContain('o BaseLinker recusou a leitura de pedidos')
    expect(corpo.erro).not.toContain('chamada de teste')
  })

  it('plataforma sem pedidos: 501 em vez de "0 pedidos" mentiroso', async () => {
    const c = id(7)
    const db = dbFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      criar: criarFalso(async () => ({ pedidos: [], cursor: {} }), false),
    }))
    expect(res.status).toBe(501)
    expect((await res.json()) as { erro: string }).toEqual({ ok: false, erro: 'o BaseLinker ainda não traz pedidos para o Prodio' })
    expect(db.setSyncState).not.toHaveBeenCalled()
  })
})

describe('quem pode sincronizar', () => {
  it('não-admin leva 403 e a plataforma não é chamada', async () => {
    const c = id(8)
    const db = dbFalso()
    const espiao = vi.fn()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, depsDo(c, db, {
      autorizar: async () => {
        throw new ErroRota(403, 'só o administrador mexe em conectores')
      },
      criar: criarFalso(async () => {
        espiao()
        return { pedidos: [], cursor: {} }
      }),
    }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, erro: 'só o administrador mexe em conectores' })
    expect(espiao).not.toHaveBeenCalled()
    expect(db.getCredentials).not.toHaveBeenCalled()
  })

  // Aqui a autorização de verdade roda: o tablet do chão de fábrica cai antes de qualquer consulta.
  it('aparelho anônimo do chão de fábrica não sincroniza conector', async () => {
    const c = id(9)
    const db = dbFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c, jwtAparelho()), env, ctxFalso(), c, {
      db: db as unknown as Db,
      lerTenant: async () => null,
      criar: criarFalso(async () => ({ pedidos: [], cursor: {} })),
    })
    expect(res.status).toBe(403)
    expect((await res.json()) as { erro: string }).toMatchObject({ ok: false })
    expect(db.getCredentials).not.toHaveBeenCalled()
  })

  it('sem Authorization: 401', async () => {
    const c = id(10)
    const db = dbFalso()
    const req = new Request(`https://worker.prodio.app/connectors/${c}/sync`, { method: 'POST' })
    const res = await rotaSincronizarConector(req, env, ctxFalso(), c, depsDo(c, db))
    expect(res.status).toBe(401)
  })
})

describe('tempo e duplo clique', () => {
  it('leitura longa: responde na hora e termina em ctx.waitUntil', async () => {
    const c = id(11)
    const db = dbFalso()
    let liberar: (() => void) | undefined
    const travado = new Promise<void>((r) => {
      liberar = r
    })
    const ctx = ctxFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctx, c, depsDo(c, db, {
      tempoLimiteMs: 5,
      criar: criarFalso(async () => {
        await travado
        return { pedidos: [PEDIDO], cursor: { date_confirmed_from: 999 } }
      }),
    }))
    expect(res.status).toBe(200)
    const corpo = (await res.json()) as { ok: boolean; pedidos: number; detalhe: string }
    expect(corpo.ok).toBe(true)
    expect(corpo.detalhe).toContain('continua rodando')
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    // Nada foi gravado ainda; a execução entregue ao waitUntil é que termina o serviço.
    expect(db.upsertOrders).not.toHaveBeenCalled()
    liberar!()
    await ctx.waitUntil.mock.calls[0][0]
    expect(db.upsertOrders).toHaveBeenCalledTimes(1)
    expect(db.marcarRodadaManual).toHaveBeenCalledWith(c, 't1', true, null)
  })

  // Requisição abandonada (o dono fecha a aba, o 4G da fábrica cai): sem waitUntil desde o
  // começo, a execução vive presa à requisição, o Workers cancela o fetch para a plataforma no
  // meio da paginação e `executar` grava no cartão um "falhou" que nunca existiu.
  it('a execução vai para o waitUntil desde o começo, não só quando o prazo estoura', async () => {
    const c = id(14)
    const db = dbFalso()
    const ctx = ctxFalso()
    const res = await rotaSincronizarConector(pedidoHttp(c), env, ctx, c, depsDo(c, db, {
      criar: criarFalso(async () => ({ pedidos: [PEDIDO], cursor: { date_confirmed_from: 999 } })),
    }))
    expect(res.status).toBe(200)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    await ctx.waitUntil.mock.calls[0][0]
    expect(db.marcarRodadaManual).toHaveBeenCalledWith(c, 't1', true, null)
  })

  it('duplo clique: a segunda chamada entra na execução que já está rodando', async () => {
    const c = id(12)
    const db = dbFalso()
    let chamadas = 0
    let liberar: (() => void) | undefined
    const travado = new Promise<void>((r) => {
      liberar = r
    })
    const dep = depsDo(c, db, {
      criar: criarFalso(async () => {
        chamadas++
        await travado
        return { pedidos: [PEDIDO], cursor: { date_confirmed_from: 999 } }
      }),
    })
    const primeira = rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, dep)
    await new Promise((r) => setTimeout(r, 0)) // deixa a primeira chegar até a plataforma
    const segunda = rotaSincronizarConector(pedidoHttp(c), env, ctxFalso(), c, dep)
    liberar!()
    const [r1, r2] = await Promise.all([primeira, segunda])
    expect(chamadas).toBe(1)
    expect(db.upsertOrders).toHaveBeenCalledTimes(1)
    expect(await r1.json()).toEqual({ ok: true, pedidos: 1, detalhe: '1 pedido lido do BaseLinker e gravado no Prodio' })
    expect(await r2.json()).toEqual({ ok: true, pedidos: 1, detalhe: '1 pedido lido do BaseLinker e gravado no Prodio' })
  })
})

describe('juntarSeJaRoda não guarda execução morta', () => {
  it('execução que nunca termina deixa de segurar cliques depois da janela', async () => {
    const c = id(15)
    // ClienteHttp não põe prazo no fetch: uma leitura que nunca termina deixaria a chave no mapa
    // para sempre e todo clique seguinte entraria nela — "Sincronizando…" eterno.
    const presa = () => new Promise<never>(() => {})
    let agora = 1_000_000
    const primeira = juntarSeJaRoda(c, presa as () => Promise<never>, () => agora)
    expect(primeira.jaRodava).toBe(false)
    expect(juntarSeJaRoda(c, presa as () => Promise<never>, () => agora).jaRodava).toBe(true)
    agora += JANELA_JUNTAR_MS + 1
    const depois = juntarSeJaRoda(c, async () => ({ status: 200, corpo: { ok: true, pedidos: 0, detalhe: 'x' } }), () => agora)
    expect(depois.jaRodava).toBe(false)
    expect((await depois.promessa).status).toBe(200)
  })
})

describe('roteador e preflight da rota nova', () => {
  it('/connectors/:uuid/sync só aceita POST e aparece no preflight', () => {
    const c = id(13)
    expect(resolverRota('POST', `/connectors/${c}/sync`)?.params).toEqual([c])
    expect(resolverRota('GET', `/connectors/${c}/sync`)).toBeNull()
    expect(resolverRota('POST', '/connectors/nao-uuid/sync')).toBeNull()
    expect(metodosDaRota(`/connectors/${c}/sync`)).toEqual(['POST'])
    // Sem isto o navegador nem manda o POST: o preflight volta sem Allow-Methods.
    const pre = respostaPreflight('https://app.prodio.com.br', metodosDaRota(`/connectors/${c}/sync`))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('https://app.prodio.com.br')
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })
})

describe('detalheSucesso', () => {
  it('singular, plural e zero', () => {
    expect(detalheSucesso('baselinker', 1)).toBe('1 pedido lido do BaseLinker e gravado no Prodio')
    expect(detalheSucesso('bling', 3)).toBe('3 pedidos lidos do Bling e gravados no Prodio')
    expect(detalheSucesso('tiny', 0)).toBe('a conta do Tiny respondeu, nenhum pedido novo desde a última leitura')
  })

  it('leitura que parou no teto avisa que há fila, sem parecer erro', () => {
    const frase = detalheSucesso('baselinker', 200, false)
    expect(frase).toMatch(/^200 pedidos lidos do BaseLinker e gravados no Prodio; ainda há pedidos mais novos na fila/)
    expect(frase).not.toMatch(/erro|falh/i)
  })
})
