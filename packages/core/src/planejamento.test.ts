// Planejamento pela média de vendas: a regra dos pedidos que contam (cancelado conta, 'ignorar' não), a
// demanda por dia de produção, os componentes fabricados, a sugestão do dia e o diagnóstico.
import {
  contaNaDemanda,
  demandaPorDiaDeProducao,
  demandaVazia,
  foraDaDemanda,
  frescorDaDemanda,
  janelaDaDemanda,
  resumirPedidos,
  sugerirPlanoDoDia,
  vendasPorProduto,
  type PedidoParaResumo,
} from './planejamento'
import type { Bom } from './tipos'
import type { DemandaResumo } from './tipos-demanda'

const AGORA = Date.parse('2026-09-26T15:00:00Z')
const haDias = (d: number, h = 0) => new Date(AGORA - d * 86_400_000 - h * 3_600_000).toISOString()
const item = (sku: string, productId: string | null, quantidade: number) => ({ sku, productId, quantidade })

describe('contaNaDemanda (decisão de 25/09)', () => {
  it('todo pedido confirmado conta, inclusive cancelado e enviado; só ignorar fica fora', () => {
    expect(contaNaDemanda('demanda')).toBe(true)
    expect(contaNaDemanda('carteira')).toBe(true)
    expect(contaNaDemanda('enviado')).toBe(true)
    expect(contaNaDemanda('cancelado')).toBe(true)
    expect(contaNaDemanda(null)).toBe(true) // status fora do De-Para
    expect(contaNaDemanda(undefined)).toBe(true)
    expect(contaNaDemanda('ignorar')).toBe(false)
  })
})

describe('janelaDaDemanda', () => {
  it('inteiro entre 1 e 90; lixo vira 14', () => {
    expect(janelaDaDemanda(30)).toBe(30)
    expect(janelaDaDemanda(7.9)).toBe(7)
    expect(janelaDaDemanda(400)).toBe(90)
    expect(janelaDaDemanda(0)).toBe(14)
    expect(janelaDaDemanda(-3)).toBe(14)
    expect(janelaDaDemanda(undefined)).toBe(14)
    expect(janelaDaDemanda(Number.NaN)).toBe(14)
  })
})

describe('demandaPorDiaDeProducao (item 17)', () => {
  it('venda da janela → mensal (30 dias corridos) ÷ dias úteis, com margem', () => {
    // 140 em 14 dias = 10/dia corrido = 300/mês; 22 dias úteis → 13,64 por dia de produção
    expect(demandaPorDiaDeProducao(140, 14, 22)).toBeCloseTo(300 / 22, 9)
    expect(demandaPorDiaDeProducao(140, 14, 22, 0.1)).toBeCloseTo((300 * 1.1) / 22, 9)
    // 30 dias úteis = dia corrido
    expect(demandaPorDiaDeProducao(140, 14, 30)).toBeCloseTo(10, 9)
  })
  it('dias úteis inválidos caem no dia corrido; venda ou janela inválida dão zero', () => {
    expect(demandaPorDiaDeProducao(140, 14, 0)).toBeCloseTo(10, 9)
    expect(demandaPorDiaDeProducao(0, 14, 22)).toBe(0)
    expect(demandaPorDiaDeProducao(140, 0, 22)).toBe(0)
  })
})

