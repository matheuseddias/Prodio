// Entradas hostis ou quebradas: __proto__, tipos trocados, textos enormes, números como texto, estruturas no
// lugar de escalares. O plano nunca lança, nunca polui protótipo e o payload continua dentro dos limites.
import { planejarImportacaoES } from '../importacaoEs'
import { backupSintetico, planejar, type BackupBruto } from './fixtura'

describe('importação do ES · adversarial', () => {
  it('__proto__, constructor e prototype como chaves não poluem nada', () => {
    const texto = JSON.stringify(backupSintetico())
      .replace('"depara":{', '"depara":{"__proto__":{"polu":"ido"},"constructor":"ED900001",')
      .replace('"precifProd":{', '"precifProd":{"__proto__":{"pesoKg":99},')
      .replace('"deparaForn":{', '"deparaForn":{"__proto__":{"X":"MP9001"},')
      .replace('"fornInsumo":{', '"fornInsumo":{"prototype":{"MP9001":{"fator":2}},')
    const b = JSON.parse(texto) as BackupBruto
    expect(Object.prototype.hasOwnProperty.call(b.depara, '__proto__')).toBe(true) // o JSON.parse cria a chave própria
    const p = planejarImportacaoES(b, { cnpjManual: JSON.parse('{"__proto__":{"x":1}}') as Record<string, string> })
    expect(p.aceito).toBe(true)
    expect(({} as Record<string, unknown>).polu).toBeUndefined()
    expect(JSON.stringify(p)).not.toContain('polu')
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')?.peso_kg).toBe(1.9)
  })

  it('tipos trocados em todo lugar não quebram o plano', () => {
    const p = planejar((b) => {
      b.fornecedores.push('fornecedor como texto', null, 42, { nome: ['lista'], cnpj: { a: 1 } })
      b.insumos.push({ sku: { x: 1 }, nome: 'Obj' }, { sku: 'MP9201', nome: 5, unidade: ['un'] }, [1, 2])
      b.products.push({ sku: 123456, nome: 'SKU numérico', ean: { n: 1 }, largura: 'quarenta', cor: 7 })
      b.bom.push({ sku: 'ED900003', mpCode: 9007, consumo: '0,01', unidade: {} }, { sku: 'ED900003', mpCode: 'MP9007', consumo: { v: 1 } })
      b.depara.TM900050 = { para: 'ED900050' }
      b.fornInsumo = 'quebrado'
      b.deparaForn['12345678000195'] = ['lista']
      b.kaminoForn = [1, 2, 3]
      b.precifProd.ED900003 = 'texto'
    })
    expect(p.aceito).toBe(true)
    expect(p.payload.produtos.find((x) => x.sku === '123456')).toMatchObject({ nome: 'SKU numérico', atributos: {} })
    expect(p.payload.insumos.some((i) => i.sku === 'MP9201')).toBe(false) // unidade em lista não é reconhecida
    expect(p.payload.fichas.some((f) => f.produto_sku === 'ED900003')).toBe(false) // consumo objeto: problema
    const tudo = JSON.stringify(p.payload)
    expect(tudo).not.toContain('[object Object]')
  })

  it('números como texto (com vírgula ou ponto) viram número', () => {
    const p = planejar((b) => {
      b.insumos[0].fatorConversao = '7,704'
      b.insumos[0].valorNfe = '300,00'
      b.insumos[0].aliqIcms = '12'
      b.insumos[0].minimo = '30.8'
      b.fornecedores[2].leadTime = '7'
    })
    expect(p.payload.insumos.find((i) => i.sku === 'MP9001')).toMatchObject({ fator_conversao: 7.704, custo_referencia: 31.0981, minimo: 30.8, lead_time_dias: 7 })
  })

  it('textos enormes são cortados e o payload respeita os limites do banco', () => {
    const enorme = 'x'.repeat(100_000)
    const p = planejar((b) => {
      b.products[0].nome = enorme
      b.fornecedores[0].contato = enorme
      b.insumos[0].nome = `Chapa ${enorme}`
      b.products[0].cor = enorme
      b.bom[1].calc.partes[0].nome = enorme
      b.deparaForn['11222333000181'][enorme] = { mp: 'MP9003', fator: 1 }
    })
    const ed = p.payload.produtos.find((x) => x.sku === 'ED900001')
    expect(ed?.nome.length).toBe(200)
    expect(ed?.atributos.cor.length).toBeLessThanOrEqual(60)
    expect(p.payload.fornecedores.find((f) => f.cnpj === '98765432000198')?.contato?.length).toBe(500)
    expect(p.payload.insumos.find((i) => i.sku === 'MP9001')?.nome.length).toBe(200)
    expect(JSON.stringify(p.payload).length).toBeLessThan(40_000)
  })

  it('números absurdos (negativos, infinitos, gigantes) não vão ao payload', () => {
    const p = planejar((b) => {
      b.insumos[0].valorNfe = -300
      b.insumos[0].custoMedio = -5
      b.insumos[0].minimo = -1
      b.insumos[1].fatorConversao = 1e300
      b.fornecedores[1].leadTime = -3
      b.precifProd.ED900001 = { pesoKg: 1e12, c: 1, l: 1, a: 1 }
    })
    const mp1 = p.payload.insumos.find((i) => i.sku === 'MP9001')
    expect(mp1?.custo_referencia).toBeUndefined()
    expect(mp1?.minimo).toBeUndefined()
    expect(p.payload.insumos.find((i) => i.sku === 'MP9002')?.fator_conversao).toBe(1)
    expect(p.payload.fornecedores.find((f) => f.cnpj === '12345678000195')?.lead_time_dias).toBeUndefined()
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')?.peso_kg).toBeUndefined()
  })

  // Um valor fora do formato de import_catalog_validate recusa o payload INTEIRO (22023): nem a prévia sai.
  // Cada um destes passava pelo core e derrubava a importação toda por causa de um item.
  it('valores fora da faixa das colunas não vão ao payload (um item ruim não derruba a importação)', () => {
    const p = planejar((b) => {
      b.insumos[0].fatorConversao = 5e8 // numeric(14,6): o banco aceita até 1e8
      b.bom[2].calc.larguraRolo = 1400 // largura do rolo em mm no lugar de m: o banco aceita até 1000
      b.precifProd.ED900001 = { pesoKg: 1, c: 90000, l: 90000, a: 90000 } // cubado 1,2e11: o banco aceita até 1e10
      b.insumos[1].fornecedores[0].preco = 5e8 // × fator 50 do vínculo (nota) ÷ fator 1 do insumo = 2,5e10: o banco aceita até 1e10
      b.insumos[1].fatorConversao = 1
    })
    const mp1 = p.payload.insumos.find((i) => i.sku === 'MP9001')
    expect(mp1?.fator_conversao).toBe(1)
    expect(p.linhas.find((l) => l.entidade === 'insumo' && l.chave === 'MP9001')?.mensagens.join(' ')).toContain('fator de conversão')
    const rolo = p.payload.fichas.find((f) => f.produto_sku === 'ED900001')?.linhas.find((l) => l.insumo_sku === 'MP9002')
    expect(rolo).toBeDefined()
    expect(rolo?.calc).toBeUndefined()
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')?.peso_cubado_kg).toBeUndefined()
    const rockl = p.payload.vinculos.find((v) => v.insumo_sku === 'MP9002')
    expect(rockl).toMatchObject({ fator: 50 })
    expect(rockl?.preco).toBeUndefined()
    for (const f of p.payload.fichas) for (const l of f.linhas) if (l.calc?.larguraRoloM !== undefined) expect(l.calc.larguraRoloM).toBeLessThan(1000)
  })

  it('linhas repetidas que somadas passam do teto do consumo derrubam só a ficha', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900003', mpCode: 'MP9007', consumo: 6e7, unidade: 'un' }, { sku: 'ED900003', mpCode: 'MP9007', consumo: 6e7, unidade: 'un' })
    })
    expect(p.payload.fichas.some((f) => f.produto_sku === 'ED900003')).toBe(false)
    expect(p.linhas.find((l) => l.entidade === 'ficha' && l.chave === 'ED900003')?.situacao).toBe('problema')
  })

  it('calculadora grande demais para a coluna (8 kB) é descartada, a linha fica', () => {
    const p = planejar((b) => {
      b.bom[1].calc.partes = Array.from({ length: 50 }, (_, i) => ({ nome: `Peça número ${i} com acentuação à beça: ${'ção'.repeat(20)}`, larg: 40.123456, alt: 40.654321, qtd: 3 }))
    })
    const linha = p.payload.fichas.find((f) => f.produto_sku === 'ED900001')?.linhas.find((l) => l.insumo_sku === 'MP9001')
    expect(linha).toBeDefined()
    expect(linha?.calc).toBeUndefined()
  })

  it('texto cortado no meio de um emoji e caractere nulo não geram JSON que o jsonb recusa', () => {
    const p = planejar((b) => {
      b.products[0].nome = `${'a'.repeat(199)}🪞 espelho`
      b.fornecedores[0].contato = `vendas\u0000@exemplo.invalid`
    })
    const json = JSON.stringify(p.payload)
    expect(json).not.toMatch(/\\u0000|\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i)
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')?.nome).toBe('a'.repeat(199))
    expect(p.payload.fornecedores.find((f) => f.cnpj === '98765432000198')?.contato).toBe('vendas @exemplo.invalid')
  })

  it('backup gigante de lixo não trava: seções que não são lista são ignoradas', () => {
    const p = planejarImportacaoES({ products: [{ sku: 'ED1', nome: 'Um' }], insumos: 'nao', bom: 5, fornecedores: {} })
    expect(p.aceito).toBe(false)
    const q = planejarImportacaoES({ products: [{ sku: 'ED1', nome: 'Um' }], insumos: [], bom: 5, fornecedores: {}, depara: [] })
    expect(q.aceito).toBe(true)
    expect(q.payload.produtos.map((x) => x.sku)).toEqual(['ED1'])
  })
})
