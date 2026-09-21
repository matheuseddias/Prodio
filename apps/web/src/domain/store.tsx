// Estado de domínio da interface. As páginas leem daqui; o store fala com um Repo
// (memória por padrão, Supabase quando VITE_SUPABASE_URL está definida).
// Cada ação atualiza o estado de forma otimista (regras de data/local.ts), chama o Repo e
// aplica o que ele devolve. A API pública de useStore() é a mesma do modo memória.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth, type TenantResumo } from '../app/auth'
import { mensagemErro } from '../data/erros'
import * as local from '../data/local'
import { MemoryRepo, snapshotExemplo } from '../data/memoryRepo'
import { novoId, type ModoDados, type OperadorInput, type Patch, type Repo, type Retorno, type ScanResult, type Snapshot } from '../data/repo'
import { modoDados, supabase } from '../data/supabaseClient'
import { SupabaseRepo } from '../data/supabaseRepo'
import { useFilaBipes } from './storeBipes'
import type { Bom, Channel, Connector, Device, Label, Material, Member, NfeInbound, Product, PurchaseOrder, StockMove, Supplier, Tenant } from './types'

export { custoFicha, explodeBom } from './storeFicha'
export type { ScanResult }
export type State = Snapshot

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
  upsertOperator: (o: OperadorInput) => void
}

export interface Meta {
  modo: ModoDados
  loading: boolean
  /** Erro de carregamento (tela inteira). */
  erro: string | null
  /** Último erro de uma ação (aviso discreto). */
  erroAcao: string | null
  limparErro: () => void
  recarregar: () => Promise<void>
  tenants: TenantResumo[]
  pendentesBipes: number
  sincronizarBipes: () => Promise<void>
}

const StoreContext = createContext<(State & Actions & Meta) | null>(null)

function snapshotVazio(): Snapshot {
  const ex = snapshotExemplo()
  return { ...Object.fromEntries(Object.keys(ex).map((k) => [k, []])), tenant: { ...ex.tenant, id: '', nome: '', perfisEtiqueta: [] } } as unknown as Snapshot
}