describe('resumirPedidos (mesmo recorte da RPC demand_summary)', () => {
  const pedidos: PedidoParaResumo[] = [
    { id: 'o1', confirmadoEm: haDias(1, 1), significado: 'demanda', itens: [item('ED1', 'P1', 2), item('ED2', 'P2', 1)] },
    { id: 'o2', confirmadoEm: haDias(2), significado: 'cancelado', itens: [item('ED1', 'P1', 3)] },
    { id: 'o3', confirmadoEm: haDias(3), significado: 'enviado', itens: [item('ED1', 'P1', 4)] },
    { id: 'o4', confirmadoEm: haDias(0, 2), significado: 'carteira', itens: [item('ED2', 'P2', 5), item('ZZ9', null, 7)] },
    { id: 'o5', confirmadoEm: haDias(0, 1), significado: 'ignorar', itens: [item('ED1', 'P1', 100)] },
    { id: 'o6', confirmadoEm: haDias(4), significado: null, itens: [item('ZZ9', null, 1), item('', null, 2)] },
    { id: 'o7', confirmadoEm: haDias(20), significado: 'demanda', itens: [item('ED1', 'P1', 50)] },
    { id: 'o8', confirmadoEm: null, significado: 'demanda', itens: [item('ED1', 'P1', 60)] },
  ]
  const r = resumirPedidos(pedidos, { dias: 14, agora: AGORA })

  it('cancelado, enviado e sem significado contam; ignorar, fora da janela e sem confirmação não', () => {
    const p1 = r.produtos.find((p) => p.productId === 'P1')!
    expect(p1.vendido).toBe(2 + 3 + 4)
    expect(r.pedidos).toBe(5) // o1, o2, o3, o4, o6
    expect(r.unidades).toBe(2 + 1 + 3 + 4 + 5 + 7 + 1 + 2)
  })
  it('carteira é só o significado carteira; pedidos 24 h pela confirmação', () => {
    const p2 = r.produtos.find((p) => p.productId === 'P2')!
    expect(p2).toMatchObject({ vendido: 6, carteira: 5, ultimoPedido: haDias(0, 2) })
    expect(r.produtos.find((p) => p.productId === 'P1')!.carteira).toBe(0)
    expect(r.pedidos24h).toBe(1) // o4 (o5 é ignorar)
  })
  it('SKUs sem produto: total e lista pelos que mais vendem', () => {
    expect(r.semProduto).toEqual({ linhas: 3, unidades: 10, skus: 2 })
    expect(r.skusSemProduto).toEqual([
      { sku: 'ZZ9', unidades: 8, pedidos: 2 },
      { sku: '', unidades: 2, pedidos: 1 },
    ])
    expect(resumirPedidos(pedidos, { dias: 14, agora: AGORA, limiteSkus: 1 }).skusSemProduto).toHaveLength(1)
  })
  it('último pedido é o de qualquer pedido gravado (diz até onde o robô leu), mesmo ignorar', () => {
    expect(r.ultimoPedido).toBe(haDias(0, 1))
    expect(r.dias).toBe(14)
    expect(r.desde).toBe(haDias(14))
    expect(resumirPedidos([], { agora: AGORA })).toMatchObject({ ultimoPedido: undefined, pedidos: 0, dias: 14, disponivel: true })
  })
  it('produtos do mais vendido para o menos; vendasPorProduto só com venda', () => {
    expect(r.produtos.map((p) => p.productId)).toEqual(['P1', 'P2'])
    expect(vendasPorProduto(r)).toEqual({ P1: 9, P2: 6 })
    expect(vendasPorProduto({ produtos: [{ productId: 'X', vendido: 0, carteira: 0 }] })).toEqual({})
  })
})

