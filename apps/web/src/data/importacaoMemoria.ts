// Importação do ES no modo memória (demonstração, sem banco).
//
// É a versão em memória da RPC import_catalog, como local.ts é a do resto do MemoryRepo: aplica o
// PayloadImportacao ao catálogo de exemplo com as mesmas regras de chave e de atualização e devolve a
// resposta no formato da RPC (ResultadoImportacao), para a tela ser a mesma nos dois modos.
//   · chave natural: fornecedor por CNPJ, insumo e produto por SKU, apelido por sku_externo, vínculo por
//     (CNPJ, SKU), ficha por produto;
//   · campo ausente não mexe; família do produto e lead time do insumo só preenchem o que está vazio;
//   · vínculo existente só ganha o que está vazio; apelido nunca é movido; nada é apagado;
//   · unidade de consumo trocada, SKU que é apelido de outro produto e ciclo de ficha viram problema;
//   · reaplicar o mesmo payload não muda nada (0 novos, 0 atualizados).
// Diferenças conscientes: não há linha excluída (deleted_at) nem dados de exemplo a bloquear — o modo
// memória inteiro é exemplo e some ao recarregar a página — e a ficha não guarda versões antigas.
import { ENTIDADES_IMPORTACAO, type ContagemResultado, type EntidadeImportacao, type FichaImport, type FornecedorImport, type InsumoImport, type LinhaResultado, type PayloadImportacao, type ProdutoImport, type ResultadoImportacao, type VinculoImport } from '@prodio/core/importacaoEs'
import type { Bom, BomLine, Material, Product, Supplier } from '../domain/types'

/** Vínculo insumo-fornecedor (supplier_materials) do modo memória: não é fatia do Snapshot. */
export interface VinculoMemoria {
  supplierId: string
  materialId: string
  codigoFornecedor?: string
  unidadeCompra?: string
  fator?: number
  preco?: number
  aliqIcms?: number
  inteiro: boolean
}

export interface CatalogoMemoria {
  suppliers: Supplier[]
  materials: Material[]
  products: Product[]
  boms: Bom[]
  vinculos: VinculoMemoria[]
}

export interface OpcoesMemoria {
  novoId: () => string
  /** Data da versão nova da ficha (ISO). */
  agora: string
  /** Códigos da tabela de unidades do tenant. */
  unidades: readonly string[]
}

