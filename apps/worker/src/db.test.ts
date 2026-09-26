// Db contra um PostgREST de mentira, com o cliente real do supabase-js (postgrestFalso.ts).
//
// Incidente de 25/09/2026: listarConectoresAtivos e getConector pediam `tenants(slug, fuso)` em
// embed e o PostgREST respondia PGRST201. Nenhum teste viu porque todos os jobs rodam com Db falso.
// Aqui a consulta que sai para o PostgREST é conferida de verdade.
import { ErroBanco, camposDoErro } from './db'
import { silenciarLog } from './log'
import { RESPOSTA_PGRST201, colunas, postgrestFalso, type PedidoPostgrest } from './postgrestFalso'

silenciarLog(true)

afterEach(() => {
  vi.restoreAllMocks()
  silenciarLog(true)
})

const conector = (id: string, tenant: string, status = 'conectado') => ({ id, tenant_id: tenant, plataforma: 'baselinker', nome: id, status, config: { dry_run: true } })
const TENANTS = [
  { id: 't1', slug: 'eddias', fuso: 'America/Sao_Paulo' },
  { id: 't2', slug: 'outra', fuso: 'America/Manaus' },
]

// Devolve só os tenants pedidos no filtro `id=in.(…)`, como o PostgREST faria.
function tenantsPedidos(p: PedidoPostgrest, base = TENANTS) {
  const ids = (p.params.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',')
  return base.filter((t) => ids.includes(t.id))
}

describe('Db.listarConectoresAtivos', () => {
  it('duas consultas simples, sem embed; o tenant é lido uma vez por id e o ausente vira null', async () => {
    const { db, pedidos } = postgrestFalso((p) => {
      if (p.tabela === 'connectors') return { status: 200, corpo: [conector('a', 't1'), conector('b', 't1', 'erro'), conector('c', 't2'), conector('d', 't9')] }
      if (p.tabela === 'tenants') return { status: 200, corpo: tenantsPedidos(p) }
      return { status: 404, corpo: { message: 'inesperado' } }
    })
    const lista = await db.listarConectoresAtivos()

    expect(pedidos.map((p) => `${p.metodo} ${p.tabela}`)).toEqual(['GET connectors', 'GET tenants'])
    const [con, ten] = pedidos
    expect(colunas(con)).toBe('id,tenant_id,plataforma,nome,status,config,ultimo_erro')
    expect(colunas(con)).not.toContain('(')
    expect(con.params.get('status')).toBe('in.(conectado,erro)')
    expect(colunas(ten)).toBe('id,slug,fuso')
    expect(ten.params.get('id')).toBe('in.(t1,t2,t9)')

    expect(lista.map((r) => [r.id, r.tenants])).toEqual([
      ['a', { slug: 'eddias', fuso: 'America/Sao_Paulo' }],
      ['b', { slug: 'eddias', fuso: 'America/Sao_Paulo' }],
      ['c', { slug: 'outra', fuso: 'America/Manaus' }],
      ['d', null],
    ])
    expect(lista[0]).toEqual({ ...conector('a', 't1'), tenants: { slug: 'eddias', fuso: 'America/Sao_Paulo' } })
  })

  // O cron é multi-tenant e o filtro de tenants vai na URL (`id=in.(…)`, ~39 bytes por uuid já
  // codificado). Um select só com todos os tenants passa do limite de URL do gateway; em lotes, não.
  it('muitos tenants: lotes de até 100 ids, URL curta, todos os tenants achados', async () => {
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const base = Array.from({ length: 250 }, (_, i) => ({ id: uuid(i), slug: `t${i}`, fuso: 'America/Sao_Paulo' }))
    const { db, pedidos } = postgrestFalso((p) =>
      p.tabela === 'connectors' ? { status: 200, corpo: base.map((t, i) => conector(`c${i}`, t.id)) } : { status: 200, corpo: tenantsPedidos(p, base) },
    )
    const lista = await db.listarConectoresAtivos()

    const deTenants = pedidos.filter((p) => p.tabela === 'tenants')
    expect(deTenants.map((p) => (p.params.get('id') ?? '').split(',').length)).toEqual([100, 100, 50])
    for (const p of deTenants) expect(p.params.toString().length).toBeLessThan(5000)
    expect(lista).toHaveLength(250)
    expect(lista.every((r) => r.tenants?.slug === `t${r.id.slice(1)}`)).toBe(true)
  })

  it('um lote de tenants que falha não apaga os outros', async () => {
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const base = Array.from({ length: 150 }, (_, i) => ({ id: uuid(i), slug: `t${i}`, fuso: 'America/Manaus' }))
    let consultas = 0
    const { db } = postgrestFalso((p) => {
      if (p.tabela === 'connectors') return { status: 200, corpo: base.map((t, i) => conector(`c${i}`, t.id)) }
      return ++consultas === 1 ? { status: 400, corpo: { code: '57014', message: 'timeout' } } : { status: 200, corpo: tenantsPedidos(p, base) }
    })
    const lista = await db.listarConectoresAtivos()
    expect(lista.filter((r) => r.tenants === null)).toHaveLength(100)
    expect(lista.filter((r) => r.tenants?.fuso === 'America/Manaus')).toHaveLength(50)
  })

  it('lista vazia não faz a segunda consulta', async () => {
    const { db, pedidos } = postgrestFalso(() => ({ status: 200, corpo: [] }))
    expect(await db.listarConectoresAtivos()).toEqual([])
    expect(pedidos.map((p) => p.tabela)).toEqual(['connectors'])
  })

  it('tenants que não responde não derruba o robô: fuso padrão no adaptador e aviso no log', async () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})
    silenciarLog(false)
    const { db } = postgrestFalso((p) =>
      p.tabela === 'connectors' ? { status: 200, corpo: [conector('a', 't1')] } : { status: 500, corpo: { code: '57014', message: 'canceling statement due to statement timeout' } },
    )
    expect((await db.listarConectoresAtivos()).map((r) => r.tenants)).toEqual([null])
    const linha = JSON.parse(String(avisos.mock.calls[0][0])) as Record<string, unknown>
    expect(linha).toMatchObject({ nivel: 'warn', evento: 'db.tenants', codigo: '57014', tenants: ['t1'] })
  })

  it('erro do PostgREST vira ErroBanco com código, detalhe e dica (o PGRST201 do incidente)', async () => {
    const { db } = postgrestFalso(() => RESPOSTA_PGRST201)
    const e = await db.listarConectoresAtivos().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroBanco)
    const erro = e as ErroBanco
    expect(erro.message).toContain('listarConectoresAtivos: Could not embed')
    expect(erro.codigo).toBe('PGRST201')
    // `details` do PGRST201 é uma lista, não texto: vira JSON para caber no log.
    expect(erro.detalhes).toContain('many-to-many')
    expect(erro.dica).toContain('tenants!connectors_tenant_id_fkey')
    const campos = camposDoErro(e)
    expect(campos.codigo).toBe('PGRST201')
    expect(campos.detalhes).toContain('hub_stock_snapshots') // os três relacionamentos cabem no log
    expect(camposDoErro(new Error('x'))).toEqual({})
  })
})

