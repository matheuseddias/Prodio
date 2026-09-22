// De-Para por fornecedor (tabela `supplier_materials`).
//
// O código do item na nota (cProd) é do fornecedor, não do Prodio. Guardar o par
// (fornecedor, cProd) → (insumo, fator) é o que evita refazer o vínculo item por item na próxima
// nota do mesmo fornecedor — com o caminhão parado, no celular. A tela prometia isso e não gravava
// em lugar nenhum: o vínculo morria com a nota.
//
// A tabela tem escrita direta para admin, compras e produção (policy supplier_materials_write) e
// chave única (tenant_id, supplier_id, material_id) — por isso o upsert aponta para essa chave.
import { checar } from './erros'
import { ehUuid } from './repo'
import { clienteSupabase, modoDados } from './supabaseClient'

export interface VinculoFornecedor {
  materialId: string
  fator?: number
}

/** Mapa código do fornecedor → insumo e fator, para pré-preencher o De-Para da próxima nota. */
export async function lerDeParaFornecedor(supplierId: string | undefined): Promise<Record<string, VinculoFornecedor>> {
  if (modoDados() === 'memoria' || !ehUuid(supplierId)) return {}
  const res = await clienteSupabase().from('supplier_materials').select('codigo_fornecedor,material_id,fator').eq('supplier_id', supplierId)
  const linhas = (checar(res) ?? []) as { codigo_fornecedor: string | null; material_id: string; fator: number | string | null }[]
  const out: Record<string, VinculoFornecedor> = {}
  for (const l of linhas) {
    const codigo = (l.codigo_fornecedor ?? '').trim()
    if (!codigo) continue
    const fator = l.fator == null ? undefined : Number(l.fator)
    out[codigo] = { materialId: l.material_id, fator: Number.isFinite(fator) ? fator : undefined }
  }
  return out
}

export interface SalvarVinculo {
  supplierId?: string
  codigo: string
  materialId: string
  fator: number
  unidadeCompra?: string
}

/**
 * Grava o vínculo. Sem fornecedor identificado na nota não há onde guardar — devolve false, e a
 * tela diz que o De-Para vale só para esta nota, em vez de prometer o que não aconteceu.
 */
export async function salvarDeParaFornecedor(tenantId: string | null, v: SalvarVinculo): Promise<boolean> {
  if (modoDados() === 'memoria') return false
  if (!tenantId || !ehUuid(v.supplierId) || !ehUuid(v.materialId) || !v.codigo.trim()) return false
  checar(
    await clienteSupabase()
      .from('supplier_materials')
      .upsert(
        {
          tenant_id: tenantId,
          supplier_id: v.supplierId,
          material_id: v.materialId,
          codigo_fornecedor: v.codigo.trim(),
          unidade_compra: v.unidadeCompra ?? null,
          fator: v.fator,
          ultimo_uso: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,supplier_id,material_id' },
      ),
  )
  return true
}
