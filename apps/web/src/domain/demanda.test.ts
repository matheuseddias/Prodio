import { necessidadeDeCompra } from '@prodio/core/necessidade'
import { demandaVazia } from '@prodio/core/planejamento'
import { describe, expect, it } from 'vitest'
import { demandaDoBanco } from '../data/demanda'
import * as local from '../data/local'
import { MemoryRepo, snapshotExemplo } from '../data/memoryRepo'
import { avisoDaDemanda, bomsParaCore, emProducaoHoje, entradaNecessidade, foraDaTela, frescorDaTela, linhasParaAplicar, sugestoesDoDia } from './demanda'
import { demandaExemplo } from './mockDemanda'
import type { Bom, Connector, DailyPlanLine, DemandaResumo, Label, Material, Product, ScanEvent } from './types'

const AGORA = Date.parse('2026-09-26T15:00:00Z')
const produto = (id: string, extra: Partial<Product> = {}): Product => ({ id, sku: id.toUpperCase(), nome: id, familia: 'F', atributos: {}, status: 'ativo', aliases: [], temFicha: true, ...extra })
const tenant = { diasUteisMes: 30, margemProjecao: 0, diasCoberturaAcabado: 10 }
const demanda = (produtos: DemandaResumo['produtos'], extra: Partial<DemandaResumo> = {}): DemandaResumo => ({ ...demandaVazia(), dias: 14, produtos, ...extra })
const linhaPlano = (productId: string, projetado: number, impresso = 0, bipado = 0): DailyPlanLine => ({ productId, demandaDia: 0, projetado, impresso, bipado, carteira: 0, saldoHub: 0 })

describe('bomsParaCore', () => {
  it('perda da tela (percentual) vira fração para o core e só ficha ativa passa', () => {
    const boms: Bom[] = [
      { productId: 'a', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'insumo', materialId: 'm', consumo: 1, unidade: 'un', perdaPct: 8 }] },
      { productId: 'b', versao: 1, ativa: false, atualizadoEm: '', linhas: [] },
    ]
    const r = bomsParaCore(boms)
    expect(r).toHaveLength(1)
    expect(r[0].linhas[0].perdaPct).toBeCloseTo(0.08, 9)
    expect(boms[0].linhas[0].perdaPct).toBe(8) // não muda o estado
  })
})

describe('emProducaoHoje', () => {
  it('no plano vale impresso − bipado da linha; fora do plano, etiquetas impressas − bipes produzidos', () => {
    const labels: Label[] = [
      { serial: 'A1', productId: 'x', tipo: 'unidade', quantidade: 1, status: 'impressa', dia: '2026-09-26', seq: 1 },
      { serial: 'A2', productId: 'x', tipo: 'unidade', quantidade: 1, status: 'impressa', dia: '2026-09-26', seq: 2 },
      { serial: 'A3', productId: 'x', tipo: 'caixa', quantidade: 6, status: 'impressa', dia: '2026-09-26', seq: 3 },
      { serial: 'A4', productId: 'x', tipo: 'unidade', quantidade: 1, status: 'anulada', dia: '2026-09-26', seq: 4 },
    ]
    const bipe = (id: string, tipo: ScanEvent['tipo'], quantidade: number): ScanEvent => ({ id, serial: id, productId: 'x', operador: '', dispositivo: '', etapa: 'final', tipo, quantidade, em: '', competencia: '', sincronizado: true })
    const scans = [bipe('s1', 'produzido', 1), bipe('s2', 'estorno', -1)]
    expect(emProducaoHoje([linhaPlano('p', 10, 8, 3)], labels, scans)).toEqual({ x: 8 - 1, p: 5 })
    expect(emProducaoHoje([linhaPlano('p', 10, 2, 5)], [], [])).toEqual({ p: 0 })
  })
})

