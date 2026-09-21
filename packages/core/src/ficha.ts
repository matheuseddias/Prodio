// Ficha técnica: explosão multinível, custo recursivo, calculadora de consumo por partes e validação.
// Funções puras. Ids são strings (SKU ou uuid), o módulo não se importa.
import type { Bom, BomCalc, BomCalcParte, BomLine, Id, Material, Product } from './tipos'

export type BomIndex = Map<Id, Bom>
export type Explosao = Record<Id, number> // materialId -> quantidade em unidade de consumo

export interface FichaContexto {
  boms: Bom[]
  materiais: Material[]
  produtos?: Product[]
}

// Índice productId -> ficha ativa (a de maior versão entre as ativas; sem ativa, nenhuma).
export function indexarBoms(boms: Bom[]): BomIndex {
  const idx: BomIndex = new Map()
  for (const b of boms) {
    if (!b.ativa) continue
    const atual = idx.get(b.productId)
    if (!atual || b.versao > atual.versao) idx.set(b.productId, b)
  }
  return idx
}

// Consumo efetivo da linha: consumo × (1 + perda). Consumo não numérico vale 0; perda negativa ou
// não numérica vale 0 (nunca reduz o consumo, nunca o deixa negativo). Reutilizado pela projeção.
export const consumoDaLinha = (l: BomLine): number => {
  const consumo = Number.isFinite(l.consumo) ? l.consumo : 0
  const perda = Number.isFinite(l.perdaPct) && l.perdaPct > 0 ? l.perdaPct : 0
  return consumo * (1 + perda)
}

// Explode a ficha até os insumos-raiz, acumulando consumo × quantidade.
// Ciclo REAL (produto que aparece no próprio caminho) é cortado; irmãos que usam o mesmo
// subproduto contam de novo (backtracking do caminho). Ciclo é erro em validarFicha, não aqui.
export function explodeBom(productId: Id, qtd: number, boms: Bom[] | BomIndex, index?: BomIndex): Explosao {
  const idx = index ?? (boms instanceof Map ? boms : indexarBoms(boms))
  const acc: Explosao = {}
  const descer = (pid: Id, q: number, caminho: Set<Id>) => {
    if (caminho.has(pid)) return
    const bom = idx.get(pid)
    if (!bom) return
    caminho.add(pid)
    for (const l of bom.linhas) {
      const c = q * consumoDaLinha(l)
      if (l.tipo === 'produto') {
        if (l.componentId) descer(l.componentId, c, caminho)
      } else if (l.materialId) {
        acc[l.materialId] = (acc[l.materialId] || 0) + c
      }
    }
    caminho.delete(pid)
  }
  descer(productId, qtd, new Set())
  return acc
}

// Custo de um produto pela ficha (custo médio dos insumos, por unidade de consumo).
// Sem ficha: cai no custo manual/ficha do cadastro do produto. Ciclo no caminho devolve 0 para o ramo.
export function custoProduto(productId: Id, ctx: FichaContexto, caminho: Set<Id> = new Set()): number {
  if (caminho.has(productId)) return 0
  const idx = indexarBoms(ctx.boms)
  const bom = idx.get(productId)
  if (!bom) {
    const p = ctx.produtos?.find((x) => x.id === productId)
    return p?.custoFicha ?? 0
  }
  const materiais = new Map(ctx.materiais.map((m) => [m.id, m]))
  caminho.add(productId)
  let custo = 0
  for (const l of bom.linhas) {
    const c = consumoDaLinha(l)
    if (l.tipo === 'produto') {
      if (l.componentId) custo += c * custoProduto(l.componentId, ctx, caminho)
    } else if (l.materialId) {
      custo += c * (materiais.get(l.materialId)?.custoMedio ?? 0)
    }
  }
  caminho.delete(productId)
  return custo
}

// ---------------------------------------------------------------------------
// Calculadora de consumo por partes
// area: cm × cm → m² · rolo: m² ÷ largura do rolo → m de rolo · comprimento: cm → m · peso: g · unidade: un
// ---------------------------------------------------------------------------
const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function calcParte(calc: BomCalc, p: BomCalcParte): number {
  const qtd = n(p.qtd) || 1
  switch (calc.tipo) {
    case 'area':
      return (n(p.largCm) / 100) * (n(p.altCm) / 100) * qtd
    case 'rolo': {
      const largura = n(calc.larguraRoloM)
      if (largura <= 0) throw new Error('Consumo por rolo exige a largura do rolo em metros')
      return ((n(p.largCm) / 100) * (n(p.altCm) / 100) * qtd) / largura
    }
    case 'comprimento':
      return (n(p.compCm) / 100) * qtd
    case 'peso':
      return n(p.pesoG) * qtd
    case 'unidade':
      return n(p.un) * qtd
  }
}

