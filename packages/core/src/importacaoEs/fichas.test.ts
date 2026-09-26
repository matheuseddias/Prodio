// Fichas técnicas: perda em FRAÇÃO, calc, linhas somadas, componentes, e ficha que nunca entra pela metade.
import { calcConsumo } from '../ficha'
import { converterCalc } from './fichas'
import { mensagensDe, planejar, situacaoDe, type BackupBruto } from './fixtura'

const ficha = (p: ReturnType<typeof planejar>, sku: string) => p.payload.fichas.find((f) => f.produto_sku === sku)

describe('perda: fração, nunca percentual', () => {
  // Armadilha: o ES guarda perda em % (10 = 10%); o Prodio em fração (0.10). E o consumo do ES já inclui a perda,
  // então a linha vai com perda_pct 0 — se fosse 10 (ou 0.10), o Prodio contaria a perda duas vezes.
  const p = planejar()
  it('perda_pct da linha é 0 e a perda do calc vai em fração', () => {
    const l = ficha(p, 'ED900001')?.linhas.find((x) => x.insumo_sku === 'MP9001')
    expect(l?.perda_pct).toBe(0)
    expect(l?.calc?.perda).toEqual({ tipo: 'pct', valor: 0.1 })
    expect(l?.consumo).toBe(0.176)
    expect(calcConsumo(l?.calc)).toBe(0.176) // 40×40 cm = 0,16 m² + 10%
  })
  it('perda "fixo" do ES vira "fixa" no valor absoluto', () => {
    const l = ficha(p, 'ED900002')?.linhas[0]
    expect(l?.calc).toEqual({ tipo: 'peso', partes: [{ nome: 'pino', qtd: 2, pesoG: 3 }], perda: { tipo: 'fixa', valor: 0.3 } })
    expect(calcConsumo(l?.calc)).toBe(l?.consumo)
  })
})

describe('converterCalc', () => {
  it('rolo sem largura fica com 1,4 m; partes em texto viram número; vazias somem', () => {
    const avisos: string[] = []
    const c = converterCalc({ tipo: 'rolo', perdaTipo: 'nenhuma', perda: '5', partes: [{ larg: '90', alt: '40,5', qtd: '', un: '', peso: '' }] }, avisos)
    expect(c).toEqual({ tipo: 'rolo', partes: [{ qtd: 1, largCm: 90, altCm: 40.5 }], larguraRoloM: 1.4 })
    expect(avisos).toEqual([])
  })
  it('tipo desconhecido ou sem partes: descarta o calc com aviso', () => {
    const avisos: string[] = []
    expect(converterCalc({ tipo: 'volume', partes: [{ larg: 1 }] }, avisos)).toBeUndefined()
    expect(converterCalc({ tipo: 'area', partes: [] }, avisos)).toBeUndefined()
    expect(avisos).toHaveLength(2)
  })
})

describe('linhas da ficha', () => {
  it('rolo da Montana com unidade da linha desatualizada: vale a unidade de consumo do insumo', () => {
    const l = ficha(planejar(), 'ED900001')?.linhas.find((x) => x.insumo_sku === 'MP9002')
    expect(l).toMatchObject({ unidade: 'm', consumo: 0.053643, calc: { tipo: 'rolo', larguraRoloM: 1.4 } })
  })

  it('linha repetida soma e descarta o calc; consumo zero ou nulo é descartado com aviso', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900003', mpCode: 'MP9007', consumo: '0,02', unidade: 'MT' })
      b.bom.push({ sku: 'ED900003', mpCode: 'MP9003', consumo: null, unidade: 'Un' })
    })
    expect(ficha(p, 'ED900003')?.linhas).toEqual([{ tipo: 'insumo', insumo_sku: 'MP9007', consumo: 0.3, unidade: 'm', perda_pct: 0 }])
    const msgs = mensagensDe(p, 'ficha', 'ED900003')
    expect(msgs.some((m) => m.includes('MP9007: linhas repetidas somadas'))).toBe(true)
    expect(msgs.some((m) => m.includes('MP9003: linha com consumo zero'))).toBe(true)
  })

  it('código com lixo em volta é lido pelo /MP\\d+/; produto citado como insumo vira componente', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900004', mpCode: 'mp9003 - disco', consumo: 1, unidade: 'Un' })
      b.bom.push({ sku: 'ED900004', mpCode: 'ED900002', consumo: 4, unidade: 'un' })
    })
    const linhas = ficha(p, 'ED900004')?.linhas
    expect(linhas?.find((l) => l.insumo_sku === 'MP9003')).toBeDefined()
    expect(linhas?.find((l) => l.componente_sku === 'ED900002')).toMatchObject({ tipo: 'produto', consumo: 4, unidade: 'un' })
    const msgs = mensagensDe(p, 'ficha', 'ED900004')
    expect(msgs.some((m) => m.includes('lido como MP9003'))).toBe(true)
    expect(msgs.some((m) => m.includes('ED900002 não é insumo; lido como componente'))).toBe(true)
  })

  it('componente citado pelo SKU antigo (apelido) resolve para o principal', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900004', tipo: 'produto', mpCode: 'TM900002', consumo: 1, unidade: 'un' })
    })
    expect(ficha(p, 'ED900004')?.linhas.find((l) => l.tipo === 'produto' && l.componente_sku === 'ED900001')).toBeDefined()
  })
})

