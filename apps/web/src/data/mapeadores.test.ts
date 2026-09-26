import { describe, expect, it } from 'vitest'
import type { Bom, Channel, Material, Product, Supplier, Tenant } from '../domain/types'
import { serieVendasDaRpc } from './demanda'
import {
  bomLinhasParaBanco,
  bomsDoBanco,
  channelDoBanco,
  channelParaBanco,
  connectorDoBanco,
  intervaloDias,
  materialDoBanco,
  materialParaBanco,
  nfeDoBanco,
  outboxDoBanco,
  pctDoBanco,
  pctParaBanco,
  perfilParaBanco,
  perfilDoBanco,
  primeiroDiaCompleto,
  productDoBanco,
  productParaBanco,
  purchaseOrderDoBanco,
  scansDoBanco,
  serieProducaoDoBanco,
  somaDias,
  supplierDoBanco,
  supplierParaBanco,
  tenantDoBanco,
  tenantParaBanco,
} from './mapeadores'

const T = '11111111-1111-1111-1111-111111111111'

describe('percentuais', () => {
  it('fração do banco vira percentual e volta', () => {
    expect(pctDoBanco('0.18')).toBe(18)
    expect(pctParaBanco(18)).toBe(0.18)
    expect(pctParaBanco(pctDoBanco(0.0825))).toBe(0.0825)
    expect(pctDoBanco(null)).toBe(0)
  })
})

describe('tenant', () => {
  it('ida e volta preserva os campos e corta os segundos da hora de virada', () => {
    const row = { id: T, nome: 'Eddias', cnpj: '44664451000107', regime: 'real' as const, credita_impostos: false, hora_virada: '05:00:00', dias_uteis_mes: 22, margem_projecao: '0.1000', dias_cobertura: 15, margem_alvo_padrao: '0.2000', exigir_projecao_para_imprimir: true }
    const perfil = { familia: 'Espelho', prefixo: 'EH', tipos: ['produto', 'montagem'], unidades_por_caixa: 6, instrucao_montagem: null }
    const t: Tenant = tenantDoBanco(row, [perfil])
    expect(t.horaVirada).toBe('05:00')
    expect(t.margemProjecao).toBe(0.1)
    expect(t.perfisEtiqueta[0]).toEqual({ familia: 'Espelho', prefixo: 'EH', tipos: ['produto', 'montagem'], unidadesPorCaixa: 6, instrucaoMontagem: undefined })
    expect(tenantParaBanco(t)).toMatchObject({ nome: 'Eddias', cnpj: '44664451000107', hora_virada: '05:00', margem_projecao: 0.1 })
    // janela da média: sem a coluna (banco antes da migration) fica ausente e não vai ao banco; fora de 1..90 é corrigida
    expect(t.diasDemanda).toBeUndefined()
    expect('dias_demanda' in tenantParaBanco(t)).toBe(false)
    expect(tenantDoBanco({ ...row, dias_demanda: '30' }, []).diasDemanda).toBe(30)
    expect(tenantParaBanco({ ...t, diasDemanda: 500 }).dias_demanda).toBe(90)
    expect('dias_demanda' in tenantParaBanco({ ...t, diasDemanda: undefined })).toBe(false)
    // cobertura do acabado no hub: sem a coluna fica ausente; fora de 0..60 é corrigida
    expect(t.diasCoberturaAcabado).toBeUndefined()
    expect(tenantDoBanco({ ...row, dias_cobertura_acabado: 0 }, []).diasCoberturaAcabado).toBe(0)
    expect(tenantParaBanco({ ...t, diasCoberturaAcabado: 99 }).dias_cobertura_acabado).toBe(60)
    expect(perfilDoBanco(perfilParaBanco(T, t.perfisEtiqueta[0]))).toEqual(t.perfisEtiqueta[0])
  })
})

