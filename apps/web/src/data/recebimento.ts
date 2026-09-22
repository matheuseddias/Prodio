// Escritas do recebimento que não cabem no Repo.
//
// `nfe_inbound.motivo_ignorada` existe no banco e a RPC `upsert_nfe_inbound` aceita o campo, mas o
// tipo `NfeInbound` (packages/core) não tem onde guardá-lo — então o motivo digitado ao ignorar uma
// nota não tinha como passar pelo store e sumia com o modal. Quem abrisse a nota depois (ou a
// contabilidade) não saberia por que ela foi descartada. Aqui ele é gravado direto pela RPC.
//
// A chamada manda só o que muda: a RPC faz `coalesce(excluded.x, nfe_inbound.x)` campo a campo, de
// modo que o resto da nota fica como está. `origem` vai junto porque é o único campo que a RPC
// sobrescreve quando o valor atual é 'sem_xml'.
import type { NfeInbound } from '../domain/types'
import { checar } from './erros'
import { clienteSupabase, modoDados } from './supabaseClient'

export async function registrarMotivoIgnorada(tenantId: string | null, nfe: NfeInbound, motivo: string): Promise<void> {
  const texto = motivo.trim()
  if (!texto || modoDados() === 'memoria' || !tenantId) return
  checar(
    await clienteSupabase().rpc('upsert_nfe_inbound', {
      p_tenant_id: tenantId,
      p_nfe: { chave: nfe.chave, status: 'ignorada', motivo_ignorada: texto, origem: nfe.origem },
      p_itens: [],
    }),
  )
}
