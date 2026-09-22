// Registro de aparelho do chão de fábrica.
//
// O código de pareamento nasce na RPC `create_device` e vale por 1 hora; `pair_code` nunca sai pela
// tabela (docs/arquitetura.md, seção 2.11), então este é o único momento em que ele pode ser lido.
// Por isso a tela cria o aparelho primeiro e só depois mostra o código: gerar um número no navegador
// antes (o que a tela fazia com Math.random) produzia um código que o aparelho nunca aceitaria.
import { checar } from './erros'
import { ehUuid } from './repo'
import { clienteSupabase, modoDados } from './supabaseClient'

export interface AparelhoCriado {
  deviceId: string
  /** 8 caracteres, maiúsculos. Digitado em /chao para parear. Expira em 1 hora. */
  pairCode: string
}

/** Minutos de validade do código, conforme a RPC create_device. */
export const VALIDADE_PAREAMENTO_MIN = 60

export async function criarDispositivo(tenantId: string | null, nome: string, localId?: string): Promise<AparelhoCriado> {
  if (modoDados() === 'memoria') return { deviceId: `dev-${Date.now().toString(36)}`, pairCode: 'DEMO0000' }
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  const res = await clienteSupabase().rpc('create_device', { p_tenant_id: tenantId, p_nome: nome, p_location_id: ehUuid(localId) ? localId : null })
  const linhas = checar(res) as { device_id: string; pair_code: string }[] | null
  const r = Array.isArray(linhas) ? linhas[0] : null
  if (!r) throw new Error('O banco não devolveu o código de pareamento. Confira a lista de aparelhos antes de tentar de novo.')
  return { deviceId: r.device_id, pairCode: r.pair_code }
}
