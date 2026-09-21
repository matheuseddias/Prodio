// Cliente Supabase criado a partir das variáveis de ambiente. Sem elas o app roda em memória.
// A anon key só serve para autenticar; tudo passa pela RLS e pelas RPCs (docs/arquitetura.md, seção 2).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ModoDados } from './repo'

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      })
    : null

export function modoDados(): ModoDados {
  return supabase ? 'supabase' : 'memoria'
}

/** Cliente garantido (só chamar quando modoDados() === 'supabase'). */
export function clienteSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')
  return supabase
}

export const workerUrl = (import.meta.env.VITE_WORKER_URL ?? '').trim().replace(/\/$/, '')

/** Lê uma claim do JWT de acesso sem verificar assinatura (o servidor já verificou; aqui é só para a UI). */
export function claimsDoToken(accessToken: string | undefined | null): Record<string, unknown> {
  if (!accessToken) return {}
  try {
    const payload = accessToken.split('.')[1] ?? ''
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function tenantDoToken(accessToken: string | undefined | null): { tenantId: string | null; papel: string | null } {
  const claims = claimsDoToken(accessToken)
  const meta = (claims.app_metadata ?? {}) as Record<string, unknown>
  const tenantId = typeof meta.tenant_id === 'string' && meta.tenant_id ? meta.tenant_id : null
  const papel = typeof meta.role === 'string' && meta.role ? meta.role : null
  return { tenantId, papel }
}
