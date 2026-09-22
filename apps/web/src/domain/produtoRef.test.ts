// Etiqueta impressa e bipe guardam só o id do produto: a tela precisa saber exibir um id que não
// existe mais (produto excluído) sem quebrar.
import { describe, expect, it } from 'vitest'
import { ROTULO_REMOVIDO, produtoRef } from './produtoRef'
import type { Product } from './types'

const produto: Product = {
  id: 'p1',
  sku: 'TM000076',
  nome: 'Espelho Redondo 40cm',
  familia: 'Espelho',
  atributos: { cor: 'Preto', tamanho: '40cm' },
  status: 'ativo',
  aliases: [],
  temFicha: true,
}

describe('produtoRef', () => {
  it('usa os dados do produto quando ele existe', () => {
    expect(produtoRef('p1', produto)).toMatchObject({ sku: 'TM000076', nome: 'Espelho Redondo 40cm', cor: 'Preto', tamanho: '40cm', removido: false })
  })

  it('marca como removido e mostra o começo do id quando o produto sumiu', () => {
    const r = produtoRef('8f2c1d3e-0000-4000-8000-000000000000')
    expect(r.removido).toBe(true)
    expect(r.nome).toBe(ROTULO_REMOVIDO)
    expect(r.sku).toBe('8f2c1d3e')
    expect(r.cor).toBe('')
  })

  it('aguenta produto sem atributos (importação, conector, upsert otimista)', () => {
    const semAtributos = { ...produto, atributos: undefined as unknown as Product['atributos'] }
    expect(produtoRef('p1', semAtributos)).toMatchObject({ cor: '', tamanho: '', removido: false })
  })

  it('aguenta id vazio', () => {
    expect(produtoRef(undefined as unknown as string)).toMatchObject({ sku: '—', nome: ROTULO_REMOVIDO, removido: true })
  })
})