// Soma das partes + perda (pct em fração ou valor fixo), arredondado a 6 casas.
export function calcConsumo(calc: BomCalc | undefined): number {
  if (!calc || !calc.partes?.length) return 0
  const soma = calc.partes.reduce((a, p) => a + calcParte(calc, p), 0)
  let perda = 0
  if (calc.perda?.tipo === 'pct') perda = soma * Math.max(0, n(calc.perda.valor))
  else if (calc.perda?.tipo === 'fixa') perda = Math.max(0, n(calc.perda.valor))
  return Math.round((soma + perda) * 1e6) / 1e6
}

// ---------------------------------------------------------------------------
// Validação de uma ficha candidata (antes de ativar)
// ---------------------------------------------------------------------------
export type FichaErroCodigo = 'componente_proprio' | 'ciclo' | 'consumo_invalido' | 'perda_invalida' | 'insumo_inexistente' | 'componente_inexistente' | 'linha_incompleta'
export interface FichaErro {
  codigo: FichaErroCodigo
  linha?: number // índice da linha na ficha candidata
  mensagem: string
}

export function validarFicha(productId: Id, linhas: BomLine[], ctx: FichaContexto): FichaErro[] {
  const erros: FichaErro[] = []
  const materiais = new Set(ctx.materiais.map((m) => m.id))
  const produtos = ctx.produtos ? new Set(ctx.produtos.map((p) => p.id)) : null
  linhas.forEach((l, i) => {
    if (!(Number.isFinite(l.consumo) && l.consumo > 0)) erros.push({ codigo: 'consumo_invalido', linha: i, mensagem: `Linha ${i + 1}: consumo deve ser um número maior que zero` })
    if (l.perdaPct !== undefined && !(Number.isFinite(l.perdaPct) && l.perdaPct >= 0)) erros.push({ codigo: 'perda_invalida', linha: i, mensagem: `Linha ${i + 1}: perda deve ser zero ou positiva` })
    if (l.tipo === 'insumo') {
      if (!l.materialId) erros.push({ codigo: 'linha_incompleta', linha: i, mensagem: `Linha ${i + 1}: insumo sem identificação` })
      else if (!materiais.has(l.materialId)) erros.push({ codigo: 'insumo_inexistente', linha: i, mensagem: `Linha ${i + 1}: insumo ${l.materialId} não existe` })
    } else {
      if (!l.componentId) erros.push({ codigo: 'linha_incompleta', linha: i, mensagem: `Linha ${i + 1}: componente sem identificação` })
      else if (l.componentId === productId) erros.push({ codigo: 'componente_proprio', linha: i, mensagem: `Linha ${i + 1}: o produto não pode ser componente de si mesmo` })
      else if (produtos && !produtos.has(l.componentId)) erros.push({ codigo: 'componente_inexistente', linha: i, mensagem: `Linha ${i + 1}: produto ${l.componentId} não existe` })
    }
  })
  // Ciclo indireto: a partir de cada componente, seguindo as fichas ativas existentes, chega-se de volta ao produto?
  const idx = indexarBoms(ctx.boms)
  const alcanca = (pid: Id, alvo: Id, visitados: Set<Id>): Id[] | null => {
    if (pid === alvo) return [pid]
    if (visitados.has(pid)) return null
    visitados.add(pid)
    const bom = idx.get(pid)
    if (!bom) return null
    for (const l of bom.linhas) {
      if (l.tipo !== 'produto' || !l.componentId) continue
      const r = alcanca(l.componentId, alvo, visitados)
      if (r) return [pid, ...r]
    }
    return null
  }
  linhas.forEach((l, i) => {
    if (l.tipo !== 'produto' || !l.componentId || l.componentId === productId) return
    const caminho = alcanca(l.componentId, productId, new Set())
    if (caminho) erros.push({ codigo: 'ciclo', linha: i, mensagem: `Linha ${i + 1}: ciclo ${[productId, ...caminho].join(' → ')}` })
  })
  return erros
}
