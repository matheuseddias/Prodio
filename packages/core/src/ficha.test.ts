import { calcConsumo, custoProduto, explodeBom, indexarBoms, validarFicha } from './ficha'
import { SEED_BOMS, SEED_MATERIAIS, SEED_PRODUTOS } from './fixtures/seed-eddias'
import type { Bom, BomLine, Material } from './tipos'

// Helpers de fixture: fichas descritas como no sistema antigo (sku, mpCode, tipo, consumo).
type LinhaAntiga = { sku: string; mpCode: string; tipo?: 'produto'; consumo: number }
function bomsDe(linhas: LinhaAntiga[]): Bom[] {
  const por = new Map<string, BomLine[]>()
  linhas.forEach((l, i) => {
    const ls = por.get(l.sku) ?? []
    ls.push(l.tipo === 'produto' ? { id: `l${i}`, tipo: 'produto', componentId: l.mpCode, consumo: l.consumo, unidade: 'un', perdaPct: 0 } : { id: `l${i}`, tipo: 'insumo', materialId: l.mpCode, consumo: l.consumo, unidade: 'un', perdaPct: 0 })
    por.set(l.sku, ls)
  })
  return [...por.entries()].map(([productId, ls]) => ({ productId, versao: 1, ativa: true, linhas: ls, atualizadoEm: '2026-01-01' }))
}
const material = (id: string, custoMedio = 1): Material => ({ id, sku: id, nome: id, unidadeCompra: 'un', unidadeConsumo: 'un', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio, leadTimeDias: 7 })

describe('explodeBom (casos portados de motores.mjs)', () => {
  it('subproduto compartilhado por irmãos conta duas vezes', () => {
    const boms = bomsDe([
      { sku: 'A', mpCode: 'B', tipo: 'produto', consumo: 1 },
      { sku: 'A', mpCode: 'C', tipo: 'produto', consumo: 1 },
      { sku: 'B', mpCode: 'D', tipo: 'produto', consumo: 1 },
      { sku: 'C', mpCode: 'D', tipo: 'produto', consumo: 1 },
      { sku: 'D', mpCode: 'MPX', consumo: 2 },
    ])
    expect(explodeBom('A', 1, boms)).toEqual({ MPX: 4 })
  })
  it('componente repetido na ficha soma as duas linhas', () => {
    const boms = bomsDe([
      { sku: 'A', mpCode: 'B', tipo: 'produto', consumo: 1 },
      { sku: 'A', mpCode: 'B', tipo: 'produto', consumo: 2 },
      { sku: 'B', mpCode: 'MPY', consumo: 1 },
    ])
    expect(explodeBom('A', 1, boms)).toEqual({ MPY: 3 })
  })
  it('ciclo A<->B não trava nem duplica', () => {
    const boms = bomsDe([
      { sku: 'A', mpCode: 'B', tipo: 'produto', consumo: 1 },
      { sku: 'B', mpCode: 'A', tipo: 'produto', consumo: 1 },
      { sku: 'B', mpCode: 'MPZ', consumo: 5 },
    ])
    expect(explodeBom('A', 1, boms)).toEqual({ MPZ: 5 })
  })
  it('ficha real Adnet 60: quantidade multiplica na descida (100 unidades)', () => {
    const boms = bomsDe([
      { sku: 'ED000124', mpCode: 'ED000379', tipo: 'produto', consumo: 1 },
      { sku: 'ED000124', mpCode: 'MP0078', consumo: 0.36 },
      { sku: 'ED000379', mpCode: 'MP0061', consumo: 0.01 },
    ])
    const r = explodeBom('ED000124', 100, boms)
    expect(r.MP0078).toBeCloseTo(36, 6)
    expect(r.MP0061).toBeCloseTo(1, 6)
  })
  it('aplica perda percentual da linha e aceita índice pré-calculado', () => {
    const boms = bomsDe([{ sku: 'A', mpCode: 'MP1', consumo: 2 }])
    boms[0].linhas[0].perdaPct = 0.05
    const idx = indexarBoms(boms)
    expect(explodeBom('A', 10, boms, idx).MP1).toBeCloseTo(21, 6)
    expect(explodeBom('A', 10, idx).MP1).toBeCloseTo(21, 6)
  })
  it('produto sem ficha e ficha inativa devolvem vazio', () => {
    const boms = bomsDe([{ sku: 'A', mpCode: 'MP1', consumo: 2 }])
    boms[0].ativa = false
    expect(explodeBom('A', 1, boms)).toEqual({})
    expect(explodeBom('ZZZ', 1, boms)).toEqual({})
  })
  it('seed Eddias: Espelho Adnet 40cm ×100 consome 16 m² de chapa e 100 caixas', () => {
    const r = explodeBom('TM000076', 100, SEED_BOMS)
    expect(r.MP0078).toBeCloseTo(16, 6)
    expect(r.MP0064).toBe(100)
    expect(r.MP0061).toBeCloseTo(1, 6)
    expect(Object.keys(r)).toHaveLength(9)
  })
})

