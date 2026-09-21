// Testes adversariais da projeção: saldo maior que a demanda, cobertura zero, margens e entradas degeneradas.
import { agregarVendas, demandaDerivadaDeComponentes, demandaDiaria, elevarACarteira, projetadoDoDia } from './projecao'
import type { Bom } from './tipos'

describe('projetadoDoDia · casos-limite', () => {
  it('saldoHub maior que a demanda: zero, nunca negativo', () => {
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: 2, saldoHub: 1000, emProducao: 0 })).toBe(0)
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: 2, saldoHub: 20, emProducao: 0 })).toBe(0)
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: 2, saldoHub: 19, emProducao: 0 })).toBe(1)
  })
  it('cobertura zero: alvo zero, mesmo com demanda', () => {
    expect(projetadoDoDia({ demandaDia: 500, diasCobertura: 0, saldoHub: 0, emProducao: 0 })).toBe(0)
  })
  it('saldoHub negativo (vendido a descoberto) é backlog e soma; emProducao negativo vale zero', () => {
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: 1, saldoHub: -50, emProducao: 0 })).toBe(60)
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: 1, saldoHub: 0, emProducao: -50 })).toBe(10)
  })
  it('NaN e undefined nas entradas valem zero', () => {
    expect(projetadoDoDia({ demandaDia: NaN, diasCobertura: 3, saldoHub: 0, emProducao: 0 })).toBe(0)
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: 3, saldoHub: NaN, emProducao: NaN })).toBe(30)
    expect(projetadoDoDia({ demandaDia: 10, diasCobertura: NaN, saldoHub: 0, emProducao: 0 })).toBe(0)
  })
  it('elevarACarteira com NaN e negativos', () => {
    expect(elevarACarteira(NaN, 5)).toBe(5)
    expect(elevarACarteira(5, NaN)).toBe(5)
    expect(elevarACarteira(-3, -8)).toBe(0)
  })
})

describe('demandaDiaria · casos-limite', () => {
  it('margem menor que −100% nunca produz demanda negativa', () => {
    expect(demandaDiaria(100, 10, -2)).toBe(0)
    expect(demandaDiaria(100, 10, -1)).toBe(0)
    expect(demandaDiaria(100, 10, -0.5)).toBe(5)
  })
  it('margem NaN vale zero; dias úteis inválidos caem no cálculo simples', () => {
    expect(demandaDiaria(100, 10, NaN)).toBe(10)
    expect(demandaDiaria(100, 10, 0, 0)).toBe(10)
    expect(demandaDiaria(100, 10, 0, -5)).toBe(10)
    expect(demandaDiaria(100, 10, 0, NaN)).toBe(10)
  })
  it('vendas negativas (mais devoluções que vendas) dão zero', () => {
    expect(demandaDiaria(-40, 10, 0.1)).toBe(0)
  })
})

describe('demandaDerivadaDeComponentes · casos-limite', () => {
  const boms: Bom[] = [
    { productId: 'A', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'produto', componentId: 'B', consumo: 2, unidade: 'un', perdaPct: -5 }] },
    { productId: 'B', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '2', tipo: 'insumo', materialId: 'MP', consumo: 1, unidade: 'un', perdaPct: 0 }] },
  ]
  it('perda menor que −100% não gera demanda negativa', () => {
    expect(demandaDerivadaDeComponentes({ A: 10 }, boms)).toEqual({ B: 20 })
  })
  it('demanda zero, negativa ou NaN não desce; produto sem ficha não gera nada', () => {
    expect(demandaDerivadaDeComponentes({ A: 0, ZZ: 10 }, boms)).toEqual({})
    expect(demandaDerivadaDeComponentes({ A: -1 }, boms)).toEqual({})
    expect(demandaDerivadaDeComponentes({ A: NaN }, boms)).toEqual({})
  })
  it('ciclo de 3 níveis não trava', () => {
    const ciclo: Bom[] = ['A', 'B', 'C'].map((p, i) => ({ productId: p, versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: String(i), tipo: 'produto', componentId: ['B', 'C', 'A'][i], consumo: 1, unidade: 'un', perdaPct: 0 }] }))
    expect(demandaDerivadaDeComponentes({ A: 1 }, ciclo)).toEqual({ B: 1, C: 1, A: 1 })
  })
})

describe('agregarVendas · casos-limite', () => {
  it('quantidade NaN vale zero, negativa é somada (devolução), SKU vazio vai para semCadastro', () => {
    const r = agregarVendas([{ sku: 'X', quantidade: NaN }, { sku: 'X', quantidade: -2 }, { sku: 'X', quantidade: 5 }, { sku: '', quantidade: 1 }], (s) => (s ? s : undefined))
    expect(r.porProduto).toEqual({ X: 3 })
    expect(r.semCadastro).toEqual([''])
  })
  it('lista vazia', () => {
    expect(agregarVendas([], () => 'X')).toEqual({ porProduto: {}, semCadastro: [] })
  })
})
