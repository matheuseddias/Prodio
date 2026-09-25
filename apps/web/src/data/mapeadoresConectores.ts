// Conectores: a linha de `connectors`, o `sync_state` do robô e o que cada plataforma faz no Prodio.
import { dataHoraBR } from '../domain/format'
import type { Connector, RoboConector } from '../domain/types'
import { num, numOpt, strOpt } from './mapeadoresCadastros'

type Plataforma = Connector['plataforma']
type Capacidades = Connector['capacidades']
export type Capacidade = keyof Capacidades

// --- O que o Prodio faz com cada plataforma HOJE ------------------------------------------------
//
// Os chips do cartão do conector ("✓ Pedidos", "✓ Push de estoque"…) saem daqui. Eles dizem o que o
// Prodio faz com a plataforma, não o que a API da plataforma permitiria: essa descrição está em
// META (pages/sistema/ConectorMeta.ts). Antes os dois se misturavam e o cartão do BaseLinker mostrava
// "✓ Enviar catálogo" sem que nenhum adaptador do worker criasse produto em lugar nenhum.
//
// A fonte é o worker: `CAPACIDADES_BASELINKER`, `CAPACIDADES_BLING` e `CAPACIDADES_TINY` em
// apps/worker/src/conectores/. O teste pages/sistema/contrato.test.ts lê esses arquivos e quebra
// quando este mapa diverge deles.

export const SEM_CAPACIDADE: Capacidades = { pedidos: false, webhooks: false, catalogo: false, pushEstoque: false, pushCatalogo: false, nfeCompra: false }

/**
 * O que o adaptador do worker DECLARA, mas que nenhum job nem rota do worker usa ainda. A tela não
 * mostra ✓ para isso. Hoje: Bling e Tiny implementam `findInboundNfe` (NF-e de compra por chave),
 * mas ninguém chama esse método, então nenhuma nota de compra vem do ERP. O teste de contrato
 * confere que a exceção continua valendo e manda tirá-la daqui quando o worker passar a usar.
 */
export const DECLARADO_SEM_USO: Partial<Record<Plataforma, Capacidade[]>> = {
  bling: ['nfeCompra'],
  tiny: ['nfeCompra'],
}

export const CAPACIDADES: Record<Plataforma, Capacidades> = {
  baselinker: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false },
  bling: { pedidos: true, webhooks: true, catalogo: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false },
  tiny: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false },
  // Sem adaptador no worker (ConectorCampos.TEM_ADAPTADOR): nada disso acontece hoje.
  omie: SEM_CAPACIDADE,
  magis5: SEM_CAPACIDADE,
}

// --- Linhas do banco ----------------------------------------------------------------------------
export interface ConnectorRow {
  id: string
  plataforma: Plataforma
  nome: string
  status: Connector['status']
  config: Record<string, unknown> | null
  ultimo_sync: string | null
  ultimo_erro: string | null
}

/** `sync_state`: só o robô (cron) escreve aqui. Leitura liberada pela RLS (policy sync_state_select). */
export interface SyncStateRow {
  connector_id: string
  cursor: unknown
  last_run_at: string | null
  last_ok_at: string | null
  runs: number | string | null
}

export interface ExtrasConector {
  outboxPendentes?: number
  /** A linha de `sync_state`. `null`: o conector ainda não tem linha. `undefined`: não deu para ler. */
  sync?: SyncStateRow | null
  pedidos24h?: number
}

/**
 * O cursor de `sync_state` em texto para gente ler. O formato é de cada adaptador do worker:
 * BaseLinker grava `date_confirmed_from` em segundos; Bling e Tiny gravam `alterado_desde` em ms.
 */
export function cursorLegivel(cursor: unknown): string | undefined {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
  const c = cursor as Record<string, unknown>
  const quando = (ms: number) => (Number.isFinite(ms) && ms > 0 ? dataHoraBR(new Date(ms).toISOString()) : null)
  if (c.date_confirmed_from != null) {
    const d = quando(Number(c.date_confirmed_from) * 1000)
    if (d) return `pedidos confirmados a partir de ${d}`
  }
  if (c.alterado_desde != null) {
    const d = quando(Number(c.alterado_desde))
    if (d) return `pedidos alterados a partir de ${d}`
  }
  const bruto = JSON.stringify(c)
  return bruto === '{}' ? undefined : bruto
}

function roboDoBanco(sync: SyncStateRow | null | undefined): RoboConector | undefined {
  if (sync === undefined) return undefined
  if (sync === null) return { rodadas: 0 }
  return { ultimaTentativa: strOpt(sync.last_run_at), ultimoOk: strOpt(sync.last_ok_at), rodadas: num(sync.runs) }
}

export function connectorDoBanco(r: ConnectorRow, extras: ExtrasConector = {}): Connector {
  const cfg = r.config ?? {}
  const base = CAPACIDADES[r.plataforma] ?? SEM_CAPACIDADE
  return {
    id: r.id,
    plataforma: r.plataforma,
    nome: r.nome,
    status: r.status,
    // Último SUCESSO de qualquer origem: o robô ou o botão "Sincronizar agora".
    ultimoSync: strOpt(r.ultimo_sync),
    // O worker grava aqui o motivo da última falha (cron ou teste). A coluna já vinha na leitura e
    // parava neste mapeador: sem ela, um conector quebrado chega na tela sem sintoma nenhum.
    ultimoErro: strOpt(r.ultimo_erro),
    cursor: cursorLegivel(extras.sync?.cursor),
    pedidos24h: numOpt(extras.pedidos24h),
    outboxPendentes: extras.outboxPendentes ?? 0,
    robo: roboDoBanco(extras.sync),
    // `push_estoque` desligado na configuração apaga o chip; ligado não inventa o que o worker não faz.
    capacidades: { ...base, pushEstoque: base.pushEstoque && (cfg.push_estoque == null || !!cfg.push_estoque) },
  }
}

export function connectorConfigParaBanco(c: Connector): Record<string, unknown> {
  return { push_estoque: c.capacidades.pushEstoque, status: c.status }
}
