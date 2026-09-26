// Custo de referência vindo do ES: a regra é a da ficha técnica do ES (custo líquido de tabela ÷ fator; sem valor
// de NF-e, o custo médio). O caso real (26/09): insumos com custo zero e a Bolha Inflável cobrada por rolo em cada
// unidade da ficha do espelho 60cm (R$ 1.603,15 numa linha). Reproduzido com dados sintéticos em
// fixtures/backup-es-custos.json; fixtures/payload-es-custos-antigo.json é o que a regra antiga (custo médio do
// ES) gerava desse backup, congelado para o teste de banco provar que reimportar conserta.
import { custoProduto } from '../ficha'
import payloadAntigoBruto from '../fixtures/payload-es-custos-antigo.json?raw'
import type { Bom, Material } from '../tipos'
import { custoReferenciaES, custoTabelaES, reais, type CustoInsumoES } from './custos'
import { jsonUmItemPorLinha, mensagensDe, planejarCustos, situacaoDe } from './fixtura'
import type { PayloadImportacao } from './tipos'

const base: CustoInsumoES = { regimeNormal: true }

describe('custoTabelaES: a mesma conta do custoLiq do ES', () => {
  it('regime normal: ICMS, IPI e PIS/COFINS 9,25% sobre a base sem ICMS', () => {
    // Montana: 1650 + IPI 82,50; créditos 66 + 82,50 + 146,52
    const t = custoTabelaES({ ...base, valorNfe: 1650, valorIpi: 82.5, aliqIcms: 4 })
    expect(t.nfe).toBeCloseTo(1732.5, 6)
    expect(t.liquido).toBeCloseTo(1437.48, 6)
  })
  it('Simples: só o ICMS do pCredSN; sem regime no ES conta como Simples (if do JavaScript)', () => {
    expect(custoTabelaES({ regimeNormal: false, valorNfe: 58.9, aliqCredSN: 1.25 }).liquido).toBeCloseTo(58.16375, 8)
    expect(custoTabelaES({ regimeNormal: false, valorNfe: 58.9, aliqIcms: 18 }).liquido).toBeCloseTo(58.9, 8)
  })
  it('valorIpi presente vence o credIpi; aliqIpi presente troca o crédito de IPI', () => {
    expect(custoTabelaES({ ...base, valorNfe: 100, credIpi: 5 }).nfe).toBe(105)
    expect(custoTabelaES({ ...base, valorNfe: 100, valorIpi: 0, credIpi: 5 }).nfe).toBe(100)
    const comAliq = custoTabelaES({ ...base, valorNfe: 100, valorIpi: 10, aliqIpi: 5 })
    expect(comAliq.nfe).toBe(110)
    expect(comAliq.liquido).toBeCloseTo(110 - 5 - 9.25, 8)
  })
})

