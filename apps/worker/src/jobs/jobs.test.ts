import type { ConectorRow, Db, LoteOutbox } from '../db'
import type { Env } from '../env'
import { SEM_CREDENCIAIS, montarConector } from '../conectores'
import { ErroConector, type Conector } from '../conectores/tipos'
import { silenciarLog } from '../log'
import { aplicarOutbox, classificarResultados } from './aplicarOutbox'
import { auditor, compararSaldos } from './auditor'
import { MSG_SEM_CREDENCIAIS } from './semCredenciais'
import { syncPedidos } from './syncPedidos'

silenciarLog(true)

const env = {} as Env
const row = (id: string, config: Record<string, unknown> = {}): ConectorRow => ({
  id, tenant_id: 't-' + id, plataforma: 'baselinker', nome: id, status: 'conectado', config, tenants: { slug: 's', fuso: 'America/Sao_Paulo' },
})

function conectorFalso(sobrescrever: Partial<Conector> = {}): Conector {
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
    ...sobrescrever,
  }
}

function dbFalso(conectores: ConectorRow[], lote: LoteOutbox[] = []) {
  const db = {
    listarConectoresAtivos: vi.fn(async () => conectores),
    getCredentials: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
    marcarStatusConector: vi.fn(async () => {}),
    getSyncState: vi.fn(async () => ({ connector_id: 'x', cursor: { date_confirmed_from: 10 }, last_run_at: null, last_ok_at: null, runs: 1 })),
    setSyncState: vi.fn(async () => {}),
    marcarPulso: vi.fn(async () => {}),
    gravarCursor: vi.fn(async () => {}),
    marcarRodadaManual: vi.fn(async () => {}),
    upsertOrders: vi.fn(async (_t: string, _c: string, pedidos: unknown[]) => pedidos.length),
    claimOutbox: vi.fn(async () => lote),
    applyOutboxResult: vi.fn(async () => {}),
    requeueOutbox: vi.fn(async () => {}),
  }
  return db as unknown as Db & typeof db
}

describe('syncPedidos', () => {
  it('erro em um conector grava ultimo_erro e não impede o próximo tenant', async () => {
    const db = dbFalso([row('a'), row('b')])
    const pedido = { externalId: '1', status: '7', confirmedAt: null, updatedAt: null, total: 10, itens: [{ skuExterno: 'CAM-01', quantidade: 1, preco: 10 }] }
    const montar = async (r: ConectorRow) => {
      if (r.id === 'a') throw new Error('token inválido')
      return conectorFalso({ pullOrders: async (cursor) => ({ pedidos: [pedido], cursor: { date_confirmed_from: Number(cursor?.date_confirmed_from) + 5 } }) })
    }
    const resumo = await syncPedidos(env, db, montar)
    expect(resumo).toEqual({ conectores: 2, ok: 1, falhas: 1, pedidos: 1 })
    // O cartão do conector MOSTRA este texto (ConectorSituacao.ts): o que vai para lá é a frase
    // para humano, nunca a mensagem crua do adaptador. A crua fica no log.
    expect(db.setSyncState).toHaveBeenCalledWith('a', null, false, 'não foi possível falar com o BaseLinker agora; confira a conexão e tente de novo em alguns minutos')
    // Adaptador sem leitura por página (Bling, Tiny) vira uma página única: o cursor é gravado
    // depois dos pedidos, e a rodada fecha com cursor nulo (o ponto já está gravado).
    expect(db.gravarCursor).toHaveBeenCalledWith('b', 't-b', { date_confirmed_from: 15 })
    expect(db.setSyncState).toHaveBeenCalledWith('b', null, true, null)
    // Sem `raw`: a chave nem vai, e o banco mantém o que houver (coalesce).
    expect(db.upsertOrders).toHaveBeenCalledWith('t-b', 'b', [
      { external_id: '1', external_status: '7', confirmed_at: null, updated_at_external: null, total: 10, itens: [{ sku_externo: 'CAM-01', quantidade: 1, preco: 10 }] },
    ])
  })
})