describe('Db.getConector', () => {
  it('duas consultas simples, sem embed', async () => {
    const { db, pedidos } = postgrestFalso((p) => (p.tabela === 'connectors' ? { status: 200, corpo: [conector('a', 't2')] } : { status: 200, corpo: tenantsPedidos(p) }))
    expect(await db.getConector('a')).toEqual({ ...conector('a', 't2'), tenants: { slug: 'outra', fuso: 'America/Manaus' } })
    expect(pedidos.map((p) => p.tabela)).toEqual(['connectors', 'tenants'])
    expect(colunas(pedidos[0])).toBe('id,tenant_id,plataforma,nome,status,config,ultimo_erro')
    expect(pedidos[0].params.get('id')).toBe('eq.a')
    expect(pedidos[1].params.get('id')).toBe('in.(t2)')
  })

  it('conector que não existe devolve null sem consultar tenants; tenant ausente vira null', async () => {
    const vazio = postgrestFalso(() => ({ status: 200, corpo: [] }))
    expect(await vazio.db.getConector('x')).toBeNull()
    expect(vazio.pedidos).toHaveLength(1)

    const orfao = postgrestFalso((p) => (p.tabela === 'connectors' ? { status: 200, corpo: [conector('a', 't9')] } : { status: 200, corpo: [] }))
    expect((await orfao.db.getConector('a'))?.tenants).toBeNull()
  })
})

describe('Db: o que o aviso de listagem usa', () => {
  it('leitura mínima e UPDATE só de ultimo_erro, sem ressuscitar desconectado', async () => {
    const { db, pedidos } = postgrestFalso((p) => (p.metodo === 'GET' ? { status: 200, corpo: [{ id: 'a', tenant_id: 't1', status: 'conectado', ultimo_erro: null }] } : { status: 204 }))
    expect(await db.listarConectoresParaAviso()).toHaveLength(1)
    await db.avisarNoCartao('a', 't1', 'x'.repeat(600))

    expect(colunas(pedidos[0])).toBe('id,tenant_id,status,ultimo_erro')
    expect(pedidos[0].params.get('status')).toBe('in.(conectado,erro)')
    const patch = pedidos[1]
    expect(patch.metodo).toBe('PATCH')
    expect(patch.tabela).toBe('connectors')
    expect(Object.fromEntries(patch.params)).toEqual({ id: 'eq.a', tenant_id: 'eq.t1', status: 'neq.desconectado' })
    // Status fica como está: em 'erro', enqueue_outbox pararia de enfileirar o estoque produzido.
    expect(patch.corpo).toEqual({ ultimo_erro: 'x'.repeat(500) })
  })

  it('limpeza do aviso: só ultimo_erro, só se ainda for o aviso, no conector e tenant da linha', async () => {
    const { db, pedidos } = postgrestFalso(() => ({ status: 204 }))
    await db.limparAvisoNoCartao('a', 't1', 'cron:')
    expect(pedidos.map((p) => `${p.metodo} ${p.tabela}`)).toEqual(['PATCH connectors'])
    expect(Object.fromEntries(pedidos[0].params)).toEqual({ id: 'eq.a', tenant_id: 'eq.t1', ultimo_erro: 'like.cron:%' })
    expect(pedidos[0].corpo).toEqual({ ultimo_erro: null })
  })
})