describe('custoProduto', () => {
  const ctx = { boms: SEED_BOMS, materiais: SEED_MATERIAIS, produtos: SEED_PRODUTOS }
  it('seed Eddias: custo pela ficha bate com o CMV cadastrado (40cm e 50cm)', () => {
    expect(custoProduto('TM000076', ctx)).toBeCloseTo(10.71, 1)
    expect(custoProduto('TM000073', ctx)).toBeCloseTo(16.14, 1)
  })
  it('componente fabricado entra pelo custo recursivo e sem ficha cai no custo do cadastro', () => {
    const boms = bomsDe([
      { sku: 'KIT', mpCode: 'TM000076', tipo: 'produto', consumo: 2 },
      { sku: 'KIT', mpCode: 'MP0064', consumo: 1 },
      { sku: 'KIT', mpCode: 'SEMFICHA', tipo: 'produto', consumo: 1 },
    ])
    const produtos = [...SEED_PRODUTOS, { ...SEED_PRODUTOS[0], id: 'SEMFICHA', sku: 'SEMFICHA', custoFicha: 3 }]
    const custo = custoProduto('KIT', { boms: [...SEED_BOMS, ...boms], materiais: SEED_MATERIAIS, produtos })
    expect(custo).toBeCloseTo(2 * 10.7047 + 2.54 + 3, 2)
  })
  it('ciclo no caminho não trava e não conta duas vezes', () => {
    const boms = bomsDe([
      { sku: 'A', mpCode: 'B', tipo: 'produto', consumo: 1 },
      { sku: 'B', mpCode: 'A', tipo: 'produto', consumo: 1 },
      { sku: 'B', mpCode: 'MP', consumo: 2 },
    ])
    expect(custoProduto('A', { boms, materiais: [material('MP', 1.5)] })).toBeCloseTo(3, 6)
  })
})

describe('calcConsumo por partes', () => {
  it('area: cm × cm vira m², com quantidade de peças', () => {
    expect(calcConsumo({ tipo: 'area', partes: [{ largCm: 90, altCm: 40 }, { largCm: 20, altCm: 20, qtd: 2 }] })).toBeCloseTo(0.36 + 0.08, 6)
  })
  it('rolo: área ÷ largura do rolo = metros de rolo; sem largura é erro', () => {
    expect(calcConsumo({ tipo: 'rolo', larguraRoloM: 1.4, partes: [{ largCm: 90, altCm: 40 }] })).toBeCloseTo(0.257143, 6)
    expect(() => calcConsumo({ tipo: 'rolo', partes: [{ largCm: 90, altCm: 40 }] })).toThrow(/largura/)
  })
  it('comprimento, peso e unidade', () => {
    expect(calcConsumo({ tipo: 'comprimento', partes: [{ compCm: 150, qtd: 2 }] })).toBe(3)
    expect(calcConsumo({ tipo: 'peso', partes: [{ pesoG: 12.5, qtd: 4 }] })).toBe(50)
    expect(calcConsumo({ tipo: 'unidade', partes: [{ un: 3 }, { un: 1, qtd: 2 }] })).toBe(5)
  })
  it('perda percentual e perda fixa', () => {
    expect(calcConsumo({ tipo: 'unidade', partes: [{ un: 10 }], perda: { tipo: 'pct', valor: 0.05 } })).toBe(10.5)
    expect(calcConsumo({ tipo: 'unidade', partes: [{ un: 10 }], perda: { tipo: 'fixa', valor: 0.25 } })).toBe(10.25)
    expect(calcConsumo(undefined)).toBe(0)
    expect(calcConsumo({ tipo: 'area', partes: [] })).toBe(0)
  })
})

describe('validarFicha', () => {
  const materiais = [material('MP1'), material('MP2')]
  const linha = (over: Partial<BomLine>): BomLine => ({ id: 'x', tipo: 'insumo', materialId: 'MP1', consumo: 1, unidade: 'un', perdaPct: 0, ...over })
  it('ficha válida não tem erros', () => {
    expect(validarFicha('A', [linha({}), linha({ materialId: 'MP2', consumo: 0.5 })], { boms: [], materiais })).toEqual([])
  })
  it('componente igual ao próprio produto', () => {
    const erros = validarFicha('A', [linha({ tipo: 'produto', materialId: undefined, componentId: 'A' })], { boms: [], materiais })
    expect(erros.map((e) => e.codigo)).toEqual(['componente_proprio'])
  })
  it('ciclo indireto via fichas existentes vira erro, com o caminho', () => {
    const boms = bomsDe([
      { sku: 'B', mpCode: 'C', tipo: 'produto', consumo: 1 },
      { sku: 'C', mpCode: 'A', tipo: 'produto', consumo: 1 },
    ])
    const erros = validarFicha('A', [linha({ tipo: 'produto', materialId: undefined, componentId: 'B' })], { boms, materiais })
    expect(erros).toHaveLength(1)
    expect(erros[0].codigo).toBe('ciclo')
    expect(erros[0].mensagem).toContain('A → B → C → A')
  })
  it('consumo zero ou negativo e insumo inexistente', () => {
    const erros = validarFicha('A', [linha({ consumo: 0 }), linha({ materialId: 'NAOEXISTE', consumo: -1 })], { boms: [], materiais })
    expect(erros.map((e) => e.codigo).sort()).toEqual(['consumo_invalido', 'consumo_invalido', 'insumo_inexistente'])
    expect(erros.find((e) => e.codigo === 'insumo_inexistente')?.linha).toBe(1)
  })
  it('componente inexistente quando a lista de produtos é dada', () => {
    const erros = validarFicha('A', [linha({ tipo: 'produto', materialId: undefined, componentId: 'ZZ' })], { boms: [], materiais, produtos: SEED_PRODUTOS })
    expect(erros.map((e) => e.codigo)).toEqual(['componente_inexistente'])
  })
})
