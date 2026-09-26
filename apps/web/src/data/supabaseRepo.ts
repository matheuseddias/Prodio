// Repo contra o Supabase: leituras via from()/views com RLS, escritas críticas via RPC.
// Módulos por assunto: leituras.ts, fatias.ts, escritasProducao.ts, escritasCadastros.ts, escritasSistema.ts.
import type { PayloadImportacao, ResultadoImportacao } from '@prodio/core/importacaoEs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Bom, Channel, Connector, DailyPlanLine, Device, Label, LabelSize, Material, Member, NfeInbound, Product, PurchaseOrder, StockMove, Supplier, Tenant } from '../domain/types'
import * as C from './escritasCadastros'
import * as P from './escritasProducao'
import * as S from './escritasSistema'
import { carregarFatias, carregarTudo } from './fatias'
import { importarCatalogo } from './importacaoCatalogo'
import type { OpcoesBipe, OperadorInput, Parte, Patch, RegistroBipe, Repo, Retorno, Snapshot } from './repo'
import { novosMapas, type Ctx } from './supabaseCtx'

export interface OpcoesSupabaseRepo {
  sb: SupabaseClient
  /** Tenant ativo (claim app_metadata.tenant_id). Lança se não houver. */
  tenantId: () => string | null
  /** Estado atual do store, para resolver ids por serial/chave e o local padrão. */
  estado: () => Snapshot
}

export class SupabaseRepo implements Repo {
  readonly modo = 'supabase' as const
  private ctx: Ctx

  constructor(o: OpcoesSupabaseRepo) {
    this.ctx = {
      sb: o.sb,
      estado: o.estado,
      mapas: novosMapas(),
      tenantId: () => {
        const id = o.tenantId()
        if (!id) throw new Error('Nenhuma empresa ativa nesta sessão. Entre de novo.')
        return id
      },
    }
  }

  carregarTudo(): Promise<Snapshot> {
    this.ctx.mapas = novosMapas()
    return carregarTudo(this.ctx)
  }
  recarregar(partes: Parte[]): Promise<Patch> {
    return carregarFatias(this.ctx, partes)
  }

  registerScan(serial: string, opts: OpcoesBipe): Promise<Retorno<RegistroBipe>> {
    return P.registerScan(this.ctx, serial, opts)
  }
  reverseScan(scanId: string): Promise<Patch> {
    return P.reverseScan(this.ctx, scanId)
  }
  setProjetado(productId: string, projetado: number): Promise<Patch> {
    return P.setProjetado(this.ctx, productId, projetado)
  }
  adicionarAoPlano(linhas: DailyPlanLine[]): Promise<Patch> {
    return P.adicionarAoPlano(this.ctx, linhas)
  }
  printLabels(productId: string, qtd: number, tipo: 'unidade' | 'caixa'): Promise<Retorno<Label[]>> {
    return P.printLabels(this.ctx, productId, qtd, tipo)
  }
  annulLabel(serial: string): Promise<Patch> {
    return P.annulLabel(this.ctx, serial)
  }
  addStockMove(m: Omit<StockMove, 'id' | 'em'>, opts: { id: string }): Promise<Patch> {
    return P.addStockMove(this.ctx, m, opts)
  }
  saveBom(b: Bom): Promise<Patch> {
    return P.saveBom(this.ctx, b)
  }

  upsertProduct(p: Product): Promise<Patch> {
    return C.upsertProduct(this.ctx, p)
  }
  upsertMaterial(m: Material): Promise<Patch> {
    return C.upsertMaterial(this.ctx, m)
  }
  upsertSupplier(s: Supplier): Promise<Patch> {
    return C.upsertSupplier(this.ctx, s)
  }
  createPurchaseOrder(po: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>): Promise<Retorno<PurchaseOrder>> {
    return C.createPurchaseOrder(this.ctx, po)
  }
  updatePurchaseOrder(po: PurchaseOrder): Promise<Patch> {
    return C.updatePurchaseOrder(this.ctx, po)
  }
  receiveNfe(chave: string, itens: NfeInbound['itens'], porOc: Record<string, number>, opts: { lote: string }): Promise<Patch> {
    return C.receiveNfe(this.ctx, chave, itens, porOc, opts)
  }
  updateNfe(n: NfeInbound): Promise<Patch> {
    return C.upsertNfe(this.ctx, n)
  }
  addNfe(n: NfeInbound): Promise<Patch> {
    return C.upsertNfe(this.ctx, n)
  }

  markNotification(id: string): Promise<Patch> {
    return S.markNotification(this.ctx, id)
  }
  setConnector(c: Connector): Promise<Patch> {
    return S.setConnector(this.ctx, c)
  }
  retryOutbox(id: string): Promise<Patch> {
    return S.retryOutbox(this.ctx, id)
  }
  upsertMember(m: Member): Promise<Patch> {
    return S.upsertMember(this.ctx, m)
  }
  removeMember(id: string): Promise<Patch> {
    return S.removeMember(this.ctx, id)
  }
  upsertDevice(d: Device): Promise<Patch> {
    return S.upsertDevice(this.ctx, d)
  }
  removeDevice(id: string): Promise<Patch> {
    return S.removeDevice(this.ctx, id)
  }
  upsertOperator(o: OperadorInput): Promise<Patch> {
    return S.upsertOperator(this.ctx, o)
  }
  setTenant(t: Tenant): Promise<Patch> {
    return S.setTenant(this.ctx, t)
  }
  saveLabelSize(t: LabelSize): Promise<Patch> {
    return S.saveLabelSize(this.ctx, t)
  }
  removeLabelSize(id: string): Promise<Patch> {
    return S.removeLabelSize(this.ctx, id)
  }
  upsertChannel(c: Channel): Promise<Patch> {
    return S.upsertChannel(this.ctx, c)
  }
  removeChannel(id: string): Promise<Patch> {
    return S.removeChannel(this.ctx, id)
  }
  setPrecoVenda(productId: string, channelId: string, preco: number | undefined): Promise<Patch> {
    return S.setPrecoVenda(this.ctx, productId, channelId, preco)
  }
  async importarCatalogo(payload: PayloadImportacao, opts: { simular: boolean }): Promise<Retorno<ResultadoImportacao>> {
    // Sem patch: o store relê o catálogo depois de gravar (uma falha na releitura não pode parecer falha na gravação).
    return { valor: await importarCatalogo(this.ctx, payload, opts.simular), patch: {} }
  }
}
