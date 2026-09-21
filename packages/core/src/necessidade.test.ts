import { SEED_BOMS, SEED_MARGEM, SEED_MATERIAIS, SEED_PERIODO_DIAS, SEED_VENDAS } from './fixtures/seed-eddias'
import { curvaABC, emTransitoDasOcs, leadTimeAprendido, necessidadeDeCompra, PARAMETROS_PADRAO, type EntradasNecessidade } from './necessidade'
import type { PurchaseOrder, Supplier } from './tipos'

const demanda = Object.fromEntries(SEED_VENDAS.map((v) => [v.productId, v.vendas]))
const fornecedor: Supplier = { id: 'F1', nome: 'Vidros Exemplo', cnpj: '98765432000110', regime: 'normal', leadTimeDias: 12, condicaoPagamento: [30] }
const oc = (id: string, criadaEm: string, entregaPrevista: string, status: PurchaseOrder['status'] = 'recebida', itens: PurchaseOrder['itens'] = []): PurchaseOrder => ({ id, numero: 1, supplierId: 'F1', status, criadaEm, entregaPrevista, condicaoPagamento: [30], itens })
const materiais = SEED_MATERIAIS.map((m) => (m.id === 'MP0078' ? { ...m, fornecedorPadraoId: 'F1', saldo: 100 } : m))
const base: EntradasNecessidade = { modo: 'metrica_mes', hoje: '2026-09-21', demandaProdutos: demanda, periodoDias: SEED_PERIODO_DIAS, margem: SEED_MARGEM, boms: SEED_BOMS, materiais, fornecedores: [fornecedor] }

describe('necessidadeDeCompra · metrica_mes', () => {
  it('chapa de espelho: demanda × ficha explodida, normalizada a 30 dias com margem, sem olhar saldo', () => {
    const r = necessidadeDeCompra(base)
    const chapa = r.linhas.find((l) => l.materialId === 'MP0078')!
    // 1622 × 0,16 + 1555 × 0,25 = 648,27 m² em 15 dias → 1296,54/mês → ×1,1 = 1426,19
    expect(chapa.qtdPeriodo).toBeCloseTo(648.27, 2)
    expect(chapa.qtdMes).toBeCloseTo(1296.54, 2)
    expect(chapa.qtdFinal).toBeCloseTo(1426.194, 2)
    expect(chapa.necessidade).toBeCloseTo(1426.194, 2)
    expect(chapa.tetoMes).toBeCloseTo(1296.54 * 1.07, 2)
    expect(chapa.custoTotal).toBeCloseTo(1426.194 * 33.43, 1)
    expect(chapa.qtdCompra).toBe(1427)
  })
  it('linhas ordenadas por custo, total soma tudo e produto sem ficha não gera insumo', () => {
    const r = necessidadeDeCompra(base)
    expect(r.linhas[0].materialId).toBe('MP0078')
    expect(r.linhas.map((l) => l.materialId)).not.toContain('ED000707')
    expect(r.totalCusto).toBeCloseTo(r.linhas.reduce((a, l) => a + l.custoTotal, 0), 6)
    expect(r.parametros).toEqual(PARAMETROS_PADRAO)
  })
  it('margem individual sobrepõe a geral e insumo sem cadastro é sinalizado', () => {
    const r = necessidadeDeCompra({ ...base, margemPorMaterial: { MP0078: 0.25 }, materiais: materiais.filter((m) => m.id !== 'MP0064') })
    const chapa = r.linhas.find((l) => l.materialId === 'MP0078')!
    expect(chapa.margemUsada).toBe(0.25)
    expect(chapa.qtdFinal).toBeCloseTo(1296.54 * 1.25, 2)
    const caixa = r.linhas.find((l) => l.materialId === 'MP0064')!
    expect(caixa.semCadastro).toBe(true)
    expect(caixa.custoTotal).toBe(0)
  })
  it('curva ABC 80/95 por valor', () => {
    const r = necessidadeDeCompra(base)
    expect(r.linhas[0].curva).toBe('A')
    expect(r.linhas[r.linhas.length - 1].curva).toBe('C')
    expect(curvaABC([{ id: 'a', valor: 70 }, { id: 'b', valor: 20 }, { id: 'c', valor: 7 }, { id: 'd', valor: 3 }])).toEqual({ a: 'A', b: 'B', c: 'C', d: 'C' })
    expect(curvaABC([{ id: 'a', valor: 0 }])).toEqual({ a: 'C' })
  })
})

