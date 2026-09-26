// Detalhe de uma linha da prévia da importação do ES: o que muda, com o valor novo (do arquivo) e o atual
// (do Prodio, quando o store tem). Pura, para ter teste. Os nomes de campo vêm da RPC import_catalog.
import type { EntidadeImportacao, LinhaPrevia, PayloadImportacao } from '@prodio/core/importacaoEs'
import { brl, num } from '../../domain/format'
import type { Bom, Material, Product, Supplier } from '../../domain/types'

export interface CatalogoAtual {
  suppliers: Supplier[]
  materials: Material[]
  products: Product[]
  boms: Bom[]
}

export interface CampoDetalhe {
  campo: string
  rotulo: string
  novo?: string
  atual?: string
}

export const ROTULO_CAMPO: Record<string, string> = {
  nome: 'Nome',
  regime: 'Regime',
  lead_time_dias: 'Prazo de entrega',
  condicao_pagamento: 'Condição de pagamento',
  contato: 'Contato',
  ncm: 'NCM',
  unidade_compra: 'Unidade de compra',
  fator_conversao: 'Fator de conversão',
  minimo: 'Estoque mínimo',
  custo_referencia: 'Custo de referência',
  fornecedor_padrao: 'Fornecedor padrão',
  familia: 'Família',
  atributos: 'Atributos',
  ean: 'EAN',
  status: 'Situação',
  peso_kg: 'Peso',
  peso_cubado_kg: 'Peso cubado',
  custo_manual: 'Custo manual',
  codigo_fornecedor: 'Código no fornecedor',
  fator: 'Fator da nota',
  preco: 'Preço',
  aliq_icms: 'Alíquota de ICMS',
  linhas: 'Linhas da ficha',
}

