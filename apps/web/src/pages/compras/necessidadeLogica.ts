// Lógica de tela da Necessidade de compra: o resultado do core (necessidadeDeCompra, sobre a demanda dos
// pedidos) agrupado por fornecedor, com o custo pela quantidade em unidade de compra (o valor da OC).
// Puro e testado; a página só desenha.
import type { LinhaNecessidade, ResultadoNecessidade } from '@prodio/core/necessidade'
import type { Material, PurchaseOrder, Supplier } from '../../domain/types'
import { somaDias, toISODate } from './ocUtils'

export interface LinhaCompra {
  l: LinhaNecessidade
  m: Material
  /** Custo de comprar `qtdCompra` (unidade de compra × fator × custo médio): o que a OC vai somar. */
  custo: number
}

export interface GrupoFornecedor {
  sup: Supplier
  linhas: LinhaCompra[]
}

export const SEM_FORNECEDOR: Supplier = { id: '', nome: 'Sem fornecedor padrão', cnpj: '', regime: 'simples', leadTimeDias: 0, condicaoPagamento: [] }

/** Linhas com insumo cadastrado; os insumos da ficha que não estão no cadastro saem à parte. */
export function linhasDaTela(r: ResultadoNecessidade, materials: Material[]): { linhas: LinhaCompra[]; semCadastro: LinhaNecessidade[] } {
  const porId = new Map(materials.map((m) => [m.id, m]))
  const linhas: LinhaCompra[] = []
  const semCadastro: LinhaNecessidade[] = []
  for (const l of r.linhas) {
    const m = porId.get(l.materialId)
    if (!m) {
      semCadastro.push(l)
      continue
    }
    linhas.push({ l, m, custo: l.qtdCompra * l.precoCompraUnit })
  }
  return { linhas, semCadastro }
}

/** Grupos por fornecedor padrão; o que vence antes (menor folga) vem primeiro, nos grupos e dentro deles. */
export function agruparPorFornecedor(linhas: LinhaCompra[], suppliers: Supplier[], soComprar: boolean): GrupoFornecedor[] {
  const porId = new Map(suppliers.map((s) => [s.id, s]))
  const map = new Map<string, GrupoFornecedor>()
  for (const x of linhas) {
    if (x.l.qtdPeriodo <= 0 && x.l.necessidade <= 0) continue
    if (soComprar && x.l.necessidade <= 0) continue
    const sup = porId.get(x.m.fornecedorPadraoId ?? '') ?? SEM_FORNECEDOR
    const g = map.get(sup.id) ?? { sup, linhas: [] }
    g.linhas.push(x)
    map.set(sup.id, g)
  }
  const folga = (x: LinhaCompra) => x.l.folgaDias
  return [...map.values()]
    .map((g) => ({ ...g, linhas: [...g.linhas].sort((a, b) => folga(a) - folga(b)) }))
    .sort((a, b) => Math.min(...a.linhas.map(folga)) - Math.min(...b.linhas.map(folga)))
}

export function resumoDaCompra(linhas: LinhaCompra[]) {
  const aComprar = linhas.filter((x) => x.l.necessidade > 0)
  return {
    itens: aComprar.length,
    atrasados: aComprar.filter((x) => x.l.atrasado).length,
    custo: aComprar.reduce((a, x) => a + x.custo, 0),
    fornecedores: new Set(aComprar.map((x) => x.m.fornecedorPadraoId).filter(Boolean)).size,
  }
}

/** OCs a gerar: uma por fornecedor, com os itens selecionados que têm compra sugerida. */
export function ordensDaSelecao(
  linhas: LinhaCompra[],
  selecionados: Set<string>,
  suppliers: Supplier[],
  opts: { hoje: Date; observacao: string; novoId: (i: number) => string },
): Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>[] {
  const sel = linhas.filter((x) => selecionados.has(x.m.id) && x.l.qtdCompra > 0 && x.m.fornecedorPadraoId)
  const porFornecedor = new Map<string, LinhaCompra[]>()
  for (const x of sel) porFornecedor.set(x.m.fornecedorPadraoId!, [...(porFornecedor.get(x.m.fornecedorPadraoId!) ?? []), x])
  const out: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>[] = []
  for (const [supId, itens] of porFornecedor) {
    const sup = suppliers.find((s) => s.id === supId)
    if (!sup) continue
    const lead = Math.max(sup.leadTimeDias, ...itens.map((x) => x.l.leadDias))
    out.push({
      supplierId: supId,
      status: 'aberta',
      entregaPrevista: toISODate(somaDias(opts.hoje, lead)),
      condicaoPagamento: sup.condicaoPagamento,
      observacao: opts.observacao,
      itens: itens.map((x, i) => ({
        id: opts.novoId(i),
        materialId: x.m.id,
        unidadeCompra: x.m.unidadeCompra,
        fator: x.m.fatorConversao,
        qtd: x.l.qtdCompra,
        qtdRecebida: 0,
        preco: Math.round(x.l.precoCompraUnit * 100) / 100,
        ipiPct: 0,
      })),
    })
  }
  return out
}
