// Testes adversariais da ficha técnica: ciclos longos, consumo/perda degenerados, componente sem ficha, fator 0.
import { calcConsumo, custoProduto, explodeBom, indexarBoms, validarFicha } from './ficha'
import type { Bom, BomLine, Material } from './tipos'

const linha = (over: Partial<BomLine>): BomLine => ({ id: 'x', tipo: 'insumo', materialId: 'MP1', consumo: 1, unidade: 'un', perdaPct: 0, ...over })
const prod = (componentId: string, consumo = 1, perdaPct = 0): BomLine => ({ id: `p-${componentId}`, tipo: 'produto', componentId, consumo, unidade: 'un', perdaPct })
const ins = (materialId: string, consumo = 1, perdaPct = 0): BomLine => ({ id: `i-${materialId}`, tipo: 'insumo', materialId, consumo, unidade: 'un', perdaPct })
const bom = (productId: string, linhas: BomLine[], over: Partial<Bom> = {}): Bom => ({ productId, versao: 1, ativa: true, linhas, atualizadoEm: '2026-01-01', ...over })
const material = (id: string, custoMedio = 1, fatorConversao = 1): Material => ({ id, sku: id, nome: id, unidadeCompra: 'un', unidadeConsumo: 'un', fatorConversao, minimo: 0, saldo: 0, custoMedio, leadTimeDias: 7 })

describe('ficha · ciclos', () => {
  it('ciclo indireto de 3 níveis (A→B→C→D→A) é detectado com o caminho completo', () => {
    const boms = [bom('B', [prod('C')]), bom('C', [prod('D')]), bom('D', [prod('A')])]
    const erros = validarFicha('A', [prod('B')], { boms, materiais: [] })
    expect(erros.map((e) => e.codigo)).toEqual(['ciclo'])
    expect(erros[0].mensagem).toContain('A → B → C → D → A')
  })
  it('ciclo de 3 níveis não trava explodeBom nem custoProduto e não conta duas vezes', () => {
    const boms = [bom('A', [prod('B')]), bom('B', [prod('C')]), bom('C', [prod('A'), ins('MP', 2)])]
    expect(explodeBom('A', 1, boms)).toEqual({ MP: 2 })
    expect(custoProduto('A', { boms, materiais: [material('MP', 1.5)] })).toBeCloseTo(3, 6)
  })
  it('ciclo que passa pela ficha ANTIGA do próprio produto não gera falso positivo', () => {
    // A hoje usa X; a nova ficha de A usa B, e B usa X. Nada volta para A.
    const boms = [bom('A', [prod('X')]), bom('B', [prod('X')]), bom('X', [ins('MP')])]
    expect(validarFicha('A', [prod('B')], { boms, materiais: [material('MP')] })).toEqual([])
  })
  it('irmãos que dependem do mesmo subproduto não são ciclo (diamante)', () => {
    const boms = [bom('B', [prod('D')]), bom('C', [prod('D')]), bom('D', [ins('MP')])]
    expect(validarFicha('A', [prod('B'), prod('C')], { boms, materiais: [material('MP')] })).toEqual([])
    expect(explodeBom('A', 1, [...boms, bom('A', [prod('B'), prod('C')])])).toEqual({ MP: 2 })
  })
  it('ficha inativa não participa do ciclo (só as ativas contam)', () => {
    const boms = [bom('B', [prod('A')], { ativa: false })]
    expect(validarFicha('A', [prod('B')], { boms, materiais: [] })).toEqual([])
  })
  it('duas versões ativas: vale a de maior versão, mesmo listada antes', () => {
    const boms = [bom('A', [ins('MP', 10)], { versao: 3 }), bom('A', [ins('MP', 1)], { versao: 2 })]
    expect(indexarBoms(boms).get('A')?.versao).toBe(3)
    expect(explodeBom('A', 1, boms)).toEqual({ MP: 10 })
  })
})

