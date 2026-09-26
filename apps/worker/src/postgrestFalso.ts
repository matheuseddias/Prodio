// PostgREST de mentira para testar o Db DE VERDADE: o cliente real do supabase-js monta a URL, os
// filtros e o corpo, e só o fetch é trocado. É o que prende o formato da consulta (sem embed, com
// quais filtros) — um Db falso, como o dos testes dos jobs, não vê nada disso.
// Só para testes; nenhum código de produção importa este arquivo.
import { createClient } from '@supabase/supabase-js'
import { Db } from './db'
import type { Env } from './env'

export interface PedidoPostgrest {
  metodo: string
  /** Caminho depois de /rest/v1/: nome da tabela ou `rpc/nome`. */
  tabela: string
  params: URLSearchParams
  corpo: unknown
}

export interface RespostaPostgrest {
  status: number
  corpo?: unknown
}

// Resposta real do PostgREST 12.2.3 ao embed `tenants(slug, fuso)` em connectors, copiada da
// reprodução de 26/09/2026 contra as migrations deste repositório.
export const RESPOSTA_PGRST201: RespostaPostgrest = {
  status: 300,
  corpo: {
    code: 'PGRST201',
    details: [
      { cardinality: 'many-to-one', embedding: 'connectors with tenants', relationship: 'connectors_tenant_id_fkey using connectors(tenant_id) and tenants(id)' },
      {
        cardinality: 'many-to-many',
        embedding: 'connectors with tenants',
        relationship: 'connector_status_map using connector_status_map_tenant_id_connector_id_fkey(tenant_id, connector_id) and connector_status_map_tenant_id_fkey(tenant_id)',
      },
      {
        cardinality: 'many-to-many',
        embedding: 'connectors with tenants',
        relationship: 'hub_stock_snapshots using hub_stock_snapshots_tenant_id_connector_id_fkey(tenant_id, connector_id) and hub_stock_snapshots_tenant_id_fkey(tenant_id)',
      },
    ],
    hint: "Try changing 'tenants' to one of the following: 'tenants!connectors_tenant_id_fkey', 'tenants!connector_status_map', 'tenants!hub_stock_snapshots'. Find the desired relationship in the 'details' key.",
    message: "Could not embed because more than one relationship was found for 'connectors' and 'tenants'",
  },
}

export function postgrestFalso(responder: (p: PedidoPostgrest) => RespostaPostgrest) {
  const pedidos: PedidoPostgrest[] = []
  const fetchFalso = async (entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada))
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined
    const pedido = { metodo: (init?.method ?? 'GET').toUpperCase(), tabela: url.pathname.replace(/^\/rest\/v1\//, ''), params: url.searchParams, corpo }
    pedidos.push(pedido)
    const r = responder(pedido)
    const vazio = r.corpo === undefined || r.status === 204
    return new Response(vazio ? null : JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }
  const sb = createClient('https://x.supabase.co', 'service', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchFalso },
  })
  return { db: new Db({ CREDENTIALS_KEY: 'chave' } as Env, sb), pedidos }
}

/** O `select` que o supabase-js mandou (ele tira os espaços). */
export const colunas = (p: PedidoPostgrest): string => p.params.get('select') ?? ''
