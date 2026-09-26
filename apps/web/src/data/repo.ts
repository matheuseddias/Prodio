// Contrato entre o store e a camada de dados. Duas implementações: MemoryRepo (dados de exemplo,
// sem variáveis de ambiente) e SupabaseRepo (docs/schema.md). Páginas nunca falam com o Repo.
import type { PayloadImportacao, ResultadoImportacao } from '@prodio/core/importacaoEs'
import type {
  Bom,
  Channel,
  Connector,
  DailyPlanLine,
  Device,
  Historico,
  Label,
  Location,
  Material,
  Member,
  NfeInbound,
  Notification,
  Operator,
  OutboxItem,
  Product,
  PurchaseOrder,
  ScanEvent,
  StockMove,
  Supplier,
  Tenant,
} from '../domain/types'

export interface Snapshot {
  tenant: Tenant
  products: Product[]
  materials: Material[]
  suppliers: Supplier[]
  boms: Bom[]
  dailyPlan: DailyPlanLine[]
  /** Séries dos gráficos (produção e vendas por dia). Do banco, ou de exemplo no modo memória. */
  historico: Historico
  labels: Label[]
  scans: ScanEvent[]
  stockMoves: StockMove[]
  purchaseOrders: PurchaseOrder[]
  nfes: NfeInbound[]
  connectors: Connector[]
  outbox: OutboxItem[]
  members: Member[]
  devices: Device[]
  notifications: Notification[]
  channels: Channel[]
  locations: Location[]
  operators: Operator[]
}

export type Parte = keyof Snapshot
export type Patch = Partial<Snapshot>
export interface Retorno<T = void> {
  valor: T
  patch: Patch
}

export type ModoDados = 'memoria' | 'supabase'

export type ScanMotivo = 'ja_bipado' | 'desconhecida' | 'anulada' | 'sem_operador' | 'nao_impressa'
export type ScanResult = { ok: true; scan: ScanEvent; product: Product } | { ok: false; motivo: ScanMotivo; product?: Product }

/** Resposta do backend a um bipe (espelha o jsonb da RPC register_scan). */
export interface RegistroBipe {
  ok: boolean
  motivo?: ScanMotivo | string
  scanId?: string
  productId?: string
  quantidade?: number
  bipadoHoje?: number
  projetadoHoje?: number
}

export interface OpcoesBipe {
  clientEventId: string
  operador: string
  dispositivo: string
}

export interface OperadorInput {
  id?: string
  nome: string
  pin?: string
}

/**
 * Cada ação devolve o que o store precisa para atualizar o estado: um Patch (fatias inteiras do
 * Snapshot) e, quando a página precisa do resultado, um valor. Os ids das entidades novas vêm do
 * store (opts.id) para que o estado otimista e o repositório de memória coincidam.
 */
export interface Repo {
  readonly modo: ModoDados
  carregarTudo(): Promise<Snapshot>
  recarregar(partes: Parte[]): Promise<Patch>

  registerScan(serial: string, opts: OpcoesBipe): Promise<Retorno<RegistroBipe>>
  reverseScan(scanId: string, opts: { id: string }): Promise<Patch>
  setProjetado(productId: string, projetado: number): Promise<Patch>
  printLabels(productId: string, qtd: number, tipo: 'unidade' | 'caixa'): Promise<Retorno<Label[]>>
  annulLabel(serial: string): Promise<Patch>
  addStockMove(m: Omit<StockMove, 'id' | 'em'>, opts: { id: string }): Promise<Patch>

  upsertProduct(p: Product): Promise<Patch>
  upsertMaterial(m: Material): Promise<Patch>
  upsertSupplier(s: Supplier): Promise<Patch>
  saveBom(b: Bom): Promise<Patch>

  createPurchaseOrder(po: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>, opts: { id: string }): Promise<Retorno<PurchaseOrder>>
  updatePurchaseOrder(po: PurchaseOrder): Promise<Patch>
  receiveNfe(chave: string, itens: NfeInbound['itens'], porOc: Record<string, number>, opts: { lote: string }): Promise<Patch>
  updateNfe(n: NfeInbound): Promise<Patch>
  addNfe(n: NfeInbound): Promise<Patch>

  markNotification(id: string): Promise<Patch>
  setConnector(c: Connector): Promise<Patch>
  retryOutbox(id: string): Promise<Patch>

  upsertMember(m: Member): Promise<Patch>
  removeMember(id: string): Promise<Patch>
  upsertDevice(d: Device): Promise<Patch>
  removeDevice(id: string): Promise<Patch>
  upsertOperator(o: OperadorInput): Promise<Patch>
  setTenant(t: Tenant): Promise<Patch>

  upsertChannel(c: Channel): Promise<Patch>
  removeChannel(id: string): Promise<Patch>
  setPrecoVenda(productId: string, channelId: string, preco: number | undefined): Promise<Patch>

  /**
   * Importação do cadastro do ES (payload montado pelo core; o arquivo nunca chega aqui). `simular: true`
   * devolve o que a gravação faria sem gravar nada. Lança quando nada foi gravado. Depois de gravar, o
   * store relê as fatias do catálogo (FATIAS_DO_CATALOGO).
   */
  importarCatalogo(payload: PayloadImportacao, opts: { simular: boolean }): Promise<Retorno<ResultadoImportacao>>
}

/** Gera um id único para entidades criadas no cliente (uuid quando o navegador oferece). */
export function novoId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* ambiente sem crypto */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ehUuid = (v: string | undefined | null): v is string => !!v && UUID_RE.test(v)