describe('ficha nunca entra pela metade', () => {
  it('insumo inexistente derruba a ficha inteira, e o produto leva o CMV como custo manual', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900003', mpCode: 'MP9999', consumo: 1, unidade: 'un' })
    })
    expect(ficha(p, 'ED900003')).toBeUndefined()
    expect(situacaoDe(p, 'ficha', 'ED900003')).toBe('problema')
    expect(mensagensDe(p, 'ficha', 'ED900003').some((m) => m.includes('MP9999 não existe'))).toBe(true)
    expect(p.payload.produtos.find((x) => x.sku === 'ED900003')?.custo_manual).toBe(3.85)
    // o kit que usa o mousepad como componente continua entrando (o componente existe como produto)
    expect(ficha(p, 'ED900004')).toBeDefined()
  })

  it('consumo negativo ou não numérico é problema', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900002', mpCode: 'MP9003', consumo: -1, unidade: 'un' })
      b.bom.push({ sku: 'ED900004', mpCode: 'MP9003', consumo: 'muito', unidade: 'un' })
    })
    expect(situacaoDe(p, 'ficha', 'ED900002')).toBe('problema')
    expect(situacaoDe(p, 'ficha', 'ED900004')).toBe('problema')
    expect(mensagensDe(p, 'ficha', 'ED900004').some((m) => m.includes('não numérico'))).toBe(true)
  })

  it('insumo com problema derruba as fichas que o usam', () => {
    const p = planejar((b) => {
      b.insumos[6].unidade = 'galão'
    })
    expect(situacaoDe(p, 'insumo', 'MP9007')).toBe('problema')
    expect(ficha(p, 'ED900003')).toBeUndefined()
    expect(mensagensDe(p, 'ficha', 'ED900003').some((m) => m.includes('MP9007 está com problema'))).toBe(true)
  })

  it('componente que não é produto importado e componente = próprio produto', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900002', tipo: 'produto', mpCode: 'ED909999', consumo: 1, unidade: 'un' })
      b.bom.push({ sku: 'ED900003', tipo: 'produto', mpCode: 'ED900003', consumo: 1, unidade: 'un' })
    })
    expect(mensagensDe(p, 'ficha', 'ED900002').some((m) => m.includes('ED909999 não é um produto importado'))).toBe(true)
    expect(mensagensDe(p, 'ficha', 'ED900003').some((m) => m.includes('componente de si mesmo'))).toBe(true)
  })

  it('fichas em ciclo ficam de fora (as duas)', () => {
    const p = planejar((b) => {
      b.bom.push({ sku: 'ED900003', tipo: 'produto', mpCode: 'ED900004', consumo: 1, unidade: 'un' })
    })
    expect(ficha(p, 'ED900003')).toBeUndefined()
    expect(ficha(p, 'ED900004')).toBeUndefined()
    expect(mensagensDe(p, 'ficha', 'ED900004').some((m) => m.includes('ciclo entre fichas: ED900003 → ED900004 → ED900003'))).toBe(true)
    expect(ficha(p, 'ED900001')).toBeDefined()
  })

  it('ficha com mais de 200 linhas fica de fora', () => {
    const p = planejar((b: BackupBruto) => {
      for (let i = 0; i < 201; i++) b.insumos.push({ sku: `MP8${String(i).padStart(3, '0')}`, nome: `Insumo ${i}`, unidade: 'un', custoMedio: 1 })
      for (let i = 0; i < 201; i++) b.bom.push({ sku: 'ED900002', mpCode: `MP8${String(i).padStart(3, '0')}`, consumo: 1, unidade: 'un' })
    })
    expect(ficha(p, 'ED900002')).toBeUndefined()
    expect(mensagensDe(p, 'ficha', 'ED900002').some((m) => m.includes('máximo 200'))).toBe(true)
  })

  it('produto com problema: a ficha dele fica de fora com problema, não como órfã', () => {
    const p = planejar((b) => {
      b.products[1].nome = ''
    })
    expect(situacaoDe(p, 'ficha', 'ED900002')).toBe('problema')
    expect(situacaoDe(p, 'ficha', 'ED900001')).toBe('problema') // usa o pino como componente
  })
})
