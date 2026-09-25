// O robô nunca mais pode entrar em ciclo de morte (incidente de 25/09/2026). Estes testes rodam o
// job de verdade (syncPedidos + sincronizarConector) contra o adaptador de verdade do BaseLinker,
// falando com um BaseLinker de mentira que pagina como a API documenta, e um banco de mentira que
// guarda cursor, pulso e pedidos como o Supabase guardaria.
import type { ConectorRow, Db, PedidoParaRpc, SyncStateRow } from '../db'
import type { Env } from '../env'
import { SOBREPOSICAO_S } from '../conectores/baselinker'
import { baseLinkerFalso, type BaseLinkerFalso, type PedidoBLFalso } from '../conectores/baselinkerFalso'
import { silenciarLog } from '../log'
import { PAGINAS_POR_RODADA_MAX, PAGINAS_POR_RODADA_PADRAO, paginasPorRodada, paraRpc, sincronizarConector, syncPedidos } from './syncPedidos'

silenciarLog(true)

const env = {} as Env
const T = 1_800_000_000 // "agora" da conta, em segundos
const linha = (config: Record<string, unknown> = {}): ConectorRow => ({
  id: 'c-bl', tenant_id: 't1', plataforma: 'baselinker', nome: 'Base', status: 'conectado', config, tenants: { slug: 'eddias', fuso: 'America/Sao_Paulo' },
})

// Banco de mentira com o comportamento das peças reais: gravarCursor e marcarPulso são os upserts
// diretos em sync_state; setSyncState é worker_set_sync_state (regrava last_run_at com o fim da
// rodada, conta runs, cursor nulo mantém o anterior); upsertOrders é idempotente por external_id.
function bancoFalso(row: ConectorRow) {
  const eventos: string[] = []
  const pedidos = new Map<string, PedidoParaRpc>()
  let sync: SyncStateRow | null = null
  const cartao = { status: row.status as string, ultimo_sync: null as string | null, ultimo_erro: null as string | null }
  const garantir = (): SyncStateRow => (sync ??= { connector_id: row.id, cursor: null, last_run_at: null, last_ok_at: null, runs: 0 })
  const db = {
    listarConectoresAtivos: vi.fn(async () => [row]),
    getCredentials: vi.fn(async () => ({ token: 'tok' })),
    marcarStatusConector: vi.fn(async () => {}),
    getSyncState: vi.fn(async () => {
      eventos.push('getSyncState')
      return sync ? { ...sync } : null
    }),
    marcarPulso: vi.fn(async (_c: string, _t: string, em: string) => {
      eventos.push('pulso')
      garantir().last_run_at = em
    }),
    gravarCursor: vi.fn(async (_c: string, _t: string, cursor: Record<string, unknown>) => {
      eventos.push('cursor')
      garantir().cursor = cursor
    }),
    setSyncState: vi.fn(async (_c: string, cursor: Record<string, unknown> | null, ok: boolean, erro: string | null) => {
      eventos.push(ok ? 'rpc.ok' : 'rpc.falha')
      const s = garantir()
      if (cursor) s.cursor = cursor
      s.last_run_at = 'FIM-DA-RODADA'
      s.runs++
      if (ok) s.last_ok_at = 'FIM-DA-RODADA'
      cartao.status = ok ? 'conectado' : 'erro'
      cartao.ultimo_erro = ok ? null : erro
      if (ok) cartao.ultimo_sync = 'FIM-DA-RODADA'
    }),
    marcarRodadaManual: vi.fn(async () => {}),
    upsertOrders: vi.fn(async (_t: string, _c: string, lista: PedidoParaRpc[]) => {
      eventos.push('upsert')
      for (const p of lista) pedidos.set(p.external_id, p)
      return lista.length
    }),
  }
  return { db: db as unknown as Db & typeof db, eventos, pedidos, cartao, sync: () => sync }
}

// Uma rodada do cron: o mesmo syncPedidos que scheduled() chama, com o adaptador real sobre o BL falso.
function rodada(bl: BaseLinkerFalso, banco: ReturnType<typeof bancoFalso>) {
  return syncPedidos(env, banco.db, async (r) => {
    banco.eventos.push('montar')
    return bl.conector(r.config)
  }, () => bl.agoraS * 1000)
}

