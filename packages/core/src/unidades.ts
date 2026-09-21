// Conversão entre unidade de compra e unidade de consumo.
// fator = quantas unidades de consumo cabem em 1 unidade de compra (1 bobina = 3000 un → fator 3000).

// Fator inválido (0, negativo, NaN) é tratado como 1: compra e consumo na mesma unidade.
export const fatorValido = (fator: number | undefined | null): number => (typeof fator === 'number' && fator > 0 && Number.isFinite(fator) ? fator : 1)

// Quantidade comprada → quantidade em unidade de consumo.
export const paraConsumo = (qtdCompra: number, fator: number | undefined | null): number => qtdCompra * fatorValido(fator)

export interface OpcoesCompra {
  inteiro?: boolean // fornecedor só vende inteiros (padrão true)
}

// Quantidade em unidade de consumo → quantidade a comprar. Arredonda para cima porque falta custa mais que sobra.
export function paraCompra(qtdConsumo: number, fator: number | undefined | null, opcoes: OpcoesCompra = {}): number {
  if (!(qtdConsumo > 0)) return 0
  const bruto = qtdConsumo / fatorValido(fator)
  if (opcoes.inteiro === false) return Math.round(bruto * 1e6) / 1e6
  // tolerância para erro de ponto flutuante (9000/3000 = 3.0000000000000004 não vira 4)
  return Math.ceil(bruto - 1e-9)
}

// Custo por unidade de compra → custo por unidade de consumo. É com este que ficha e projeção multiplicam.
export const custoPorConsumo = (custoCompra: number, fator: number | undefined | null): number => custoCompra / fatorValido(fator)

// Custo por unidade de consumo → custo por unidade de compra (para exibir preço da OC).
export const custoPorCompra = (custoConsumo: number, fator: number | undefined | null): number => custoConsumo * fatorValido(fator)