describe('sugerirPlanoDoDia', () => {
  // ESPELHO leva 2 PINOS (componente fabricado); PINO também é vendido avulso.
  const boms: Bom[] = [
    { productId: 'ESPELHO', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'produto', componentId: 'PINO', consumo: 2, unidade: 'un', perdaPct: 0 }, { id: '2', tipo: 'insumo', materialId: 'MP1', consumo: 1, unidade: 'un', perdaPct: 0 }] },
    { productId: 'PINO', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '3', tipo: 'insumo', materialId: 'PETG', consumo: 0.004, unidade: 'kg', perdaPct: 0 }] },
  ]
  const parametros = { diasUteisMes: 30, margem: 0, diasCobertura: 10 }
  const demanda = (produtos: DemandaResumo['produtos'], hub: DemandaResumo['hub'] = []) => ({ dias: 14, produtos, hub })

  // O bipe do ESPELHO já baixa o PETG do PINO (explode_bom desce na ficha do componente). Se o PINO entrasse no plano
  // pela demanda derivada, seria impresso e bipado à parte e o PETG baixaria duas vezes. Como no ES (componente fora da
  // projeção do dia), a demanda derivada é só informativa: o sugerido cobre a venda avulsa do componente.
  it('componente fabricado: a demanda dos pais é informativa e o sugerido cobre só a venda avulsa', () => {
    const s = sugerirPlanoDoDia({ demanda: demanda([{ productId: 'ESPELHO', vendido: 140, carteira: 0 }, { productId: 'PINO', vendido: 14, carteira: 0 }]), boms, parametros })
    const pino = s.find((x) => x.productId === 'PINO')!
    expect(pino.demandaDireta).toBeCloseTo(1, 9)
    expect(pino.demandaDerivada).toBeCloseTo(20, 9)
    expect(pino.demandaDia).toBeCloseTo(1, 9)
    expect(pino.componente).toBe(true)
    expect(pino.sugerido).toBe(1)
    expect(s.find((x) => x.productId === 'ESPELHO')).toMatchObject({ demandaDerivada: 0, componente: false, sugerido: 10, base: 'dia' })
  })
  it('componente só derivado (sem venda avulsa) aparece, mas com sugerido zero: não entra no plano', () => {
    const s = sugerirPlanoDoDia({ demanda: demanda([{ productId: 'ESPELHO', vendido: 70, carteira: 0 }]), boms, parametros })
    expect(s.map((x) => [x.productId, x.sugerido])).toEqual([['ESPELHO', 5], ['PINO', 0]])
    expect(s[1]).toMatchObject({ vendido: 0, demandaDireta: 0, demandaDia: 0, componente: true })
    expect(s[1].demandaDerivada).toBeCloseTo(10, 9)
  })
  it('com saldo no hub: demanda × cobertura − saldo − em produção', () => {
    const s = sugerirPlanoDoDia({ demanda: demanda([{ productId: 'ESPELHO', vendido: 140, carteira: 3 }], [{ productId: 'ESPELHO', saldo: 50 }]), boms: [], parametros, emProducao: { ESPELHO: 5 } })
    expect(s[0]).toMatchObject({ productId: 'ESPELHO', base: 'cobertura', saldoHub: 50, emProducao: 5, carteira: 3, sugerido: 10 * 10 - 50 - 5 })
  })
  it('sem saldo no hub: meta do dia (demanda de um dia − em produção), arredondada para cima', () => {
    const s = sugerirPlanoDoDia({ demanda: demanda([{ productId: 'A', vendido: 3, carteira: 0 }, { productId: 'B', vendido: 140, carteira: 0 }]), boms: [], parametros, emProducao: { B: 4, A: -2 } })
    expect(s.find((x) => x.productId === 'A')).toMatchObject({ base: 'dia', saldoHub: undefined, emProducao: 0, sugerido: 1 }) // 0,21/dia → 1
    expect(s.find((x) => x.productId === 'B')!.sugerido).toBe(6) // 10 − 4
  })
  it('dia de produção e margem: 140 em 14 dias, 22 úteis, margem 10% → 15/dia', () => {
    const s = sugerirPlanoDoDia({ demanda: demanda([{ productId: 'A', vendido: 140, carteira: 0 }]), boms: [], parametros: { diasUteisMes: 22, margem: 0.1, diasCobertura: 1 } })
    expect(s[0].demandaDia).toBeCloseTo(15, 9)
    expect(s[0].sugerido).toBe(15)
  })
  it('pedido cancelado gera sugestão (o resumo conta o cancelado)', () => {
    const r = resumirPedidos([{ id: 'c', confirmadoEm: haDias(1), significado: 'cancelado', itens: [item('ED1', 'A', 28)] }], { dias: 14, agora: AGORA })
    const s = sugerirPlanoDoDia({ demanda: r, boms: [], parametros })
    expect(s[0]).toMatchObject({ productId: 'A', vendido: 28, sugerido: 2 })
  })
  it('produto inativo ou excluído fica fora; venda zero não gera linha', () => {
    const s = sugerirPlanoDoDia({ demanda: demanda([{ productId: 'A', vendido: 14, carteira: 0 }, { productId: 'B', vendido: 14, carteira: 0 }, { productId: 'C', vendido: 0, carteira: 0 }]), boms: [], parametros, elegivel: (id) => id !== 'B' })
    expect(s.map((x) => x.productId)).toEqual(['A'])
  })
})

