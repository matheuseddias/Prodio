// Precificação por canal: a soma dos custos do canal que a tabela da Calculadora mostra numa coluna só
// (a decomposição inteira fica no detalhe do canal).
import { describe, expect, it } from 'vitest'
import { avaliarPreco, custosDoCanal, precoParaMargem } from './precificacao'
import type { Channel } from './tipos'

const canal = (x: Partial<Channel>): Channel =>
  ({ id: 'c', nome: 'Canal', ativo: true, comissaoPct: 0, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 0, adsPct: 0, parcelamentoPct: 0, outrosPct: 0, ...x }) as Channel

describe('custosDoCanal', () => {
  it('soma comissão, taxa fixa, frete, imposto, ads, parcelamento e outros', () => {
    const ml = canal({ comissaoPct: 12, taxaFixa: 6, freteVendedor: [{ ateKg: 5, valor: 20 }], impostoVendaPct: 6, adsPct: 2, parcelamentoPct: 1, outrosPct: 1 })
    const r = avaliarPreco(ml, 100, 30, 1)
    // 12 + 6 + 20 + 6 + 2 + 1 + 1
    expect(custosDoCanal(r)).toBeCloseTo(48, 10)
  })

  it('é o que sobra do preço depois do custo do produto e do lucro', () => {
    const shopee = canal({ comissaoPct: 20, taxaFixa: 4, impostoVendaPct: 6 })
    for (const r of [avaliarPreco(shopee, 59.9, 11.13, 2.4), precoParaMargem(shopee, 11.13, 2.4, 0.2)]) {
      expect(custosDoCanal(r)).toBeCloseTo(r.preco - r.custo - r.lucro, 10)
    }
  })

  it('canal sem taxa nenhuma não leva nada', () => {
    expect(custosDoCanal(avaliarPreco(canal({}), 50, 10, 0))).toBe(0)
  })
})
