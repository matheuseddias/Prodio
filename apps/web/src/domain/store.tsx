import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import * as mock from './mock'
import type {
  Bom,
  Channel,
  Connector,
  DailyPlanLine,
  Device,
  Label,
  Material,
  Member,
  NfeInbound,
  Notification,
  OutboxItem,
  Product,
  PurchaseOrder,
  ScanEvent,
  StockMove,
  Supplier,
  Tenant,
} from './types'

export interface State {
  tenant: Tenant
  products: Product[]
  materials: Material[]
  suppliers: Supplier[]
  boms: Bom[]
  dailyPlan: DailyPlanLine[]
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
}

export type ScanResult =
  | { ok: true; scan: ScanEvent; product: Product }
  | { ok: false; motivo: 'ja_bipado' | 'desconhecida' | 'anulada'; product?: Product }

interface Actions {
  registerScan: (serial: string, operador: string, dispositivo: string) => ScanResult
  reverseScan: (scanId: string) => void
  setProjetado: (productId: string, projetado: number) => void
  printLabels: (productId: string, qtd: number, tipo?: 'unidade' | 'caixa') => Label[]
  addStockMove: (m: Omit<StockMove, 'id' | 'em'>) => void
  upsertProduct: (p: Product) => void
  upsertMaterial: (m: Material) => void
  upsertSupplier: (s: Supplier) => void
  saveBom: (b: Bom) => void
  createPurchaseOrder: (po: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>) => PurchaseOrder
  updatePurchaseOrder: (po: PurchaseOrder) => void
  receiveNfe: (chave: string, itens: NfeInbound['itens'], porOc: Record<string, number>) => void
  updateNfe: (n: NfeInbound) => void
  markNotification: (id: string) => void
  setConnector: (c: Connector) => void
  retryOutbox: (id: string) => void
  upsertMember: (m: Member) => void
  upsertDevice: (d: Device) => void
  setTenant: (t: Tenant) => void
  upsertChannel: (c: Channel) => void
  removeChannel: (id: string) => void
  setPrecoVenda: (productId: string, channelId: string, preco: number | undefined) => void
  annulLabel: (serial: string) => void
  addNfe: (n: NfeInbound) => void
  removeMember: (id: string) => void
  removeDevice: (id: string) => void
}

const StoreContext = createContext<(State & Actions) | null>(null)

const initial: State = {
  tenant: mock.tenant,
  products: mock.products,
  materials: mock.materials,
  suppliers: mock.suppliers,
  boms: mock.boms,
  dailyPlan: mock.dailyPlan,
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
}

