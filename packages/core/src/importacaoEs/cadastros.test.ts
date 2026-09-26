// Fornecedores, insumos e produtos: regras de conversão e linhas com problema.
import { mensagensDe, planejar, situacaoDe } from './fixtura'

const TECIDOS = 'Tecidos Modelo Ind. e Com.'

describe('fornecedores', () => {
  it('converte regime, prazo, lead time e contato', () => {
    const p = planejar()
    expect(p.payload.fornecedores.find((f) => f.cnpj === '11222333000181')).toEqual({
      cnpj: '11222333000181', nome: 'Vidraçaria Exemplo Ltda', regime: 'normal', lead_time_dias: 7, condicao_pagamento: [28, 35, 42], contato: 'Contato Fictício · (00) 0000-0000',
    })
    // sem leadTime: não envia; prazo "" no ES é à vista → [0]
    expect(p.payload.fornecedores.find((f) => f.cnpj === '98765432000198')).toEqual({
      cnpj: '98765432000198', nome: 'Plásticos Teste ME', regime: 'simples', condicao_pagamento: [0], contato: 'vendas@exemplo.invalid',
    })
  })

  it('prazo vazio vira à vista; prazo sem número e regime ausente viram aviso', () => {
    const p = planejar((b) => {
      b.fornecedores[0].prazo = 'combinar'
      delete b.fornecedores[2].regimeNormal
    })
    expect(p.payload.fornecedores.find((f) => f.cnpj === '98765432000198')?.condicao_pagamento).toBeUndefined()
    expect(mensagensDe(p, 'fornecedor', '98765432000198').some((m) => m.includes('combinar'))).toBe(true)
    expect(p.payload.fornecedores.find((f) => f.cnpj === '11222333000181')?.regime).toBeUndefined()
    expect(mensagensDe(p, 'fornecedor', '11222333000181').some((m) => m.includes('regime'))).toBe(true)
  })

  it('ordem de resolução do CNPJ: digitado na prévia vence o Prodio, que vence as notas', () => {
    const manual = planejar(undefined, { cnpjManual: { [TECIDOS]: '52.998.224/0001-00' }, cnpjPorNomeNoProdio: { [TECIDOS]: '11444777000161' } })
    // CNPJ digitado inválido é ignorado e cai no seguinte (Prodio)
    expect(manual.payload.fornecedores.some((f) => f.cnpj === '11444777000161')).toBe(true)
    const valido = planejar(undefined, { cnpjManual: { [TECIDOS]: '11.444.777/0001-61' } })
    expect(mensagensDe(valido, 'fornecedor', '11444777000161')).toContain('CNPJ digitado na prévia')
  })

  it('sem kaminoForn, acha o CNPJ pelas notas importadas (cnpj + OC → fornecedor da OC)', () => {
    const p = planejar((b) => {
      b.kaminoForn = {}
      b.fornecedores[2].cnpj = ''
    })
    expect(p.payload.fornecedores.some((f) => f.cnpj === '11222333000181' && f.nome === 'Vidraçaria Exemplo Ltda')).toBe(true)
    expect(mensagensDe(p, 'fornecedor', '11222333000181')).toContain('CNPJ achado nas notas')
  })

  it('sem CNPJ em lugar nenhum: problema, fica de fora e aparece para digitar na prévia', () => {
    const p = planejar((b) => {
      b.kaminoForn = {}
    })
    expect(situacaoDe(p, 'fornecedor', `nome:${TECIDOS}`)).toBe('problema')
    expect(p.fornecedoresSemCnpj).toEqual([{ nome: TECIDOS, insumos: 2 }])
    expect(p.avisosGerais.some((a) => a.includes('sem CNPJ'))).toBe(true)
    // insumos dele entram sem fornecedor padrão, com aviso; vínculos dele ficam de fora
    const mp = p.payload.insumos.find((i) => i.sku === 'MP9002')
    expect(mp?.fornecedor_padrao_cnpj).toBeUndefined()
    expect(mensagensDe(p, 'insumo', 'MP9002').some((m) => m.includes('ficou de fora'))).toBe(true)
    expect(p.payload.vinculos.some((v) => v.insumo_sku === 'MP9002')).toBe(false)
  })

  it('CNPJ com dígito inválido tenta os outros caminhos; se nada resolver, é problema', () => {
    const p = planejar((b) => {
      b.fornecedores[0].cnpj = '98.765.432/0001-99'
    })
    expect(situacaoDe(p, 'fornecedor', 'nome:Plásticos Teste ME')).toBe('problema')
    expect(mensagensDe(p, 'fornecedor', 'nome:Plásticos Teste ME').some((m) => m.includes('dígito verificador'))).toBe(true)
  })

  it('dois fornecedores com o mesmo CNPJ viram um só (nome do que tem mais insumos)', () => {
    const p = planejar((b) => {
      b.fornecedores.push({ cnpj: '98765432000198', nome: 'Plasticos Teste (duplicado)', prazo: '30', regimeNormal: false })
    })
    const f = p.payload.fornecedores.filter((x) => x.cnpj === '98765432000198')
    expect(f).toHaveLength(1)
    expect(f[0].nome).toBe('Plásticos Teste ME')
    expect(mensagensDe(p, 'fornecedor', '98765432000198').some((m) => m.includes('mesmo CNPJ'))).toBe(true)
  })
})

