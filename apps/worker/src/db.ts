// Acesso ao Supabase com service role. Só é usado por cron, webhook e e-mail (docs/arquitetura.md §2.5);
// rotas acionadas por usuário usam criarClienteUsuario (anon key + JWT do usuário, RLS vale).
//
// Contrato das RPCs worker_* (migration 0008, docs/schema.md):
//   worker_get_credentials(p_connector_id, p_key) -> jsonb
//   worker_set_credentials(p_tenant_id, p_connector_id, p_payload jsonb, p_key) -> void
//   worker_upsert_orders(p_tenant_id, p_connector_id, p_orders jsonb) -> int
//   worker_set_sync_state(p_connector_id, p_cursor jsonb, p_ok bool, p_erro text) -> void
//     (cursor nulo mantém o anterior; p_ok=false grava connectors.ultimo_erro e status 'erro';
//      também regrava sync_state.last_run_at com now() — ver marcarPulso)
//   worker_claim_outbox(p_connector_id, p_limit) -> [{product_id, sku, delta, ids bigint[]}]
//   worker_apply_outbox_result(p_ids bigint[], p_ok bool, p_erro text) -> void
//     (p_ok=false com p_erro nulo devolve os itens a 'pendente' sem contar tentativa: é o freio do lote)
//   worker_upsert_hub_stock(p_tenant_id, p_connector_id, p_itens jsonb [{sku, saldo}]) -> int
//   worker_record_audit(p_tenant_id, p_connector_id, p_divergencias jsonb) -> uuid
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env } from './env'
import type { Plataforma } from './conectores/tipos'
import { log } from './log'

export interface ConectorRow {
  id: string
  tenant_id: string
  plataforma: Plataforma
  nome: string
  status: 'conectado' | 'erro' | 'desconectado'
  config: Record<string, unknown>
  // Lido pelo cron só para tirar o aviso de listagem do cartão (jobs/avisoListagem.ts).
  ultimo_erro?: string | null
  tenants: { slug: string; fuso: string } | null
}
export interface SyncStateRow {
  connector_id: string
  cursor: Record<string, unknown> | null
  last_run_at: string | null
  last_ok_at: string | null
  runs: number
}
export interface LoteOutbox {
  product_id: string
  sku: string
  delta: number
  ids: number[]
}
export interface PedidoParaRpc {
  external_id: string
  external_status: string
  confirmed_at: string | null
  updated_at_external: string | null
  total: number
  // Ausente = o banco mantém o que já havia (coalesce em worker_upsert_orders). Ver PedidoNormalizado.raw.
  raw?: unknown
  itens: { sku_externo: string; quantidade: number; preco: number }[]
}
export interface ProdutoRow {
  id: string
  sku: string
}
export interface SnapshotRow {
  product_id: string
  saldo_hub: number
}
export type Credenciais = Record<string, unknown>

// O que o PostgREST/Postgres devolve junto da mensagem (PostgrestError). É o `code` que separa
// "a consulta está errada" (PGRST201, 42703…) de "o banco não respondeu" (sem código).
// Os campos vêm como `unknown` porque o tipo do supabase-js promete texto e o PostgREST nem sempre
// cumpre (ver comoTexto).
interface ErroPostgrest {
  message: string
  code?: unknown
  details?: unknown
  hint?: unknown
}

export class ErroBanco extends Error {
  codigo: string | null
  detalhes: string | null
  dica: string | null
  constructor(operacao: string, detalhe: string, extra: Omit<ErroPostgrest, 'message'> = {}) {
    super(`${operacao}: ${detalhe}`)
    this.name = 'ErroBanco'
    this.codigo = comoTexto(extra.code)
    this.detalhes = comoTexto(extra.details)
    this.dica = comoTexto(extra.hint)
  }
}

// O PostgREST nem sempre manda texto: no PGRST201, `details` é a LISTA dos relacionamentos.
function comoTexto(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' ? v : JSON.stringify(v)
}

// Código, detalhe e dica do PostgREST para o LOG (nunca para a tela). Descrevem a consulta —
// tabela, relacionamento, coluna —, não a credencial: a chave de cifra vai como argumento de RPC e
// o Postgres não a repete no erro. Cortados para caber numa linha do painel.
export function camposDoErro(e: unknown): { codigo?: string; detalhes?: string; dica?: string } {
  if (e instanceof ErroBanco) return camposPostgrest({ code: e.codigo, details: e.detalhes, hint: e.dica })
  return {}
}