const uid = () => Math.random().toString(36).slice(2, 10)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<State>(initial)

  const registerScan = useCallback<Actions['registerScan']>((serialRaw, operador, dispositivo) => {
    const serial = serialRaw.trim().toUpperCase()
    let result: ScanResult = { ok: false, motivo: 'desconhecida' }
    setS((prev) => {
      const label = prev.labels.find((l) => l.serial === serial)
      if (!label) {
        result = { ok: false, motivo: 'desconhecida' }
        return prev
      }
      const product = prev.products.find((p) => p.id === label.productId)!
      if (label.status === 'anulada') {
        result = { ok: false, motivo: 'anulada', product }
        return prev
      }
      if (prev.scans.some((x) => x.serial === serial && x.tipo === 'produzido')) {
        result = { ok: false, motivo: 'ja_bipado', product }
        return prev
      }
      const scan: ScanEvent = {
        id: uid(),
        serial,
        productId: label.productId,
        operador,
        dispositivo,
        etapa: 'final',
        tipo: 'produzido',
        quantidade: label.quantidade,
        em: new Date().toISOString(),
        competencia: new Date().toISOString().slice(0, 10),
        sincronizado: true,
      }
      result = { ok: true, scan, product }
      const dailyPlan = prev.dailyPlan.map((l) =>
        l.productId === label.productId ? { ...l, bipado: l.bipado + label.quantidade } : l,
      )
      const outbox: OutboxItem[] = [
        { id: uid(), connectorId: 'c1', productId: label.productId, delta: label.quantidade, status: 'pendente', em: scan.em },
        ...prev.outbox,
      ]
      return { ...prev, scans: [scan, ...prev.scans], dailyPlan, outbox }
    })
    return result
  }, [])

  const reverseScan = useCallback<Actions['reverseScan']>((scanId) => {
    setS((prev) => {
      const orig = prev.scans.find((x) => x.id === scanId)
      if (!orig || orig.tipo !== 'produzido') return prev
      const rev: ScanEvent = { ...orig, id: uid(), tipo: 'estorno', quantidade: -orig.quantidade, em: new Date().toISOString() }
      const scans = prev.scans.filter((x) => x.id !== scanId)
      const dailyPlan = prev.dailyPlan.map((l) =>
        l.productId === orig.productId ? { ...l, bipado: Math.max(0, l.bipado - orig.quantidade) } : l,
      )
      return { ...prev, scans: [rev, ...scans], dailyPlan }
    })
  }, [])

  const setProjetado = useCallback<Actions['setProjetado']>((productId, projetado) => {
    setS((prev) => ({
      ...prev,
      dailyPlan: prev.dailyPlan.some((l) => l.productId === productId)
        ? prev.dailyPlan.map((l) => (l.productId === productId ? { ...l, projetado } : l))
        : [...prev.dailyPlan, { productId, demandaDia: 0, projetado, impresso: 0, bipado: 0, carteira: 0, saldoHub: 0 }],
    }))
  }, [])

  const printLabels = useCallback<Actions['printLabels']>((productId, qtd, tipo = 'unidade') => {
    const novas: Label[] = []
    setS((prev) => {
      const p = prev.products.find((x) => x.id === productId)!
      const dia = new Date().toISOString().slice(0, 10)
      const diaCompacto = dia.replace(/-/g, '').slice(2)
      const perfil = prev.tenant.perfisEtiqueta.find((x) => x.familia === p.familia)
      const prefix = perfil?.prefixo ?? 'PR'
      const porCaixa = perfil?.unidadesPorCaixa ?? 6
      const seqInicial = prev.labels.filter((l) => l.productId === productId && l.dia === dia).length
      for (let i = 1; i <= qtd; i++) {
        const seq = seqInicial + i
        novas.push({
          serial: `${prefix}${p.sku}${diaCompacto}${String(seq).padStart(4, '0')}`,
          productId,
          tipo,
          quantidade: tipo === 'caixa' ? porCaixa : 1,
          status: 'impressa',
          dia,
          seq,
        })
      }
      const dailyPlan = prev.dailyPlan.map((l) =>
        l.productId === productId ? { ...l, impresso: l.impresso + qtd } : l,
      )
      return { ...prev, labels: [...prev.labels, ...novas], dailyPlan }
    })
    return novas
  }, [])

  const addStockMove = useCallback<Actions['addStockMove']>((m) => {
    setS((prev) => {
      const move: StockMove = { ...m, id: uid(), em: new Date().toISOString() }
      const materials = prev.materials.map((x) =>
        x.id === m.materialId ? { ...x, saldo: Math.round((x.saldo + m.delta) * 1000) / 1000 } : x,
      )
      return { ...prev, stockMoves: [move, ...prev.stockMoves], materials }
    })
  }, [])

  const upsert = <T extends { id: string }>(list: T[], item: T) =>
    list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]

  const upsertProduct = useCallback<Actions['upsertProduct']>((p) => setS((prev) => ({ ...prev, products: upsert(prev.products, p) })), [])
  const upsertMaterial = useCallback<Actions['upsertMaterial']>((m) => setS((prev) => ({ ...prev, materials: upsert(prev.materials, m) })), [])
  const upsertSupplier = useCallback<Actions['upsertSupplier']>((x) => setS((prev) => ({ ...prev, suppliers: upsert(prev.suppliers, x) })), [])
  const upsertMember = useCallback<Actions['upsertMember']>((x) => setS((prev) => ({ ...prev, members: upsert(prev.members, x) })), [])
  const upsertDevice = useCallback<Actions['upsertDevice']>((x) => setS((prev) => ({ ...prev, devices: upsert(prev.devices, x) })), [])
  const setConnector = useCallback<Actions['setConnector']>((x) => setS((prev) => ({ ...prev, connectors: upsert(prev.connectors, x) })), [])
  const setTenant = useCallback<Actions['setTenant']>((t) => setS((prev) => ({ ...prev, tenant: t })), [])

  const saveBom = useCallback<Actions['saveBom']>((b) => {
    setS((prev) => {
      const boms = prev.boms.some((x) => x.productId === b.productId)
        ? prev.boms.map((x) => (x.productId === b.productId ? b : x))
        : [...prev.boms, b]
      const products = prev.products.map((p) => (p.id === b.productId ? { ...p, temFicha: b.linhas.length > 0 } : p))
      return { ...prev, boms, products }
    })
  }, [])

  const createPurchaseOrder = useCallback<Actions['createPurchaseOrder']>((po) => {
    let created!: PurchaseOrder
    setS((prev) => {
      const numero = Math.max(...prev.purchaseOrders.map((x) => x.numero)) + 1
      created = { ...po, id: uid(), numero, criadaEm: new Date().toISOString() }
      return { ...prev, purchaseOrders: [created, ...prev.purchaseOrders] }
    })
    return created
  }, [])

  const updatePurchaseOrder = useCallback<Actions['updatePurchaseOrder']>((po) => setS((prev) => ({ ...prev, purchaseOrders: upsert(prev.purchaseOrders, po) })), [])

  const receiveNfe = useCallback<Actions['receiveNfe']>((chave, itens, porOc) => {
    setS((prev) => {
      const nfe = prev.nfes.find((n) => n.chave === chave)
      if (!nfe) return prev
      const moves: StockMove[] = []
      let materials = prev.materials
      for (const it of itens) {
        if (!it.materialId || !it.qtdConsumo) continue
        const custoUnit = it.vUnCom / (it.fator || 1)
        moves.push({ id: uid(), materialId: it.materialId, tipo: 'entrada_nfe', delta: it.qtdConsumo, custoUnit, ref: `NF-e ${nfe.numero}`, por: 'Recebimento', em: new Date().toISOString() })
        materials = materials.map((m) => {
          if (m.id !== it.materialId) return m
          const novoSaldo = m.saldo + it.qtdConsumo!
          const novoCm = novoSaldo > 0 ? (m.saldo * m.custoMedio + it.qtdConsumo! * custoUnit) / novoSaldo : custoUnit
          return { ...m, saldo: Math.round(novoSaldo * 1000) / 1000, custoMedio: Math.round(novoCm * 100) / 100 }
        })
      }
      const purchaseOrders = prev.purchaseOrders.map((po) => {
        if (!nfe.poIds.includes(po.id)) return po
        const itensPo = po.itens.map((pi) => {
          const recebidoAgora = porOc[pi.id] ?? 0
          return { ...pi, qtdRecebida: pi.qtdRecebida + recebidoAgora }
        })
        const completo = itensPo.every((pi) => pi.qtdRecebida >= pi.qtd)
        const algum = itensPo.some((pi) => pi.qtdRecebida > 0)
        return { ...po, itens: itensPo, status: completo ? 'recebida' : algum ? 'parcial' : po.status }
      })
      const nfes = prev.nfes.map((n) => (n.chave === chave ? { ...n, itens, status: 'recebida' as const } : n))
      return { ...prev, materials, stockMoves: [...moves, ...prev.stockMoves], purchaseOrders, nfes }
    })
  }, [])

  const updateNfe = useCallback<Actions['updateNfe']>((n) => setS((prev) => ({ ...prev, nfes: prev.nfes.map((x) => (x.chave === n.chave ? n : x)) })), [])
  const markNotification = useCallback<Actions['markNotification']>((id) => setS((prev) => ({ ...prev, notifications: prev.notifications.map((n) => (n.id === id ? { ...n, lida: true } : n)) })), [])
  const retryOutbox = useCallback<Actions['retryOutbox']>((id) => setS((prev) => ({ ...prev, outbox: prev.outbox.map((o) => (o.id === id ? { ...o, status: 'aplicado', erro: undefined } : o)) })), [])

  const upsertChannel = useCallback<Actions['upsertChannel']>((c) => setS((prev) => ({ ...prev, channels: upsert(prev.channels, c) })), [])
  const removeChannel = useCallback<Actions['removeChannel']>((id) => setS((prev) => ({ ...prev, channels: prev.channels.filter((c) => c.id !== id) })), [])
  const setPrecoVenda = useCallback<Actions['setPrecoVenda']>((productId, channelId, preco) =>
    setS((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? { ...p, precoVenda: { ...(p.precoVenda ?? {}), [channelId]: preco } } : p)),
    })), [])
  const annulLabel = useCallback<Actions['annulLabel']>((serial) =>
    setS((prev) => {
      const label = prev.labels.find((l) => l.serial === serial)
      if (!label || label.status === 'anulada') return prev
      const dailyPlan = prev.dailyPlan.map((l) => (l.productId === label.productId ? { ...l, impresso: Math.max(0, l.impresso - 1) } : l))
      return { ...prev, labels: prev.labels.map((l) => (l.serial === serial ? { ...l, status: 'anulada' as const } : l)), dailyPlan }
    }), [])
  const addNfe = useCallback<Actions['addNfe']>((n) => setS((prev) => (prev.nfes.some((x) => x.chave === n.chave) ? prev : { ...prev, nfes: [n, ...prev.nfes] })), [])
  const removeMember = useCallback<Actions['removeMember']>((id) => setS((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== id) })), [])
  const removeDevice = useCallback<Actions['removeDevice']>((id) => setS((prev) => ({ ...prev, devices: prev.devices.filter((d) => d.id !== id) })), [])

  const value = useMemo(
    () => ({
      ...s,
      registerScan,
      reverseScan,
      setProjetado,
      printLabels,
      addStockMove,
      upsertProduct,
      upsertMaterial,
      upsertSupplier,
      saveBom,
      createPurchaseOrder,
      updatePurchaseOrder,
      receiveNfe,
      updateNfe,
      markNotification,
      setConnector,
      retryOutbox,
      upsertMember,
      upsertDevice,
      setTenant,
      upsertChannel,
      removeChannel,
      setPrecoVenda,
      annulLabel,
      addNfe,
      removeMember,
      removeDevice,
    }),
    [s, registerScan, reverseScan, setProjetado, printLabels, addStockMove, upsertProduct, upsertMaterial, upsertSupplier, saveBom, createPurchaseOrder, updatePurchaseOrder, receiveNfe, updateNfe, markNotification, setConnector, retryOutbox, upsertMember, upsertDevice, setTenant, upsertChannel, removeChannel, setPrecoVenda, annulLabel, addNfe, removeMember, removeDevice],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore fora do StoreProvider')
  return ctx
}