const pedidosEspacados = (n: number, desde: number, passo = 10): PedidoBLFalso[] =>
  Array.from({ length: n }, (_, i) => ({ order_id: i + 1, date_confirmed: desde + i * passo }))

describe('execução que morre no meio', () => {
  it('a próxima rodada retoma da página em que a anterior morreu, e nada é pulado', async () => {
    const todos = pedidosEspacados(450, T - 86_400)
    const bl = baseLinkerFalso(todos, T)
    const row = linha({ paginas_por_rodada: 10 })
    const banco = bancoFalso(row)

    bl.falharNa = 4 // morre ao ler a 4ª página
    const r1 = await rodada(bl, banco)
    expect(r1).toMatchObject({ ok: 0, falhas: 1 })
    // As três páginas lidas antes da morte ficaram no banco, e o cursor aponta para a borda da 3ª:
    // o maior date_confirmed dela (pedido de índice 297 — as páginas se sobrepõem no segundo da borda).
    expect(banco.pedidos.size).toBe(298)
    expect(banco.sync()?.cursor).toEqual({ date_confirmed_from: todos[297].date_confirmed })
    expect(banco.cartao.status).toBe('erro')

    bl.falharNa = undefined
    const consultasAntes = bl.consultas.length
    const r2 = await rodada(bl, banco)
    expect(r2).toMatchObject({ ok: 1, falhas: 0 })
    // Começou da página 4, não da janela inicial inteira.
    expect(bl.consultas[consultasAntes]).toBe(todos[297].date_confirmed)
    expect(new Set(banco.pedidos.keys())).toEqual(new Set(todos.map((p) => String(p.order_id))))
    expect(banco.cartao).toMatchObject({ status: 'conectado', ultimo_erro: null })
  })

  it('morrer entre gravar os pedidos e gravar o cursor só faz reler a página', async () => {
    const todos = pedidosEspacados(250, T - 86_400)
    const bl = baseLinkerFalso(todos, T)
    const row = linha({ paginas_por_rodada: 10 })
    const banco = bancoFalso(row)
    let cursores = 0
    const gravar = banco.db.gravarCursor.getMockImplementation()!
    banco.db.gravarCursor.mockImplementation(async (...a) => {
      if (++cursores === 2) throw new Error('conexão com o banco caiu')
      return gravar(...a)
    })
    await rodada(bl, banco)
    // Página 2 gravou os pedidos e morreu antes do cursor: o cursor ficou na borda da página 1.
    expect(banco.sync()?.cursor).toEqual({ date_confirmed_from: todos[99].date_confirmed })
    banco.db.gravarCursor.mockImplementation(gravar)
    await rodada(bl, banco)
    expect(banco.pedidos.size).toBe(250)
  })
})

describe('páginas por rodada', () => {
  it('padrão pequeno, configurável em connectors.config, com teto', () => {
    expect(PAGINAS_POR_RODADA_PADRAO).toBe(2)
    expect(paginasPorRodada({})).toBe(2)
    expect(paginasPorRodada(null)).toBe(2)
    expect(paginasPorRodada({ paginas_por_rodada: 5 })).toBe(5)
    expect(paginasPorRodada({ paginas_por_rodada: '3' })).toBe(3)
    expect(paginasPorRodada({ paginas_por_rodada: 0 })).toBe(2)
    expect(paginasPorRodada({ paginas_por_rodada: 'muitas' })).toBe(2)
    expect(paginasPorRodada({ paginas_por_rodada: 10_000 })).toBe(PAGINAS_POR_RODADA_MAX)
  })

  it('cada rodada lê no máximo o teto, e o atraso é drenado em várias rodadas sem perder nada', async () => {
    const todos = pedidosEspacados(1000, T - 2 * 86_400)
    const bl = baseLinkerFalso(todos, T)
    const row = linha() // padrão: 2 páginas
    const banco = bancoFalso(row)
    const porRodada: number[] = []
    for (let i = 0; i < 20 && banco.pedidos.size < todos.length; i++) {
      const antes = bl.consultas.length
      await rodada(bl, banco)
      porRodada.push(bl.consultas.length - antes)
    }
    expect(Math.max(...porRodada)).toBe(2)
    expect(banco.pedidos.size).toBe(1000)
    // Cada rodada curta fecha como sucesso: o cartão não acusa erro enquanto drena.
    expect(banco.cartao.status).toBe('conectado')
    expect(porRodada.length).toBeGreaterThan(1)
  })

  it('config maior lê mais páginas na mesma rodada', async () => {
    const bl = baseLinkerFalso(pedidosEspacados(1000, T - 2 * 86_400), T)
    const row = linha({ paginas_por_rodada: 3 })
    await rodada(bl, bancoFalso(row))
    expect(bl.consultas).toHaveLength(3)
  })
})

