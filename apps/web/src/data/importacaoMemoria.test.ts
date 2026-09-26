// Importação do ES no modo memória: mesmas regras de chave e de atualização da RPC import_catalog.
import { juntarPrevia, type PayloadImportacao } from '@prodio/core/importacaoEs'
import { planejar } from '@prodio/core/importacaoEs/fixtura'
import { describe, expect, it } from 'vitest'
import * as mock from '../domain/mock'
import type { Product } from '../domain/types'
import { importarEmMemoria, type CatalogoMemoria } from './importacaoMemoria'
import { MemoryRepo, snapshotExemplo } from './memoryRepo'

const vazio = (): CatalogoMemoria => ({ suppliers: [], materials: [], products: [], boms: [], vinculos: [] })
const opcoes = () => {
  let n = 0
  return { novoId: () => `id-${++n}`, agora: '2026-09-26T12:00:00.000Z', unidades: mock.units.map((u) => u.code) }
}
const payload = (): PayloadImportacao => structuredClone(planejar().payload)
const aplicar = (cat: CatalogoMemoria, p: PayloadImportacao = payload()) => importarEmMemoria(cat, p, opcoes())
const linha = (r: ReturnType<typeof aplicar>, entidade: string, chave: string) => r.resultado.linhas.filter((l) => l.entidade === entidade && l.chave === chave)