describe('insumos', () => {
  const p = planejar()
  const ins = (sku: string) => p.payload.insumos.find((i) => i.sku === sku)

  it('chapa comprada por chapa (CH) vira un com fator 7,704 e consumo em m2', () => {
    expect(ins('MP9001')).toEqual({
      sku: 'MP9001', nome: 'Chapa Espelho 3mm 3,21x2,40 (exemplo)', unidade_compra: 'un', unidade_consumo: 'm2', fator_conversao: 7.704,
      ncm: '7009.91.00', minimo: 30.8, custo_referencia: 29.1837, fornecedor_padrao_cnpj: '11222333000181', lead_time_dias: 7,
    })
    expect(mensagensDe(p, 'insumo', 'MP9001')[0]).toContain('"CH" (chapa)')
  })
  it('rolo, fardo, carretel em g e milheiro', () => {
    expect(ins('MP9002')).toMatchObject({ unidade_compra: 'rl', unidade_consumo: 'm', fator_conversao: 50, lead_time_dias: 12 })
    expect(ins('MP9004')).toMatchObject({ unidade_compra: 'un', unidade_consumo: 'un', fator_conversao: 25 })
    expect(ins('MP9006')).toMatchObject({ unidade_compra: 'un', unidade_consumo: 'g', fator_conversao: 1000, custo_referencia: 0.0582 })
    expect(ins('MP9008')).toMatchObject({ unidade_compra: 'un', unidade_consumo: 'un', fator_conversao: 1000 })
  })
  it('fornecedor fora do cadastro do ES: sem fornecedor padrão, com aviso', () => {
    expect(ins('MP9005')?.fornecedor_padrao_cnpj).toBeUndefined()
    expect(mensagensDe(p, 'insumo', 'MP9005')[0]).toContain('Casa do Parafuso')
  })

  it('SKU vazio, fora do formato, repetido e unidade desconhecida', () => {
    const q = planejar((b) => {
      b.insumos.push({ sku: '', nome: 'Sem código', unidade: 'un' })
      b.insumos.push({ sku: 'MP 9001', nome: 'Duplicado', unidade: 'un' })
      b.insumos.push({ sku: 'MP#1', nome: 'Formato', unidade: 'un' })
      b.insumos.push({ sku: 'MP9101', nome: 'Tinta', unidade: 'litro' })
    })
    expect(situacaoDe(q, 'insumo', '(sem SKU) #9')).toBe('problema')
    expect(mensagensDe(q, 'insumo', 'MP9001').some((m) => m.includes('repetido'))).toBe(true)
    expect(q.payload.insumos.find((i) => i.sku === 'MP9001')?.nome).toBe('Chapa Espelho 3mm 3,21x2,40 (exemplo)')
    expect(situacaoDe(q, 'insumo', 'MP#1')).toBe('problema')
    expect(situacaoDe(q, 'insumo', 'MP9101')).toBe('problema')
    expect(mensagensDe(q, 'insumo', 'MP9101')[0]).toContain('"litro" não reconhecida')
    expect(q.payload.insumos).toHaveLength(8)
  })

  it('formato de 31/05 (sem unidadeConsumo, sem custo, fator 0): consumo = compra, fator 1, aviso de custo', () => {
    const q = planejar((b) => {
      b.insumos.push({ sku: 'MP9102', nome: 'Legado', unidade: 'MT', fatorConversao: 0, fornecedor: 'tecidos modelo ind e com' })
    })
    expect(q.payload.insumos.find((i) => i.sku === 'MP9102')).toEqual({
      sku: 'MP9102', nome: 'Legado', unidade_compra: 'm', unidade_consumo: 'm', fator_conversao: 1, fornecedor_padrao_cnpj: '12345678000195', lead_time_dias: 12,
    })
    const msgs = mensagensDe(q, 'insumo', 'MP9102')
    expect(msgs.some((m) => m.includes('sem custo'))).toBe(true)
    expect(msgs.some((m) => m.includes('casado pelo nome'))).toBe(true)
  })

  it('compra e consumo iguais com fator ≠ 1 gera aviso (fora embalagem)', () => {
    const q = planejar((b) => {
      b.insumos[6].fatorConversao = 2
    })
    expect(mensagensDe(q, 'insumo', 'MP9007').some((m) => m.includes('confira o fator'))).toBe(true)
    expect(mensagensDe(q, 'insumo', 'MP9004').some((m) => m.includes('confira o fator'))).toBe(false)
  })
})

