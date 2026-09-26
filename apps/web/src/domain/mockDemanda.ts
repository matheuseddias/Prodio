// Demanda do modo de demonstração (sem banco): pedidos de exemplo dos últimos 30 dias, resumidos pela
// MESMA regra da RPC demand_summary (resumirPedidos do core). Com banco, a demanda vem de lá — nunca daqui.
// Tem um pedido cancelado (conta), um 'ignorar' (não conta), um produto vendido sem ficha (p9) e um SKU
// que não casa com produto nenhum, para as telas mostrarem o que fica de fora.
import { resumirPedidos, type PedidoParaResumo } from '@prodio/core/planejamento'
import type { DemandaResumo } from './types'

// Venda média por dia corrido de cada produto de exemplo (id, sku).
const MEDIA: [string, string, number][] = [
  ['p1', 'ED000130', 50],
  ['p2', 'ED000127', 46],
  ['p3', 'ED000215', 14],
  ['p4', 'ED000240', 11],
  ['p5', 'ED000001', 30],
  ['p6', 'ED000008', 15],
  ['p7', 'ED000002', 8],
  ['p8', 'ED000010', 3],
  ['p9', 'ED000376', 2.4],
]
// Saldo no hub (snapshot do auditor) só de alguns: os outros mostram a meta do dia sem saldo.
const HUB: [string, number][] = [
  ['p1', 212],
  ['p2', 96],
  ['p5', 388],
]

function pedidosDeExemplo(agora: number): PedidoParaResumo[] {
  const out: PedidoParaResumo[] = []
  for (let d = 0; d < 30; d++) {
    const em = new Date(agora - d * 86_400_000 - 3 * 3_600_000).toISOString()
    // Dia útil vende mais; a variação é fixa (a tela não pode mudar a cada recarga). Um pedido por produto e dia.
    const fator = [1.1, 0.9, 1.2, 1, 0.8, 0.6, 0.7][d % 7]
    for (const [id, sku, media] of MEDIA) {
      const quantidade = Math.round(media * fator)
      if (quantidade > 0) out.push({ id: `ex-${d}-${id}`, confirmadoEm: em, significado: d < 2 ? 'carteira' : 'enviado', itens: [{ sku, productId: id, quantidade }] })
    }
  }
  out.push({ id: 'ex-cancelado', confirmadoEm: new Date(agora - 4 * 86_400_000).toISOString(), significado: 'cancelado', itens: [{ sku: 'ED000130', productId: 'p1', quantidade: 6 }] })
  out.push({ id: 'ex-orcamento', confirmadoEm: new Date(agora - 3_600_000).toISOString(), significado: 'ignorar', itens: [{ sku: 'ED000130', productId: 'p1', quantidade: 500 }] })
  out.push({ id: 'ex-sem-produto', confirmadoEm: new Date(agora - 2 * 86_400_000).toISOString(), significado: 'enviado', itens: [{ sku: 'ED000999', productId: null, quantidade: 12 }] })
  return out
}

/** Resumo de exemplo na janela pedida (padrão 14 dias), marcado como exemplo. */
export function demandaExemplo(dias?: number, agora = Date.now()): DemandaResumo {
  const hub = HUB.map(([productId, saldo]) => ({ productId, saldo, capturadoEm: new Date(agora - 9 * 3_600_000).toISOString() }))
  return resumirPedidos(pedidosDeExemplo(agora), { dias, agora, hub, exemplo: true })
}