describe('aplicarOutbox', () => {
  const lote: LoteOutbox[] = [
    { product_id: 'p1', sku: 'A', delta: 2, ids: [1, 2] },
    { product_id: 'p2', sku: 'B', delta: -1, ids: [3] },
    { product_id: 'p3', sku: 'C', delta: 5, ids: [4, 5] },
  ]

  it('classifica: aplicados até a falha, falho em erro, restante devolvido', () => {
    const r = classificarResultados(lote, [{ sku: 'A', ok: true }, { sku: 'B', ok: false, erro: 'boom' }], false)
    expect(r).toEqual({ aplicados: [1, 2], devolvidos: [4, 5], falha: { ids: [3], erro: 'boom' } })
  })

  it('dry run devolve tudo a pendente', () => {
    const r = classificarResultados(lote, [{ sku: 'A', ok: true, dryRun: true }, { sku: 'B', ok: true, dryRun: true }, { sku: 'C', ok: true, dryRun: true }], true)
    expect(r).toEqual({ aplicados: [], devolvidos: [1, 2, 3, 4, 5], falha: null })
  })

  it('freio: para na primeira falha e grava os três destinos no banco', async () => {
    const db = dbFalso([row('a', { push_estoque: true })], lote)
    const push = vi.fn(async () => [{ sku: 'A', ok: true }, { sku: 'B', ok: false, erro: 'boom' }])
    const resumo = await aplicarOutbox(env, db, async () => conectorFalso({ pushFinishedStock: push }))
    expect(push).toHaveBeenCalledWith([{ sku: 'A', delta: 2 }, { sku: 'B', delta: -1 }, { sku: 'C', delta: 5 }], { dryRun: false })
    expect(db.applyOutboxResult).toHaveBeenCalledWith([1, 2], true, null)
    expect(db.applyOutboxResult).toHaveBeenCalledWith([3], false, 'boom')
    expect(db.requeueOutbox).toHaveBeenCalledWith([4, 5])
    expect(resumo).toEqual({ conectores: 1, aplicados: 2, erros: 1, devolvidos: 2 })
  })

  it('sem push_estoque no config não reclama lote; exceção antes do push devolve tudo', async () => {
    const db = dbFalso([row('a'), row('b', { push_estoque: true })], lote)
    const resumo = await aplicarOutbox(env, db, async () => conectorFalso({ pushFinishedStock: async () => { throw new Error('catálogo fora') } }))
    expect(db.claimOutbox).toHaveBeenCalledTimes(1)
    expect(db.requeueOutbox).toHaveBeenCalledWith([1, 2, 3, 4, 5])
    expect(db.setSyncState).toHaveBeenCalledWith('b', null, false, 'outbox: catálogo fora')
    expect(resumo.aplicados).toBe(0)
  })

  // O texto vai para connectors.ultimo_erro e integration_outbox.erro, que o tablet do chão de
  // fábrica lê. O caminho do sync já filtrava segredo; o do outbox gravava a mensagem crua.
  it('erro do envio não leva a credencial para o cartão, para o item nem para o log', async () => {
    const segredo = 'segredo-do-cliente-123456'
    const db = dbFalso([row('b', { push_estoque: true })], lote)
    db.getCredentials.mockResolvedValue({ client_secret: segredo })
    await aplicarOutbox(env, db, async () => conectorFalso({ pushFinishedStock: async () => { throw new Error(`invalid_client ${segredo}`) } }))
    expect(db.setSyncState).toHaveBeenCalledWith('b', null, false, 'outbox: invalid_client [credencial oculta]')
    db.setSyncState.mockClear()
    const push = async () => [{ sku: 'A', ok: false, erro: `recusado: ${segredo}` }]
    await aplicarOutbox(env, db, async () => conectorFalso({ pushFinishedStock: push }))
    expect(db.applyOutboxResult).toHaveBeenCalledWith([1, 2], false, 'recusado: [credencial oculta]')
    // Sem conseguir ler a credencial, não há como filtrar: vai uma frase fixa, nunca o texto cru.
    db.getCredentials.mockRejectedValue(new Error('banco fora'))
    db.setSyncState.mockClear()
    await aplicarOutbox(env, db, async () => conectorFalso({ pushFinishedStock: async () => { throw new Error(`invalid_client ${segredo}`) } }))
    expect(JSON.stringify(db.setSyncState.mock.calls)).not.toContain(segredo)
    expect(db.setSyncState).toHaveBeenCalledTimes(1)
  })
})

