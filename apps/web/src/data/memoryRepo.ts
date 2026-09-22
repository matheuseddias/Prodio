// Repositório em memória: guarda o Snapshot com os dados de exemplo e aplica as regras de local.ts.
// É o modo usado sem VITE_SUPABASE_URL. Cada ação devolve as fatias que mudaram.
import * as mock from '../domain/mock'
import type { Bom, Channel, Connector, Device, Label, Material, Member, NfeInbound, Product, PurchaseOrder, StockMove, Supplier, Tenant } from '../domain/types'
import * as local from './local'
import type { OpcoesBipe, OperadorInput, Parte, Patch, RegistroBipe, Repo, Retorno, Snapshot } from './repo'

export function snapshotExemplo(): Snapshot {
  return {
    tenant: mock.tenant,
    products: mock.products,
    materials: mock.materials,
    suppliers: mock.suppliers,
    boms: mock.boms,
    dailyPlan: mock.dailyPlan,
    historico: mock.historico,
    labels: mock.labels,
    scans: mock.scans,
    stockMoves: mock.stockMoves,
    purchaseOrders: mock.purchaseOrders,
    nfes: mock.nfes,
    connectors: mock.connectors,
    outbox: mock.outbox,
    members: mock.members,
    devices: mock.devices,
    notifications: mock.notifications,
    channels: mock.channels,
    locations: mock.locations,
    operators: mock.operators,
  }
}

const TODAS: Parte[] = ['tenant', 'products', 'materials', 'suppliers', 'boms', 'dailyPlan', 'historico', 'labels', 'scans', 'stockMoves', 'purchaseOrders', 'nfes', 'connectors', 'outbox', 'members', 'devices', 'notifications', 'channels', 'locations', 'operators']

export class MemoryRepo implements Repo {
  readonly modo = 'memoria' as const
  private s: Snapshot

  constructor(inicial: Snapshot = snapshotExemplo()) {
    this.s = inicial
  }

  get estado(): Snapshot {
    return this.s
  }

  private fatias(partes: Parte[]): Patch {
    const out: Patch = {}
    for (const p of partes) (out as Record<Parte, unknown>)[p] = this.s[p]
    return out
  }

  /** Aplica um redutor e devolve as fatias alteradas. */
  private aplicar(novo: Snapshot, partes: Parte[]): Patch {
    this.s = novo
    return this.fatias(partes)
  }

  async carregarTudo(): Promise<Snapshot> {
    return this.s
  }
  async recarregar(partes: Parte[]): Promise<Patch> {
    return this.fatias(partes.length ? partes : TODAS)
  }

  async registerScan(serial: string, opts: OpcoesBipe): Promise<Retorno<RegistroBipe>> {
    const r = local.registerScan(this.s, serial, opts.operador, opts.dispositivo, opts.clientEventId)
    const patch = this.aplicar(r.estado, ['scans', 'dailyPlan', 'outbox'])
    const v = r.valor
    const plano = v.ok ? this.s.dailyPlan.find((l) => l.productId === v.product.id) : undefined
    const valor: RegistroBipe = v.ok
      ? { ok: true, scanId: v.scan.id, productId: v.product.id, quantidade: v.scan.quantidade, bipadoHoje: plano?.bipado, projetadoHoje: plano?.projetado }
      : { ok: false, motivo: v.motivo, productId: v.product?.id }
    return { valor, patch }
  }
  async reverseScan(scanId: string, opts: { id: string }): Promise<Patch> {
    return this.aplicar(local.reverseScan(this.s, scanId, opts.id), ['scans', 'dailyPlan'])
  }
  async setProjetado(productId: string, projetado: number): Promise<Patch> {
    return this.aplicar(local.setProjetado(this.s, productId, projetado), ['dailyPlan'])
  }
  async printLabels(productId: string, qtd: number, tipo: 'unidade' | 'caixa'): Promise<Retorno<Label[]>> {
    const r = local.printLabels(this.s, productId, qtd, tipo)
    return { valor: r.valor, patch: this.aplicar(r.estado, ['labels', 'dailyPlan']) }
  }
  async annulLabel(serial: string): Promise<Patch> {
    return this.aplicar(local.annulLabel(this.s, serial), ['labels', 'dailyPlan'])
  }
  async addStockMove(m: Omit<StockMove, 'id' | 'em'>, opts: { id: string }): Promise<Patch> {
    return this.aplicar(local.addStockMove(this.s, m, opts.id), ['stockMoves', 'materials'])
  }