describe('sugestoesDoDia e linhasParaAplicar', () => {
  const products = [produto('a'), produto('b'), produto('c', { status: 'inativo' }), produto('d', { temFicha: false })]
  const d = demanda([
    { productId: 'a', vendido: 140, carteira: 2 },
    { productId: 'b', vendido: 28, carteira: 0 },
    { productId: 'c', vendido: 70, carteira: 0 },
    { productId: 'd', vendido: 14, carteira: 0 },
    { productId: 'sumiu', vendido: 99, carteira: 0 },
  ])

  it('produto inativo ou fora do cadastro não é sugerido; sem ficha é (produção não exige ficha)', () => {
    const s = sugestoesDoDia({ tenant, demanda: d, boms: [], products, dailyPlan: [], labels: [], scans: [] })
    expect(s.map((x) => [x.productId, x.sugerido])).toEqual([['a', 10], ['b', 2], ['d', 1]])
  })
  it('quem já está no plano fica marcado com o projetado atual e nunca entra no aplicar', () => {
    const s = sugestoesDoDia({ tenant, demanda: d, boms: [], products, dailyPlan: [linhaPlano('a', 3, 3, 1)], labels: [], scans: [] })
    const a = s.find((x) => x.productId === 'a')!
    expect(a).toMatchObject({ noPlano: true, projetadoAtual: 3, emProducao: 2, sugerido: 8 })
    const aplicar = linhasParaAplicar(s)
    expect(aplicar.map((l) => l.productId)).toEqual(['b', 'd'])
    expect(aplicar[0]).toEqual({ productId: 'b', demandaDia: 2, projetado: 2, impresso: 0, bipado: 0, carteira: 0, saldoHub: 0 })
  })
  it('a perda da ficha em percentual não explode a demanda derivada do componente', () => {
    const boms: Bom[] = [{ productId: 'a', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'produto', componentId: 'b', consumo: 2, unidade: 'un', perdaPct: 10 }] }]
    const s = sugestoesDoDia({ tenant, demanda: d, boms, products, dailyPlan: [], labels: [], scans: [] })
    // a: 10/dia → b derivado 10 × 2 × 1,10 = 22 (informativo: o bipe de a já baixa o insumo de b); o plano de b
    // cobre só a venda avulsa (2/dia), e o aplicar não põe a demanda dos pais no plano.
    const b = s.find((x) => x.productId === 'b')!
    expect(b.demandaDerivada).toBeCloseTo(22, 9)
    expect(b.demandaDia).toBeCloseTo(2, 9)
    expect(linhasParaAplicar(s).find((l) => l.productId === 'b')).toMatchObject({ projetado: 2, demandaDia: 2 })
  })
  it('aplicar no estado local não sobrescreve ajuste manual e ignora sugestão zero', () => {
    const base = { ...snapshotExemplo(), dailyPlan: [linhaPlano('a', 3)] }
    const r = local.adicionarAoPlano(base, [
      { ...linhaPlano('a', 50), demandaDia: 10 },
      { ...linhaPlano('b', 2), demandaDia: 2 },
      { ...linhaPlano('z', 0), demandaDia: 0 },
    ])
    expect(r.valor.map((l) => l.productId)).toEqual(['b'])
    expect(r.estado.dailyPlan.find((l) => l.productId === 'a')!.projetado).toBe(3)
    expect(r.estado.dailyPlan).toHaveLength(2)
  })
})

describe('MemoryRepo.adicionarAoPlano', () => {
  it('grava só as linhas novas e mantém o ajuste manual', async () => {
    const repo = new MemoryRepo({ ...snapshotExemplo(), dailyPlan: [linhaPlano('a', 3)] })
    const p = await repo.adicionarAoPlano([linhaPlano('a', 50), linhaPlano('b', 2)])
    expect(p.dailyPlan!.map((l) => [l.productId, l.projetado])).toEqual([['a', 3], ['b', 2]])
  })
})

describe('frescorDaTela e avisoDaDemanda', () => {
  const conector = (extra: Partial<Connector>): Connector => ({ id: 'c', plataforma: 'baselinker', nome: 'Base', status: 'conectado', capacidades: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false }, ...extra })
  const minAtras = (m: number) => new Date(AGORA - m * 60_000).toISOString()

  it('carga inicial ainda em agosto: aviso com a data do último pedido lido', () => {
    const d = demanda([], { ultimoPedido: '2026-08-12T13:00:00Z' })
    const f = frescorDaTela(d, [conector({ robo: { ultimoOk: minAtras(2), rodadas: 10 } })], AGORA)
    expect(f?.situacao).toBe('carga_atrasada')
    const a = avisoDaDemanda(d, f)!
    expect(a.tom).toBe('warn')
    expect(a.titulo).toContain('12/08/2026')
  })
  it('robô parado vira perigo; conector desconectado não conta; demanda ilegível avisa', () => {
    const d = demanda([], { ultimoPedido: minAtras(10) })
    expect(frescorDaTela(d, [conector({ robo: { ultimoOk: minAtras(180), rodadas: 1 } })], AGORA)?.situacao).toBe('robo_parado')
    expect(frescorDaTela(d, [conector({ status: 'desconectado', robo: { ultimoOk: minAtras(1), rodadas: 1 } })], AGORA)?.situacao).toBe('sem_conector')
    expect(frescorDaTela(demandaVazia(false), [], AGORA)).toBeNull()
    expect(avisoDaDemanda(demandaVazia(false), null)?.tom).toBe('danger')
    const emDia = frescorDaTela(d, [conector({ robo: { ultimoOk: minAtras(3), rodadas: 1 } })], AGORA)
    expect(avisoDaDemanda(d, emDia)).toBeNull()
  })
})

describe('foraDaTela', () => {
  it('produto vendido sem ficha e produto inativo/excluído aparecem; os SKUs sem produto vêm do banco', () => {
    const d = demanda([{ productId: 'a', vendido: 5, carteira: 0 }, { productId: 'd', vendido: 3, carteira: 0 }, { productId: 'sumiu', vendido: 2, carteira: 0 }], {
      skusSemProduto: [{ sku: 'ED9', unidades: 4, pedidos: 3 }],
      semProduto: { linhas: 3, unidades: 4, skus: 1 },
    })
    const f = foraDaTela(d, [produto('a'), produto('d', { temFicha: false })])
    expect(f.semFicha).toEqual([{ productId: 'd', vendido: 3 }])
    expect(f.inativos).toEqual([{ productId: 'sumiu', vendido: 2 }])
    expect(f.skusSemProduto[0].sku).toBe('ED9')
  })
})

