// Prévia da web (outro branch) contra o banco de produção antes de main publicar a 20260926000700: sem a tabela
// label_sizes e sem label_profiles.label_size_id. A tela tem de carregar com os tamanhos de fábrica e a gravação dos
// perfis não pode mandar a coluna nova.
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { lerTenant } from './leituras'
import { perfilParaBanco } from './mapeadores'
import { novosMapas, type Ctx } from './supabaseCtx'
import { lerLabelSizes } from './tamanhosEtiqueta'

const T = '11111111-1111-1111-1111-111111111111'
const TENANT = { id: T, nome: 'Eddias', cnpj: '1', regime: 'real', credita_impostos: false, hora_virada: '05:00:00', dias_uteis_mes: 22, margem_projecao: 0.1, dias_cobertura: 15, margem_alvo_padrao: 0.2, exigir_projecao_para_imprimir: true }
const PERFIL = { familia: 'Espelho', prefixo: 'EH', tipos: ['produto'], unidades_por_caixa: 6, instrucao_montagem: null }

/** PostgREST falso de um banco sem a migration: select com coluna/tabela nova devolve erro. */
function bancoAntigo(): SupabaseClient {
  const consulta = (tabela: string) => {
    let colunas = ''
    const q = {
      select: (c: string) => ((colunas = c), q),
      eq: () => q,
      order: () => q,
      single: () => Promise.resolve(resposta(true)),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resposta(false)).then(ok, erro),
    }
    const resposta = (um: boolean) => {
      if (tabela === 'label_sizes') return { data: null, error: { code: '42P01', message: 'relation "public.label_sizes" does not exist' } }
      if (colunas.includes('label_size_id') || colunas.includes('dias_demanda')) return { data: null, error: { code: '42703', message: 'column does not exist' } }
      if (tabela === 'tenants') return { data: um ? TENANT : [TENANT], error: null }
      if (tabela === 'label_profiles') return { data: [PERFIL], error: null }
      return { data: [], error: null }
    }
    return q
  }
  return { from: consulta } as unknown as SupabaseClient
}

const ctx = (): Ctx => ({ sb: bancoAntigo(), tenantId: () => T, estado: () => ({}) as never, mapas: novosMapas() })

describe('banco sem a migration de tamanhos', () => {
  it('lerLabelSizes devolve lista vazia (a tela usa os tamanhos de fábrica) em vez de derrubar a carga', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await lerLabelSizes(ctx())).toEqual([])
    aviso.mockRestore()
  })
  it('lerTenant relê os perfis sem label_size_id; o perfil fica sem tamanhoId e a gravação não manda a coluna', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = await lerTenant(ctx())
    aviso.mockRestore()
    expect(t.perfisEtiqueta).toHaveLength(1)
    expect(t.perfisEtiqueta[0]).not.toHaveProperty('tamanhoId')
    expect(perfilParaBanco(T, t.perfisEtiqueta[0])).not.toHaveProperty('label_size_id')
  })
})
