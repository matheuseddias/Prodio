// Conectar uma plataforma: as três peças que a tela precisa juntar, na ordem.
//
//   1. a linha em `connectors` (RPC `upsert_connector`) — é ela que dá o UUID e guarda a
//      configuração NÃO secreta do conector;
//   2. a credencial, que só o worker sabe cifrar (`POST /connectors/:id/credentials`);
//   3. a prova de que a credencial funciona (`POST /connectors/:id/test`).
//
// Sem o passo 1 não existe id para os passos 2 e 3: credencial e teste são sempre de um conector
// que já existe no banco. E sem o passo 3 não há motivo para marcar nada como conectado.
//
// ONDE MORAM `inventory_id` E `warehouse_id` (BaseLinker) — um lugar só: `connectors.config`.
// Hoje eles aparecem em dois lugares: o adaptador (ConfigBaseLinker, em
// apps/worker/src/conectores/baselinker.ts) lê os dois de `row.config`, e CHAVES_PERMITIDAS em
// apps/worker/src/rotas/credenciais.ts também os aceita como credencial. Gravá-los como credencial
// seria cifrar um dado que ninguém lê: o adaptador nunca os procura ali. Além disso não são
// segredo — são o endereço do inventário e do depósito dentro da conta do cliente — e, ficando em
// `config`, saem numa leitura normal com RLS, o que deixa a tela pré-preencher os campos numa
// reconexão. Por isso esta tela grava os dois sempre via `upsert_connector`, em `connectors.config`,
// e nunca os manda para a rota de credenciais.
import type { Connector } from '../domain/types'
import { checar } from './erros'
import { ehUuid } from './repo'
import { clienteSupabase, modoDados } from './supabaseClient'
import { chamarWorker } from './worker'

export type PlataformaOauth = 'bling' | 'tiny'

const SEM_BANCO = 'Conectar uma plataforma exige o banco configurado: o conector precisa existir no Supabase antes de receber credencial.'