describe('custoReferenciaES', () => {
  const bolha: CustoInsumoES = { regimeNormal: false, valorNfe: 400.79, fatorConversao: 100, custoMedio: 400.79 }

  it('custo médio legado por unidade de compra: vale tabela ÷ fator e a prévia explica', () => {
    const r = custoReferenciaES(bolha, 'rl', 'un')
    expect(r).toMatchObject({ custo: 4.0079, origem: 'tabela' })
    expect(r.avisos).toEqual(['o custo médio do ES (R$ 400,79) está por rl, não por un: vale o custo de tabela R$ 4,01/un (custo líquido R$ 400,79/rl ÷ fator 100, a conta da ficha do ES)'])
  })
  it('custo médio zerado, negativo ou ausente não apaga o custo de tabela', () => {
    for (const custoMedio of [0, -3.12, undefined]) {
      expect(custoReferenciaES({ ...base, valorNfe: 5.9, valorIpi: 0.3, aliqIcms: 18, custoMedio }, 'un', 'un')).toEqual({ custo: 4.3905, origem: 'tabela', avisos: [] })
    }
  })
  it('médio perto do de tabela: sem aviso; muito longe: avisa e vale o de tabela', () => {
    expect(custoReferenciaES({ ...base, valorNfe: 553, aliqIcms: 18, custoMedio: 280 }, 'cx', 'cx').avisos).toEqual([])
    const longe = custoReferenciaES({ ...base, valorNfe: 553, aliqIcms: 18, custoMedio: 2000 }, 'cx', 'cx')
    expect(longe.custo).toBe(411.515)
    expect(longe.avisos[0]).toContain('é 4,9× o custo de tabela (R$ 411,51/cx)')
    expect(custoReferenciaES({ ...base, valorNfe: 553, aliqIcms: 18, custoMedio: 20 }, 'cx', 'cx').avisos[0]).toContain('é 1/21 do custo de tabela')
  })
  it('sem valor de NF-e no ES: vale o custo médio (custoAtual do ES), sem aviso', () => {
    expect(custoReferenciaES({ ...base, valorNfe: 0, fatorConversao: 1000, custoMedio: 0.045 }, 'un', 'un')).toEqual({ custo: 0.045, origem: 'medio', avisos: [] })
  })
  it('créditos que cobrem a NF-e: vale o médio; sem médio, nada vai', () => {
    const tudo = { ...base, valorNfe: 10, valorIpi: 0, aliqIcms: 100 }
    expect(custoReferenciaES({ ...tudo, custoMedio: 2 }, 'un', 'un')).toMatchObject({ custo: 2, origem: 'medio' })
    const nada = custoReferenciaES(tudo, 'un', 'un')
    expect(nada.custo).toBeUndefined()
    expect(nada.avisos[0]).toContain('cobrem o custo da NF-e')
  })
  it('sem custo nenhum no ES: não vai, com aviso; custo que arredonda a zero também não', () => {
    expect(custoReferenciaES(base, 'un', 'un')).toEqual({ origem: 'nenhum', avisos: ['sem custo no ES (valor da NF-e e custo médio zerados ou ausentes); custo de referência não enviado'] })
    const minusculo = custoReferenciaES({ regimeNormal: false, valorNfe: 0.01, fatorConversao: 1000 }, 'un', 'g')
    expect(minusculo.custo).toBeUndefined()
    expect(minusculo.avisos[0]).toContain('abaixo de R$ 0,0001')
  })
  it('reais: milhar com ponto, 4 casas abaixo de R$ 1', () => {
    expect([reais(1603.16), reais(0.0582), reais(0), reais(-3.12)]).toEqual(['R$ 1.603,16', 'R$ 0,0582', 'R$ 0,00', '-R$ 3,12'])
  })
})

// Custo da ficha como o Prodio calcula (core/ficha.ts custoProduto), com o custo de referência do payload
// fazendo as vezes do custo médio (o que a web faz enquanto o ledger não tem custo).
function custoNoProdio(p: PayloadImportacao, sku: string): number {
  const materiais: Material[] = p.insumos.map((i) => ({
    id: i.sku, sku: i.sku, nome: i.nome, unidadeCompra: i.unidade_compra, unidadeConsumo: i.unidade_consumo,
    fatorConversao: i.fator_conversao, minimo: 0, saldo: 0, custoMedio: i.custo_referencia ?? 0, leadTimeDias: 0,
  }))
  const boms: Bom[] = p.fichas.map((f) => ({
    productId: f.produto_sku, versao: 1, ativa: true, atualizadoEm: '2026-09-26',
    linhas: f.linhas.map((l, k) => ({ id: `${f.produto_sku}-${k}`, tipo: l.tipo, materialId: l.insumo_sku, componentId: l.componente_sku, consumo: l.consumo, unidade: l.unidade, perdaPct: 0 })),
  }))
  return custoProduto(sku, { boms, materiais })
}

