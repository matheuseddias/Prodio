// Autenticação do chão de fábrica no Supabase: o aparelho entra anônimo, é pareado uma vez
// pelo código gerado no escritório (register_device) e o operador se identifica pelo PIN (set_operator).
import type { SupabaseClient } from '@supabase/supabase-js'
import { mensagemErro } from './erros'

export interface AparelhoInfo {
  id: string
  nome: string
}

/** Aparelho registrado para o usuário anônimo desta sessão (null quando ainda não pareado). */
export async function aparelhoRegistrado(sb: SupabaseClient, userId: string): Promise<AparelhoInfo | null> {
  const res = await sb.from('devices').select('id,nome').eq('device_user_id', userId).is('revoked_at', null).maybeSingle()
  if (res.error) throw new Error(mensagemErro(res.error))
  return (res.data as AparelhoInfo | null) ?? null
}

export async function parearAparelho(sb: SupabaseClient, codigo: string): Promise<string> {
  const res = await sb.rpc('register_device', { p_pair_code: codigo.trim().toUpperCase() })
  if (res.error) throw new Error(mensagemErro(res.error))
  return res.data as string
}

export interface OperadorSessao {
  operatorId: string
  nome: string
  expiraEm: string
}

export async function entrarComPin(sb: SupabaseClient, pin: string): Promise<OperadorSessao> {
  const res = await sb.rpc('set_operator', { p_pin: pin })
  if (res.error) throw new Error(mensagemErro(res.error))
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { operator_id: string; nome: string; expires_at: string } | undefined
  if (!row) throw new Error('PIN inválido')
  return { operatorId: row.operator_id, nome: row.nome, expiraEm: row.expires_at }
}

const CHAVE = 'prodio.dispositivo'
export function lembrarDispositivo(nome: string) {
  try {
    sessionStorage.setItem(CHAVE, nome)
    localStorage.setItem(CHAVE, nome)
  } catch {
    /* ignora */
  }
}
export function dispositivoLembrado(padrao = 'Celular linha 1'): string {
  try {
    return sessionStorage.getItem(CHAVE) || localStorage.getItem(CHAVE) || padrao
  } catch {
    return padrao
  }
}