describe('produto', () => {
  it('mapeia aliases, preços e ficha; a volta gera a linha do banco', () => {
    const p: Product = productDoBanco(
      { id: 'a1', sku: 'TM000076', nome: 'Espelho', familia: 'Espelho', atributos: { cor: 'Preto' }, ean: null, ncm: '7009.91.00', status: 'ativo', peso_kg: '1.9000', peso_cubado_kg: null, custo_manual: null, sku_aliases: [{ sku_externo: 'ED000130' }] },
      { temFicha: true, custoFicha: 10.71, precoVenda: { ch1: 129.9 } },
    )
    expect(p).toMatchObject({ aliases: ['ED000130'], temFicha: true, custoFicha: 10.71, pesoKg: 1.9, pesoCubadoKg: undefined, precoVenda: { ch1: 129.9 } })
    expect(productParaBanco(T, p, 'a1')).toEqual({ id: 'a1', tenant_id: T, sku: 'TM000076', nome: 'Espelho', familia: 'Espelho', atributos: { cor: 'Preto' }, ean: null, ncm: '7009.91.00', status: 'ativo', peso_kg: 1.9, peso_cubado_kg: null })
  })
})

describe('insumo e fornecedor', () => {
  it('saldo e custo médio vêm da v_stock; a volta não leva saldo', () => {
    const m: Material = materialDoBanco(
      { id: 'm1', sku: 'MP0078', nome: 'Chapa', ncm: null, unidade_compra: 'un', unidade_consumo: 'm2', fator_conversao: '7.700000', minimo: '40.0000', custo_referencia: '30', fornecedor_padrao_id: 's1', lead_time_dias: 7 },
      { material_id: 'm1', saldo: '61.4000', custo_medio: '33.4300' },
    )
    expect(m).toMatchObject({ fatorConversao: 7.7, saldo: 61.4, custoMedio: 33.43, fornecedorPadraoId: 's1', ncm: undefined })
    const row = materialParaBanco(T, m, 'm1')
    expect(row).toMatchObject({ id: 'm1', tenant_id: T, fator_conversao: 7.7, minimo: 40, lead_time_dias: 7 })
    expect('saldo' in row).toBe(false)
    const s: Supplier = supplierDoBanco({ id: 's1', nome: 'Vidros', cnpj: '12345678000190', regime: 'normal', lead_time_dias: 7, condicao_pagamento: [28, 42], contato: null })
    expect(supplierParaBanco(T, { ...s, cnpj: '12.345.678/0001-90' }, 's1')).toMatchObject({ cnpj: '12345678000190', condicao_pagamento: [28, 42], contato: null })
  })
})

describe('ficha ativa', () => {
  it('agrupa linhas por produto respeitando a ordem e converte a perda', () => {
    const boms: Bom[] = bomsDoBanco([
      { product_id: 'p1', bom_version_id: 'v1', versao: 3, ativada_em: '2026-09-01T00:00:00Z', line_id: 'l2', ordem: 2, tipo: 'insumo', material_id: 'm2', component_product_id: null, consumo: '0.043000', unidade: 'm2', perda_pct: '0.05000' },
      { product_id: 'p1', bom_version_id: 'v1', versao: 3, ativada_em: '2026-09-01T00:00:00Z', line_id: 'l1', ordem: 1, tipo: 'insumo', material_id: 'm1', component_product_id: null, consumo: '0.160000', unidade: 'm2', perda_pct: '0.08000' },
    ])
    expect(boms).toHaveLength(1)
    expect(boms[0].linhas.map((l) => l.id)).toEqual(['l1', 'l2'])
    expect(boms[0].linhas[0].perdaPct).toBe(8)
    expect(bomLinhasParaBanco(boms[0])[0]).toEqual({ ordem: 1, tipo: 'insumo', material_id: 'm1', component_product_id: null, consumo: 0.16, unidade: 'm2', perda_pct: 0.08 })
  })
})

