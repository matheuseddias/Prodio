// Testes adversariais da necessidade de compra: fornecedor sem OCs, lead time 0, insumo sem consumo, ABC com empates,
// datas inválidas e coberturas astronômicas.
import { curvaABC, emTransitoDasOcs, leadTimeAprendido, necessidadeDeCompra, type EntradasNecessidade } from './necessidade'
import type { Bom, Material, PurchaseOrder, Supplier } from './tipos'

const material = (id: string, over: Partial<Material> = {}): Material => ({ id, sku: id, nome: id, unidadeCompra: 'un', unidadeConsumo: 'un', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 1, leadTimeDias: 7, ...over })
const bom = (productId: string, materialId: string, consumo = 1): Bom => ({ productId, versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: 'l', tipo: 'insumo', materialId, consumo, unidade: 'un', perdaPct: 0 }] })
const oc = (id: string, over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({ id, numero: 1, supplierId: 'F1', status: 'recebida', criadaEm: '2026-08-01', entregaPrevista: '2026-08-11', condicaoPagamento: [30], itens: [], ...over })
const fornecedor: Supplier = { id: 'F1', nome: 'F1', cnpj: '1', regime: 'normal', leadTimeDias: 12, condicaoPagamento: [30] }
const base: EntradasNecessidade = { modo: 'por_saldo', hoje: '2026-09-21', demandaProdutos: { P: 300 }, periodoDias: 30, margem: 0, boms: [bom('P', 'MP', 1)], materiais: [material('MP', { fornecedorPadraoId: 'F1', saldo: 50 })], fornecedores: [fornecedor] }
const linha = (r: ReturnType<typeof necessidadeDeCompra>, id = 'MP') => r.linhas.find((l) => l.materialId === id)!

describe('lead time · casos-limite', () => {
  it('fornecedor sem OCs, só canceladas, ou sem entrega prevista: null e cai no cadastro', () => {
    expect(leadTimeAprendido('F1', [])).toBeNull()
    expect(leadTimeAprendido('F1', [oc('a', { status: 'cancelada' })])).toBeNull()
    expect(leadTimeAprendido('F1', [oc('a', { entregaPrevista: undefined })])).toBeNull()
    const r = necessidadeDeCompra({ ...base, ocs: [oc('a', { status: 'cancelada' })] })
    expect(linha(r).leadDias).toBe(12)
    expect(linha(r).leadAprendido).toBe(false)
  })
  it('OC entregue no mesmo dia (lead 0) conta como zero; entrega antes da criação é descartada', () => {
    expect(leadTimeAprendido('F1', [oc('a', { criadaEm: '2026-08-01', entregaPrevista: '2026-08-01' })])).toBe(0)
    expect(leadTimeAprendido('F1', [oc('a', { criadaEm: '2026-08-10', entregaPrevista: '2026-08-01' })])).toBeNull()
    const r = necessidadeDeCompra({ ...base, ocs: [oc('a', { criadaEm: '2026-08-01', entregaPrevista: '2026-08-01' })] })
    expect(linha(r).leadDias).toBe(0)
    expect(linha(r).leadAprendido).toBe(true)
  })
  it('datas inválidas na OC são ignoradas em vez de virar NaN', () => {
    expect(leadTimeAprendido('F1', [oc('a', { criadaEm: 'ontem', entregaPrevista: '2026-08-11' })])).toBeNull()
  })
  it('ultimasOcs 0 não divide por zero', () => {
    expect(leadTimeAprendido('F1', [oc('a')], { ultimasOcs: 0, leadMaxDias: 90 })).toBeNull()
  })
  it('lead time 0 no cadastro do fornecedor é respeitado', () => {
    const r = necessidadeDeCompra({ ...base, fornecedores: [{ ...fornecedor, leadTimeDias: 0 }] })
    expect(linha(r).leadDias).toBe(0)
  })
})

describe('em trânsito · casos-limite', () => {
  it('recebido acima do pedido não gera trânsito negativo; fator 0 vale 1; OC recebida não conta', () => {
    expect(emTransitoDasOcs([oc('a', { status: 'aberta', itens: [{ id: 'i', materialId: 'MP', unidadeCompra: 'un', fator: 0, qtd: 5, qtdRecebida: 9, preco: 1, ipiPct: 0 }] })])).toEqual({ MP: 0 })
    expect(emTransitoDasOcs([oc('a', { status: 'aberta', itens: [{ id: 'i', materialId: 'MP', unidadeCompra: 'un', fator: 0, qtd: 5, qtdRecebida: 0, preco: 1, ipiPct: 0 }] })])).toEqual({ MP: 5 })
    expect(emTransitoDasOcs([oc('a', { status: 'recebida', itens: [{ id: 'i', materialId: 'MP', unidadeCompra: 'un', fator: 1, qtd: 5, qtdRecebida: 0, preco: 1, ipiPct: 0 }] })])).toEqual({})
  })
  it('emTransito explícito sobrepõe as OCs, inclusive com objeto vazio', () => {
    const ocs = [oc('a', { status: 'aberta', itens: [{ id: 'i', materialId: 'MP', unidadeCompra: 'un', fator: 1, qtd: 500, qtdRecebida: 0, preco: 1, ipiPct: 0 }] })]
    expect(linha(necessidadeDeCompra({ ...base, ocs })).emTransito).toBe(500)
    expect(linha(necessidadeDeCompra({ ...base, ocs, emTransito: {} })).emTransito).toBe(0)
  })
})

describe('necessidade · insumo sem consumo, demanda zero, datas e coberturas', () => {
  it('insumo cadastrado sem consumo não aparece; demanda toda zero devolve vazio com total zero', () => {
    const r = necessidadeDeCompra({ ...base, materiais: [...base.materiais, material('OUTRO')] })
    expect(r.linhas.map((l) => l.materialId)).toEqual(['MP'])
    const vazio = necessidadeDeCompra({ ...base, demandaProdutos: { P: 0, Q: NaN, R: -5 } })
    expect(vazio).toMatchObject({ linhas: [], totalCusto: 0 })
  })
  it('hoje inválido não derruba o cálculo: comprarAte fica null', () => {
    const r = necessidadeDeCompra({ ...base, hoje: '' })
    expect(linha(r).comprarAte).toBeNull()
    expect(linha(r).necessidade).toBeGreaterThan(0)
    expect(linha(necessidadeDeCompra({ ...base, hoje: '21/09/2026' })).comprarAte).toBeNull()
  })
  it('cobertura astronômica (consumo ínfimo) não estoura a Date: comprarAte null e não atrasado', () => {
    const r = necessidadeDeCompra({ ...base, demandaProdutos: { P: 0.000001 }, saldos: { MP: 1e9 } })
    const l = linha(r)
    expect(l.necessidade).toBe(0)
    expect(l.comprarAte).toBeNull()
    expect(l.atrasado).toBe(false)
  })
  it('hoje com hora e fuso é aceito', () => {
    const r = necessidadeDeCompra({ ...base, hoje: '2026-09-21T15:00:00-03:00', saldos: { MP: 10000 } })
    expect(linha(r).comprarAte).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('margem NaN vale zero em vez de contaminar a linha', () => {
    const r = necessidadeDeCompra({ ...base, margem: NaN })
    expect(linha(r).margemUsada).toBe(0)
    expect(Number.isFinite(linha(r).necessidade)).toBe(true)
    const r2 = necessidadeDeCompra({ ...base, margemPorMaterial: { MP: NaN } })
    expect(linha(r2).margemUsada).toBe(0)
  })
  it('periodoDias zero ou negativo é tratado como 1, sem Infinity', () => {
    const r = necessidadeDeCompra({ ...base, periodoDias: 0 })
    expect(Number.isFinite(linha(r).qtdMes)).toBe(true)
    expect(linha(r).qtdMes).toBe(300 * 30)
  })
  it('saldo negativo (ledger no vermelho) aumenta a necessidade e dá cobertura negativa', () => {
    const r = necessidadeDeCompra({ ...base, saldos: { MP: -20 } })
    expect(linha(r).necessidade).toBeCloseTo(320, 6)
    expect(linha(r).coberturaDias).toBeLessThan(0)
    expect(linha(r).comprarAte).toBe('2026-09-21')
  })
  it('fatorConversao 0 no cadastro não zera nem explode a quantidade de compra', () => {
    const r = necessidadeDeCompra({ ...base, materiais: [material('MP', { fatorConversao: 0, custoMedio: 2 })] })
    expect(linha(r).qtdCompra).toBe(300)
    expect(linha(r).precoCompraUnit).toBe(2)
  })
  it('insumo sem cadastro em por_saldo: saldo 0, lead padrão, custo zero, curva C', () => {
    const r = necessidadeDeCompra({ ...base, materiais: [] })
    expect(linha(r)).toMatchObject({ semCadastro: true, saldo: 0, custoTotal: 0, curva: 'C' })
    expect(linha(r).leadDias).toBe(7)
  })
})

describe('curva ABC · empates', () => {
  it('valores iguais recebem a mesma curva (o empate não separa A de C)', () => {
    const r = curvaABC([{ id: 'a', valor: 10 }, { id: 'b', valor: 10 }, { id: 'c', valor: 10 }, { id: 'd', valor: 10 }])
    expect(new Set(Object.values(r)).size).toBe(1)
    expect(r.a).toBe('A')
  })
  it('empate na fronteira: quem empata com um A vira A', () => {
    const r = curvaABC([{ id: 'a', valor: 80 }, { id: 'b', valor: 10 }, { id: 'c', valor: 10 }])
    expect(r.a).toBe('A')
    expect(r.b).toBe(r.c)
  })
  it('um único item com valor é A, não C', () => {
    expect(curvaABC([{ id: 'a', valor: 42 }])).toEqual({ a: 'A' })
    expect(curvaABC([{ id: 'a', valor: 99 }, { id: 'b', valor: 1 }])).toEqual({ a: 'A', b: 'C' })
  })
  it('valores negativos e NaN não quebram o acumulado', () => {
    const r = curvaABC([{ id: 'a', valor: 100 }, { id: 'b', valor: -5 }, { id: 'c', valor: NaN }])
    expect(r.a).toBe('A')
    expect(r.b).toBe('C')
    expect(r.c).toBe('C')
  })
  it('lista vazia', () => {
    expect(curvaABC([])).toEqual({})
  })
})
