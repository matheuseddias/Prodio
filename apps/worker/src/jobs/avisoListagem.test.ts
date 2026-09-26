// Falha ao listar conectores não pode mais ser invisível (incidente de 25/09/2026: 24 h de robô
// parado e só uma linha 'sync.listar' no log). Roda o syncPedidos de verdade com o Db de verdade
// sobre um PostgREST de mentira que devolve o PGRST201 do incidente para a listagem completa.
import { ErroBanco } from '../db'
import type { Env } from '../env'
import { silenciarLog } from '../log'
import { RESPOSTA_PGRST201, colunas, postgrestFalso, type PedidoPostgrest } from '../postgrestFalso'
import { PREFIXO_AVISO_CRON, avisarFalhaDeListagem, avisoDeListagem } from './avisoListagem'
import { syncPedidos } from './syncPedidos'

silenciarLog(true)

afterEach(() => {
  vi.restoreAllMocks()
  silenciarLog(true)
})

const env = {} as Env
const AVISO = avisoDeListagem(new ErroBanco('listarConectoresAtivos', 'x', { code: 'PGRST201' }))

// Listagem completa (tem `config`) quebra como no incidente; a leitura mínima responde.
function bancoDoIncidente(minima: unknown[] | 'falha') {
  return postgrestFalso((p: PedidoPostgrest) => {
    if (p.metodo === 'GET' && p.tabela === 'connectors') {
      if (colunas(p).includes('config')) return RESPOSTA_PGRST201
      // 401 e não 503: o supabase-js repete GET que volta 503/520, com espera de segundos.
      return minima === 'falha' ? { status: 401, corpo: { message: 'Invalid API key' } } : { status: 200, corpo: minima }
    }
    if (p.metodo === 'PATCH' && p.tabela === 'connectors') return { status: 204 }
    return { status: 500, corpo: { message: `inesperado: ${p.metodo} ${p.tabela}` } }
  })
}

const linhasDoLog = (espiao: { mock: { calls: unknown[][] } }) => espiao.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)

describe('falha ao listar conectores', () => {
  it('log com o código do PostgREST e aviso no cartão dos conectores ativos, sem mexer em status nem em sync_state', async () => {
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    silenciarLog(false)
    const { db, pedidos } = bancoDoIncidente([
      { id: 'a', tenant_id: 't1', status: 'conectado', ultimo_erro: null },
      { id: 'b', tenant_id: 't1', status: 'erro', ultimo_erro: 'token inválido' },
      { id: 'c', tenant_id: 't2', status: 'erro', ultimo_erro: AVISO }, // já avisado: não regrava
    ])

    const resumo = await syncPedidos(env, db, async () => {
      throw new Error('não deveria montar adaptador nenhum')
    })

    expect(resumo).toEqual({ conectores: 0, ok: 0, falhas: 0, pedidos: 0 })
    const listar = linhasDoLog(erros).find((l) => l.evento === 'sync.listar')
    expect(listar).toMatchObject({ nivel: 'error', codigo: 'PGRST201' })
    expect(String(listar?.detalhes)).toContain('hub_stock_snapshots')
    expect(String(listar?.dica)).toContain('tenants!')

    const patches = pedidos.filter((p) => p.metodo === 'PATCH')
    expect(patches.map((p) => p.params.get('id'))).toEqual(['eq.a', 'eq.b'])
    for (const p of patches) {
      expect(p.corpo).toEqual({ ultimo_erro: AVISO })
      expect(p.params.get('status')).toBe('neq.desconectado')
    }
    // Nada de sync_state (o robô não tentou conector nenhum) nem de RPC que marque rodada.
    expect(pedidos.filter((p) => p.tabela !== 'connectors')).toEqual([])
  })

  it('se nem a leitura mínima responde, fica o log e o cron segue sem lançar', async () => {
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    silenciarLog(false)
    const { db, pedidos } = bancoDoIncidente('falha')
    await expect(syncPedidos(env, db)).resolves.toEqual({ conectores: 0, ok: 0, falhas: 0, pedidos: 0 })
    expect(linhasDoLog(erros).map((l) => [l.evento, l.etapa])).toEqual([
      ['sync.listar', undefined],
      ['sync.listar.aviso', 'ler'],
    ])
    expect(pedidos.filter((p) => p.metodo !== 'GET')).toEqual([])
  })

  it('um cartão que não grava não impede os outros', async () => {
    const db = {
      listarConectoresParaAviso: vi.fn(async () => [
        { id: 'a', tenant_id: 't1', status: 'conectado', ultimo_erro: null },
        { id: 'b', tenant_id: 't1', status: 'conectado', ultimo_erro: null },
      ]),
      avisarNoCartao: vi.fn(async (id: string) => {
        if (id === 'a') throw new ErroBanco('avisarNoCartao', 'timeout')
      }),
    }
    expect(await avisarFalhaDeListagem(db, new Error('fetch failed'))).toBe(1)
    expect(db.avisarNoCartao).toHaveBeenCalledTimes(2)
  })
})