function camposPostgrest(e: Omit<ErroPostgrest, 'message'>): { codigo?: string; detalhes?: string; dica?: string } {
  const campos: { codigo?: string; detalhes?: string; dica?: string } = {}
  const [codigo, detalhes, dica] = [comoTexto(e.code), comoTexto(e.details), comoTexto(e.hint)]
  if (codigo) campos.codigo = codigo.slice(0, 40)
  if (detalhes) campos.detalhes = detalhes.slice(0, 1000) // o do PGRST201 lista os relacionamentos: ~700
  if (dica) campos.dica = dica.slice(0, 400)
  return campos
}

// Colunas de connectors que o worker lê. SEM embed (`tenants(slug, fuso)`), de propósito: ver
// listarConectoresAtivos.
const COLUNAS_CONECTOR = 'id, tenant_id, plataforma, nome, status, config, ultimo_erro'
type LinhaConector = Omit<ConectorRow, 'tenants'>
type TenantDoConector = NonNullable<ConectorRow['tenants']>
// Ids por consulta de tenants. O filtro vai na URL (`id=in.(…)`, ~39 bytes por uuid codificado) e o
// cron é multi-tenant: 100 ids dão ~4 KB, longe do limite de URL do gateway do Supabase.
const TENANTS_POR_CONSULTA = 100

const opcoesSemSessao = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

export function criarClienteServico(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, opcoesSemSessao)
}

// Cliente que age como o usuário: anon key + Authorization do próprio JWT. Nunca escreve via service role.
export function criarClienteUsuario(env: Env, jwt: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    ...opcoesSemSessao,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}

function checar<T>(operacao: string, r: { data: unknown; error: ErroPostgrest | null }): T {
  if (r.error) throw new ErroBanco(operacao, r.error.message, r.error)
  return r.data as T
}

export class Db {
  sb: SupabaseClient
  private chave: string

  constructor(env: Env, sb?: SupabaseClient) {
    this.sb = sb ?? criarClienteServico(env)
    this.chave = env.CREDENTIALS_KEY
  }

