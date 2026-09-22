// Locais (fábricas próprias, terceiros e depósitos).
//
// `locations` é uma das poucas tabelas de cadastro com escrita direta liberada ao cliente: a policy
// locations_write exige admin ou produção do tenant e o GRANT existe (migration
// 20260921000100_fundacao.sql). Não há RPC porque não há nada a numerar nem estoque a mover — a RLS
// dá conta. Por isso esta tela escreve por `from('locations')` e não pelo Repo.
import type { Location } from '../domain/types'
import { checar } from './erros'
import { ehUuid } from './repo'
import { clienteSupabase, modoDados } from './supabaseClient'

/** Cria ou renomeia um local. Devolve o id (novo ou o mesmo). */
export async function salvarLocal(tenantId: string | null, local: Location): Promise<string> {
  if (modoDados() === 'memoria') return local.id || `loc-${Date.now().toString(36)}`
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  const nome = local.nome.trim()
  if (!nome) throw new Error('O local precisa de um nome.')
  const sb = clienteSupabase()
  if (ehUuid(local.id)) {
    checar(await sb.from('locations').update({ nome, kind: local.tipo }).eq('id', local.id).eq('tenant_id', tenantId))
    return local.id
  }
  const res = await sb.from('locations').insert({ tenant_id: tenantId, nome, kind: local.tipo }).select('id').single()
  return (checar(res) as { id: string }).id
}

/**
 * Desativa o local. Não é DELETE: aparelhos, membros e movimentos de estoque apontam para ele, e o
 * histórico tem de continuar legível. A leitura do store só traz `ativo = true`.
 */
export async function desativarLocal(tenantId: string | null, id: string): Promise<void> {
  if (modoDados() === 'memoria') return
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  checar(await clienteSupabase().from('locations').update({ ativo: false }).eq('id', id).eq('tenant_id', tenantId))
}