// A listagem voltou. Antes, o aviso só saía no FIM de uma rodada completa (worker_set_sync_state):
// uma rodada que morre no meio (CPU do plano) ou que não chega a este conector deixava o cartão
// dizendo que o robô nem lista os conectores, por cima do diagnóstico pelo pulso.
describe('a listagem voltou', () => {
  function bancoRecuperado(linhas: { id: string; ultimo_erro: string | null }[]) {
    return postgrestFalso((p: PedidoPostgrest) => {
      if (p.metodo === 'GET' && p.tabela === 'connectors') {
        return { status: 200, corpo: linhas.map((l) => ({ ...l, tenant_id: 't1', plataforma: 'baselinker', nome: l.id, status: 'conectado', config: {} })) }
      }
      if (p.metodo === 'GET' && p.tabela === 'tenants') return { status: 200, corpo: [{ id: 't1', slug: 'eddias', fuso: 'America/Sao_Paulo' }] }
      return { status: 204 }
    })
  }

  it('o aviso sai do cartão ANTES da rodada, e só o aviso', async () => {
    const { db, pedidos } = bancoRecuperado([
      { id: 'a', ultimo_erro: AVISO },
      { id: 'b', ultimo_erro: 'token inválido' }, // motivo de verdade: fica até a rodada decidir
      { id: 'c', ultimo_erro: null },
    ])
    const limpezasAoMontar: string[][] = []
    const limpezas = () => pedidos.filter((p) => p.metodo === 'PATCH' && p.tabela === 'connectors' && p.params.has('ultimo_erro'))
    // A rodada "morre" ao montar o adaptador: o que importa é o que já foi gravado até ali.
    await syncPedidos(env, db, async (row) => {
      limpezasAoMontar.push(limpezas().map((p) => `${row.id}:${p.params.get('id')}`))
      throw new Error('morreu no meio')
    })

    expect(limpezasAoMontar[0]).toEqual(['a:eq.a'])
    const [limpeza] = limpezas()
    expect(limpeza.corpo).toEqual({ ultimo_erro: null })
    expect(Object.fromEntries(limpeza.params)).toEqual({ id: 'eq.a', tenant_id: 'eq.t1', ultimo_erro: `like.${PREFIXO_AVISO_CRON}%` })
    expect(limpezas()).toHaveLength(1)
  })
})

describe('frase do aviso', () => {
  it('prefixo que a tela reconhece, código quando há, e nada mais do erro', () => {
    expect(AVISO.startsWith(PREFIXO_AVISO_CRON)).toBe(true)
    expect(AVISO).toContain('(código PGRST201)')
    expect(AVISO).toContain('Sincronizar agora')
    expect(AVISO).toContain('sync.listar')
    expect(AVISO.length).toBeLessThanOrEqual(500)
    // Sem código (rede, fetch) não inventa um; código esquisito não vai para a tela.
    const semCodigo = avisoDeListagem(new Error('fetch failed: https://x.supabase.co'))
    expect(semCodigo).not.toContain('código')
    expect(semCodigo).not.toContain('supabase.co')
    expect(avisoDeListagem(new ErroBanco('x', 'y', { code: '<script>alert(1)</script>' }))).not.toContain('script')
    expect(avisoDeListagem(new ErroBanco('x', 'y', { code: '42703' }))).toContain('(código 42703)')
  })
})