describe('ficha · consumo e perda degenerados', () => {
  it('consumo zero, negativo, NaN e Infinity são inválidos', () => {
    const ctx = { boms: [], materiais: [material('MP1')] }
    const erros = validarFicha('A', [linha({ consumo: 0 }), linha({ consumo: -1 }), linha({ consumo: NaN }), linha({ consumo: Infinity })], ctx)
    expect(erros.filter((e) => e.codigo === 'consumo_invalido').map((e) => e.linha)).toEqual([0, 1, 2, 3])
  })
  it('perda negativa é inválida na validação', () => {
    const ctx = { boms: [], materiais: [material('MP1')] }
    const erros = validarFicha('A', [linha({ perdaPct: -0.1 })], ctx)
    expect(erros.map((e) => e.codigo)).toEqual(['perda_invalida'])
    expect(validarFicha('A', [linha({ perdaPct: NaN })], ctx).map((e) => e.codigo)).toEqual(['perda_invalida'])
    expect(validarFicha('A', [linha({ perdaPct: 0 })], ctx)).toEqual([])
  })
  it('explodeBom nunca devolve consumo negativo por perda menor que −100%', () => {
    const boms = [bom('A', [ins('MP', 2, -2)])]
    expect(explodeBom('A', 10, boms).MP).toBe(20)
    expect(custoProduto('A', { boms, materiais: [material('MP', 1)] })).toBe(2)
  })
  it('consumo zero explode como zero e não polui o resultado com NaN', () => {
    const boms = [bom('A', [ins('MP', 0), ins('MP2', NaN as unknown as number)])]
    const r = explodeBom('A', 5, boms)
    expect(r.MP).toBe(0)
    expect(r.MP2).toBe(0)
  })
  it('quantidade zero ou negativa explode zero (quem filtra é o chamador)', () => {
    const boms = [bom('A', [ins('MP', 2)])]
    expect(explodeBom('A', 0, boms)).toEqual({ MP: 0 })
    expect(explodeBom('A', -3, boms).MP).toBe(-6)
  })
})

describe('ficha · componente sem ficha e fator 0', () => {
  it('componente sem ficha não gera insumos na explosão, mas custa pelo cadastro', () => {
    const boms = [bom('A', [prod('SEMI', 2), ins('MP', 1)])]
    expect(explodeBom('A', 1, boms)).toEqual({ MP: 1 })
    const produtos = [{ id: 'SEMI', sku: 'SEMI', nome: 'Semi', familia: 'x', atributos: {}, status: 'ativo' as const, aliases: [], temFicha: false, custoFicha: 4 }]
    expect(custoProduto('A', { boms, materiais: [material('MP', 1)], produtos })).toBe(9)
    expect(custoProduto('A', { boms, materiais: [material('MP', 1)] })).toBe(1)
  })
  it('validarFicha sem lista de produtos aceita componente desconhecido; com lista rejeita', () => {
    expect(validarFicha('A', [prod('SEMI')], { boms: [], materiais: [] })).toEqual([])
    expect(validarFicha('A', [prod('SEMI')], { boms: [], materiais: [], produtos: [] }).map((e) => e.codigo)).toEqual(['componente_inexistente'])
  })
  it('insumo com fatorConversao 0 não afeta o custo por unidade de consumo (custoMedio já é por consumo)', () => {
    const boms = [bom('A', [ins('MP', 3)])]
    expect(custoProduto('A', { boms, materiais: [material('MP', 2, 0)] })).toBe(6)
  })
  it('linha de insumo sem materialId e de produto sem componentId são incompletas, não crasham', () => {
    const erros = validarFicha('A', [linha({ materialId: undefined }), linha({ tipo: 'produto', materialId: undefined })], { boms: [], materiais: [] })
    expect(erros.map((e) => e.codigo)).toEqual(['linha_incompleta', 'linha_incompleta'])
    expect(explodeBom('A', 1, [bom('A', [linha({ materialId: undefined }), linha({ tipo: 'produto', materialId: undefined })])])).toEqual({})
  })
})

describe('calcConsumo · casos-limite', () => {
  it('perda negativa não reduz o consumo abaixo da soma das partes', () => {
    expect(calcConsumo({ tipo: 'unidade', partes: [{ un: 10 }], perda: { tipo: 'pct', valor: -0.5 } })).toBe(10)
    expect(calcConsumo({ tipo: 'unidade', partes: [{ un: 10 }], perda: { tipo: 'fixa', valor: -3 } })).toBe(10)
  })
  it('largura de rolo zero, negativa ou NaN é erro', () => {
    for (const larguraRoloM of [0, -1, NaN]) expect(() => calcConsumo({ tipo: 'rolo', larguraRoloM, partes: [{ largCm: 10, altCm: 10 }] })).toThrow(/largura/)
  })
  it('partes com valores ausentes ou NaN valem zero; qtd ausente vale 1', () => {
    expect(calcConsumo({ tipo: 'area', partes: [{ largCm: NaN, altCm: 10 }, { largCm: 100, altCm: 100 }] })).toBe(1)
    expect(calcConsumo({ tipo: 'peso', partes: [{}] })).toBe(0)
  })
  it('resultado é arredondado a 6 casas (sem 0.1 + 0.2)', () => {
    expect(calcConsumo({ tipo: 'unidade', partes: [{ un: 0.1 }, { un: 0.2 }] })).toBe(0.3)
  })
})