describe('importarEmMemoria', () => {
  it('primeira importação: tudo novo, com as mesmas contagens do plano', () => {
    const plano = planejar()
    const r = aplicar(vazio())
    for (const e of ['fornecedor', 'insumo', 'produto', 'apelido', 'vinculo', 'ficha'] as const) {
      expect(r.resultado.contagens[e]).toEqual({ novos: plano.contagens[e].entram, atualizados: 0, iguais: 0, problemas: 0 })
    }
    expect(r.resultado.exemplo).toEqual({ produtos: 0, insumos: 0, fornecedores: 0 })
    const ed1 = r.catalogo.products.find((p) => p.sku === 'ED900001') as Product
    expect(ed1.aliases).toEqual(['TM900002'])
    expect(ed1.temFicha).toBe(true)
    const ficha = r.catalogo.boms.find((b) => b.productId === ed1.id)
    expect(ficha?.linhas).toHaveLength(6)
    expect(ficha?.linhas.every((l) => l.perdaPct === 0)).toBe(true) // o consumo do ES já inclui a perda
    expect(juntarPrevia(plano, r.resultado).podeGravar).toBe(true)
  })

  it('reimportar o mesmo arquivo não muda nada: 0 novos, 0 atualizados, tudo igual', () => {
    const plano = planejar()
    const primeira = aplicar(vazio())
    const segunda = aplicar(primeira.catalogo)
    expect(segunda.resultado.linhas.filter((l) => l.situacao !== 'aviso')).toEqual([])
    for (const e of ['fornecedor', 'insumo', 'produto', 'apelido', 'vinculo', 'ficha'] as const) {
      expect(segunda.resultado.contagens[e]).toEqual({ novos: 0, atualizados: 0, iguais: plano.contagens[e].entram, problemas: 0 })
    }
    expect(segunda.catalogo).toEqual(primeira.catalogo)
    const previa = juntarPrevia(plano, segunda.resultado)
    expect(previa.podeGravar).toBe(false)
    expect(previa.bloqueios).toEqual(['Nenhuma alteração a gravar: o Prodio já está igual ao arquivo.'])
  })

  it('não muda o catálogo recebido', () => {
    const cat = vazio()
    aplicar(cat)
    expect(cat).toEqual(vazio())
  })

  it('um campo alterado no arquivo = 1 atualizado, com o nome do campo', () => {
    const cat = aplicar(vazio()).catalogo
    const p = payload()
    p.insumos.find((i) => i.sku === 'MP9003')!.nome = 'Alça nova'
    const r = aplicar(cat, p)
    expect(r.resultado.contagens.insumo).toMatchObject({ novos: 0, atualizados: 1 })
    expect(linha(r, 'insumo', 'MP9003')).toEqual([{ entidade: 'insumo', chave: 'MP9003', situacao: 'atualizado', campos: ['nome'] }])
  })

  it('campo ausente não apaga; família e lead time só preenchem o que está vazio', () => {
    const cat = aplicar(vazio()).catalogo
    cat.products = cat.products.map((p) => (p.sku === 'ED900002' ? { ...p, familia: 'Decoração', ean: '7891234567895' } : p))
    cat.materials = cat.materials.map((m) => (m.sku === 'MP9001' ? { ...m, leadTimeDias: 20 } : m))
    const r = aplicar(cat)
    expect(r.catalogo.products.find((p) => p.sku === 'ED900002')).toMatchObject({ familia: 'Decoração', ean: '7891234567895' })
    expect(r.catalogo.materials.find((m) => m.sku === 'MP9001')?.leadTimeDias).toBe(20)
    expect(r.resultado.contagens.produto.atualizados).toBe(0)
  })

  it('unidade de consumo trocada: o insumo é problema e as fichas que o usam ficam de fora', () => {
    const cat = aplicar(vazio()).catalogo
    cat.materials = cat.materials.map((m) => (m.sku === 'MP9001' ? { ...m, unidadeConsumo: 'kg' } : m))
    cat.boms = []
    const r = aplicar(cat)
    expect(linha(r, 'insumo', 'MP9001')[0]).toMatchObject({ situacao: 'problema' })
    expect(linha(r, 'insumo', 'MP9001')[0].mensagem).toContain('mudou de kg para m2')
    expect(linha(r, 'ficha', 'ED900001')[0]).toMatchObject({ situacao: 'problema' })
    expect(linha(r, 'ficha', 'TM900001')[0].mensagem).toContain('a ficha inteira fica de fora')
    expect(linha(r, 'vinculo', '11222333000181|MP9001')[0]).toMatchObject({ situacao: 'problema' })
    expect(r.catalogo.materials.find((m) => m.sku === 'MP9001')?.unidadeConsumo).toBe('kg')
  })

  it('SKU que é apelido de outro produto e apelido de outro produto viram problema; nada é movido', () => {
    const cat = vazio()
    cat.products = [
      { id: 'x1', sku: 'TM000001', nome: 'Outro', familia: 'Espelho', atributos: {}, status: 'ativo', aliases: ['ED900003', 'TM900002'], temFicha: false },
    ]
    const r = aplicar(cat)
    expect(linha(r, 'produto', 'ED900003')[0]).toMatchObject({ situacao: 'problema' })
    expect(linha(r, 'produto', 'ED900003')[0].mensagem).toContain('é apelido de TM000001')
    expect(linha(r, 'apelido', 'TM900002')[0].mensagem).toContain('já é de TM000001')
    expect(r.catalogo.products.find((p) => p.sku === 'TM000001')?.aliases).toEqual(['ED900003', 'TM900002'])
    // ED900004 usa ED900003 como componente: a ficha fica de fora inteira.
    expect(linha(r, 'ficha', 'ED900004')[0]).toMatchObject({ situacao: 'problema' })
  })

  it('apelido que já é SKU de produto no Prodio: problema no produto (não renomeia)', () => {
    const cat = vazio()
    cat.products = [{ id: 'x1', sku: 'TM900002', nome: 'Antigo', familia: 'Espelho', atributos: {}, status: 'ativo', aliases: [], temFicha: false }]
    const r = aplicar(cat)
    expect(linha(r, 'produto', 'ED900001')[0].mensagem).toContain('TM900002 já existe como produto')
  })

  it('vínculo existente só ganha o que está vazio; código em uso por outro insumo vira aviso', () => {
    const primeira = aplicar(vazio()).catalogo
    const forn = primeira.suppliers.find((s) => s.cnpj === '12345678000195')!
    const mp2 = primeira.materials.find((m) => m.sku === 'MP9002')!
    const mp7 = primeira.materials.find((m) => m.sku === 'MP9007')!
    primeira.vinculos = primeira.vinculos
      .filter((v) => v.materialId !== mp7.id)
      .map((v) => (v.materialId === mp2.id ? { ...v, fator: 45, preco: undefined, codigoFornecedor: 'ALPES-PT' } : v))
    const r = aplicar(primeira)
    const v2 = r.catalogo.vinculos.find((v) => v.materialId === mp2.id)!
    expect(v2.fator).toBe(45) // o que o recebimento aprendeu vence
    expect(linha(r, 'vinculo', '12345678000195|MP9002')[0]).toMatchObject({ situacao: 'atualizado', campos: ['preco'] })
    expect(linha(r, 'vinculo', '12345678000195|MP9007').map((l) => l.situacao).sort()).toEqual(['aviso', 'novo'])
    expect(r.catalogo.vinculos.find((v) => v.supplierId === forn.id && v.materialId === mp7.id)?.codigoFornecedor).toBeUndefined()
  })

  it('ficha diferente vira nova versão; ficha que fecha ciclo com uma existente fica de fora', () => {
    const cat = aplicar(vazio()).catalogo
    const p = payload()
    p.fichas.find((f) => f.produto_sku === 'ED900002')!.linhas[0].consumo = 7
    const r = aplicar(cat, p)
    expect(linha(r, 'ficha', 'ED900002')[0]).toMatchObject({ situacao: 'atualizado', campos: ['linhas'] })
    const ed2 = r.catalogo.products.find((x) => x.sku === 'ED900002')!
    expect(r.catalogo.boms.find((b) => b.productId === ed2.id)?.versao).toBe(2)

    const ciclo = payload()
    ciclo.fichas.find((f) => f.produto_sku === 'ED900002')!.linhas.push({ tipo: 'produto', componente_sku: 'ED900001', consumo: 1, unidade: 'un', perda_pct: 0 })
    const rc = aplicar(r.catalogo, ciclo)
    expect(linha(rc, 'ficha', 'ED900002')[0]).toMatchObject({ situacao: 'problema' })
    expect(linha(rc, 'ficha', 'ED900002')[0].mensagem).toContain('ciclo')
  })

  it('unidade que o tenant não tem: problema no insumo', () => {
    const r = importarEmMemoria(vazio(), payload(), { ...opcoes(), unidades: ['un', 'm', 'm2', 'g', 'rl'] })
    expect(linha(r, 'insumo', 'MP9005')[0].mensagem).toBe('unidade ct não está cadastrada no Prodio (Configurações > Unidades)')
  })
})

describe('MemoryRepo.importarCatalogo', () => {
  it('simular não grava; gravar grava e devolve as fatias; reimportar não muda nada', async () => {
    const repo = new MemoryRepo(snapshotExemplo())
    const antes = repo.estado
    const sim = await repo.importarCatalogo(payload(), { simular: true })
    expect(sim.valor.simulacao).toBe(true)
    expect(sim.patch).toEqual({})
    expect(repo.estado).toBe(antes)

    const g = await repo.importarCatalogo(payload(), { simular: false })
    expect(g.valor.simulacao).toBe(false)
    expect(g.valor.contagens).toEqual(sim.valor.contagens)
    expect(Object.keys(g.patch).sort()).toEqual(['boms', 'materials', 'products', 'suppliers'])
    expect(repo.estado.products.length).toBe(antes.products.length + 5)
    const ed4 = repo.estado.products.find((p) => p.sku === 'ED900004')
    expect(ed4?.custoFicha).toBeGreaterThan(0) // custo refeito pela ficha importada

    const de_novo = await repo.importarCatalogo(payload(), { simular: false })
    expect(de_novo.valor.linhas.filter((l) => l.situacao !== 'aviso')).toEqual([])
  })
})
