// Paginação das leituras: sem ela o PostgREST corta em 1.000 linhas sem erro nenhum.
import { describe, expect, it } from 'vitest'
import { lerTudo } from './paginar'

/** Tabela falsa que respeita .range(de, ate) e um teto de linhas por resposta, como o db-max-rows. */
function tabela(total: number, maxRows = 1000) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }))
  const pedidos: [number, number][] = []
  const montar = async (de: number, ate: number) => {
    pedidos.push([de, ate])
    return { data: linhas.slice(de, Math.min(ate + 1, de + maxRows)), error: null }
  }
  return { montar, pedidos }
}

describe('lerTudo', () => {
  it('junta os lotes até vir um lote menor que o tamanho', async () => {
    const t = tabela(2500)
    const r = await lerTudo<{ id: number }>(t.montar)
    expect(r).toHaveLength(2500)
    expect(r.map((x) => x.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i))
    expect(t.pedidos).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('exatamente 1.000 linhas: pede mais um lote (vazio) para ter certeza de que acabou', async () => {
    const t = tabela(1000)
    expect(await lerTudo(t.montar)).toHaveLength(1000)
    expect(t.pedidos).toHaveLength(2)
  })

  it('tabela vazia e data nula viram lista vazia', async () => {
    expect(await lerTudo(tabela(0).montar)).toEqual([])
    expect(await lerTudo(async () => ({ data: null, error: null }))).toEqual([])
  })

  it('erro do PostgREST em qualquer lote derruba a leitura inteira (nada de lista pela metade)', async () => {
    let n = 0
    const montar = async (de: number, ate: number) => {
      n++
      if (n === 2) return { data: null, error: { code: '42501', message: 'permission denied' } }
      return { data: Array.from({ length: ate - de + 1 }, (_, i) => de + i), error: null }
    }
    await expect(lerTudo(montar)).rejects.toThrow('Sem permissão para esta operação.')
  })

  it('resposta que não é lista é recusada', async () => {
    await expect(lerTudo(async () => ({ data: { id: 1 }, error: null }))).rejects.toThrow(/formato inesperado/)
  })

  it('não entra em laço infinito se o servidor ignorar o range', async () => {
    const semFim = async () => ({ data: [1, 2, 3], error: null })
    await expect(lerTudo(semFim, 3)).rejects.toThrow(/grande demais/)
  })

  it('tamanho de lote inválido é recusado', async () => {
    await expect(lerTudo(tabela(1).montar, 0)).rejects.toThrow(/tamanho/)
  })
})
