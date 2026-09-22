// Contrato dos adaptadores de plataforma (BaseLinker, Bling, ...). Ver docs/arquitetura.md, seção 5.
import type { Connector } from '@prodio/core'

export type Plataforma = Connector['plataforma']
export type Capacidades = Connector['capacidades']

// O que a plataforma não tem devolve esta constante em vez de lançar.
export const UNSUPPORTED = 'unsupported' as const
export type Unsupported = typeof UNSUPPORTED
export const ehUnsupported = (v: unknown): v is Unsupported => v === UNSUPPORTED

// Cursor incremental persistido em sync_state.cursor (jsonb). Cada adaptador define as chaves.
export type Cursor = Record<string, unknown>

export interface ItemPedido {
  skuExterno: string // pode vir vazio na plataforma; quem casa com products/sku_aliases é o banco
  quantidade: number
  preco: number
  nome?: string
  produtoExternoId?: string
}

export interface PedidoNormalizado {
  externalId: string
  status: string // status externo cru; connector_status_map dá o significado
  confirmedAt: string | null // ISO
  updatedAt: string | null // ISO
  total: number
  itens: ItemPedido[]
  raw?: unknown
}

export interface ItemCatalogo {
  externalId: string
  skuExterno: string
  nome: string
  ean?: string
}

export interface SaldoHub {
  sku: string
  saldo: number
  externalId?: string
}

export interface DeltaEstoque {
  sku: string
  delta: number
}

export interface ResultadoPush {
  sku: string
  ok: boolean
  erro?: string
  saldoAntes?: number
  saldoDepois?: number
  dryRun?: boolean
}

export interface NfeEncontrada {
  externalId: string
  chave: string
  numero?: number
  serie?: number
  emitente?: string
  xml?: string // XML completo quando a plataforma devolve
  itens: { codigo: string; descricao: string; quantidade: number; valor: number }[]
  raw?: unknown
}

export interface Conector {
  plataforma: Plataforma
  capacidades: Capacidades
  // Pedidos novos/alterados desde o cursor. Devolve o próximo cursor (com sobreposição, upsert é idempotente).
  pullOrders(cursor: Cursor | null): Promise<{ pedidos: PedidoNormalizado[]; cursor: Cursor }>
  // Um pedido por id externo (webhooks).
  pullOrder(externalId: string): Promise<PedidoNormalizado | null | Unsupported>
  pullCatalog(): Promise<ItemCatalogo[] | Unsupported>
  // Saldo de acabado no hub. Sem lista, devolve todos os produtos conhecidos.
  pullFinishedStock(skus?: string[]): Promise<SaldoHub[] | Unsupported>
  // Aplica deltas por SKU. Para na primeira falha e devolve os resultados até ela (o job faz o freio).
  pushFinishedStock(deltas: DeltaEstoque[], opts: { dryRun: boolean }): Promise<ResultadoPush[] | Unsupported>
  findInboundNfe(chave: string): Promise<NfeEncontrada | null | Unsupported>
  // Confere a assinatura do webhook a partir do corpo cru.
  verifyWebhook(req: Request, corpo: string): Promise<boolean | Unsupported>
  // Uma chamada barata e somente-leitura que prova que a credencial funciona (POST /connectors/:id/test).
  // Devolve uma frase para humano ("inventário X", "N produtos"), nunca a credencial. Opcional:
  // adaptador que não implementa responde "teste indisponível" na rota.
  testarConexao?(): Promise<string>
}

export class ErroConector extends Error {
  plataforma: Plataforma
  codigo?: string
  status?: number
  constructor(plataforma: Plataforma, mensagem: string, extra: { codigo?: string; status?: number } = {}) {
    super(mensagem)
    this.name = 'ErroConector'
    this.plataforma = plataforma
    this.codigo = extra.codigo
    this.status = extra.status
  }
}

export const unixParaIso = (s: unknown): string | null => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null
}

// Número tolerante ao formato brasileiro: "12,5" vira 12.5 e "1.234,56" vira 1234.56
// (com vírgula, o ponto é separador de milhar). Sem vírgula, o ponto é decimal ("1.5").
export const numero = (v: unknown): number => {
  if (typeof v === 'string') {
    const t = v.trim()
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
    return Number.isFinite(n) ? n : 0
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