describe('necessidadeDeCompra · por_saldo', () => {
  const ocs = [
    oc('o1', '2026-08-01', '2026-08-11'),
    oc('o2', '2026-08-15', '2026-08-29'),
    oc('o3', '2026-09-01', '2026-09-13', 'aberta', [{ id: 'i1', materialId: 'MP0078', unidadeCompra: 'm2', fator: 1, qtd: 200, qtdRecebida: 50, preco: 44.92, ipiPct: 0.1 }]),
    oc('o4', '2026-05-01', '2026-09-01'), // 123 dias: descartada (> leadMaxDias)
    oc('o5', '2026-07-01', '2026-07-05', 'cancelada'),
  ]
  it('lead time aprendido pelas últimas OCs do fornecedor, com fallback no cadastro', () => {
    expect(leadTimeAprendido('F1', ocs)).toBe(12) // (10 + 14 + 12) / 3
    expect(leadTimeAprendido('F1', ocs, { ultimasOcs: 1, leadMaxDias: 90 })).toBe(12) // só a mais recente (o3)
    expect(leadTimeAprendido('F9', ocs)).toBeNull()
  })
  it('em trânsito soma o que falta receber das OCs abertas/parciais em unidade de consumo', () => {
    expect(emTransitoDasOcs(ocs)).toEqual({ MP0078: 150 })
    expect(emTransitoDasOcs([oc('x', '2026-09-01', '2026-09-10', 'parcial', [{ id: 'i', materialId: 'MPB', unidadeCompra: 'bobina', fator: 3000, qtd: 2, qtdRecebida: 1, preco: 380, ipiPct: 0 }])])).toEqual({ MPB: 3000 })
  })
  it('necessidade = consumo × cobertura − saldo − em trânsito; cobertura, folga e comprar até', () => {
    const r = necessidadeDeCompra({ ...base, modo: 'por_saldo', ocs, parametros: { diasCobertura: 30, diasSeguranca: 3 } })
    const chapa = r.linhas.find((l) => l.materialId === 'MP0078')!
    // consumo/dia 43,218 · alvo 30 dias com margem = 1426,19 − saldo 100 − trânsito 150 = 1176,19
    expect(chapa.consumoDia).toBeCloseTo(43.218, 2)
    expect(chapa.necessidade).toBeCloseTo(1176.194, 2)
    expect(chapa.saldo).toBe(100)
    expect(chapa.emTransito).toBe(150)
    expect(chapa.leadDias).toBe(12)
    expect(chapa.leadAprendido).toBe(true)
    expect(chapa.coberturaDias).toBeCloseTo(100 / 43.218, 2)
    expect(chapa.coberturaComTransitoDias).toBeCloseTo(250 / 43.218, 2)
    // folga = 5,78 − 12 − 3 < 0 → comprar hoje, atrasado
    expect(chapa.folgaDias).toBeLessThan(0)
    expect(chapa.atrasado).toBe(true)
    expect(chapa.comprarAte).toBe('2026-09-21')
  })
  it('saldo cobre tudo: necessidade zero, comprar até no futuro; sem consumo: cobertura infinita', () => {
    const r = necessidadeDeCompra({ ...base, modo: 'por_saldo', ocs, saldos: { MP0078: 5000 }, parametros: { diasSeguranca: 3 } })
    const chapa = r.linhas.find((l) => l.materialId === 'MP0078')!
    expect(chapa.necessidade).toBe(0)
    expect(chapa.qtdCompra).toBe(0)
    // cobertura com trânsito = 5150 / 43,218 = 119,16 dias − 12 − 3 = 104 dias → 2027-01-03
    expect(chapa.comprarAte).toBe('2027-01-03')
    expect(chapa.atrasado).toBe(false)
    const semConsumo = necessidadeDeCompra({ ...base, modo: 'por_saldo', demandaProdutos: { TM000076: 0 } })
    expect(semConsumo.linhas).toEqual([])
  })
  it('fallback de lead time: cadastro do fornecedor, depois do insumo, depois padrão', () => {
    const semOcs = necessidadeDeCompra({ ...base, modo: 'por_saldo' })
    const chapa = semOcs.linhas.find((l) => l.materialId === 'MP0078')!
    expect(chapa.leadDias).toBe(12) // fornecedor.leadTimeDias
    expect(chapa.leadAprendido).toBe(false)
    const semForn = necessidadeDeCompra({ ...base, modo: 'por_saldo', fornecedores: [] })
    expect(semForn.linhas.find((l) => l.materialId === 'MP0078')!.leadDias).toBe(7) // material.leadTimeDias
    const semNada = necessidadeDeCompra({ ...base, modo: 'por_saldo', fornecedores: [], materiais: materiais.map((m) => ({ ...m, leadTimeDias: 0 })), parametros: { leadPadraoDias: 9 } })
    expect(semNada.linhas.find((l) => l.materialId === 'MP0078')!.leadDias).toBe(0)
    expect(semNada.linhas.find((l) => l.materialId === 'MP0064')!.leadDias).toBe(0)
  })
  it('quantidade de compra sobe para inteiro da unidade de compra pelo fator', () => {
    const bobina = { ...SEED_MATERIAIS[0], id: 'BOB', fatorConversao: 3000, unidadeCompra: 'bobina', custoMedio: 0.12, saldo: 0 }
    const boms = [{ productId: 'P', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: 'l', tipo: 'insumo' as const, materialId: 'BOB', consumo: 2, unidade: 'un', perdaPct: 0 }] }]
    const r = necessidadeDeCompra({ ...base, modo: 'por_saldo', boms, materiais: [bobina], demandaProdutos: { P: 1000 }, margem: 0, parametros: { diasCobertura: 30 } })
    const l = r.linhas[0]
    expect(l.necessidade).toBeCloseTo(4000, 6)
    expect(l.qtdCompra).toBe(2)
    expect(l.precoCompraUnit).toBeCloseTo(360, 6)
  })
})
