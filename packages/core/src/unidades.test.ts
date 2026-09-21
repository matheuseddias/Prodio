import { custoPorCompra, custoPorConsumo, fatorValido, paraCompra, paraConsumo } from './unidades'

describe('fator de conversão (casos portados de motores.mjs, com valores concretos)', () => {
  it('bobina de 3000 un: custo de 383,23 por bobina vira 0,12774 por unidade', () => {
    expect(custoPorConsumo(383.23, 3000)).toBeCloseTo(0.127743, 6)
  })
  it('fator 0 (ou ausente) vira 1: custo por consumo é o próprio custo de compra', () => {
    expect(custoPorConsumo(10, 0)).toBe(10)
    expect(custoPorConsumo(10, undefined)).toBe(10)
    expect(fatorValido(-2)).toBe(1)
    expect(fatorValido(Number.NaN)).toBe(1)
  })
  it('fator 1 é neutro nas duas direções', () => {
    expect(custoPorConsumo(12.5, 1)).toBe(12.5)
    expect(custoPorCompra(12.5, 1)).toBe(12.5)
    expect(paraConsumo(7, 1)).toBe(7)
  })
})

describe('paraConsumo / paraCompra', () => {
  it('compra → consumo multiplica pelo fator', () => {
    expect(paraConsumo(2, 3000)).toBe(6000)
    expect(paraConsumo(1.5, 100)).toBe(150)
  })
  it('consumo → compra arredonda para cima em inteiros de compra', () => {
    expect(paraCompra(6000, 3000)).toBe(2)
    expect(paraCompra(6001, 3000)).toBe(3)
    expect(paraCompra(9000, 3000)).toBe(3) // 9000/3000 = 3.0000000000000004 em ponto flutuante
    expect(paraCompra(0, 3000)).toBe(0)
    expect(paraCompra(-5, 3000)).toBe(0)
  })
  it('fornecedor que vende fração mantém o decimal', () => {
    expect(paraCompra(2.5, 1, { inteiro: false })).toBe(2.5)
    expect(paraCompra(2.5, 1)).toBe(3)
  })
  it('custo por compra é o inverso do custo por consumo', () => {
    expect(custoPorCompra(custoPorConsumo(383.23, 3000), 3000)).toBeCloseTo(383.23, 6)
  })
})