describe('backup de custos: o espelho 60cm', () => {
  const plano = planejarCustos()
  const antigo = JSON.parse(payloadAntigoBruto) as PayloadImportacao

  it('payload estável (fixture do teste de banco)', async () => {
    expect(plano.aceito).toBe(true)
    await expect(jsonUmItemPorLinha(plano.payload)).toMatchFileSnapshot('../fixtures/payload-es-custos.json')
  })

  it('custo de referência por unidade de consumo, líquido, a conta da ficha do ES', () => {
    const custo = (p: PayloadImportacao) => Object.fromEntries(p.insumos.map((i) => [i.sku, i.custo_referencia]))
    expect(custo(plano.payload)).toEqual({
      MP9101: 31.0981, MP9133: 0.0582, MP9140: 20.5354, MP9145: 4.0079, MP9163: 4.3905, MP9172: 411.515, MP9180: 85, MP9190: undefined,
    })
    // a regra antiga (custo médio do ES): Montana e Caixa sem custo, Bolha por rolo
    expect(custo(antigo)).toMatchObject({ MP9140: undefined, MP9145: 400.79, MP9163: undefined, MP9172: 280 })
  })

  it('só o custo muda: unidades, fator, produtos e fichas saem iguais à importação antiga', () => {
    const semCusto = (p: PayloadImportacao) => ({ ...p, insumos: p.insumos.map(({ custo_referencia: _c, ...i }) => i) })
    expect(semCusto(plano.payload)).toEqual(semCusto(antigo))
  })

  it('a ficha do espelho 60cm volta a ter custo de espelho', () => {
    expect(custoNoProdio(antigo, 'ED900124')).toBeCloseTo(1615.15, 2) // 4 un × R$ 400,79 = R$ 1.603,16 numa linha
    expect(custoNoProdio(plano.payload, 'ED900124')).toBeCloseTo(36.23, 2)
    expect(situacaoDe(plano, 'ficha', 'ED900124')).toBe('ok')
  })

  it('a prévia avisa: custo médio legado, fator 0, unidades diferentes com fator 1 e insumo sem custo', () => {
    expect(mensagensDe(plano, 'insumo', 'MP9145')[0]).toContain('está por rl, não por un')
    expect(mensagensDe(plano, 'insumo', 'MP9180')).toEqual([
      'fator de conversão 0 no ES; gravado 1 (como o ES calcula), confira',
      'compra em rl e consumo em un com fator 1 (1 rl = 1 un?): confira o fator de conversão; o custo por un e a entrada da NF-e dependem dele',
    ])
    expect(situacaoDe(plano, 'insumo', 'MP9190')).toBe('aviso')
    expect(mensagensDe(plano, 'insumo', 'MP9140')).toEqual([])
    expect(mensagensDe(plano, 'insumo', 'MP9163')).toEqual([])
  })

  it('a prévia avisa ficha com linha que passa do CMV do ES ou com insumo sem custo', () => {
    expect(mensagensDe(plano, 'ficha', 'ED900500')).toEqual([
      'MP9180: R$ 85,00 por unidade do produto (1 un × R$ 85,00/un) é 20× o CMV do ES (R$ 4,20); confira no ES o fator de conversão, o valor da NF-e e o consumo',
      'MP9190: insumo sem custo no ES; a linha entra com custo zero no custo da ficha',
    ])
  })

  it('com a Bolha cobrada por rolo (ES sem valor de NF-e), a ficha do espelho acusa a linha', () => {
    const p = planejarCustos((b) => {
      b.insumos.find((i: { sku: string }) => i.sku === 'MP9145').valorNfe = 0
    })
    expect(mensagensDe(p, 'ficha', 'ED900124')).toEqual([
      'MP9145: R$ 1.603,16 por unidade do produto (4 un × R$ 400,79/un) é 45× o CMV do ES (R$ 35,90); confira no ES o fator de conversão, o valor da NF-e e o consumo',
    ])
    // sem CMV no ES, a linha que engole as outras é que acusa
    const semCmv = planejarCustos((b) => {
      b.insumos.find((i: { sku: string }) => i.sku === 'MP9145').valorNfe = 0
      b.products.find((x: { sku: string }) => x.sku === 'ED900124').cmv = 0
    })
    expect(mensagensDe(semCmv, 'ficha', 'ED900124')[0]).toMatch(/^MP9145: R\$ 1\.603,16 .* é 79× a soma das outras linhas \(R\$ 20,20\)/)
  })

  it('componente caro acusa pelo componente e a ficha toda passando do CMV também avisa', () => {
    const p = planejarCustos((b) => {
      b.insumos.find((i: { sku: string }) => i.sku === 'MP9133').fatorConversao = 1 // filamento: R$ 58,16 por grama
    })
    expect(mensagensDe(p, 'ficha', 'ED900379')[0]).toContain('é 990× o CMV do ES (R$ 0,37)')
    expect(mensagensDe(p, 'ficha', 'ED900124')[0]).toMatch(/^ED900379: R\$ 366,43 .*confira a ficha do componente$/)
    const toda = planejarCustos((b) => {
      b.products.find((x: { sku: string }) => x.sku === 'ED900124').cmv = 10
    })
    expect(mensagensDe(toda, 'ficha', 'ED900124')).toEqual(['custo pela ficha (R$ 36,23) é 3,6× o CMV do ES (R$ 10,00); confira os custos e os consumos das linhas'])
  })
})