const arred = (v: number | undefined, casas: number): number | undefined => (v === undefined || !Number.isFinite(v) ? v : Math.round(v * 10 ** casas) / 10 ** casas)
const digitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '')
const texto = (x: unknown): string => JSON.stringify(x ?? null)
/** Objeto comparado sem depender da ordem das chaves (como o jsonb). */
const atributosTexto = (a: Record<string, string>): string => JSON.stringify(Object.entries(a ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
/** Nomes (como na RPC) dos campos cujo valor muda. */
const mudou = (pares: [string, unknown, unknown][]): string[] => pares.filter(([, a, b]) => texto(a) !== texto(b)).map(([c]) => c)

class Saida {
  readonly linhas: LinhaResultado[] = []
  readonly contagens = Object.fromEntries(ENTIDADES_IMPORTACAO.map((e) => [e, { novos: 0, atualizados: 0, iguais: 0, problemas: 0 }])) as Record<EntidadeImportacao, ContagemResultado>

  linha(entidade: EntidadeImportacao, chave: string, situacao: LinhaResultado['situacao'], extra: { campos?: string[]; mensagem?: string } = {}) {
    this.linhas.push({ entidade, chave, situacao, ...extra })
    const c = this.contagens[entidade]
    if (situacao === 'novo') c.novos++
    else if (situacao === 'atualizado') c.atualizados++
    else if (situacao === 'problema') c.problemas++
  }

  fechar(entidade: EntidadeImportacao, total: number) {
    const c = this.contagens[entidade]
    c.iguais = Math.max(0, total - c.novos - c.atualizados - c.problemas)
  }
}

function fornecedores(atual: Supplier[], itens: FornecedorImport[], s: Saida, o: OpcoesMemoria): Supplier[] {
  const lista = [...atual]
  for (const f of itens) {
    const i = lista.findIndex((x) => digitos(x.cnpj) === f.cnpj)
    if (i < 0) {
      lista.push({ id: o.novoId(), nome: f.nome, cnpj: f.cnpj, regime: f.regime ?? 'normal', leadTimeDias: f.lead_time_dias ?? 0, condicaoPagamento: f.condicao_pagamento ?? [0], contato: f.contato })
      s.linha('fornecedor', f.cnpj, 'novo')
      continue
    }
    const cur = lista[i]
    const novo: Supplier = { ...cur, nome: f.nome, regime: f.regime ?? cur.regime, leadTimeDias: f.lead_time_dias ?? cur.leadTimeDias, condicaoPagamento: f.condicao_pagamento ?? cur.condicaoPagamento, contato: f.contato ?? cur.contato }
    const campos = mudou([
      ['nome', cur.nome, novo.nome],
      ['regime', cur.regime, novo.regime],
      ['lead_time_dias', cur.leadTimeDias, novo.leadTimeDias],
      ['condicao_pagamento', cur.condicaoPagamento, novo.condicaoPagamento],
      ['contato', cur.contato, novo.contato],
    ])
    if (campos.length) {
      lista[i] = novo
      s.linha('fornecedor', f.cnpj, 'atualizado', { campos })
    }
  }
  s.fechar('fornecedor', itens.length)
  return lista
}

function problemaDoInsumo(m: InsumoImport, cur: Material | undefined, unidades: Set<string>): string | undefined {
  for (const u of [m.unidade_compra, m.unidade_consumo]) if (!unidades.has(u)) return `unidade ${u} não está cadastrada no Prodio (Configurações > Unidades)`
  if (cur && cur.unidadeConsumo !== m.unidade_consumo) {
    return `a unidade de consumo mudou de ${cur.unidadeConsumo} para ${m.unidade_consumo}: o insumo não é atualizado e as fichas que o usam ficam de fora (saldo e fichas do Prodio estão em ${cur.unidadeConsumo})`
  }
  return undefined
}

function insumos(atual: Material[], suppliers: Supplier[], itens: InsumoImport[], s: Saida, o: OpcoesMemoria) {
  const lista = [...atual]
  const bloqueados = new Set<string>()
  const unidades = new Set(o.unidades)
  for (const m of itens) {
    const i = lista.findIndex((x) => x.sku === m.sku)
    const cur = i >= 0 ? lista[i] : undefined
    const problema = problemaDoInsumo(m, cur, unidades)
    if (problema) {
      bloqueados.add(m.sku)
      s.linha('insumo', m.sku, 'problema', { mensagem: problema })
      continue
    }
    const forn = m.fornecedor_padrao_cnpj ? suppliers.find((x) => digitos(x.cnpj) === m.fornecedor_padrao_cnpj) : undefined
    if (m.fornecedor_padrao_cnpj && !forn) s.linha('insumo', m.sku, 'aviso', { mensagem: `fornecedor padrão ${m.fornecedor_padrao_cnpj} não está no Prodio; o fornecedor padrão não foi alterado` })
    if (!cur) {
      lista.push({
        id: o.novoId(), sku: m.sku, nome: m.nome, ncm: m.ncm, unidadeCompra: m.unidade_compra, unidadeConsumo: m.unidade_consumo, fatorConversao: m.fator_conversao,
        minimo: m.minimo ?? 0, saldo: 0, custoMedio: m.custo_referencia ?? 0, fornecedorPadraoId: forn?.id, leadTimeDias: m.lead_time_dias ?? 0,
      })
      s.linha('insumo', m.sku, 'novo')
      continue
    }
    const novo: Material = {
      ...cur, nome: m.nome, ncm: m.ncm ?? cur.ncm, unidadeCompra: m.unidade_compra, fatorConversao: m.fator_conversao, minimo: m.minimo ?? cur.minimo,
      custoMedio: m.custo_referencia ?? cur.custoMedio, fornecedorPadraoId: forn?.id ?? cur.fornecedorPadraoId,
      leadTimeDias: cur.leadTimeDias === 0 ? (m.lead_time_dias ?? 0) : cur.leadTimeDias,
    }
    const campos = mudou([
      ['nome', cur.nome, novo.nome],
      ['ncm', cur.ncm, novo.ncm],
      ['unidade_compra', cur.unidadeCompra, novo.unidadeCompra],
      ['fator_conversao', arred(cur.fatorConversao, 6), arred(novo.fatorConversao, 6)],
      ['minimo', arred(cur.minimo, 4), arred(novo.minimo, 4)],
      ['custo_referencia', arred(cur.custoMedio, 4), arred(novo.custoMedio, 4)],
      ['fornecedor_padrao', cur.fornecedorPadraoId, novo.fornecedorPadraoId],
      ['lead_time_dias', cur.leadTimeDias, novo.leadTimeDias],
    ])
    if (campos.length) {
      lista[i] = novo
      s.linha('insumo', m.sku, 'atualizado', { campos })
    }
  }
  s.fechar('insumo', itens.length)
  return { materials: lista, bloqueados }
}

function problemaDoProduto(p: ProdutoImport, lista: Product[]): string | undefined {
  const dono = lista.find((x) => x.sku !== p.sku && (x.aliases ?? []).includes(p.sku))
  if (dono) return `o SKU ${p.sku} é apelido de ${dono.sku} no Prodio (o apelido vence o SKU nos pedidos); resolva à mão`
  const jaSku = p.apelidos.filter((a) => lista.some((x) => x.sku === a)).sort()
  if (jaSku.length) return `${jaSku.join(', ')} já existe como produto no Prodio; a importação não renomeia SKU (resolva à mão)`
  return undefined
}

function atualizarProduto(cur: Product, p: ProdutoImport): { novo: Product; campos: string[] } {
  const semFamilia = !cur.familia || cur.familia === 'Sem família'
  const novo: Product = {
    ...cur, nome: p.nome, familia: semFamilia ? (p.familia ?? cur.familia) : cur.familia, atributos: { ...(cur.atributos ?? {}), ...p.atributos },
    ean: p.ean ?? cur.ean, ncm: p.ncm ?? cur.ncm, status: p.status, pesoKg: p.peso_kg ?? cur.pesoKg, pesoCubadoKg: p.peso_cubado_kg ?? cur.pesoCubadoKg,
    // custo_manual só vale para produto sem ficha: com ficha, o custo da tela é o da ficha.
    custoFicha: !cur.temFicha && p.custo_manual !== undefined ? p.custo_manual : cur.custoFicha,
  }
  const campos = mudou([
    ['nome', cur.nome, novo.nome],
    ['familia', cur.familia, novo.familia],
    ['atributos', atributosTexto(cur.atributos), atributosTexto(novo.atributos)],
    ['ean', cur.ean, novo.ean],
    ['ncm', cur.ncm, novo.ncm],
    ['status', cur.status, novo.status],
    ['peso_kg', arred(cur.pesoKg, 4), arred(novo.pesoKg, 4)],
    ['peso_cubado_kg', arred(cur.pesoCubadoKg, 4), arred(novo.pesoCubadoKg, 4)],
    ['custo_manual', arred(cur.custoFicha, 4), arred(novo.custoFicha, 4)],
  ])
  return { novo, campos }
}

function produtos(atual: Product[], itens: ProdutoImport[], s: Saida, o: OpcoesMemoria) {
  const lista = atual.map((p) => ({ ...p, aliases: [...(p.aliases ?? [])] }))
  const bloqueados = new Set<string>()
  for (const p of itens) {
    const problema = problemaDoProduto(p, lista)
    if (problema) {
      bloqueados.add(p.sku)
      s.linha('produto', p.sku, 'problema', { mensagem: problema })
      continue
    }
    const i = lista.findIndex((x) => x.sku === p.sku)
    if (i < 0) {
      lista.push({
        id: o.novoId(), sku: p.sku, nome: p.nome, familia: p.familia ?? 'Sem família', atributos: { ...p.atributos }, ean: p.ean, ncm: p.ncm, status: p.status,
        aliases: [], temFicha: false, custoFicha: p.custo_manual, pesoKg: p.peso_kg, pesoCubadoKg: p.peso_cubado_kg,
      })
      s.linha('produto', p.sku, 'novo')
      continue
    }
    const { novo, campos } = atualizarProduto(lista[i], p)
    if (campos.length) {
      lista[i] = novo
      s.linha('produto', p.sku, 'atualizado', { campos })
    }
  }
  s.fechar('produto', itens.length)

  // Apelidos: só acrescenta. Já do mesmo produto = igual; de outro = problema (mover muda a rota dos pedidos).
  let total = 0
  for (const p of itens) {
    for (const ap of p.apelidos) {
      total++
      const prod = bloqueados.has(p.sku) ? undefined : lista.find((x) => x.sku === p.sku)
      const dono = lista.find((x) => x.aliases.includes(ap))
      if (!prod) s.linha('apelido', ap, 'problema', { mensagem: `o produto ${p.sku} ficou de fora; o apelido não entra` })
      else if (dono && dono.id !== prod.id) s.linha('apelido', ap, 'problema', { mensagem: `o apelido ${ap} já é de ${dono.sku} no Prodio; não é movido (move a rota dos pedidos)` })
      else if (dono) continue
      else if (lista.some((x) => x.sku === ap)) s.linha('apelido', ap, 'problema', { mensagem: `${ap} já é SKU de um produto no Prodio` })
      else {
        prod.aliases.push(ap)
        s.linha('apelido', ap, 'novo')
      }
    }
  }
  s.fechar('apelido', total)
  return { products: lista, bloqueados }
}

function vinculos(cat: CatalogoMemoria, itens: VinculoImport[], bloqIns: Set<string>, s: Saida): VinculoMemoria[] {
  const lista = [...cat.vinculos]
  for (const v of itens) {
    const chave = `${v.fornecedor_cnpj}|${v.insumo_sku}`
    const sup = cat.suppliers.find((x) => digitos(x.cnpj) === v.fornecedor_cnpj)
    const mat = bloqIns.has(v.insumo_sku) ? undefined : cat.materials.find((x) => x.sku === v.insumo_sku)
    if (!sup) {
      s.linha('vinculo', chave, 'problema', { mensagem: `fornecedor ${v.fornecedor_cnpj} não está no Prodio (ficou de fora ou está excluído)` })
      continue
    }
    if (!mat) {
      s.linha('vinculo', chave, 'problema', { mensagem: `insumo ${v.insumo_sku} não está no Prodio (ficou de fora ou está excluído)` })
      continue
    }
    const i = lista.findIndex((x) => x.supplierId === sup.id && x.materialId === mat.id)
    const cur = i >= 0 ? lista[i] : undefined
    let codigo = v.codigo_fornecedor
    const colide = codigo ? lista.find((x) => x.supplierId === sup.id && x.codigoFornecedor === codigo && x.materialId !== mat.id) : undefined
    if (colide) {
      const dele = cat.materials.find((x) => x.id === colide.materialId)?.sku ?? '?'
      if (!cur?.codigoFornecedor) s.linha('vinculo', chave, 'aviso', { mensagem: `código ${codigo} já é do insumo ${dele} neste fornecedor; vínculo gravado sem código` })
      codigo = undefined
    }
    if (!cur) {
      lista.push({ supplierId: sup.id, materialId: mat.id, codigoFornecedor: codigo, unidadeCompra: v.unidade_compra, fator: v.fator, preco: v.preco, aliqIcms: v.aliq_icms, inteiro: v.inteiro ?? false })
      s.linha('vinculo', chave, 'novo')
      continue
    }
    // O que o recebimento de NF-e aprendeu no Prodio vence: só preenche o que está vazio.
    const novo: VinculoMemoria = {
      ...cur, codigoFornecedor: cur.codigoFornecedor ?? codigo, unidadeCompra: cur.unidadeCompra ?? v.unidade_compra, fator: cur.fator ?? v.fator,
      preco: cur.preco ?? v.preco, aliqIcms: cur.aliqIcms ?? v.aliq_icms,
    }
    const campos = mudou([
      ['codigo_fornecedor', cur.codigoFornecedor, novo.codigoFornecedor],
      ['unidade_compra', cur.unidadeCompra, novo.unidadeCompra],
      ['fator', cur.fator, novo.fator],
      ['preco', cur.preco, novo.preco],
      ['aliq_icms', cur.aliqIcms, novo.aliqIcms],
    ])
    if (campos.length) {
      lista[i] = novo
      s.linha('vinculo', chave, 'atualizado', { campos })
    }
  }
  s.fechar('vinculo', itens.length)
  return lista
}

/** O produto aparece na árvore de algum componente da ficha nova? (fichas ativas, com a nova no lugar da atual) */
function temCiclo(productId: string, linhas: BomLine[], boms: Bom[]): boolean {
  const filhos = (id: string): string[] => {
    const ls = id === productId ? linhas : (boms.find((b) => b.productId === id && b.ativa)?.linhas ?? [])
    return ls.filter((l) => l.tipo === 'produto' && l.componentId).map((l) => l.componentId as string)
  }
  const vistos = new Set<string>()
  const pilha = filhos(productId)
  while (pilha.length) {
    const id = pilha.pop() as string
    if (id === productId) return true
    if (vistos.has(id)) continue
    vistos.add(id)
    pilha.push(...filhos(id))
  }
  return false
}

type Resolvida = { linha: Omit<BomLine, 'id'>; ref: string }

function resolverFicha(f: FichaImport, cat: CatalogoMemoria, bloqIns: Set<string>, bloqProd: Set<string>): { linhas: Resolvida[] } | { erro: string } {
  const linhas: Resolvida[] = []
  for (const l of f.linhas) {
    const base = { tipo: l.tipo, consumo: arred(l.consumo, 6) as number, unidade: l.unidade, perdaPct: 0 }
    if (l.tipo === 'insumo') {
      const sku = l.insumo_sku ?? ''
      const m = bloqIns.has(sku) ? undefined : cat.materials.find((x) => x.sku === sku)
      if (!m) return { erro: `insumo ${sku} não está no Prodio (ficou de fora ou está excluído)` }
      if (m.unidadeConsumo !== l.unidade) return { erro: `insumo ${sku} está em ${m.unidadeConsumo} no Prodio e em ${l.unidade} no arquivo` }
      linhas.push({ linha: { ...base, materialId: m.id }, ref: sku })
    } else {
      const sku = l.componente_sku ?? ''
      const c = bloqProd.has(sku) ? undefined : cat.products.find((x) => x.sku === sku)
      if (!c) return { erro: `componente ${sku} não está no Prodio (ficou de fora ou está excluído)` }
      linhas.push({ linha: { ...base, componentId: c.id }, ref: sku })
    }
  }
  return { linhas }
}

/** Assinatura da ficha sem depender da ordem das linhas: (tipo, sku, consumo, unidade, perda em fração). */
function assinatura(linhas: { tipo: string; ref: string; consumo: number; unidade: string; perda: number }[]): string {
  return JSON.stringify(linhas.map((l) => JSON.stringify([l.tipo, l.ref, arred(l.consumo, 6), l.unidade, arred(l.perda, 5)])).sort())
}

function fichas(cat: CatalogoMemoria, itens: FichaImport[], bloqIns: Set<string>, bloqProd: Set<string>, s: Saida, o: OpcoesMemoria): { boms: Bom[]; products: Product[] } {
  let boms = [...cat.boms]
  let products = cat.products
  const skuDe = (l: BomLine) => (l.tipo === 'insumo' ? cat.materials.find((m) => m.id === l.materialId)?.sku : products.find((p) => p.id === l.componentId)?.sku) ?? '?'
  for (const f of [...itens].sort((a, b) => (a.produto_sku < b.produto_sku ? -1 : a.produto_sku > b.produto_sku ? 1 : 0))) {
    const sku = f.produto_sku
    const prod = bloqProd.has(sku) ? undefined : products.find((p) => p.sku === sku)
    if (!prod) {
      s.linha('ficha', sku, 'problema', { mensagem: `o produto ${sku} não está no Prodio (ficou de fora ou está excluído)` })
      continue
    }
    const r = resolverFicha(f, { ...cat, products }, bloqIns, bloqProd)
    if ('erro' in r) {
      s.linha('ficha', sku, 'problema', { mensagem: `${r.erro}; a ficha inteira fica de fora` })
      continue
    }
    const atual = boms.find((b) => b.productId === prod.id && b.ativa)
    const antes = assinatura((atual?.linhas ?? []).map((l) => ({ tipo: l.tipo, ref: skuDe(l), consumo: l.consumo, unidade: l.unidade, perda: l.perdaPct / 100 })))
    const depois = assinatura(r.linhas.map((x) => ({ tipo: x.linha.tipo, ref: x.ref, consumo: x.linha.consumo, unidade: x.linha.unidade, perda: 0 })))
    if (antes === depois) continue
    const linhas: BomLine[] = r.linhas.map((x) => ({ id: o.novoId(), ...x.linha }))
    const erro = linhas.some((l) => l.componentId === prod.id)
      ? 'componente não pode ser o próprio produto'
      : temCiclo(prod.id, linhas, boms)
        ? 'ciclo na ficha: o produto aparece na árvore de um componente'
        : undefined
    if (erro) {
      s.linha('ficha', sku, 'problema', { mensagem: `${erro}; a ficha inteira fica de fora` })
      continue
    }
    boms = [...boms.filter((b) => b.productId !== prod.id), { productId: prod.id, versao: (atual?.versao ?? 0) + 1, ativa: true, linhas, atualizadoEm: o.agora }]
    products = products.map((p) => (p.id === prod.id ? { ...p, temFicha: true } : p))
    if (atual && atual.linhas.length) s.linha('ficha', sku, 'atualizado', { campos: ['linhas'], mensagem: 'nova versão da ficha' })
    else s.linha('ficha', sku, 'novo')
  }
  s.fechar('ficha', itens.length)
  return { boms, products }
}

/** Aplica o payload ao catálogo em memória. Não muda `atual`: devolve o catálogo novo e a resposta da "RPC". */
export function importarEmMemoria(atual: CatalogoMemoria, payload: PayloadImportacao, o: OpcoesMemoria): { resultado: ResultadoImportacao; catalogo: CatalogoMemoria } {
  const s = new Saida()
  const suppliers = fornecedores(atual.suppliers, payload.fornecedores ?? [], s, o)
  const ins = insumos(atual.materials, suppliers, payload.insumos ?? [], s, o)
  const prod = produtos(atual.products, payload.produtos ?? [], s, o)
  const meio: CatalogoMemoria = { suppliers, materials: ins.materials, products: prod.products, boms: atual.boms, vinculos: atual.vinculos }
  const vinc = vinculos(meio, payload.vinculos ?? [], ins.bloqueados, s)
  const fic = fichas(meio, payload.fichas ?? [], ins.bloqueados, prod.bloqueados, s, o)
  return {
    resultado: { simulacao: false, exemplo: { produtos: 0, insumos: 0, fornecedores: 0 }, contagens: s.contagens, linhas: s.linhas },
    catalogo: { suppliers, materials: ins.materials, products: fic.products, boms: fic.boms, vinculos: vinc },
  }
}