describe('produtos', () => {
  it('atributos estruturados, família, peso e peso cubado do precifProd', () => {
    const p = planejar()
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')).toMatchObject({
      nome: 'Espelho Adnet Redondo 40cm - Preto', familia: 'Espelho', ean: '2000000000015', ncm: '7009.91.00', status: 'ativo',
      atributos: { cor: 'Preto', tamanho: '40cm', formato: 'Redondo', linha: 'Adnet', material: 'Sintético', lapidado: 'não', categoria: 'Espelho', divisao: 'Eddias Home', grupo_corte: 'Redondo 40cm' },
      peso_kg: 1.9, peso_cubado_kg: 2.025,
    })
    const mp = p.payload.produtos.find((x) => x.sku === 'ED900003')
    expect(mp?.atributos.tamanho).toBe('90x40cm')
    expect(mp?.peso_cubado_kg).toBe(0.7)
    expect(p.payload.produtos.find((x) => x.sku === 'ED900004')?.familia).toBe('Kit') // tipo "Outro" cai na categoria
  })

  it('CMV vira custo manual só quando o produto não leva ficha', () => {
    const p = planejar((b) => {
      b.products.push({ sku: 'ED900005', nome: 'Sem ficha - Azul', cmv: '12,5', categoria: 'Teste' })
    })
    expect(p.payload.produtos.find((x) => x.sku === 'ED900005')?.custo_manual).toBe(12.5)
    expect(p.payload.produtos.find((x) => x.sku === 'ED900005')?.atributos).toEqual({ categoria: 'Teste', cor: 'Azul' })
    expect(p.payload.produtos.every((x) => x.sku === 'ED900005' || x.custo_manual === undefined)).toBe(true)
  })

  it('SKU vazio, repetido, sem nome; EAN inválido e EAN repetido', () => {
    const p = planejar((b) => {
      b.products.push({ sku: '', nome: 'Sem SKU' })
      b.products.push({ sku: 'ed900003', nome: 'Duplicado' })
      b.products.push({ sku: 'ED900006', nome: '' })
      b.products.push({ sku: 'ED900007', nome: 'EAN errado', ean: '2000000000016' })
      b.products.push({ sku: 'ED900008', nome: 'EAN repetido', ean: '2000000000039' })
    })
    expect(situacaoDe(p, 'produto', '(sem SKU) #6')).toBe('problema')
    expect(mensagensDe(p, 'produto', 'ED900003').some((m) => m.includes('repetido no arquivo'))).toBe(true)
    expect(situacaoDe(p, 'produto', 'ED900006')).toBe('problema')
    expect(p.payload.produtos.find((x) => x.sku === 'ED900007')?.ean).toBeUndefined()
    expect(mensagensDe(p, 'produto', 'ED900007').some((m) => m.includes('dígito verificador'))).toBe(true)
    expect(mensagensDe(p, 'produto', 'ED900008').some((m) => m.includes('EAN 2000000000039 repetido'))).toBe(true)
    expect(mensagensDe(p, 'produto', 'ED900003').some((m) => m.includes('EAN 2000000000039 repetido'))).toBe(true)
  })

  it('backup de versão antiga (31/05): produto com 9 campos, insumo sem custo, bom sem tipo nem calc, deparaForn string', () => {
    const p = planejar((b) => {
      b.products = b.products.map((x: Record<string, unknown>) => ({ sku: x.sku, nome: x.nome, ncm: x.ncm, ean: x.ean, cmv: x.cmv, icms: x.icms, divisao: x.divisao, categoria: x.categoria, status: x.status }))
      b.insumos = b.insumos.map((i: Record<string, unknown>) => ({ sku: i.sku, nome: i.nome, unidade: i.unidade, valorNfe: i.valorNfe, fornecedor: i.fornecedor, ncm: i.ncm, fatorConversao: i.fatorConversao, unidadeConsumo: i.unidadeConsumo }))
      b.bom = b.bom.filter((l: Record<string, unknown>) => l.tipo !== 'produto').map((l: Record<string, unknown>) => ({ sku: l.sku, mpCode: l.mpCode, consumo: l.consumo, unidade: l.unidade }))
      b.depara = {}
      b.deparaForn = { '11222333000181': { 'CH3MM-321240': 'MP9001' } }
      for (const k of ['fornInsumo', 'kaminoForn', 'kaminoItem', 'precifProd', 'tombs']) delete b[k]
    })
    expect(p.aceito).toBe(true)
    expect(p.payload.produtos.find((x) => x.sku === 'ED900001')).toMatchObject({ familia: 'Espelho', atributos: { cor: 'Preto', tamanho: '40cm', categoria: 'Espelho', divisao: 'Eddias Home' } })
    expect(p.payload.insumos.every((i) => i.custo_referencia === undefined)).toBe(true)
    expect(p.payload.fichas.find((f) => f.produto_sku === 'ED900003')?.linhas[0].calc).toBeUndefined()
    expect(p.payload.vinculos.find((v) => v.insumo_sku === 'MP9001')).toMatchObject({ codigo_fornecedor: 'CH3MM-321240' })
    expect(p.origem.sentidoDepara).toBe('sem de/para')
  })
})