/** Config atual do conector, para a modal pré-preencher numa reconexão. Falha aqui não é erro de tela. */
export async function lerConfigConector(id: string): Promise<Record<string, unknown>> {
  if (modoDados() === 'memoria' || !ehUuid(id)) return {}
  try {
    const res = await clienteSupabase().from('connectors').select('config').eq('id', id).maybeSingle()
    if (res.error) return {}
    return (res.data?.config ?? {}) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Status do conector como está no banco agora. Depois de um teste, é o worker quem acabou de
 * gravar ali o que verificou (conectado, erro ou — quando não há credencial nenhuma —
 * desconectado), então a tela lê em vez de adivinhar.
 */
export async function lerStatusConector(id: string): Promise<Connector['status'] | null> {
  if (modoDados() === 'memoria' || !ehUuid(id)) return null
  try {
    const res = await clienteSupabase().from('connectors').select('status').eq('id', id).maybeSingle()
    const status = res.error ? null : (res.data?.status as Connector['status'] | undefined)
    return status ?? null
  } catch {
    return null
  }
}

/**
 * Garante a linha do conector e devolve o UUID real.
 *
 * `config` recebe só o que a tela conhece (ex.: inventory_id/warehouse_id): a RPC faz
 * `config = config || p_config`, então o que já estava lá continua. `status` não vai junto de
 * propósito — quem muda status é quem verificou a conexão, não quem abriu o formulário.
 */
export async function garantirConector(c: Connector, tenantId: string | null, config: Record<string, unknown> = {}): Promise<string> {
  if (modoDados() === 'memoria') throw new Error(SEM_BANCO)
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa. Peça acesso ao administrador.')
  const res = await clienteSupabase().rpc('upsert_connector', {
    p_tenant_id: tenantId,
    p_id: ehUuid(c.id) ? c.id : null,
    p_plataforma: c.plataforma,
    p_nome: c.nome,
    p_config: config,
  })
  const id = checar(res) as string | null
  if (!ehUuid(id)) throw new Error('O banco não devolveu o id do conector. Tente de novo.')
  return id
}

/**
 * Desconecta de verdade: a RPC `disconnect_connector` apaga a credencial cifrada, marca o conector
 * como desconectado e joga o outbox pendente para 'ignorado'. A tela antes só gravava o status por
 * `upsert_connector` e mesmo assim prometia que a credencial tinha sido apagada.
 */
export async function desconectarConector(tenantId: string | null, connectorId: string): Promise<void> {
  if (modoDados() === 'memoria') return
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  checar(await clienteSupabase().rpc('disconnect_connector', { p_tenant_id: tenantId, p_connector_id: connectorId }))
}

// ---------------------------------------------------------------------------
// De-Para de status (connector_status_map)
//
// É esse mapa que decide o que cada status da plataforma significa aqui: demanda entra na projeção
// do dia, carteira firme reserva produção. Sem mapa gravado, `worker_upsert_orders` conta TODO
// pedido como demanda (migration 20260921000800, l.228). Leitura direta com RLS; escrita pela RPC
// `set_status_map`, que troca o mapa inteiro do conector.
// ---------------------------------------------------------------------------

export type SignificadoStatus = 'ignorar' | 'demanda' | 'carteira' | 'enviado' | 'cancelado'

/** Mapa salvo no banco: status da plataforma → significado. Vazio quando nunca foi gravado. */
export async function lerStatusMap(connectorId: string): Promise<Record<string, SignificadoStatus>> {
  if (modoDados() === 'memoria' || !ehUuid(connectorId)) return {}
  const res = await clienteSupabase().from('connector_status_map').select('status_externo,significado').eq('connector_id', connectorId)
  const linhas = (checar(res) ?? []) as { status_externo: string; significado: SignificadoStatus }[]
  return Object.fromEntries(linhas.map((l) => [l.status_externo, l.significado]))
}

/** Substitui o mapa inteiro. Devolve quantas linhas ficaram gravadas. */
export async function salvarStatusMap(tenantId: string | null, connectorId: string, mapa: Record<string, SignificadoStatus>): Promise<number> {
  if (modoDados() === 'memoria') return 0
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  const p_map = Object.entries(mapa).map(([status_externo, significado]) => ({ status_externo, significado }))
  const n = checar(await clienteSupabase().rpc('set_status_map', { p_tenant_id: tenantId, p_connector_id: connectorId, p_map })) as number | null
  return n ?? 0
}

// ---------------------------------------------------------------------------
// De-Para de SKU (sku_aliases)
//
// SKU externo que chega num pedido e não bate com nenhum produto: `worker_upsert_orders` resolve o
// produto por `sku_aliases` (migration 20260921000800, l.250), então vincular aqui é o que faz o
// pedido virar demanda do produto certo daqui para a frente.
// ---------------------------------------------------------------------------

export interface SkuSemDePara {
  sku: string
  /** Quantas linhas de pedido chegaram com este SKU sem produto vinculado. */
  vezes: number
}

/** Teto de linhas lidas de order_items: o suficiente para a lista, sem puxar o histórico inteiro. */
const LIMITE_ITENS_PEDIDO = 2000

/** SKUs externos vistos em pedidos e ainda sem produto no Prodio. */
export async function lerSkusSemDePara(): Promise<SkuSemDePara[]> {
  if (modoDados() === 'memoria') return []
  const res = await clienteSupabase().from('order_items').select('sku_externo').is('product_id', null).not('sku_externo', 'is', null).limit(LIMITE_ITENS_PEDIDO)
  const linhas = (checar(res) ?? []) as { sku_externo: string | null }[]
  const contagem = new Map<string, number>()
  for (const l of linhas) {
    const sku = (l.sku_externo ?? '').trim()
    if (sku) contagem.set(sku, (contagem.get(sku) ?? 0) + 1)
  }
  return [...contagem.entries()].map(([sku, vezes]) => ({ sku, vezes })).sort((a, b) => b.vezes - a.vezes || a.sku.localeCompare(b.sku))
}

/** Liga um SKU externo a um produto. Refazer o vínculo sobrescreve o anterior (chave única por tenant). */
export async function vincularSkuExterno(tenantId: string | null, skuExterno: string, productId: string): Promise<void> {
  if (modoDados() === 'memoria') return
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  checar(await clienteSupabase().from('sku_aliases').upsert({ tenant_id: tenantId, product_id: productId, sku_externo: skuExterno }, { onConflict: 'tenant_id,sku_externo' }))
}

// ---------------------------------------------------------------------------
// Auditor noturno (audit_runs)
// ---------------------------------------------------------------------------

/** Uma divergência como o worker a grava em audit_runs.divergencias (apps/worker/src/jobs/auditor.ts). */
export interface DivergenciaAuditor {
  sku: string
  product_id: string
  saldo_hub: number
  saldo_anterior: number | null
  bipado_hoje: number
  esperado: number | null
  diferenca: number | null
}

export interface ExecucaoAuditor {
  em: string
  connectorId: string | null
  divergencias: DivergenciaAuditor[]
}

/** Última execução do auditor deste tenant, ou null se ele ainda não rodou. */
export async function lerUltimaAuditoria(): Promise<ExecucaoAuditor | null> {
  if (modoDados() === 'memoria') return null
  const res = await clienteSupabase().from('audit_runs').select('executado_em,connector_id,divergencias').order('executado_em', { ascending: false }).limit(1).maybeSingle()
  const row = checar(res) as { executado_em: string; connector_id: string | null; divergencias: DivergenciaAuditor[] } | null
  if (!row) return null
  return { em: row.executado_em, connectorId: row.connector_id, divergencias: Array.isArray(row.divergencias) ? row.divergencias : [] }
}

export interface RespostaCredenciais {
  ok: true
  campos: string[]
}
/** Grava a credencial cifrada. O segredo sai do navegador uma vez e nunca volta. */
export function salvarCredenciais(connectorId: string, campos: Record<string, string>): Promise<RespostaCredenciais> {
  return chamarWorker<RespostaCredenciais>(`/connectors/${connectorId}/credentials`, { corpo: campos })
}

export interface RespostaOauth {
  ok: true
  url: string
}
/** Devolve a URL de consentimento da plataforma (com `state` assinado pelo worker). */
export function iniciarOauth(connectorId: string, plataforma: PlataformaOauth): Promise<RespostaOauth> {
  return chamarWorker<RespostaOauth>(`/connectors/${connectorId}/${plataforma}/oauth/start`)
}

export interface RespostaTeste {
  ok: true
  detalhe: string
}
/**
 * Chamada real e barata à plataforma com a credencial guardada. É o único carimbo de "conectado":
 * o próprio worker grava o status verificado (conectado ou erro) em `connectors`.
 * Prazo maior que o padrão porque quem responde é a plataforma, não o worker.
 */
export function testarConector(connectorId: string): Promise<RespostaTeste> {
  return chamarWorker<RespostaTeste>(`/connectors/${connectorId}/test`, { timeoutMs: 45_000 })
}