describe('conector ativo sem credencial', () => {
  // O seed cria o conector do BaseLinker 'conectado' e sem credencial (credencial é cifrada).
  // Sem cura, o cron repetiria a mesma falha a cada 5 minutos, para sempre.
  const semCredencial = async (r: ConectorRow) => montarConector(r, env, { getCredentials: async () => null, setCredentials: async () => {} })

  it('a fábrica marca o caso com um código próprio', async () => {
    await expect(semCredencial(row('a'))).rejects.toMatchObject({ name: 'ErroConector', codigo: SEM_CREDENCIAIS })
    // Credencial vazia é o mesmo caso: não há o que tentar.
    await expect(montarConector(row('a'), env, { getCredentials: async () => ({}), setCredentials: async () => {} })).rejects.toMatchObject({ codigo: SEM_CREDENCIAIS })
  })

  it('syncPedidos desativa em vez de gravar erro de sync, e não atrapalha o próximo tenant', async () => {
    const db = dbFalso([row('a'), row('b')])
    const montar = async (r: ConectorRow) => (r.id === 'a' ? semCredencial(r) : conectorFalso())
    const resumo = await syncPedidos(env, db, montar)
    expect(db.marcarStatusConector).toHaveBeenCalledWith('a', 't-a', 'desconectado', MSG_SEM_CREDENCIAIS)
    expect(db.setSyncState).not.toHaveBeenCalledWith('a', null, false, expect.anything())
    expect(db.gravarCursor).toHaveBeenCalledWith('b', 't-b', {})
    expect(db.setSyncState).toHaveBeenCalledWith('b', null, true, null)
    expect(resumo).toEqual({ conectores: 2, ok: 1, falhas: 1, pedidos: 0 })
  })

  it('token expirado e rede fora continuam tentando: só a ausência de credencial desativa', async () => {
    const db = dbFalso([row('a')])
    await syncPedidos(env, db, async () => {
      throw new ErroConector('baselinker', 'o Tiny recusou o token renovado', { codigo: 'reauth', status: 401 })
    })
    expect(db.marcarStatusConector).not.toHaveBeenCalled()
    expect(db.setSyncState).toHaveBeenCalledWith('a', null, false, 'o token foi recusado pelo BaseLinker; gere um novo em Minha conta > API e salve aqui')
  })

  it('aplicarOutbox devolve o lote e desativa sem marcar erro de sync', async () => {
    const db = dbFalso([row('a', { push_estoque: true })], [{ product_id: 'p1', sku: 'A', delta: 1, ids: [7] }])
    await aplicarOutbox(env, db, semCredencial)
    expect(db.requeueOutbox).toHaveBeenCalledWith([7])
    expect(db.marcarStatusConector).toHaveBeenCalledWith('a', 't-a', 'desconectado', MSG_SEM_CREDENCIAIS)
    expect(db.setSyncState).not.toHaveBeenCalled()
  })

  it('auditor também desativa', async () => {
    const db = dbFalso([row('a')])
    const resumo = await auditor(env, db, semCredencial)
    expect(db.marcarStatusConector).toHaveBeenCalledWith('a', 't-a', 'desconectado', MSG_SEM_CREDENCIAIS)
    expect(resumo.falhas).toBe(1)
  })
})

describe('auditor · compararSaldos', () => {
  it('divergência = hub − (snapshot anterior + bipado hoje); sem snapshot não acusa', () => {
    const produtos = [{ id: 'p1', sku: 'A' }, { id: 'p2', sku: 'B' }, { id: 'p3', sku: 'C' }, { id: 'p4', sku: 'D' }]
    const saldos = [{ sku: 'A', saldo: 15 }, { sku: 'B', saldo: 7 }, { sku: 'C', saldo: 3 }]
    const anteriores = new Map([['p1', 10], ['p2', 5]])
    const bipados = new Map([['p1', 5], ['p2', 3]])
    const d = compararSaldos(produtos, saldos, anteriores, bipados)
    expect(d).toEqual([{ sku: 'B', product_id: 'p2', saldo_hub: 7, saldo_anterior: 5, bipado_hoje: 3, esperado: 8, diferenca: -1 }])
  })
})

// O cron grava em connectors.ultimo_erro, e connectors é legível por QUALQUER membro do tenant
// (policy connectors_select) — inclusive a sessão anônima do tablet do chão de fábrica. Desde que
// o cartão do conector passou a mostrar essa coluna, o que vai para lá é interface, não log.
describe('o que o cron grava no cartão', () => {
  const dbComCredencial = (credenciais: Record<string, unknown>) => {
    const db = dbFalso([row('a')]) as unknown as { getCredentials: unknown; setSyncState: { mock: { calls: unknown[][] } } }
    ;(db as { getCredentials: () => Promise<Record<string, unknown>> }).getCredentials = async () => credenciais
    return db as unknown as ReturnType<typeof dbFalso>
  }

  it('credencial ecoada pela plataforma não chega ao cartão nem ao log', async () => {
    const segredo = 'segredo-do-app-do-bling'
    const db = dbComCredencial({ client_secret: segredo })
    await syncPedidos(env, db, async () => {
      // oauthTokenBling repassa o corpo cru do provedor; servidor OAuth que ecoa o que recebeu é comum.
      throw new ErroConector('bling', `OAuth Bling falhou (400): {"error":"invalid_client","client_secret":"${segredo}"}`, { status: 400 })
    })
    const gravado = (db.setSyncState.mock.calls[0] as unknown[])[3] as string
    expect(gravado).not.toContain(segredo)
    expect(gravado).toContain('[credencial oculta]')
  })

  it('falha do banco não vira "confira a conexão com a plataforma"', async () => {
    const db = dbComCredencial({ token: 'bl-token-super-secreto' })
    await syncPedidos(env, db, async () =>
      conectorFalso({
        pullOrders: async () => {
          const e = new Error('worker_upsert_orders: permission denied')
          e.name = 'ErroBanco'
          throw e
        },
      }),
    )
    const gravado = (db.setSyncState.mock.calls[0] as unknown[])[3] as string
    expect(gravado).toContain('problema interno nosso')
    expect(gravado).not.toContain('confira a conexão')
    expect(gravado).not.toContain('permission denied')
  })
})