describe('bipes, OC, NF-e e outbox', () => {
  it('esconde o produzido já estornado e negativa o estorno', () => {
    const scans = scansDoBanco([
      { id: 's1', label_id: 'l1', product_id: 'p1', event_type: 'produzido', quantidade: 1, operator_id: 'o1', device_id: 'd1', user_id: null, competencia: '2026-09-21', scanned_at: '2026-09-21T10:00:00Z', reverses_id: null, labels: { serial: 'EHX1' }, operators: { nome: 'Thiago' }, devices: { nome: 'Celular' } },
      { id: 's2', label_id: 'l1', product_id: 'p1', event_type: 'estorno', quantidade: 1, operator_id: 'o1', device_id: 'd1', user_id: null, competencia: '2026-09-21', scanned_at: '2026-09-21T10:05:00Z', reverses_id: 's1', labels: { serial: 'EHX1' }, operators: { nome: 'Thiago' }, devices: { nome: 'Celular' } },
      { id: 's3', label_id: 'l2', product_id: 'p1', event_type: 'produzido', quantidade: 1, operator_id: null, device_id: null, user_id: 'u1', competencia: '2026-09-21', scanned_at: '2026-09-21T10:06:00Z', reverses_id: null, labels: { serial: 'EHX2' } },
    ], { u1: 'Matheus' })
    expect(scans.map((s) => [s.id, s.tipo, s.quantidade, s.operador])).toEqual([['s2', 'estorno', -1, 'Thiago'], ['s3', 'produzido', 1, 'Matheus']])
  })
  it('OC com itens e IPI em percentual', () => {
    const po = purchaseOrderDoBanco({ id: 'oc1', numero: 1041, supplier_id: 's1', status: 'aberta', entrega_prevista: '2026-09-25', condicao_pagamento: [28], observacao: null, created_at: '2026-09-20T12:00:00Z', purchase_order_items: [{ id: 'i1', material_id: 'm1', unidade_compra: 'un', fator: '7.7', qtd: '12', qtd_recebida: null, preco: '257.40', ipi_pct: '0.10000' }] })
    expect(po.itens[0]).toEqual({ id: 'i1', materialId: 'm1', unidadeCompra: 'un', fator: 7.7, qtd: 12, qtdRecebida: 0, preco: 257.4, ipiPct: 10 })
  })
  it('NF-e com itens ordenados e OCs vinculadas', () => {
    const n = nfeDoBanco({ id: 'n1', chave: '3'.repeat(44), numero: 48211, serie: 1, cnpj_emitente: '12345678000190', emitente: 'Vidros', supplier_id: null, emissao: '2026-09-20', valor_total: '3504.80', origem: 'email', status: 'pendente', nfe_inbound_items: [{ n_item: 2, c_prod: 'B', x_prod: 'B', ncm: null, cfop: '5102', u_com: 'UN', q_com: 1, v_un_com: 1, v_prod: 1, material_id: null, fator: null, qtd_consumo: null }, { n_item: 1, c_prod: 'A', x_prod: 'A', ncm: null, cfop: '5102', u_com: 'UN', q_com: 2, v_un_com: 3, v_prod: 6, material_id: 'm1', fator: '7.7', qtd_consumo: '15.4' }], nfe_po_links: [{ purchase_order_id: 'oc1' }] })
    expect(n.itens.map((i) => i.nItem)).toEqual([1, 2])
    expect(n.itens[0]).toMatchObject({ materialId: 'm1', fator: 7.7, qtdConsumo: 15.4 })
    expect(n.poIds).toEqual(['oc1'])
    expect(n.supplierId).toBeUndefined()
  })
  it('conector: o motivo da falha que o worker gravou chega até a tela', () => {
    // A coluna já vinha na consulta e parava no mapeador: o cartão só sabia dizer "Erro", sem
    // motivo, e o texto ficava visível apenas para quem rodasse `wrangler tail`.
    const linha = { id: 'c1', plataforma: 'baselinker' as const, nome: 'Eddias', status: 'erro' as const, config: null, ultimo_sync: null, ultimo_erro: 'token inválido (401)' }
    expect(connectorDoBanco(linha)).toMatchObject({ status: 'erro', ultimoErro: 'token inválido (401)', ultimoSync: undefined })
    expect(connectorDoBanco({ ...linha, status: 'conectado', ultimo_erro: null }).ultimoErro).toBeUndefined()
  })
  it('outbox normaliza status e id', () => {
    expect(outboxDoBanco({ id: 7, connector_id: 'c1', product_id: 'p1', delta: '2', status: 'em_processamento', erro: null, created_at: 'x' })).toMatchObject({ id: '7', status: 'pendente', delta: 2 })
    expect(outboxDoBanco({ id: 8, connector_id: 'c1', product_id: 'p1', delta: '2', status: 'ignorado', erro: null, created_at: 'x' }).status).toBe('aplicado')
  })
  it('canal: percentuais e frete por faixa vão e voltam', () => {
    const c: Channel = channelDoBanco({ id: 'ch1', nome: 'ML', preset: 'mercadolivre', ativo: true, comissao_pct: '0.12000', taxa_fixa: '6.00', taxa_fixa_abaixo_de: '79.00', frete_vendedor: [{ ateKg: 0.3, valor: 0 }], frete_gratis_acima_de: null, imposto_venda_pct: '0.06000', ads_pct: '0.03000', parcelamento_pct: '0', outros_pct: '0', observacao: null })
    expect(c).toMatchObject({ comissaoPct: 12, taxaFixa: 6, taxaFixaAbaixoDe: 79, impostoVendaPct: 6, freteGratisAcimaDe: undefined })
    expect(channelParaBanco(T, c, 'ch1')).toMatchObject({ comissao_pct: 0.12, imposto_venda_pct: 0.06, frete_gratis_acima_de: null, frete_vendedor: [{ ateKg: 0.3, valor: 0 }] })
  })
})

