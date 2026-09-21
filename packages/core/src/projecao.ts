// Projeção de produção: demanda diária por SKU, projetado do dia, elevação à carteira
// e demanda derivada de componentes fabricados (semiacabados) via ficha.
import { consumoDaLinha, indexarBoms } from './ficha'
import type { Bom, Id } from './tipos'

// Demanda diária = vendas do período ÷ dias × (1 + margem).
// Com diasUteisMes, a demanda mensal (vendas/dias × 30) é dividida pelos dias úteis, como na fábrica:
// vende-se 30 dias por mês, produz-se só nos úteis.
// Margem abaixo de −100% (ou não numérica) nunca produz demanda negativa.
export function demandaDiaria(vendasPeriodo: number, dias: number, margem: number, diasUteisMes?: number): number {
  if (!(dias > 0) || !(vendasPeriodo > 0)) return 0
  const fator = Math.max(0, 1 + (Number.isFinite(margem) ? margem : 0))
  if (diasUteisMes && diasUteisMes > 0) return ((vendasPeriodo / dias) * 30 * fator) / diasUteisMes
  return (vendasPeriodo / dias) * fator
}

export interface EntradaProjetado {
  demandaDia: number
  diasCobertura: number
  saldoHub: number // acabado disponível no hub/estoque
  emProducao: number // já impresso/em andamento hoje
}

// Projetado = max(0, demanda × cobertura − saldo no hub − em produção).
// Saldo negativo no hub (vendido a descoberto) soma ao projetado: é backlog a produzir.
// Em produção negativo (estornos além do impresso) vale zero.
export function projetadoDoDia(e: EntradaProjetado): number {
  const alvo = (e.demandaDia || 0) * (e.diasCobertura || 0)
  return Math.max(0, alvo - (e.saldoHub || 0) - Math.max(0, e.emProducao || 0))
}

// Pedidos firmes (carteira) nunca ficam abaixo do projetado; nunca negativo.
export const elevarACarteira = (projetado: number, carteira: number): number => Math.max(0, projetado || 0, carteira || 0)

// Demanda de componentes fabricados derivada da demanda dos pais: para cada pai, cada linha
// tipo 'produto' soma demanda × consumo (× perda) no componente. Desce em cadeia (componente de componente),
// com proteção de ciclo por caminho.
export function demandaDerivadaDeComponentes(demandaPorProduto: Record<Id, number>, boms: Bom[]): Record<Id, number> {
  const idx = indexarBoms(boms)
  const acc: Record<Id, number> = {}
  const descer = (pid: Id, qtd: number, caminho: Set<Id>) => {
    if (caminho.has(pid)) return
    const bom = idx.get(pid)
    if (!bom) return
    caminho.add(pid)
    for (const l of bom.linhas) {
      if (l.tipo !== 'produto' || !l.componentId) continue
      const q = qtd * consumoDaLinha(l)
      acc[l.componentId] = (acc[l.componentId] || 0) + q
      descer(l.componentId, q, caminho)
    }
    caminho.delete(pid)
  }
  for (const [pid, qtd] of Object.entries(demandaPorProduto)) if (qtd > 0) descer(pid, qtd, new Set())
  return acc
}

// Agrega vendas por produto resolvendo aliases (SKU comercial → produto), somando duplicatas.
export function agregarVendas(vendas: { sku: string; quantidade: number }[], resolver: (sku: string) => Id | undefined): { porProduto: Record<Id, number>; semCadastro: string[] } {
  const porProduto: Record<Id, number> = {}
  const semCadastro: string[] = []
  for (const v of vendas) {
    const pid = resolver(v.sku)
    if (!pid) {
      semCadastro.push(v.sku)
      continue
    }
    porProduto[pid] = (porProduto[pid] || 0) + (v.quantidade || 0)
  }
  return { porProduto, semCadastro }
}
