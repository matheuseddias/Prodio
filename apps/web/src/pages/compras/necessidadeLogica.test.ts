import { necessidadeDeCompra } from '@prodio/core/necessidade'
import { demandaVazia } from '@prodio/core/planejamento'
import { describe, expect, it } from 'vitest'
import { entradaNecessidade } from '../../domain/demanda'
import type { Bom, DemandaResumo, Material, Supplier } from '../../domain/types'
import { agruparPorFornecedor, linhasDaTela, ordensDaSelecao, resumoDaCompra } from './necessidadeLogica'

const mat = (id: string, extra: Partial<Material> = {}): Material => ({ id, sku: id.toUpperCase(), nome: id, unidadeCompra: 'cx', unidadeConsumo: 'un', fatorConversao: 10, minimo: 0, saldo: 0, custoMedio: 2, leadTimeDias: 3, ...extra })
const sup = (id: string, lead = 4): Supplier => ({ id, nome: `Forn ${id}`, cnpj: '', regime: 'simples', leadTimeDias: lead, condicaoPagamento: [30] })
const bom = (productId: string, linhas: [string, number][]): Bom => ({ productId, versao: 1, ativa: true, atualizadoEm: '', linhas: linhas.map(([materialId, consumo], i) => ({ id: `${productId}${i}`, tipo: 'insumo', materialId, consumo, unidade: 'un', perdaPct: 0 })) })

describe('Necessidade de compra pela demanda dos pedidos', () => {
  const materials = [mat('a', { fornecedorPadraoId: 'f1', saldo: 5 }), mat('b', { fornecedorPadraoId: 'f2', saldo: 1000 }), mat('c')]
  const suppliers = [sup('f1'), sup('f2')]
  const boms = [bom('p1', [['a', 1], ['b', 2], ['c', 1], ['sumiu', 1]])]
  const demanda: DemandaResumo = { ...demandaVazia(), dias: 14, produtos: [{ productId: 'p1', vendido: 28, carteira: 0 }] }
  const r = necessidadeDeCompra(entradaNecessidade({ modo: 'metrica', hoje: '2026-09-26', demanda, tenant: { margemProjecao: 0, diasCobertura: 7 }, boms, materials, suppliers, purchaseOrders: [] }))
  const { linhas, semCadastro } = linhasDaTela(r, materials)

  it('insumo da ficha sem cadastro sai à parte; custo é o da OC (un. de compra × fator × custo)', () => {
    expect(semCadastro.map((l) => l.materialId)).toEqual(['sumiu'])
    const a = linhas.find((x) => x.m.id === 'a')!
    // 28 em 14 dias = 2/dia → 60 em 30 dias − saldo 5 = 55 un → 6 cx de 10 → R$ 2 × 10 × 6
    expect(a.l.necessidade).toBeCloseTo(55, 9)
    expect(a.l.qtdCompra).toBe(6)
    expect(a.custo).toBeCloseTo(120, 9)
  })
  it('agrupa por fornecedor padrão; "só com compra" esconde quem o saldo cobre; sem fornecedor vai num grupo próprio', () => {
    const so = agruparPorFornecedor(linhas, suppliers, true)
    expect(so.map((g) => g.sup.id).sort()).toEqual(['', 'f1'])
    const todos = agruparPorFornecedor(linhas, suppliers, false)
    expect(todos.map((g) => g.sup.id).sort()).toEqual(['', 'f1', 'f2'])
    expect(todos.find((g) => g.sup.id === '')!.sup.nome).toBe('Sem fornecedor padrão')
  })
  it('resumo conta só o que tem compra sugerida', () => {
    expect(resumoDaCompra(linhas)).toMatchObject({ itens: 2, fornecedores: 1 })
  })
  it('OCs: uma por fornecedor, só selecionados com compra e fornecedor, entrega em hoje + maior lead', () => {
    const ordens = ordensDaSelecao(linhas, new Set(['a', 'b', 'c']), suppliers, { hoje: new Date(2026, 8, 26), observacao: 'x', novoId: (i) => `i${i}` })
    expect(ordens).toHaveLength(1)
    expect(ordens[0]).toMatchObject({ supplierId: 'f1', entregaPrevista: '2026-09-30', status: 'aberta' })
    expect(ordens[0].itens).toEqual([{ id: 'i0', materialId: 'a', unidadeCompra: 'cx', fator: 10, qtd: 6, qtdRecebida: 0, preco: 20, ipiPct: 0 }])
  })
})