describe('foraDaDemanda', () => {
  it('separa vendidos sem ficha e inativos; repassa os SKUs sem produto', () => {
    const d = { ...demandaVazia(), produtos: [
      { productId: 'COM', vendido: 5, carteira: 0 },
      { productId: 'SEM', vendido: 3, carteira: 0 },
      { productId: 'SEM2', vendido: 9, carteira: 0 },
      { productId: 'OFF', vendido: 2, carteira: 0 },
      { productId: 'ZERO', vendido: 0, carteira: 0 },
    ], skusSemProduto: [{ sku: 'X', unidades: 4, pedidos: 2 }], semProduto: { linhas: 2, unidades: 4, skus: 1 } }
    const f = foraDaDemanda(d, { ativo: (id) => id !== 'OFF', temFicha: (id) => id === 'COM' })
    expect(f.semFicha).toEqual([{ productId: 'SEM2', vendido: 9 }, { productId: 'SEM', vendido: 3 }])
    expect(f.inativos).toEqual([{ productId: 'OFF', vendido: 2 }])
    expect(f.skusSemProduto).toEqual([{ sku: 'X', unidades: 4, pedidos: 2 }])
    expect(f.semProduto.unidades).toBe(4)
  })
})

describe('frescorDaDemanda', () => {
  const ok = (h: number) => ({ ultimoOk: haDias(0, h), lido: true })
  it('em dia: robô rodou há pouco e o último pedido é de hoje', () => {
    expect(frescorDaDemanda({ ultimoPedido: haDias(0, 3), robos: [ok(0.1)], agora: AGORA })).toMatchObject({ situacao: 'em_dia', desatualizada: false })
  })
  it('sem conector de pedidos ativo', () => {
    expect(frescorDaDemanda({ ultimoPedido: haDias(0, 1), robos: [], agora: AGORA }).situacao).toBe('sem_conector')
  })
  it('robô parado: nenhuma rodada boa há mais de 1 h (o mais recente entre os conectores vale)', () => {
    const f = frescorDaDemanda({ ultimoPedido: haDias(0, 1), robos: [ok(3), ok(2)], agora: AGORA })
    expect(f).toMatchObject({ situacao: 'robo_parado', desatualizada: true, ultimoOk: haDias(0, 2) })
    expect(frescorDaDemanda({ ultimoPedido: haDias(0, 1), robos: [{ lido: true }], agora: AGORA }).situacao).toBe('robo_parado')
  })
  it('robô que a tela não leu não acusa parada', () => {
    expect(frescorDaDemanda({ ultimoPedido: haDias(0, 1), robos: [{ lido: false }], agora: AGORA }).situacao).toBe('em_dia')
  })
  it('sem pedido gravado, ou último pedido lido com mais de 24 h (carga inicial ainda andando)', () => {
    expect(frescorDaDemanda({ robos: [ok(0)], agora: AGORA }).situacao).toBe('sem_pedidos')
    expect(frescorDaDemanda({ ultimoPedido: '2026-08-12T10:00:00Z', robos: [ok(0)], agora: AGORA })).toMatchObject({ situacao: 'carga_atrasada', desatualizada: true })
  })
})