// Seletores utilitários
export function useLookups() {
  const s = useStore()
  return useMemo(
    () => ({
      product: (id: string) => s.products.find((p) => p.id === id),
      material: (id: string) => s.materials.find((m) => m.id === id),
      supplier: (id?: string) => (id ? s.suppliers.find((x) => x.id === id) : undefined),
      bom: (productId: string) => s.boms.find((b) => b.productId === productId && b.ativa),
    }),
    [s.products, s.materials, s.suppliers, s.boms],
  )
}

// Explosão de ficha multinível (versão simplificada em memória)
export function explodeBom(
  productId: string,
  qtd: number,
  boms: Bom[],
  visitados: Set<string> = new Set(),
): Record<string, number> {
  const out: Record<string, number> = {}
  if (visitados.has(productId)) return out
  const bom = boms.find((b) => b.productId === productId && b.ativa)
  if (!bom) return out
  const next = new Set(visitados)
  next.add(productId)
  for (const l of bom.linhas) {
    const consumo = l.consumo * (1 + l.perdaPct / 100) * qtd
    if (l.tipo === 'insumo' && l.materialId) {
      out[l.materialId] = (out[l.materialId] ?? 0) + consumo
    } else if (l.tipo === 'produto' && l.componentId) {
      const sub = explodeBom(l.componentId, consumo, boms, next)
      for (const [k, v] of Object.entries(sub)) out[k] = (out[k] ?? 0) + v
    }
  }
  return out
}

export function custoFicha(productId: string, boms: Bom[], materials: Material[]): number | undefined {
  const bom = boms.find((b) => b.productId === productId && b.ativa)
  if (!bom) return undefined
  const exp = explodeBom(productId, 1, boms)
  let total = 0
  for (const [mid, q] of Object.entries(exp)) {
    const m = materials.find((x) => x.id === mid)
    if (m) total += q * m.custoMedio
  }
  return Math.round(total * 100) / 100
}
