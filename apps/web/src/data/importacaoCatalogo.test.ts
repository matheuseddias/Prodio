// Camada de dados da importação do ES: a chamada à RPC import_catalog e a leitura da resposta.
import type { PayloadImportacao, ResultadoImportacao } from '@prodio/core/importacaoEs'
import { planejar } from '@prodio/core/importacaoEs/fixtura'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { snapshotExemplo } from './memoryRepo'
import { importarCatalogo, LIMITE_PAYLOAD_BYTES, tamanhoPayload } from './importacaoCatalogo'
import { novosMapas, type Ctx } from './supabaseCtx'

const TENANT = '11111111-1111-1111-1111-111111111111'
const contagens = () =>
  Object.fromEntries(['fornecedor', 'insumo', 'produto', 'apelido', 'vinculo', 'ficha'].map((e) => [e, { novos: 1, atualizados: 0, iguais: 0, problemas: 0 }])) as ResultadoImportacao['contagens']
const resposta = (simulacao: boolean) => ({
  simulacao,
  exemplo: { produtos: 0, insumos: 0, fornecedores: 0 },
  uso_real: { conectores_ligados: 1, pedidos_reais: 40 },
  contagens: contagens(),
  linhas: [{ entidade: 'produto', chave: 'ED900001', situacao: 'novo' }],
  itens_pedido_religados: 12,
})

/** Cliente falso: guarda as chamadas de rpc e devolve o que o teste mandar. */
function ctxFalso(responder: (args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const chamadas: { nome: string; args: Record<string, unknown> }[] = []
  const sb = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args })
      return responder(args)
    },
  } as unknown as SupabaseClient
  const ctx: Ctx = { sb, tenantId: () => TENANT, estado: snapshotExemplo, mapas: novosMapas() }
  return { ctx, chamadas }
}

describe('importarCatalogo (SupabaseRepo)', () => {
  const payload: PayloadImportacao = planejar().payload

  it('manda só o payload montado pelo core, o tenant ativo e a simulação', async () => {
    const { ctx, chamadas } = ctxFalso((a) => ({ data: resposta(a.p_dry_run as boolean), error: null }))
    const r = await importarCatalogo(ctx, payload, true)
    expect(chamadas).toEqual([{ nome: 'import_catalog', args: { p_tenant_id: TENANT, p_payload: payload, p_dry_run: true } }])
    expect(r.simulacao).toBe(true)
    expect(r.linhas).toEqual([{ entidade: 'produto', chave: 'ED900001', situacao: 'novo' }])
    expect(r.itensPedidoReligados).toBe(12)
    expect(r.usoReal).toEqual({ conectoresLigados: 1, pedidosReais: 40 })
    await importarCatalogo(ctx, payload, false)
    expect(chamadas[1].args.p_dry_run).toBe(false)
  })

  it('resposta fora do contrato vira erro (nunca uma prévia inventada)', async () => {
    const { ctx } = ctxFalso(() => ({ data: { simulacao: true, linhas: [] }, error: null }))
    await expect(importarCatalogo(ctx, payload, true)).rejects.toThrow(/formato inesperado/)
  })

  it('servidor que responde gravação quando se pediu simulação é recusado', async () => {
    const { ctx } = ctxFalso(() => ({ data: resposta(false), error: null }))
    await expect(importarCatalogo(ctx, payload, true)).rejects.toThrow(/simulação trocada/)
  })

  it.each([
    [{ code: '55000', message: 'remova os dados de exemplo antes de importar (supabase/dist/limpar_exemplo.sql)' }, 'remova os dados de exemplo antes de importar (supabase/dist/limpar_exemplo.sql)'],
    [
      { code: '55000', message: 'remova os dados de exemplo antes de importar: o Prodio já tem conector ligado ou pedido real, então rode supabase/dist/limpar_so_exemplo.sql (limpar_exemplo.sql apagaria a integração e os pedidos)' },
      'rode supabase/dist/limpar_so_exemplo.sql',
    ],
    [{ code: '42501', message: 'permission denied' }, 'Sem permissão para esta operação.'],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'O banco demorou demais e cancelou a operação: nada foi gravado. Tente de novo.'],
    [{ code: '22023', message: 'payload inválido: chave desconhecida usuarios' }, 'payload inválido: chave desconhecida usuarios'],
    // O que o PostgREST 12.2.3 devolve (503) quando o processo do banco morre no meio da import_catalog (prova e2e).
    [{ code: 'PGRST001', message: 'Database client error. Retrying the connection.', details: 'no connection to the server\n' }, 'O servidor perdeu a conexão com o banco no meio da operação. Tente de novo em instantes.'],
    [{ code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }, 'O banco está ocupado demais agora. Tente de novo em instantes.'],
  ])('erro do banco sai em português (%o)', async (erro, texto) => {
    const { ctx } = ctxFalso(() => ({ data: null, error: erro }))
    await expect(importarCatalogo(ctx, payload, false)).rejects.toThrow(texto)
  })

  it('payload acima de 5 MB é recusado antes de ir ao banco', async () => {
    const { ctx, chamadas } = ctxFalso(() => ({ data: resposta(true), error: null }))
    const grande: PayloadImportacao = { ...payload, produtos: Array.from({ length: 4000 }, (_, i) => ({ ...payload.produtos[0], sku: `ED${i}`, nome: 'x'.repeat(1400) })) }
    expect(tamanhoPayload(grande)).toBeGreaterThan(LIMITE_PAYLOAD_BYTES)
    await expect(importarCatalogo(ctx, grande, true)).rejects.toThrow(/5 MB/)
    expect(chamadas).toEqual([])
  })
})
