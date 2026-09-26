// Vínculo insumo-fornecedor (De-Para da NF-e): código, fator, unidade, preço e alíquota.
import { mensagensDe, planejar } from './fixtura'

const vinculo = (p: ReturnType<typeof planejar>, cnpj: string, sku: string) => p.payload.vinculos.find((v) => v.fornecedor_cnpj === cnpj && v.insumo_sku === sku)

describe('vínculos do backup sintético', () => {
  const p = planejar()
  it('código do deparaForn (objeto com fator) e fator da nota; inteiro da OC', () => {
    expect(vinculo(p, '11222333000181', 'MP9001')).toEqual({
      fornecedor_cnpj: '11222333000181', insumo_sku: 'MP9001', codigo_fornecedor: 'CH3MM-321240', fator: 7.704, preco: 300, aliq_icms: 0.12, inteiro: true,
    })
  })
  it('código legado (string) sem fator na nota: fator e unidade vêm da OC (fornInsumo)', () => {
    expect(vinculo(p, '12345678000195', 'MP9007')).toEqual({
      fornecedor_cnpj: '12345678000195', insumo_sku: 'MP9007', codigo_fornecedor: 'ALPES-PT', fator: 1, unidade_compra: 'MT', preco: 18.5, aliq_icms: 0.18, inteiro: false,
    })
  })
  it('alíquota null no fornecedor usa a do insumo, em fração; preço zero não vai', () => {
    expect(vinculo(p, '12345678000195', 'MP9007')?.aliq_icms).toBe(0.18)
    expect(vinculo(p, '98765432000198', 'MP9008')).toEqual({ fornecedor_cnpj: '98765432000198', insumo_sku: 'MP9008', aliq_icms: 0 })
  })
  it('fornecedor fora do cadastro: o vínculo fica de fora com aviso', () => {
    expect(p.payload.vinculos.some((v) => v.insumo_sku === 'MP9005')).toBe(false)
    expect(mensagensDe(p, 'vinculo', 'nome:Casa do Parafuso Fictícia|MP9005')[0]).toContain('vínculo fica de fora')
  })
})

describe('regras de escolha', () => {
  it('preço com fator próprio do vínculo: preço × fator do vínculo ÷ fator do insumo', () => {
    const p = planejar((b) => {
      b.deparaForn['98765432000198'] = { 'CX-40-10': { mp: 'MP9004', fator: 10 } }
    })
    // 87,25 por fardo de 25 → a nota vende caixa de 10: 87,25 × 10 ÷ 25 = 34,90
    expect(vinculo(p, '98765432000198', 'MP9004')).toMatchObject({ codigo_fornecedor: 'CX-40-10', fator: 10, preco: 34.9 })
  })

  it('mais de um código para o par: objeto com fator > string > kaminoItem, com aviso', () => {
    const p = planejar((b) => {
      b.kaminoItem['11222333000181']['AAA-KAMINO'] = 'MP9001'
      b.deparaForn['11222333000181']['BBB-LEGADO'] = 'MP9001'
    })
    expect(vinculo(p, '11222333000181', 'MP9001')?.codigo_fornecedor).toBe('CH3MM-321240')
    expect(mensagensDe(p, 'vinculo', '11222333000181|MP9001').some((m) => m.includes('Outros: BBB-LEGADO, AAA-KAMINO'))).toBe(true)
  })

  it('fator da nota diferente do da OC: vale o da nota, com aviso', () => {
    const p = planejar((b) => {
      b.fornInsumo['Vidraçaria Exemplo Ltda'].MP9001.fator = 7.7
    })
    expect(vinculo(p, '11222333000181', 'MP9001')?.fator).toBe(7.704)
    expect(mensagensDe(p, 'vinculo', '11222333000181|MP9001').some((m) => m.includes('vale o da nota'))).toBe(true)
  })

  it('o mesmo código para dois insumos do fornecedor: o segundo fica sem código', () => {
    const p = planejar((b) => {
      b.kaminoItem['12345678000195'] = { 'ROCKL-PT-140': 'MP9007' }
    })
    expect(vinculo(p, '12345678000195', 'MP9002')?.codigo_fornecedor).toBe('ROCKL-PT-140')
    expect(vinculo(p, '12345678000195', 'MP9007')?.codigo_fornecedor).toBe('ALPES-PT')
    const q = planejar((b) => {
      b.deparaForn['12345678000195'] = { 'ROCKL-PT-140': { mp: 'MP9002', fator: 50 } }
      b.kaminoItem['12345678000195'] = { 'ROCKL-PT-140': 'MP9007' }
    })
    expect(vinculo(q, '12345678000195', 'MP9007')?.codigo_fornecedor).toBeUndefined()
    expect(mensagensDe(q, 'vinculo', '12345678000195|MP9007').some((m) => m.includes('já é de MP9002'))).toBe(true)
  })

  it('CNPJ das notas sem fornecedor importado e insumo que não existe: aviso, de fora', () => {
    const p = planejar((b) => {
      b.deparaForn['11444777000161'] = { X1: { mp: 'MP9001', fator: 1 } }
      b.kaminoItem['11222333000181'].Y2 = 'MP7777'
    })
    expect(mensagensDe(p, 'vinculo', '11444777000161|*')[0]).toContain('não é de um fornecedor importado')
    expect(mensagensDe(p, 'vinculo', '11222333000181|MP7777')[0]).toContain('não é um insumo importado')
  })
})
