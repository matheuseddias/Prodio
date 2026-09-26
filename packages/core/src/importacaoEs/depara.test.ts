// De/para de SKU: grupos pelo componente conexo, dono pelos dados, SKU principal ED, apelidos.
import { mensagensDe, planejar, situacaoDe, type BackupBruto } from './fixtura'

const produto = (sku: string, nome = `Produto ${sku}`) => ({ sku, nome, status: 'ativo' })
const linha = (sku: string, mpCode: string, consumo = 1) => ({ sku, mpCode, consumo, unidade: 'un' })

describe('de/para TM→ED (sentido atual)', () => {
  it('TM no cadastro sem ficha e ED com ficha: um produto ED com o TM de apelido', () => {
    const p = planejar((b) => {
      b.products.push(produto('TM900002', 'Espelho antigo - Preto'))
      b.bom = b.bom.filter((l: BackupBruto) => l.sku !== 'TM900002')
    })
    expect(p.payload.produtos.map((x) => x.sku)).not.toContain('TM900002')
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')?.apelidos).toEqual(['TM900002'])
    expect(mensagensDe(p, 'apelido', 'TM900002').some((m) => m.includes('não vira produto separado'))).toBe(true)
  })

  it('cadastro e ficha só no TM: o principal é o ED do grupo, com aviso', () => {
    const p = planejar((b) => {
      b.products.push(produto('TM900010', 'Bandeja 40cm - Preta'))
      b.bom.push(linha('TM900010', 'MP9003', 1))
      b.depara = { TM900010: 'ED900010' }
    })
    const x = p.payload.produtos.find((y) => y.sku === 'ED900010')
    expect(x).toMatchObject({ nome: 'Bandeja 40cm - Preta', apelidos: ['TM900010'] })
    expect(p.payload.fichas.find((f) => f.produto_sku === 'ED900010')?.linhas[0]).toMatchObject({ insumo_sku: 'MP9003' })
    expect(mensagensDe(p, 'produto', 'ED900010').some((m) => m.includes('no ES o cadastro estava no TM900010'))).toBe(true)
  })
})

describe('de/para ED→TM (sentido antigo, antes de 09/07)', () => {
  it('o PARA (TM) tem cadastro e ficha; o ED vira o SKU principal e o TM o apelido', () => {
    const p = planejar((b) => {
      b.products.push(produto('TM900020', 'Espelho 50cm - Preto'))
      b.bom.push(linha('TM900020', 'MP9001', 0.25))
      b.depara = { ED900020: 'TM900020' }
    })
    expect(p.origem.sentidoDepara).toBe('ED→TM')
    expect(p.avisosGerais.some((a) => a.includes('sentido antigo'))).toBe(true)
    const x = p.payload.produtos.find((y) => y.sku === 'ED900020')
    expect(x?.apelidos).toEqual(['TM900020'])
    expect(p.payload.fichas.find((f) => f.produto_sku === 'ED900020')?.linhas[0]).toMatchObject({ insumo_sku: 'MP9001', consumo: 0.25 })
  })

  it('os dois lados no cadastro, só um com ficha: o dono é o que tem ficha', () => {
    const p = planejar((b) => {
      b.products.push(produto('TM900021', 'Nome do TM'), produto('ED900021', 'Nome do ED'))
      b.bom.push(linha('TM900021', 'MP9003', 2))
      b.depara = { ED900021: 'TM900021' }
    })
    const x = p.payload.produtos.find((y) => y.sku === 'ED900021')
    expect(x).toMatchObject({ nome: 'Nome do TM', apelidos: ['TM900021'] })
  })
})

describe('casos difíceis do de/para', () => {
  it('cadeia A→B→C vira um grupo só', () => {
    const p = planejar((b) => {
      b.products.push(produto('TM900031'))
      b.depara = { TM900030: 'TM900031', TM900031: 'ED900031' }
    })
    expect(p.payload.produtos.find((y) => y.sku === 'ED900031')?.apelidos).toEqual(['TM900030', 'TM900031'])
    expect(p.origem.sentidoDepara).toBe('misto')
  })

  it('dois produtos com fichas diferentes ligados pelo de/para: não junta e o par vira problema', () => {
    const p = planejar((b) => {
      b.depara = { ED900003: 'ED900002' }
    })
    expect(p.payload.produtos.some((y) => y.sku === 'ED900003')).toBe(true)
    expect(p.payload.produtos.some((y) => y.sku === 'ED900002')).toBe(true)
    expect(p.payload.produtos.every((y) => y.apelidos.length === 0 || y.sku === 'ED900001')).toBe(true)
    expect(situacaoDe(p, 'apelido', 'ED900003')).toBe('problema')
  })

  it('de/para sem nenhum dos lados no cadastro é ignorado; a ficha órfã gera aviso', () => {
    const p = planejar((b) => {
      b.depara = { TM900040: 'ED900040' }
      b.bom.push(linha('ED900040', 'MP9003'))
    })
    expect(p.payload.produtos.some((y) => y.sku === 'ED900040')).toBe(false)
    expect(mensagensDe(p, 'apelido', 'TM900040')[0]).toContain('ignorado')
    expect(mensagensDe(p, 'ficha', 'ED900040')[0]).toContain('ficha órfã')
  })

  it('par inválido (vazio ou igual) é ignorado com aviso; sem de/para o sentido é "sem de/para"', () => {
    const p = planejar((b) => {
      b.depara = { ED900001: 'ED900001', '': 'ED900002' }
    })
    expect(p.origem.sentidoDepara).toBe('sem de/para')
    expect(p.linhas.some((l) => l.entidade === 'apelido' && l.mensagens.includes('par de/para inválido ignorado'))).toBe(true)
  })

  it('prefixo principal configurável', () => {
    const p = planejar(undefined, { prefixoPrincipal: 'TM' })
    expect(p.payload.produtos.find((y) => y.sku === 'TM900002')?.apelidos).toEqual(['ED900001'])
  })
})