describe('entradaNecessidade (tela de Necessidade pelo core)', () => {
  const m: Material = { id: 'm', sku: 'MP', nome: 'Chapa', unidadeCompra: 'un', unidadeConsumo: 'm2', fatorConversao: 2, minimo: 0, saldo: 10, custoMedio: 5, leadTimeDias: 5 }
  const boms: Bom[] = [{ productId: 'a', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'insumo', materialId: 'm', consumo: 0.5, unidade: 'm2', perdaPct: 10 }] }]
  const d = demanda([{ productId: 'a', vendido: 140, carteira: 0 }])
  const base = { hoje: '2026-09-26', demanda: d, tenant: { margemProjecao: 0, diasCobertura: 7 }, boms, materials: [m], suppliers: [], purchaseOrders: [] }

  it('métrica do mês: 30 dias de consumo (perda em fração) − saldo', () => {
    const l = necessidadeDeCompra(entradaNecessidade({ ...base, modo: 'metrica' })).linhas[0]
    // 140 em 14 dias × 0,5 × 1,1 = 5,5 m²/dia → 30 dias = 165 − saldo 10 = 155
    expect(l.consumoDia).toBeCloseTo(5.5, 9)
    expect(l.necessidade).toBeCloseTo(155, 9)
    expect(l.qtdCompra).toBe(78) // 155 ÷ 2, para cima
    expect(l.folgaDias).toBeCloseTo(10 / 5.5 - 5 - 7, 9)
  })
  it('por saldo: lead do insumo + dias de cobertura da empresa', () => {
    const l = necessidadeDeCompra(entradaNecessidade({ ...base, modo: 'saldo' })).linhas[0]
    expect(l.necessidade).toBeCloseTo(5.5 * (5 + 7) - 10, 9)
  })
  it('sem venda na janela, nada a comprar', () => {
    expect(necessidadeDeCompra(entradaNecessidade({ ...base, modo: 'metrica', demanda: demandaVazia() })).linhas).toEqual([])
  })
})

describe('demanda de exemplo e leitura do banco', () => {
  it('o exemplo usa a regra do banco: cancelado conta, ignorar não, e há SKU sem produto', () => {
    const d = demandaExemplo(14, AGORA)
    expect(d.exemplo).toBe(true)
    // um pedido por produto e dia (9 produtos) nos 14 dias + o cancelado + o do SKU sem produto; o orçamento ('ignorar') não
    expect(d.pedidos).toBe(14 * 9 + 2)
    expect(d.pedidos24h).toBe(9)
    const p1 = d.produtos.find((p) => p.productId === 'p1')!
    expect(p1.vendido).toBeLessThan(1000) // ~650: os 500 do orçamento ficaram de fora
    expect(d.skusSemProduto[0]).toMatchObject({ sku: 'ED000999', unidades: 12 })
    expect(demandaExemplo(30, AGORA).produtos.find((p) => p.productId === 'p1')!.vendido).toBeGreaterThan(p1.vendido)
  })
  it('demandaDoBanco converte o jsonb da RPC e nunca lança', () => {
    const d = demandaDoBanco({
      dias: '14', ultimo_pedido: '2026-09-26T14:00:00Z', pedidos: '5', pedidos_24h: 1, unidades: '23.0000',
      sem_produto: { linhas: 3, unidades: '6', skus: 2 },
      skus_sem_produto: [{ sku: 'ZZZ', unidades: '4', pedidos: 2 }, { sku: null, unidades: 2, pedidos: 1 }],
      produtos: [{ product_id: 'a', vendido: '14.0000', carteira: '3', ultimo_pedido: null }, { vendido: 1 }],
      hub: [{ product_id: 'a', saldo: '40', capturado_em: '2026-09-26T03:00:00Z' }],
    })
    expect(d).toMatchObject({ disponivel: true, dias: 14, pedidos: 5, pedidos24h: 1, unidades: 23, semProduto: { linhas: 3, unidades: 6, skus: 2 } })
    expect(d.skusSemProduto).toEqual([{ sku: 'ZZZ', unidades: 4, pedidos: 2 }, { sku: '', unidades: 2, pedidos: 1 }])
    expect(d.produtos).toEqual([{ productId: 'a', vendido: 14, carteira: 3, ultimoPedido: undefined }])
    expect(d.hub).toEqual([{ productId: 'a', saldo: 40, capturadoEm: '2026-09-26T03:00:00Z' }])
    expect(demandaDoBanco(null).disponivel).toBe(false)
    expect(demandaDoBanco({ dias: 'x' }).dias).toBe(14)
  })
})
