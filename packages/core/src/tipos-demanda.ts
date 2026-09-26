// Tipos da demanda que vem dos pedidos (planejamento.ts). O banco agrega (RPC demand_summary, migration
// 20260926000500_demanda.sql) e a Linha de hoje, a Necessidade de compra e o Painel leem daqui.
import type { Id } from './tipos'

/** `orders.significado`, dado pelo De-Para de status do conector (connector_status_map). */
export type SignificadoPedido = 'ignorar' | 'demanda' | 'carteira' | 'enviado' | 'cancelado'

/** Venda de um produto na janela da demanda (últimos N dias). */
export interface DemandaProduto {
  productId: Id
  /** Unidades de todo pedido confirmado na janela que não é 'ignorar' (inclusive cancelado e enviado). */
  vendido: number
  /** Unidades dos pedidos da janela com significado 'carteira' (pedido firme ainda a produzir). */
  carteira: number
  /** Confirmação mais recente deste produto na janela (ISO). */
  ultimoPedido?: string
}

/** SKU que chegou num pedido e não casa com produto nem apelido do Prodio. */
export interface SkuSemProduto {
  sku: string
  unidades: number
  pedidos: number
}

/** Saldo de acabado no hub (hub_stock_snapshots, gravado pelo auditor noturno do worker). */
export interface SaldoHubProduto {
  productId: Id
  saldo: number
  capturadoEm?: string
}

/**
 * Resumo da demanda dos pedidos na janela do tenant. Só agregados: os pedidos em si nunca vêm para
 * o navegador. `disponivel: false` quer dizer que a leitura falhou — a tela não afirma nada
 * (nem "nada a comprar", nem "sem vendas").
 */
export interface DemandaResumo {
  disponivel: boolean
  /** Dados de exemplo (modo demonstração, sem banco). */
  exemplo: boolean
  /** Janela da média de vendas em dias corridos (tenants.dias_demanda). */
  dias: number
  /** Início da janela (ISO). */
  desde?: string
  /** Quando o banco calculou (ISO). */
  geradoEm?: string
  /** Confirmação mais recente de qualquer pedido já gravado, de qualquer significado (ISO). Diz até onde o robô leu. */
  ultimoPedido?: string
  /** Pedidos da janela que contam na demanda. */
  pedidos: number
  /** Pedidos confirmados nas últimas 24 h que contam na demanda. */
  pedidos24h: number
  /** Unidades vendidas na janela (com e sem produto). */
  unidades: number
  /** Itens da janela sem produto no Prodio: linhas, unidades e SKUs distintos. */
  semProduto: { linhas: number; unidades: number; skus: number }
  /** Os SKUs sem produto que mais vendem (a lista é cortada; `semProduto` tem o total). */
  skusSemProduto: SkuSemProduto[]
  /** Vendas por produto na janela (só produtos com venda). */
  produtos: DemandaProduto[]
  /** Saldo no hub por produto (só produtos com snapshot). */
  hub: SaldoHubProduto[]
}