describe('histórico dos gráficos', () => {
  it('projetado soma os locais e bipado não conta duas vezes o mesmo produto', () => {
    // v_daily_plan devolve uma linha por (dia, local, produto); o bipado da view já é o total do
    // produto no dia, então dois galpões repetem o mesmo número.
    const rows = [
      { dia: '2026-09-22', product_id: 'p1', projetado: '80', bipado: '63' },
      { dia: '2026-09-22', product_id: 'p1', projetado: '20', bipado: '63' },
      { dia: '2026-09-22', product_id: 'p2', projetado: '70', bipado: '70' },
    ]
    expect(serieProducaoDoBanco(rows, ['2026-09-21', '2026-09-22'])).toEqual([
      { dia: '2026-09-21', projetado: 0, produzido: 0 },
      { dia: '2026-09-22', projetado: 170, produzido: 133 },
    ])
  })
  it('dia sem linha no banco vale zero, nunca número de outro dia', () => {
    expect(serieProducaoDoBanco([], intervaloDias('2026-09-20', '2026-09-22'))).toEqual([
      { dia: '2026-09-20', projetado: 0, produzido: 0 },
      { dia: '2026-09-21', projetado: 0, produzido: 0 },
      { dia: '2026-09-22', projetado: 0, produzido: 0 },
    ])
  })
  it('vendas por dia da RPC sales_by_day: número em texto vira número, dia torto sai, ordem do mais antigo', () => {
    expect(
      serieVendasDaRpc([
        { dia: '2026-09-22', pedidos: '3', unidades: '6.0000' },
        { dia: '2026-09-21', pedidos: 0, unidades: 0 },
        { dia: '', pedidos: 1, unidades: 99 },
      ]),
    ).toEqual([
      { dia: '2026-09-21', unidades: 0 },
      { dia: '2026-09-22', unidades: 6 },
    ])
    expect(serieVendasDaRpc(null)).toEqual([])
  })
  it('somaDias anda no calendário e intervaloDias fecha nas duas pontas', () => {
    expect(somaDias('2026-03-01', -1)).toBe('2026-02-28')
    expect(intervaloDias('2026-12-30', '2027-01-01')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01'])
    expect(intervaloDias('2026-09-22', '2026-09-20')).toEqual([])
  })
  it('leitura truncada começa no dia seguinte ao mais antigo, que pode estar pela metade', () => {
    expect(primeiroDiaCompleto(['2026-09-22', '2026-09-21', '2026-09-20'], '2026-09-22')).toBe('2026-09-21')
    expect(primeiroDiaCompleto(['2026-09-22'], '2026-09-22')).toBe('2026-09-22')
  })
})
