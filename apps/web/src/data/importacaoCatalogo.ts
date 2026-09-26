// Importação do cadastro do ES no banco: uma chamada à RPC public.import_catalog (supabase/migrations/
// 20260926000300_import_catalog_fichas.sql). Só admin; tudo numa transação; com simulação (dry-run exato).
//
// O que vai ao servidor é só o PayloadImportacao que o core montou campo a campo a partir do backup: o
// arquivo do ES nunca sai do navegador. A resposta passa por lerResultadoImportacao (o contrato entre
// banco e tela): formato inesperado vira erro, nunca uma prévia inventada.
import { lerResultadoImportacao, type PayloadImportacao, type ResultadoImportacao } from '@prodio/core/importacaoEs'
import type { Parte } from './repo'
import { rpc, type Ctx } from './supabaseCtx'

/** Fatias do Snapshot que a importação muda: relidas depois de gravar. */
export const FATIAS_DO_CATALOGO: Parte[] = ['suppliers', 'materials', 'boms', 'products']

/** Teto do payload na RPC (import_catalog_validate). Conferido antes, para o erro sair em português e sem ida ao banco. */
export const LIMITE_PAYLOAD_BYTES = 5 * 1024 * 1024

export function tamanhoPayload(payload: PayloadImportacao): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

/**
 * Simula (`simular: true`, nada fica gravado) ou grava. Erro do banco (sem permissão, dados de exemplo,
 * payload inválido, tempo esgotado, rede) é lançado com a mensagem em português: nesse caso nada foi gravado.
 */
export async function importarCatalogo(ctx: Ctx, payload: PayloadImportacao, simular: boolean): Promise<ResultadoImportacao> {
  if (tamanhoPayload(payload) > LIMITE_PAYLOAD_BYTES) {
    throw new Error('O cadastro passa de 5 MB e não cabe numa importação só. Avise o suporte do Prodio.')
  }
  const bruto = await rpc(ctx, 'import_catalog', { p_tenant_id: ctx.tenantId(), p_payload: payload, p_dry_run: simular })
  const resultado = lerResultadoImportacao(bruto)
  if (resultado.simulacao !== simular) throw new Error('Resposta da importação em formato inesperado (simulação trocada).')
  return resultado
}