export function StoreProvider({ children, repo: repoProp }: { children: ReactNode; repo?: Repo }) {
  const auth = useAuth()
  const modo: ModoDados = repoProp?.modo ?? modoDados()
  const inicial = useMemo(() => (modo === 'memoria' ? snapshotExemplo() : snapshotVazio()), [modo])
  const [s, setS] = useState<Snapshot>(inicial)
  const stateRef = useRef(inicial)
  const tenantRef = useRef(auth.tenantId)
  tenantRef.current = auth.tenantId
  const [loading, setLoading] = useState(modo === 'supabase')
  const [erro, setErro] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const repo = useMemo<Repo>(() => {
    if (repoProp) return repoProp
    if (modo === 'supabase' && supabase) return new SupabaseRepo({ sb: supabase, tenantId: () => tenantRef.current, estado: () => stateRef.current })
    return new MemoryRepo(inicial)
  }, [repoProp, modo, inicial])

  const commit = useCallback((novo: Snapshot) => {
    stateRef.current = novo
    setS(novo)
  }, [])
  const aplicarPatch = useCallback((patch: Patch) => commit({ ...stateRef.current, ...patch }), [commit])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      commit(await repo.carregarTudo())
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setLoading(false)
    }
  }, [repo, commit])

  // Carga inicial: memória carrega já; Supabase espera a sessão com empresa ativa.
  const chaveCarga = modo === 'supabase' ? `${auth.pronto}|${auth.sessao?.user.id ?? ''}|${auth.tenantId ?? ''}` : 'memoria'
  useEffect(() => {
    if (modo === 'memoria') return // o estado inicial já é o snapshot de exemplo
    if (!auth.pronto) return
    if (!auth.sessao) {
      setLoading(false)
      commit(snapshotVazio())
      return
    }
    if (!auth.tenantId) {
      setLoading(false)
      setErro(auth.usuario?.anonimo ? 'Aparelho ainda não pareado.' : 'Seu usuário não está vinculado a nenhuma empresa. Peça um convite ao administrador.')
      return
    }
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveCarga, carregar])

  const avisar = useCallback((texto: string) => setErroAcao(texto), [])
  const bipes = useFilaBipes(repo, modo === 'supabase' && !!auth.tenantId, aplicarPatch, avisar)

  // Chamadas ao Repo em série, na ordem em que as ações foram disparadas.
  const cadeia = useRef<Promise<unknown>>(Promise.resolve())
  const falhou = useCallback(
    (e: unknown) => {
      setErroAcao(mensagemErro(e))
      if (modo === 'supabase') repo.carregarTudo().then(commit).catch(() => {})
    },
    [modo, repo, commit],
  )
  const executar = useCallback(
    <T,>(otimista: (atual: Snapshot) => local.Resultado<T> | Snapshot, chamada: () => Promise<Patch | Retorno<unknown>>): T => {
      const r = otimista(stateRef.current)
      const valor = ('estado' in r ? r.valor : undefined) as T
      commit('estado' in r ? r.estado : r)
      cadeia.current = cadeia.current.then(async () => {
        try {
          const res = await chamada()
          aplicarPatch('patch' in res ? res.patch : res)
        } catch (e) {
          falhou(e)
        }
      })
      return valor
    },
    [commit, aplicarPatch, falhou],
  )

  const registerScan = useCallback<Actions['registerScan']>(
    (serialRaw, operador, dispositivo) => {
      const serial = serialRaw.trim().toUpperCase()
      const id = novoId()
      if (modo === 'memoria') {
        return executar((atual) => local.registerScan(atual, serial, operador, dispositivo, id), () => repo.registerScan(serial, { clientEventId: id, operador, dispositivo }))
      }
      // Supabase: responde na hora pela fila local e reconcilia depois (replay em ordem).
      const r = local.registerScan(stateRef.current, serial, operador, dispositivo, id, bipes.lidos())
      if (r.valor.ok) {
        commit(r.estado)
        void bipes.enfileirar({ clientEventId: id, serial, em: r.valor.scan.em, operador, dispositivo })
      } else if (r.valor.motivo === 'desconhecida' && navigator.onLine) {
        // Pode ser etiqueta impressa depois da carga: atualiza a lista para a próxima leitura.
        cadeia.current = cadeia.current.then(() => repo.recarregar(['labels']).then(aplicarPatch).catch(() => {}))
      }
      return r.valor
    },
    [modo, repo, executar, commit, aplicarPatch, bipes],
  )

  const reverseScan = useCallback<Actions['reverseScan']>((scanId) => {
    const id = novoId()
    executar((a) => local.reverseScan(a, scanId, id), () => repo.reverseScan(scanId, { id }))
  }, [executar, repo])
  const setProjetado = useCallback<Actions['setProjetado']>((productId, projetado) => executar((a) => local.setProjetado(a, productId, projetado), () => repo.setProjetado(productId, projetado)), [executar, repo])
  const printLabels = useCallback<Actions['printLabels']>((productId, qtd, tipo = 'unidade') => executar((a) => local.printLabels(a, productId, qtd, tipo), () => repo.printLabels(productId, qtd, tipo)), [executar, repo])
  const annulLabel = useCallback<Actions['annulLabel']>((serial) => executar((a) => local.annulLabel(a, serial), () => repo.annulLabel(serial)), [executar, repo])
  const addStockMove = useCallback<Actions['addStockMove']>((m) => {
    const id = novoId()
    executar((a) => local.addStockMove(a, m, id), () => repo.addStockMove(m, { id }))
  }, [executar, repo])

  const upsertProduct = useCallback<Actions['upsertProduct']>((p) => executar((a) => ({ ...a, products: local.upsertLista(a.products, p) }), () => repo.upsertProduct(p)), [executar, repo])
  const upsertMaterial = useCallback<Actions['upsertMaterial']>((m) => executar((a) => ({ ...a, materials: local.upsertLista(a.materials, m) }), () => repo.upsertMaterial(m)), [executar, repo])
  const upsertSupplier = useCallback<Actions['upsertSupplier']>((x) => executar((a) => ({ ...a, suppliers: local.upsertLista(a.suppliers, x) }), () => repo.upsertSupplier(x)), [executar, repo])
  const saveBom = useCallback<Actions['saveBom']>((b) => executar((a) => local.saveBom(a, b), () => repo.saveBom(b)), [executar, repo])

  const createPurchaseOrder = useCallback<Actions['createPurchaseOrder']>((po) => {
    const id = novoId()
    return executar((a) => local.createPurchaseOrder(a, po, id), () => repo.createPurchaseOrder(po, { id }))
  }, [executar, repo])
  const updatePurchaseOrder = useCallback<Actions['updatePurchaseOrder']>((po) => executar((a) => ({ ...a, purchaseOrders: local.upsertLista(a.purchaseOrders, po) }), () => repo.updatePurchaseOrder(po)), [executar, repo])
  const receiveNfe = useCallback<Actions['receiveNfe']>((chave, itens, porOc) => {
    const lote = novoId()
    executar((a) => local.receiveNfe(a, chave, itens, porOc, lote), () => repo.receiveNfe(chave, itens, porOc, { lote }))
  }, [executar, repo])
  const updateNfe = useCallback<Actions['updateNfe']>((n) => executar((a) => local.updateNfe(a, n), () => repo.updateNfe(n)), [executar, repo])
  const addNfe = useCallback<Actions['addNfe']>((n) => executar((a) => local.addNfe(a, n), () => repo.addNfe(n)), [executar, repo])

  const markNotification = useCallback<Actions['markNotification']>((id) => executar((a) => local.markNotification(a, id), () => repo.markNotification(id)), [executar, repo])
  const setConnector = useCallback<Actions['setConnector']>((c) => executar((a) => ({ ...a, connectors: local.upsertLista(a.connectors, c) }), () => repo.setConnector(c)), [executar, repo])
  const retryOutbox = useCallback<Actions['retryOutbox']>((id) => executar((a) => local.retryOutbox(a, id), () => repo.retryOutbox(id)), [executar, repo])
  const upsertMember = useCallback<Actions['upsertMember']>((m) => executar((a) => ({ ...a, members: local.upsertLista(a.members, m) }), () => repo.upsertMember(m)), [executar, repo])
  const removeMember = useCallback<Actions['removeMember']>((id) => executar((a) => local.removeMember(a, id), () => repo.removeMember(id)), [executar, repo])
  const upsertDevice = useCallback<Actions['upsertDevice']>((d) => executar((a) => ({ ...a, devices: local.upsertLista(a.devices, d) }), () => repo.upsertDevice(d)), [executar, repo])
  const removeDevice = useCallback<Actions['removeDevice']>((id) => executar((a) => local.removeDevice(a, id), () => repo.removeDevice(id)), [executar, repo])
  const upsertOperator = useCallback<Actions['upsertOperator']>((o) => executar((a) => local.upsertOperator(a, o, `op-${novoId()}`), () => repo.upsertOperator(o)), [executar, repo])
  const setTenant = useCallback<Actions['setTenant']>((t) => executar((a) => ({ ...a, tenant: t }), () => repo.setTenant(t)), [executar, repo])
  const upsertChannel = useCallback<Actions['upsertChannel']>((c) => executar((a) => local.upsertChannel(a, c), () => repo.upsertChannel(c)), [executar, repo])
  const removeChannel = useCallback<Actions['removeChannel']>((id) => executar((a) => local.removeChannel(a, id), () => repo.removeChannel(id)), [executar, repo])
  const setPrecoVenda = useCallback<Actions['setPrecoVenda']>((productId, channelId, preco) => executar((a) => local.setPrecoVenda(a, productId, channelId, preco), () => repo.setPrecoVenda(productId, channelId, preco)), [executar, repo])

  const limparErro = useCallback(() => setErroAcao(null), [])
  const value = useMemo(
    () => ({
      ...s,
      registerScan, reverseScan, setProjetado, printLabels, addStockMove, upsertProduct, upsertMaterial, upsertSupplier, saveBom,
      createPurchaseOrder, updatePurchaseOrder, receiveNfe, updateNfe, markNotification, setConnector, retryOutbox, upsertMember,
      upsertDevice, setTenant, upsertChannel, removeChannel, setPrecoVenda, annulLabel, addNfe, removeMember, removeDevice, upsertOperator,
      modo, loading, erro, erroAcao, limparErro, recarregar: carregar, tenants: auth.tenants,
      pendentesBipes: bipes.pendentes, sincronizarBipes: bipes.drenar,
    }),
    [s, registerScan, reverseScan, setProjetado, printLabels, addStockMove, upsertProduct, upsertMaterial, upsertSupplier, saveBom, createPurchaseOrder, updatePurchaseOrder, receiveNfe, updateNfe, markNotification, setConnector, retryOutbox, upsertMember, upsertDevice, setTenant, upsertChannel, removeChannel, setPrecoVenda, annulLabel, addNfe, removeMember, removeDevice, upsertOperator, modo, loading, erro, erroAcao, limparErro, carregar, auth.tenants, bipes.pendentes, bipes.drenar],
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
