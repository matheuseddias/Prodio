import { describe, expect, it } from 'vitest'
import { snapshotExemplo } from './memoryRepo'
import * as local from './local'
import { perfilDoBanco, perfilParaBanco } from './mapeadores'
import { tamanhoDoBanco, tamanhoParaBanco, type LabelSizeRow } from './tamanhosEtiqueta'

const T = '11111111-1111-1111-1111-111111111111'
const ID = '0a000000-0000-4000-8000-000000000001'
const linha: LabelSizeRow = { id: ID, nome: 'Rolo', largura_mm: '33.50', altura_mm: '22.00', margem_mm: '1.50', dpi: 300, orientacao: 'girada', colunas: 2, espaco_colunas_mm: '2.00', padrao: true, preset: null }

describe('tamanho de etiqueta ↔ banco', () => {
  it('numeric do PostgREST vira número; dpi e orientação fora da lista caem no padrão', () => {
    expect(tamanhoDoBanco(linha)).toEqual({ id: ID, nome: 'Rolo', larguraMm: 33.5, alturaMm: 22, margemMm: 1.5, dpi: 300, orientacao: 'girada', colunas: 2, espacoColunasMm: 2, padrao: true, preset: undefined })
    const estranho = tamanhoDoBanco({ ...linha, dpi: 250, orientacao: 'deitada', preset: '60x40' })
    expect([estranho.dpi, estranho.orientacao, estranho.preset]).toEqual([203, 'normal', '60x40'])
  })
  it('corpo da RPC: id do banco vai; id criado na tela (novo-…) não vai, e a RPC cria', () => {
    const t = tamanhoDoBanco(linha)
    expect(tamanhoParaBanco(t)).toEqual({ id: ID, nome: 'Rolo', largura_mm: 33.5, altura_mm: 22, margem_mm: 1.5, dpi: 300, orientacao: 'girada', colunas: 2, espaco_colunas_mm: 2, padrao: true })
    expect(tamanhoParaBanco({ ...t, id: 'novo-abc', nome: '  Novo  ' })).not.toHaveProperty('id')
    expect(tamanhoParaBanco({ ...t, id: 'novo-abc', nome: '  Novo  ' }).nome).toBe('Novo')
  })
})

describe('perfil com tamanho', () => {
  const row = { familia: 'Espelho', prefixo: 'EH', tipos: ['produto'], unidades_por_caixa: 6, instrucao_montagem: null }
  it('com a coluna: nulo = padrão, id = tamanho escolhido; e volta igual', () => {
    expect(perfilDoBanco({ ...row, label_size_id: null }).tamanhoId).toBeNull()
    const p = perfilDoBanco({ ...row, label_size_id: ID })
    expect(p.tamanhoId).toBe(ID)
    expect(perfilParaBanco(T, p).label_size_id).toBe(ID)
    expect(perfilDoBanco(perfilParaBanco(T, p))).toEqual(p)
  })
  it('sem a coluna (banco antes da migration): nem lê nem manda label_size_id', () => {
    const p = perfilDoBanco(row)
    expect(p).not.toHaveProperty('tamanhoId')
    expect(perfilParaBanco(T, p)).not.toHaveProperty('label_size_id')
  })
  it('perfil sem prefixo cai no ET do banco (antes a tela dizia PR)', () => {
    expect(perfilDoBanco({ ...row, prefixo: undefined as unknown as string }).prefixo).toBe('ET')
  })
})

describe('regras do modo memória (as da RPC)', () => {
  const s = snapshotExemplo()
  const rolo = s.labelSizes.find((t) => t.id === 'ts-rolo2')!
  it('marcar padrão tira o padrão do anterior; lista em ordem de largura', () => {
    const n = local.saveLabelSize(s, { ...rolo, padrao: true })
    expect(n.labelSizes.filter((t) => t.padrao).map((t) => t.id)).toEqual(['ts-rolo2'])
    expect(n.labelSizes.map((t) => t.larguraMm)).toEqual([...n.labelSizes.map((t) => t.larguraMm)].sort((a, b) => a - b))
  })
  it('mudar a medida de um tamanho de fábrica tira o "de fábrica"; a margem, não', () => {
    const p50 = s.labelSizes.find((t) => t.preset === '50x30')!
    expect(local.saveLabelSize(s, { ...p50, margemMm: 3 }).labelSizes.find((t) => t.id === p50.id)?.preset).toBe('50x30')
    expect(local.saveLabelSize(s, { ...p50, larguraMm: 52 }).labelSizes.find((t) => t.id === p50.id)?.preset).toBeUndefined()
  })
  it('desmarcar o único padrão não muda nada; o primeiro tamanho de uma lista vazia vira padrão', () => {
    const padrao = s.labelSizes.find((t) => t.padrao)!
    expect(local.saveLabelSize(s, { ...padrao, padrao: false })).toBe(s)
    const vazio = { ...s, labelSizes: [] }
    expect(local.saveLabelSize(vazio, { ...rolo, id: 'novo-1', padrao: false }).labelSizes[0].padrao).toBe(true)
  })
  it('apagar devolve os perfis ao padrão; o padrão não se apaga', () => {
    const n = local.removeLabelSize(s, 'ts-100x50')
    expect(n.labelSizes.some((t) => t.id === 'ts-100x50')).toBe(false)
    expect(n.tenant.perfisEtiqueta.find((p) => p.familia === 'Bandeja')?.tamanhoId).toBeNull()
    expect(local.removeLabelSize(s, s.labelSizes.find((t) => t.padrao)!.id)).toBe(s)
  })
  it('etiqueta de família sem perfil sai com o prefixo do banco (ET) e 1 por caixa', () => {
    const semPerfil = { ...s, tenant: { ...s.tenant, perfisEtiqueta: [] } }
    const r = local.printLabels(semPerfil, s.products[0].id, 1, 'caixa')
    expect(r.valor[0].serial.startsWith('ET')).toBe(true)
    expect(r.valor[0].quantidade).toBe(1)
  })
})
