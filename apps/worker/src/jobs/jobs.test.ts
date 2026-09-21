import type { ConectorRow, Db, LoteOutbox } from '../db'
import type { Env } from '../env'
import type { Conector } from '../conectores/tipos'
import { silenciarLog } from '../log'
import { aplicarOutbox, classificarResultados } from './aplicarOutbox'
import { compararSaldos } from './auditor'
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
    getSyncState: vi.fn(async () => ({ connector_id: 'x', cursor: { date_confirmed_from: 10 }, last_run_at: null, last_ok_at: null, runs: 1 })),
    setSyncState: vi.fn(async () => {}),
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
    expect(db.setSyncState).toHaveBeenCalledWith('a', null, false, 'token inválido')
    expect(db.setSyncState).toHaveBeenCalledWith('b', { date_confirmed_from: 15 }, true, null)
    expect(db.upsertOrders).toHaveBeenCalledWith('t-b', 'b', [
      { external_id: '1', external_status: '7', confirmed_at: null, updated_at_external: null, total: 10, raw: null, itens: [{ sku_externo: 'CAM-01', quantidade: 1, preco: 10 }] },
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