type Valor = string | undefined
const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const dias = (n: number | undefined): Valor => (n === undefined ? undefined : `${n} ${n === 1 ? 'dia' : 'dias'}`)
const prazo = (d: number[] | undefined): Valor => (d === undefined ? undefined : d.length === 1 && d[0] === 0 ? 'à vista' : `${d.join('/')} dias`)
const kg = (n: number | undefined): Valor => (n === undefined ? undefined : `${num(n, 3)} kg`)
const dinheiro = (n: number | undefined): Valor => (n === undefined ? undefined : brl(n))
const atributos = (a: Record<string, string> | undefined): Valor => {
  const e = Object.entries(a ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
  return e.length ? e.map(([k, v]) => `${k}: ${v}`).join(', ') : undefined
}
const linhas = (n: number | undefined): Valor => (n === undefined ? undefined : `${n} ${n === 1 ? 'linha' : 'linhas'}`)
const REGIME: Record<string, string> = { simples: 'Simples Nacional', normal: 'Regime normal' }
const STATUS: Record<string, string> = { ativo: 'Ativo', inativo: 'Inativo' }

/** Pares (novo, atual) de cada campo, por entidade. */
function valores(entidade: EntidadeImportacao, chave: string, p: PayloadImportacao, cat: CatalogoAtual): Record<string, [Valor, Valor]> {
  const fornPorCnpj = (cnpj: string | undefined) => (cnpj ? cat.suppliers.find((s) => dig(s.cnpj) === cnpj) : undefined)
  if (entidade === 'fornecedor') {
    const n = p.fornecedores.find((f) => f.cnpj === chave)
    const a = fornPorCnpj(chave)
    return {
      nome: [n?.nome, a?.nome],
      regime: [n?.regime && REGIME[n.regime], a && REGIME[a.regime]],
      lead_time_dias: [dias(n?.lead_time_dias), dias(a?.leadTimeDias)],
      condicao_pagamento: [prazo(n?.condicao_pagamento), prazo(a?.condicaoPagamento)],
      contato: [n?.contato, a?.contato],
    }
  }
  if (entidade === 'insumo') {
    const n = p.insumos.find((i) => i.sku === chave)
    const a = cat.materials.find((m) => m.sku === chave)
    const nomeForn = (cnpj: string | undefined) => p.fornecedores.find((f) => f.cnpj === cnpj)?.nome ?? fornPorCnpj(cnpj)?.nome ?? cnpj
    return {
      nome: [n?.nome, a?.nome],
      ncm: [n?.ncm, a?.ncm],
      unidade_compra: [n?.unidade_compra, a?.unidadeCompra],
      fator_conversao: [n && num(n.fator_conversao, 4), a && num(a.fatorConversao, 4)],
      minimo: [n?.minimo === undefined ? undefined : `${num(n.minimo, 2)} ${n.unidade_consumo}`, a && `${num(a.minimo, 2)} ${a.unidadeConsumo}`],
      custo_referencia: [dinheiro(n?.custo_referencia), dinheiro(a?.custoMedio)],
      fornecedor_padrao: [nomeForn(n?.fornecedor_padrao_cnpj), cat.suppliers.find((s) => s.id === a?.fornecedorPadraoId)?.nome],
      lead_time_dias: [dias(n?.lead_time_dias), dias(a?.leadTimeDias)],
    }
  }
  if (entidade === 'produto') {
    const n = p.produtos.find((x) => x.sku === chave)
    const a = cat.products.find((x) => x.sku === chave)
    return {
      nome: [n?.nome, a?.nome],
      familia: [n?.familia, a?.familia],
      atributos: [atributos(n?.atributos), atributos(a?.atributos)],
      ean: [n?.ean, a?.ean],
      ncm: [n?.ncm, a?.ncm],
      status: [n && STATUS[n.status], a && STATUS[a.status]],
      peso_kg: [kg(n?.peso_kg), kg(a?.pesoKg)],
      peso_cubado_kg: [kg(n?.peso_cubado_kg), kg(a?.pesoCubadoKg)],
      custo_manual: [dinheiro(n?.custo_manual), a && !a.temFicha ? dinheiro(a.custoFicha) : undefined],
    }
  }
  if (entidade === 'vinculo') {
    const [cnpj, sku] = chave.split('|')
    const n = p.vinculos.find((v) => v.fornecedor_cnpj === cnpj && v.insumo_sku === sku)
    // O vínculo atual não fica no store (é lido na hora do recebimento): só o valor do arquivo.
    return {
      codigo_fornecedor: [n?.codigo_fornecedor, undefined],
      unidade_compra: [n?.unidade_compra, undefined],
      fator: [n?.fator === undefined ? undefined : num(n.fator, 4), undefined],
      preco: [dinheiro(n?.preco), undefined],
      aliq_icms: [n?.aliq_icms === undefined ? undefined : `${num(n.aliq_icms * 100, 2)}%`, undefined],
    }
  }
  if (entidade === 'ficha') {
    const n = p.fichas.find((f) => f.produto_sku === chave)
    const prod = cat.products.find((x) => x.sku === chave)
    const a = prod ? cat.boms.find((b) => b.productId === prod.id && b.ativa) : undefined
    return { linhas: [linhas(n?.linhas.length), linhas(a?.linhas.length)] }
  }
  return {}
}

/** Campos que a linha diz que mudam, com rótulo em português e os dois valores quando se sabe. */
export function detalharCampos(l: Pick<LinhaPrevia, 'entidade' | 'chave' | 'campos'>, payload: PayloadImportacao, cat: CatalogoAtual): CampoDetalhe[] {
  if (!l.campos.length) return []
  const v = valores(l.entidade, l.chave, payload, cat)
  return l.campos.map((campo) => {
    const [novo, atual] = v[campo] ?? [undefined, undefined]
    return { campo, rotulo: ROTULO_CAMPO[campo] ?? campo, novo, atual: atual !== novo ? atual : undefined }
  })
}

/** Nome para exibir quando o plano não trouxe (ex.: linha só do servidor). */
export function nomeDaChave(entidade: EntidadeImportacao, chave: string, p: PayloadImportacao): string | undefined {
  if (entidade === 'fornecedor') return p.fornecedores.find((f) => f.cnpj === chave)?.nome
  if (entidade === 'insumo') return p.insumos.find((i) => i.sku === chave)?.nome
  if (entidade === 'produto' || entidade === 'ficha') return p.produtos.find((x) => x.sku === chave)?.nome
  if (entidade === 'apelido') {
    const dono = p.produtos.find((x) => x.apelidos.includes(chave))
    return dono ? `apelido de ${dono.sku}` : undefined
  }
  const [cnpj, sku] = chave.split('|')
  const f = p.fornecedores.find((x) => x.cnpj === cnpj)?.nome
  const i = p.insumos.find((x) => x.sku === sku)?.nome
  return f && i ? `${i} · ${f}` : undefined
}
