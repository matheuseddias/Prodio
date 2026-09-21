import { SEED_BOMS, SEED_MARGEM, SEED_PERIODO_DIAS, SEED_PRODUTOS, SEED_VENDAS } from './fixtures/seed-eddias'
import { agregarVendas, demandaDerivadaDeComponentes, demandaDiaria, elevarACarteira, projetadoDoDia } from './projecao'
import type { Bom } from './tipos'

describe('demandaDiaria', () => {
  it('vendas ÷ dias × (1 + margem)', () => {
    expect(demandaDiaria(150, 15, 0.1)).toBeCloseTo(11, 6)
    expect(demandaDiaria(150, 15, 0)).toBe(10)
  })
  it('com dias úteis: mensal (30 dias corridos) dividida pelos dias úteis, como no App antigo', () => {
    // 1622 vendas em 15 dias, margem 10%, 22 dias úteis → 1622/15*30*1.1/22 = 162,2
    expect(demandaDiaria(1622, SEED_PERIODO_DIAS, SEED_MARGEM, 22)).toBeCloseTo(162.2, 6)
  })
  it('período ou vendas inválidos dão zero', () => {
    expect(demandaDiaria(100, 0, 0.1)).toBe(0)
    expect(demandaDiaria(0, 15, 0.1)).toBe(0)
  })
})

describe('projetadoDoDia e elevarACarteira', () => {
  it('max(0, demanda × cobertura − saldo no hub − em produção)', () => {
    expect(projetadoDoDia({ demandaDia: 100, diasCobertura: 3, saldoHub: 120, emProducao: 30 })).toBe(150)
    expect(projetadoDoDia({ demandaDia: 100, diasCobertura: 1, saldoHub: 500, emProducao: 0 })).toBe(0)
    expect(projetadoDoDia({ demandaDia: 0, diasCobertura: 5, saldoHub: 0, emProducao: 0 })).toBe(0)
  })
  it('carteira firme eleva o projetado, nunca reduz', () => {
    expect(elevarACarteira(150, 200)).toBe(200)
    expect(elevarACarteira(150, 80)).toBe(150)
    expect(elevarACarteira(0, 0)).toBe(0)
  })
})

describe('demandaDerivadaDeComponentes', () => {
  const boms: Bom[] = [
    { productId: 'ESPELHO', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'produto', componentId: 'PINO', consumo: 2, unidade: 'un', perdaPct: 0 }, { id: '2', tipo: 'insumo', materialId: 'MP1', consumo: 1, unidade: 'un', perdaPct: 0 }] },
    { productId: 'KIT', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '3', tipo: 'produto', componentId: 'ESPELHO', consumo: 1, unidade: 'un', perdaPct: 0 }, { id: '4', tipo: 'produto', componentId: 'PINO', consumo: 1, unidade: 'un', perdaPct: 0.5 }] },
    { productId: 'PINO', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '5', tipo: 'insumo', materialId: 'PETG', consumo: 0.004, unidade: 'kg', perdaPct: 0 }] },
  ]
  it('componente fabricado recebe demanda × consumo dos pais (App.jsx 5416-5420)', () => {
    expect(demandaDerivadaDeComponentes({ ESPELHO: 100 }, boms)).toEqual({ PINO: 200 })
  })
  it('desce em cadeia, soma pais diferentes e aplica perda', () => {
    // KIT 10 → ESPELHO 10 → PINO 20; KIT 10 → PINO 10 × 1,5 = 15; ESPELHO 100 → PINO 200
    expect(demandaDerivadaDeComponentes({ KIT: 10, ESPELHO: 100 }, boms)).toEqual({ ESPELHO: 10, PINO: 235 })
  })
  it('ciclo não trava', () => {
    const ciclo: Bom[] = [
      { productId: 'A', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '1', tipo: 'produto', componentId: 'B', consumo: 1, unidade: 'un', perdaPct: 0 }] },
      { productId: 'B', versao: 1, ativa: true, atualizadoEm: '', linhas: [{ id: '2', tipo: 'produto', componentId: 'A', consumo: 1, unidade: 'un', perdaPct: 0 }] },
    ]
    expect(demandaDerivadaDeComponentes({ A: 5 }, ciclo)).toEqual({ B: 5, A: 5 })
  })
})

describe('agregarVendas', () => {
  it('resolve aliases, soma duplicatas e lista SKUs sem cadastro', () => {
    const conhecidos = new Set(SEED_PRODUTOS.map((p) => p.id))
    const depara: Record<string, string> = { ED000130: 'TM000076' }
    const resolver = (sku: string) => (conhecidos.has(sku) ? sku : depara[sku])
    const vendas = [...SEED_VENDAS.map((v) => ({ sku: v.productId, quantidade: v.vendas })), { sku: 'ED000130', quantidade: 8 }]
    const r = agregarVendas(vendas, resolver)
    expect(r.porProduto.TM000076).toBe(1622 + 8)
    expect(r.semCadastro).toEqual(['ED000707'])
    expect(Object.keys(r.porProduto)).toHaveLength(SEED_BOMS.length)
  })
})