  private async rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
    return checar<T>(nome, await this.sb.rpc(nome, args))
  }

  // Duas consultas simples (connectors, depois tenants), e NUNCA embed do PostgREST. Até 26/09/2026
  // isto era um select só com `tenants(slug, fuso)`, e o PostgREST respondia PGRST201 ("more than
  // one relationship was found for 'connectors' and 'tenants'"): além da FK direta, connector_status_map
  // e hub_stock_snapshots têm FK para as duas tabelas com as colunas dentro da PK, e ele as trata
  // como junção muitos-para-muitos. O cron, o envio de estoque e o auditor não chegavam a conector
  // nenhum. Hint `!fk` também não: prende a consulta ao nome gerado da FK, e renomeá-la derruba o
  // cron. O teste semEmbed.test.ts reprova qualquer embed nos .select do worker.
  async listarConectoresAtivos(): Promise<ConectorRow[]> {
    const r = await this.sb.from('connectors').select(COLUNAS_CONECTOR).in('status', ['conectado', 'erro'])
    const linhas = checar<LinhaConector[] | null>('listarConectoresAtivos', r) ?? []
    if (linhas.length === 0) return []
    const tenants = await this.tenantsPorId(linhas.map((l) => l.tenant_id))
    return linhas.map((l) => ({ ...l, tenants: tenants.get(l.tenant_id) ?? null }))
  }

  async getConector(id: string): Promise<ConectorRow | null> {
    const r = await this.sb.from('connectors').select(COLUNAS_CONECTOR).eq('id', id).maybeSingle()
    const linha = checar<LinhaConector | null>('getConector', r)
    if (!linha) return null
    const tenants = await this.tenantsPorId([linha.tenant_id])
    return { ...linha, tenants: tenants.get(linha.tenant_id) ?? null }
  }

  // Tenant ausente (ou leitura que falhou) vira `tenants: null`, e o adaptador usa o fuso padrão
  // (America/Sao_Paulo) — a mesma escolha da rota do botão (rotas/sincronizar.ts, lerTenantDoUsuario):
  // parar o robô por causa do fuso seria pior do que a diferença de fuso. A falha fica no log.
  // Em lotes (TENANTS_POR_CONSULTA): um lote que falha não apaga o fuso dos outros.
  private async tenantsPorId(ids: string[]): Promise<Map<string, TenantDoConector>> {
    const mapa = new Map<string, TenantDoConector>()
    const distintos = [...new Set(ids)]
    for (let i = 0; i < distintos.length; i += TENANTS_POR_CONSULTA) {
      const lote = distintos.slice(i, i + TENANTS_POR_CONSULTA)
      const r = await this.sb.from('tenants').select('id, slug, fuso').in('id', lote)
      if (r.error) {
        log('warn', 'db.tenants', { tenants: lote, erro: r.error.message, ...camposPostgrest(r.error) })
        continue
      }
      for (const t of (r.data ?? []) as { id: string; slug: string; fuso: string }[]) mapa.set(t.id, { slug: t.slug, fuso: t.fuso })
    }
    return mapa
  }

  // Leitura mínima para o aviso de listagem (jobs/avisoListagem.ts): só o necessário para achar os
  // cartões dos conectores ativos quando listarConectoresAtivos falhou. `ultimo_erro` vem para não
  // regravar o mesmo aviso a cada 5 minutos (connectors_audit grava uma linha em audit_log por UPDATE).
  async listarConectoresParaAviso(): Promise<{ id: string; tenant_id: string; status: string; ultimo_erro: string | null }[]> {
    const r = await this.sb.from('connectors').select('id, tenant_id, status, ultimo_erro').in('status', ['conectado', 'erro'])
    return checar<{ id: string; tenant_id: string; status: string; ultimo_erro: string | null }[] | null>('listarConectoresParaAviso', r) ?? []
  }

  // Grava SÓ ultimo_erro, sem mexer em status. Pôr 'erro' aqui teria efeito colateral: enqueue_outbox
  // (migration 0004) só enfileira o estoque produzido para conector 'conectado', e o bipe feito
  // enquanto o aviso estivesse no cartão nunca chegaria à plataforma. Também não toca em sync_state
  // (o robô não tentou este conector) nem ressuscita 'desconectado'.
  async avisarNoCartao(connectorId: string, tenantId: string, texto: string): Promise<void> {
    const r = await this.sb
      .from('connectors')
      .update({ ultimo_erro: texto.slice(0, 500) })
      .eq('id', connectorId)
      .eq('tenant_id', tenantId)
      .neq('status', 'desconectado')
    checar('avisarNoCartao', r)
  }

  // A listagem voltou: tira o aviso, e SÓ ele (`like prefixo%`): um motivo gravado nesse meio-tempo
  // pela rodada ou pelo botão fica. Status intacto, como em avisarNoCartao.
  async limparAvisoNoCartao(connectorId: string, tenantId: string, prefixo: string): Promise<void> {
    const r = await this.sb.from('connectors').update({ ultimo_erro: null }).eq('id', connectorId).eq('tenant_id', tenantId).like('ultimo_erro', `${prefixo}%`)
    checar('limparAvisoNoCartao', r)
  }

  async tenantPorSlug(slug: string): Promise<{ id: string; slug: string; fuso: string } | null> {
    const r = await this.sb.from('tenants').select('id, slug, fuso').eq('slug', slug).maybeSingle()
    return checar<{ id: string; slug: string; fuso: string } | null>('tenantPorSlug', r)
  }

  async getCredentials(connectorId: string): Promise<Credenciais | null> {
    const d = await this.rpc<Credenciais | null>('worker_get_credentials', { p_connector_id: connectorId, p_key: this.chave })
    return d ?? null
  }

  async setCredentials(tenantId: string, connectorId: string, payload: Credenciais): Promise<void> {
    await this.rpc('worker_set_credentials', { p_tenant_id: tenantId, p_connector_id: connectorId, p_payload: payload, p_key: this.chave })
  }

  // Status e ultimo_erro do conector, direto na tabela (service_role tem UPDATE em connectors).
  // Não há RPC worker_* para isto: worker_set_sync_state só alterna entre 'conectado' e 'erro' e,
  // de quebra, grava ultimo_sync e conta a rodada — fingiria uma sincronização que não houve.
  // A RPC do cliente (disconnect_connector) exige membership e ainda apaga credencial e outbox.
  // connectors não é ledger nem documento numerado (docs/arquitetura.md §2.3), então UPDATE direto
  // aqui é legítimo; o que é crítico continua só em RPC.
  // O tenant vai no filtro de propósito: o id chega de uma linha já autorizada (RLS na rota,
  // listarConectoresAtivos no cron) e o par id+tenant garante que continua sendo aquela linha.
  async marcarStatusConector(connectorId: string, tenantId: string, status: 'conectado' | 'erro' | 'desconectado', ultimoErro: string | null): Promise<void> {
    const r = await this.sb
      .from('connectors')
      .update({ status, ultimo_erro: ultimoErro?.slice(0, 500) ?? null })
      .eq('id', connectorId)
      .eq('tenant_id', tenantId)
    checar('marcarStatusConector', r)
  }

  async getSyncState(connectorId: string): Promise<SyncStateRow | null> {
    const r = await this.sb.from('sync_state').select('connector_id, cursor, last_run_at, last_ok_at, runs').eq('connector_id', connectorId).maybeSingle()
    return checar<SyncStateRow | null>('getSyncState', r)
  }

  async setSyncState(connectorId: string, cursor: Record<string, unknown> | null, ok: boolean, erro: string | null = null): Promise<void> {
    await this.rpc('worker_set_sync_state', { p_connector_id: connectorId, p_cursor: cursor, p_ok: ok, p_erro: erro })
  }

  // sync_state é do ROBÔ (o cron) e estes dois métodos escrevem nele direto, sem RPC. É legítimo pelo
  // mesmo motivo de marcarStatusConector: service_role tem INSERT/UPDATE em sync_state (migration
  // 0008), sync_state não é ledger nem documento (docs/arquitetura.md §2.3) e §2.5 lista sync_state
  // entre o que o worker grava. Não precisou de migration — o dono publica o worker e pronto.
  // O tenant vem da linha já lida por listarConectoresAtivos, e a FK composta (tenant_id,
  // connector_id) de sync_state recusa um par que não seja do mesmo conector.

  // PULSO: last_run_at = início da tentativa, gravado ANTES de decifrar a credencial e de falar com a
  // plataforma. É o que separa "o robô não roda" (pulso velho) de "o robô roda e morre antes de
  // gravar" (pulso novo, last_ok_at velho). Só mexe em last_run_at: nem cursor, nem runs, nem
  // last_ok_at, nem nada em connectors (status e ultimo_sync continuam dizendo a verdade anterior).
  async marcarPulso(connectorId: string, tenantId: string, em: string): Promise<void> {
    const r = await this.sb.from('sync_state').upsert({ connector_id: connectorId, tenant_id: tenantId, last_run_at: em, updated_at: em }, { onConflict: 'connector_id' })
    checar('marcarPulso', r)
  }

  // Ponto de retomada, gravado depois de CADA página já gravada em orders. Só mexe em cursor.
  async gravarCursor(connectorId: string, tenantId: string, cursor: Record<string, unknown>): Promise<void> {
    const r = await this.sb
      .from('sync_state')
      .upsert({ connector_id: connectorId, tenant_id: tenantId, cursor, updated_at: new Date().toISOString() }, { onConflict: 'connector_id' })
    checar('gravarCursor', r)
  }

  // Resultado do botão "Sincronizar agora" (POST /connectors/:id/sync), só no cartão (connectors).
  // Não usa worker_set_sync_state de propósito: a RPC regrava sync_state.last_run_at, runs e
  // last_ok_at, e aí um clique no botão com o cron morto faria o pulso parecer vivo — exatamente o
  // diagnóstico que o pulso existe para dar. sync_state fica só com o robô.
  // Mesmas regras da RPC para o cartão: sucesso limpa o erro e grava ultimo_sync; falha grava o
  // texto e status 'erro'; conector 'desconectado' não é ressuscitado (senão o cron voltaria a pegá-lo).
  async marcarRodadaManual(connectorId: string, tenantId: string, ok: boolean, erro: string | null = null): Promise<void> {
    const campos = ok
      ? { status: 'conectado', ultimo_erro: null, ultimo_sync: new Date().toISOString() }
      : { status: 'erro', ultimo_erro: erro?.slice(0, 500) ?? null }
    const r = await this.sb.from('connectors').update(campos).eq('id', connectorId).eq('tenant_id', tenantId).neq('status', 'desconectado')
    checar('marcarRodadaManual', r)
  }

  // Callback do OAuth gravou credencial nova: limpa o erro antigo e tira de 'erro' (sem ressuscitar
  // 'desconectado': quem carimba 'conectado' é POST /connectors/:id/test, logo em seguida). Não grava
  // ultimo_sync nem sync_state: nenhuma leitura de pedidos aconteceu.
  async marcarCredencialNova(connectorId: string, tenantId: string): Promise<void> {
    const r = await this.sb.from('connectors').update({ status: 'conectado', ultimo_erro: null }).eq('id', connectorId).eq('tenant_id', tenantId).neq('status', 'desconectado')
    checar('marcarCredencialNova', r)
  }

  async upsertOrders(tenantId: string, connectorId: string, pedidos: PedidoParaRpc[]): Promise<number> {
    let total = 0
    for (let i = 0; i < pedidos.length; i += 200) {
      const n = await this.rpc<number | null>('worker_upsert_orders', { p_tenant_id: tenantId, p_connector_id: connectorId, p_orders: pedidos.slice(i, i + 200) })
      total += n ?? 0
    }
    return total
  }

  async claimOutbox(connectorId: string, limite = 200): Promise<LoteOutbox[]> {
    const d = await this.rpc<LoteOutbox[] | null>('worker_claim_outbox', { p_connector_id: connectorId, p_limit: limite })
    return (d ?? []).map((l) => ({ ...l, delta: Number(l.delta), ids: (l.ids ?? []).map(Number) }))
  }

  async applyOutboxResult(ids: number[], ok: boolean, erro: string | null = null): Promise<void> {
    if (ids.length === 0) return
    await this.rpc('worker_apply_outbox_result', { p_ids: ids, p_ok: ok, p_erro: erro })
  }

  // Freio: devolve a 'pendente' sem contar tentativa (erro nulo).
  async requeueOutbox(ids: number[]): Promise<void> {
    await this.applyOutboxResult(ids, false, null)
  }

  async upsertHubStock(tenantId: string, connectorId: string, itens: { sku: string; saldo: number }[]): Promise<number> {
    if (itens.length === 0) return 0
    const n = await this.rpc<number | null>('worker_upsert_hub_stock', { p_tenant_id: tenantId, p_connector_id: connectorId, p_itens: itens })
    return n ?? 0
  }

  async recordAudit(tenantId: string, connectorId: string, divergencias: unknown[]): Promise<string | null> {
    return this.rpc<string | null>('worker_record_audit', { p_tenant_id: tenantId, p_connector_id: connectorId, p_divergencias: divergencias })
  }

  async listarProdutos(tenantId: string): Promise<ProdutoRow[]> {
    const r = await this.sb.from('products').select('id, sku').eq('tenant_id', tenantId).eq('status', 'ativo').is('deleted_at', null)
    return checar<ProdutoRow[] | null>('listarProdutos', r) ?? []
  }

  async snapshotsHub(tenantId: string, connectorId: string): Promise<SnapshotRow[]> {
    const r = await this.sb.from('hub_stock_snapshots').select('product_id, saldo_hub').eq('tenant_id', tenantId).eq('connector_id', connectorId)
    return (checar<SnapshotRow[] | null>('snapshotsHub', r) ?? []).map((s) => ({ ...s, saldo_hub: Number(s.saldo_hub) }))
  }

  // Bipes do dia (competência) por produto, líquidos de estorno.
  async bipadoPorProduto(tenantId: string, competencia: string): Promise<Map<string, number>> {
    const r = await this.sb.from('scan_events').select('product_id, event_type, quantidade').eq('tenant_id', tenantId).eq('competencia', competencia)
    const linhas = checar<{ product_id: string; event_type: string; quantidade: number }[] | null>('bipadoPorProduto', r) ?? []
    const mapa = new Map<string, number>()
    for (const l of linhas) {
      const sinal = l.event_type === 'produzido' ? 1 : l.event_type === 'estorno' ? -1 : 0
      mapa.set(l.product_id, (mapa.get(l.product_id) ?? 0) + sinal * Number(l.quantidade))
    }
    return mapa
  }

  // Chamada como service role: a RPC deve aceitar auth.role() = 'service_role' sem membership (origem 'email').
  async upsertNfeInbound(tenantId: string, nfe: Record<string, unknown>, itens: Record<string, unknown>[]): Promise<unknown> {
    return this.rpc('upsert_nfe_inbound', { p_tenant_id: tenantId, p_nfe: nfe, p_itens: itens })
  }

  async salvarXml(tenantId: string, chave: string, xml: string): Promise<string> {
    const caminho = `${tenantId}/${chave}.xml`
    const r = await this.sb.storage.from('nfe-xml').upload(caminho, xml, { contentType: 'application/xml', upsert: true })
    if (r.error) throw new ErroBanco('salvarXml', r.error.message)
    return caminho
  }
}