  async upsertProduct(p: Product): Promise<Patch> {
    return this.aplicar({ ...this.s, products: local.upsertLista(this.s.products, p) }, ['products'])
  }
  async upsertMaterial(m: Material): Promise<Patch> {
    return this.aplicar({ ...this.s, materials: local.upsertLista(this.s.materials, m) }, ['materials'])
  }
  async upsertSupplier(x: Supplier): Promise<Patch> {
    return this.aplicar({ ...this.s, suppliers: local.upsertLista(this.s.suppliers, x) }, ['suppliers'])
  }
  async saveBom(b: Bom): Promise<Patch> {
    return this.aplicar(local.saveBom(this.s, b), ['boms', 'products'])
  }

  async createPurchaseOrder(po: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>, opts: { id: string }): Promise<Retorno<PurchaseOrder>> {
    const r = local.createPurchaseOrder(this.s, po, opts.id)
    return { valor: r.valor, patch: this.aplicar(r.estado, ['purchaseOrders']) }
  }
  async updatePurchaseOrder(po: PurchaseOrder): Promise<Patch> {
    return this.aplicar({ ...this.s, purchaseOrders: local.upsertLista(this.s.purchaseOrders, po) }, ['purchaseOrders'])
  }
  async receiveNfe(chave: string, itens: NfeInbound['itens'], porOc: Record<string, number>, opts: { lote: string }): Promise<Patch> {
    return this.aplicar(local.receiveNfe(this.s, chave, itens, porOc, opts.lote), ['materials', 'stockMoves', 'purchaseOrders', 'nfes'])
  }
  async updateNfe(n: NfeInbound): Promise<Patch> {
    return this.aplicar(local.updateNfe(this.s, n), ['nfes'])
  }
  async addNfe(n: NfeInbound): Promise<Patch> {
    return this.aplicar(local.addNfe(this.s, n), ['nfes'])
  }

  async markNotification(id: string): Promise<Patch> {
    return this.aplicar(local.markNotification(this.s, id), ['notifications'])
  }
  async setConnector(c: Connector): Promise<Patch> {
    return this.aplicar({ ...this.s, connectors: local.upsertLista(this.s.connectors, c) }, ['connectors'])
  }
  async retryOutbox(id: string): Promise<Patch> {
    return this.aplicar(local.retryOutbox(this.s, id), ['outbox'])
  }

  async upsertMember(m: Member): Promise<Patch> {
    return this.aplicar({ ...this.s, members: local.upsertLista(this.s.members, m) }, ['members'])
  }
  async removeMember(id: string): Promise<Patch> {
    return this.aplicar(local.removeMember(this.s, id), ['members'])
  }
  async upsertDevice(d: Device): Promise<Patch> {
    return this.aplicar({ ...this.s, devices: local.upsertLista(this.s.devices, d) }, ['devices'])
  }
  async removeDevice(id: string): Promise<Patch> {
    return this.aplicar(local.removeDevice(this.s, id), ['devices'])
  }
  async upsertOperator(o: OperadorInput): Promise<Patch> {
    return this.aplicar(local.upsertOperator(this.s, o, `op-${Date.now().toString(36)}`), ['operators'])
  }
  async setTenant(t: Tenant): Promise<Patch> {
    return this.aplicar({ ...this.s, tenant: t }, ['tenant'])
  }

  async upsertChannel(c: Channel): Promise<Patch> {
    return this.aplicar(local.upsertChannel(this.s, c), ['channels'])
  }
  async removeChannel(id: string): Promise<Patch> {
    return this.aplicar(local.removeChannel(this.s, id), ['channels'])
  }
  async setPrecoVenda(productId: string, channelId: string, preco: number | undefined): Promise<Patch> {
    return this.aplicar(local.setPrecoVenda(this.s, productId, channelId, preco), ['products'])
  }
}