// Gerador determinístico: o teste falha sempre do mesmo jeito, se falhar.
function sorteio(semente: number) {
  let x = semente >>> 0
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

describe('cursor em pedaços não pula pedido', () => {
  it('segundos compartilhados na borda, rodadas curtas, mortes a esmo e pedidos chegando: todos entram', async () => {
    for (const semente of [1, 7, 42, 2026]) {
      const acaso = sorteio(semente)
      // Histórico em rajadas: vários pedidos no mesmo segundo (até 30), bem na borda das páginas.
      const pedidos: PedidoBLFalso[] = []
      let segundo = T - 2 * 86_400
      while (pedidos.length < 700) {
        const rajada = 1 + Math.floor(acaso() * 30)
        for (let k = 0; k < rajada; k++) pedidos.push({ order_id: pedidos.length + 1, date_confirmed: segundo })
        segundo += Math.floor(acaso() * 400)
      }
      const bl = baseLinkerFalso(pedidos, T)
      const row = linha({ paginas_por_rodada: 1 + Math.floor(acaso() * 2) })
      const banco = bancoFalso(row)
      // O banco também cai às vezes no meio da gravação da página (antes de o cursor andar).
      const gravar = banco.db.upsertOrders.getMockImplementation()!
      banco.db.upsertOrders.mockImplementation(async (...a) => {
        if (acaso() < 0.1) throw new Error('worker_upsert_orders: timeout')
        return gravar(...a)
      })
      for (let r = 0; r < 60; r++) {
        // Pedidos novos chegam entre as rodadas; alguns com confirmação até 90 min no passado.
        for (let k = Math.floor(acaso() * 4); k > 0; k--) {
          const atraso = acaso() < 0.3 ? Math.floor(acaso() * 5400) : 0
          pedidos.push({ order_id: pedidos.length + 1, date_confirmed: bl.agoraS - atraso, visivel_em: bl.agoraS })
        }
        bl.falharNa = acaso() < 0.3 ? bl.consultas.length + 1 + Math.floor(acaso() * 2) : undefined
        await rodada(bl, banco)
        bl.agoraS += 300
      }
      bl.falharNa = undefined
      banco.db.upsertOrders.mockImplementation(gravar)
      for (let r = 0; r < 5; r++) await rodada(bl, banco)
      const faltando = pedidos.filter((p) => !banco.pedidos.has(String(p.order_id)))
      expect({ semente, faltando: faltando.length }).toEqual({ semente, faltando: 0 })
    }
  })

  // Importação em massa: centenas de pedidos confirmados no mesmo segundo, com rodadas de 1 página e
  // mortes entre elas. A versão anterior andava +1 no segundo lotado e perdia o resto dele.
  it('segundos com mais de 100 pedidos, rodadas curtas e mortes: todos entram', async () => {
    for (const semente of [3, 11, 99]) {
      const acaso = sorteio(semente)
      const pedidos: PedidoBLFalso[] = []
      let segundo = T - 86_400
      while (pedidos.length < 900) {
        const rajada = acaso() < 0.3 ? 100 + Math.floor(acaso() * 180) : 1 + Math.floor(acaso() * 20)
        for (let k = 0; k < rajada; k++) pedidos.push({ order_id: pedidos.length + 1, date_confirmed: segundo })
        segundo += 1 + Math.floor(acaso() * 60)
      }
      const bl = baseLinkerFalso(pedidos, T)
      const banco = bancoFalso(linha({ paginas_por_rodada: 1 }))
      for (let r = 0; r < 80; r++) {
        bl.falharNa = acaso() < 0.25 ? bl.consultas.length + 1 : undefined
        await rodada(bl, banco)
        bl.agoraS += 300
      }
      const faltando = pedidos.filter((p) => !banco.pedidos.has(String(p.order_id)))
      expect({ semente, faltando: faltando.length }).toEqual({ semente, faltando: 0 })
    }
  })

  it('rodada que para no teto grava a borda exata (sem sobreposição e sem +1); a que fica em dia volta 2 h', async () => {
    const todos = pedidosEspacados(300, T - 86_400)
    const bl = baseLinkerFalso(todos, T)
    const row = linha({ paginas_por_rodada: 1 })
    const banco = bancoFalso(row)
    await rodada(bl, banco)
    expect(banco.sync()?.cursor).toEqual({ date_confirmed_from: todos[99].date_confirmed })
    await rodada(bl, banco)
    await rodada(bl, banco)
    expect(banco.sync()?.cursor).toEqual({ date_confirmed_from: todos[297].date_confirmed })
    // 4ª rodada: página incompleta, em dia. O ponto volta 2 h do maior lido.
    await rodada(bl, banco)
    expect(banco.sync()?.cursor).toEqual({ date_confirmed_from: todos[299].date_confirmed - SOBREPOSICAO_S })
    expect(banco.pedidos.size).toBe(300)
    // Se a sobreposição de 2 h tiver mais pedidos que o teto da rodada, as rodadas seguintes a relêem
    // em pedaços (é o preço de não pular pedido atrasado) e voltam a ficar em dia sozinhas.
    const consultas = bl.consultas.length
    await rodada(bl, banco)
    expect(bl.consultas[consultas]).toBe(todos[299].date_confirmed - SOBREPOSICAO_S)
  })
})

// Cron de 5 min que demorou e encontrou o seguinte, e o dono apertando "Sincronizar agora" no meio.
// A regra que não pode quebrar nunca: todo cursor gravado, por quem quer que seja, está atrás de
// todo pedido ainda não gravado. Conferida em CADA gravação de cursor, não só no fim.
describe('concorrência: dois crons sobrepostos e o botão ao mesmo tempo', () => {
  it('nenhum cursor gravado passa à frente de pedido não gravado, e no fim todos entram', async () => {
    for (const semente of [5, 23, 77]) {
      const acaso = sorteio(semente)
      const pedidos: PedidoBLFalso[] = []
      let segundo = T - 86_400
      while (pedidos.length < 800) {
        const rajada = acaso() < 0.15 ? 100 + Math.floor(acaso() * 120) : 1 + Math.floor(acaso() * 25)
        for (let k = 0; k < rajada; k++) pedidos.push({ order_id: pedidos.length + 1, date_confirmed: segundo })
        segundo += 1 + Math.floor(acaso() * 90)
      }
      const bl = baseLinkerFalso(pedidos, T)
      const row = linha({ paginas_por_rodada: 1 + Math.floor(acaso() * 3) })
      const banco = bancoFalso(row)
      const gravar = banco.db.gravarCursor.getMockImplementation()!
      let violacoes = 0
      banco.db.gravarCursor.mockImplementation(async (c, t, cursor) => {
        const desde = Number(cursor.date_confirmed_from)
        // Atrás do cursor: os segundos anteriores (o próprio segundo é relido, >=); com id_from, também
        // os pedidos do próprio segundo com número abaixo dele.
        const idFrom = cursor.id_from === undefined ? -Infinity : Number(cursor.id_from)
        const atras = (p: PedidoBLFalso) => p.date_confirmed < desde || (p.date_confirmed === desde && p.order_id < idFrom)
        violacoes += pedidos.filter((p) => atras(p) && !banco.pedidos.has(String(p.order_id))).length
        return gravar(c, t, cursor)
      })
      const montar = async () => bl.conector(row.config)
      for (let r = 0; r < 40; r++) {
        bl.falharNa = acaso() < 0.3 ? bl.consultas.length + 1 + Math.floor(acaso() * 4) : undefined
        await Promise.all([
          rodada(bl, banco),
          rodada(bl, banco),
          sincronizarConector(row, banco.db, montar, { origem: 'manual' }).catch(() => undefined),
        ])
        bl.agoraS += 300
      }
      bl.falharNa = undefined
      for (let r = 0; r < 10; r++) await rodada(bl, banco)
      const faltando = pedidos.filter((p) => !banco.pedidos.has(String(p.order_id))).length
      expect({ semente, violacoes, faltando }).toEqual({ semente, violacoes: 0, faltando: 0 })
    }
  })

  it('o botão nunca grava cursor, nem no meio de um segundo lotado', async () => {
    const bl = baseLinkerFalso(Array.from({ length: 300 }, (_, i) => ({ order_id: i + 1, date_confirmed: T - 60 })), T)
    const row = linha({ paginas_por_rodada: 5 })
    const banco = bancoFalso(row)
    await sincronizarConector(row, banco.db, async () => bl.conector(), { origem: 'manual' })
    expect(banco.db.gravarCursor).not.toHaveBeenCalled()
    expect(banco.db.marcarPulso).not.toHaveBeenCalled()
    expect(banco.db.setSyncState).not.toHaveBeenCalled()
    expect(banco.pedidos.size).toBe(300)
  })
})

describe('pulso do robô (sync_state.last_run_at)', () => {
  it('é gravado antes de decifrar a credencial e de falar com a plataforma, e termina valendo o início', async () => {
    const bl = baseLinkerFalso(pedidosEspacados(5, T - 3600), T)
    const row = linha()
    const banco = bancoFalso(row)
    await rodada(bl, banco)
    expect(banco.eventos[0]).toBe('pulso')
    expect(banco.eventos.indexOf('pulso')).toBeLessThan(banco.eventos.indexOf('montar'))
    // A RPC do fim regrava last_run_at com o fim da rodada; o contrato é o início.
    expect(banco.eventos.slice(-2)).toEqual(['rpc.ok', 'pulso'])
    expect(banco.sync()).toMatchObject({ last_run_at: new Date(T * 1000).toISOString(), last_ok_at: 'FIM-DA-RODADA' })
    // O pulso não mexe no cartão: quem marca ultimo_sync é o sucesso.
    expect(banco.db.marcarPulso).toHaveBeenCalledWith('c-bl', 't1', new Date(T * 1000).toISOString())
  })

  it('fica gravado quando a leitura falha, sem fingir sucesso', async () => {
    const bl = baseLinkerFalso(pedidosEspacados(5, T - 3600), T)
    bl.falharNa = 1
    const row = linha()
    const banco = bancoFalso(row)
    await rodada(bl, banco)
    expect(banco.eventos[0]).toBe('pulso')
    expect(banco.sync()).toMatchObject({ last_run_at: new Date(T * 1000).toISOString(), last_ok_at: null })
    expect(banco.cartao.ultimo_sync).toBeNull()
  })

  it('fica gravado quando nem o adaptador monta (credencial ilegível), antes de qualquer outra coisa', async () => {
    const row = linha()
    const banco = bancoFalso(row)
    await syncPedidos(env, banco.db, async () => {
      banco.eventos.push('montar')
      throw new Error('falha ao decifrar')
    }, () => T * 1000)
    expect(banco.eventos.slice(0, 2)).toEqual(['pulso', 'montar'])
    expect(banco.sync()?.last_run_at).toBe(new Date(T * 1000).toISOString())
  })

  it('pulso que não grava não impede a sincronização', async () => {
    const bl = baseLinkerFalso(pedidosEspacados(5, T - 3600), T)
    const row = linha()
    const banco = bancoFalso(row)
    banco.db.marcarPulso.mockRejectedValue(new Error('sync_state fora do ar'))
    const r = await rodada(bl, banco)
    expect(r).toMatchObject({ ok: 1, pedidos: 5 })
  })
})

describe('orders.raw', () => {
  it('sem anotação a chave nem vai para a RPC; a anotação pequena do webhook vai', () => {
    const base = { externalId: '1', status: '7', confirmedAt: null, updatedAt: null, total: 1, itens: [] }
    expect('raw' in paraRpc(base)).toBe(false)
    expect(paraRpc({ ...base, raw: { webhook: { eventId: 'e1' } } }).raw).toEqual({ webhook: { eventId: 'e1' } })
  })
})
