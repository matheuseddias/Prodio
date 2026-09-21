// Cadastros simples (upsert direto com tenant_id, RLS protege) e compras/NF-e (RPCs das 0006 e 0007).
import type { Material, NfeInbound, Product, PurchaseOrder, Supplier } from '../domain/types'
import { checar } from './erros'
import { carregarFatias } from './fatias'
import { materialParaBanco, nfeItensParaBanco, nfeParaBanco, poItensParaBanco, productParaBanco, supplierParaBanco } from './mapeadores'
import { ehUuid, type Patch, type Retorno } from './repo'
import { localPadraoId, rpc, type Ctx } from './supabaseCtx'

/** Upsert por id quando o id é uuid; senão insere (o id de tela era provisório). */
async function gravar(ctx: Ctx, tabela: string, linha: Record<string, unknown>, id: string): Promise<string> {
  if (ehUuid(id)) {
    checar(await ctx.sb.from(tabela).upsert({ ...linha, id }, { onConflict: 'id' }))
    return id
  }
  const res = await ctx.sb.from(tabela).insert(linha).select('id').single()
  return (checar(res) as { id: string }).id
}

export async function upsertProduct(ctx: Ctx, p: Product): Promise<Patch> {
  const tenant = ctx.tenantId()
  const id = await gravar(ctx, 'products', productParaBanco(tenant, p), p.id)
  // Aliases: substitui o conjunto do produto (escopo explícito, nunca por diferença de memória).
  checar(await ctx.sb.from('sku_aliases').delete().eq('tenant_id', tenant).eq('product_id', id))
  const aliases = [...new Set(p.aliases.map((a) => a.trim()).filter(Boolean))]
  if (aliases.length) checar(await ctx.sb.from('sku_aliases').insert(aliases.map((sku_externo) => ({ tenant_id: tenant, product_id: id, sku_externo }))))
  return carregarFatias(ctx, ['products'])
}

export async function upsertMaterial(ctx: Ctx, m: Material): Promise<Patch> {
  await gravar(ctx, 'materials', materialParaBanco(ctx.tenantId(), m), m.id)
  return carregarFatias(ctx, ['materials'])
}

export async function upsertSupplier(ctx: Ctx, s: Supplier): Promise<Patch> {
  await gravar(ctx, 'suppliers', supplierParaBanco(ctx.tenantId(), s), s.id)
  return carregarFatias(ctx, ['suppliers'])
}

export async function createPurchaseOrder(ctx: Ctx, po: Omit<PurchaseOrder, 'id' | 'numero' | 'criadaEm'>): Promise<Retorno<PurchaseOrder>> {
  const id = await rpc<string>(ctx, 'create_purchase_order', {
    p_tenant_id: ctx.tenantId(),
    p_supplier_id: po.supplierId,
    p_location_id: localPadraoId(ctx),
    p_entrega_prevista: po.entregaPrevista ?? null,
    p_condicao: po.condicaoPagamento.length ? po.condicaoPagamento : [0],
    p_itens: poItensParaBanco(po.itens),
    p_observacao: po.observacao ?? null,
  })
  const patch = await carregarFatias(ctx, ['purchaseOrders'])
  const criada = patch.purchaseOrders?.find((x) => x.id === id)
  if (!criada) throw new Error('Ordem criada, mas não foi possível recarregá-la.')
  return { valor: criada, patch }
}

export async function updatePurchaseOrder(ctx: Ctx, po: PurchaseOrder): Promise<Patch> {
  const atual = ctx.estado().purchaseOrders.find((x) => x.id === po.id)
  // Quantidades recebidas a mais viram um recebimento manual (RPC receive_manual): o banco deriva parcial/recebida.
  const recebidos = po.itens
    .map((it) => ({ purchase_order_item_id: it.id, qtd_compra: it.qtdRecebida - (atual?.itens.find((a) => a.id === it.id)?.qtdRecebida ?? 0) }))
    .filter((it) => it.qtd_compra > 0 && ehUuid(it.purchase_order_item_id))
  if (recebidos.length) {
    await rpc(ctx, 'receive_manual', { p_tenant_id: ctx.tenantId(), p_purchase_order_id: po.id, p_location_id: localPadraoId(ctx), p_itens: recebidos, p_idempotency_key: `web:${crypto.randomUUID()}` })
  }
  // Só cancelar e reabrir são decisões do cliente; parcial/recebida nascem do recebimento.
  if ((po.status === 'cancelada' || po.status === 'aberta') && (!atual || atual.status !== po.status)) {
    await rpc(ctx, 'update_purchase_order_status', { p_tenant_id: ctx.tenantId(), p_id: po.id, p_status: po.status })
  }
  // Campos editáveis fora do status (entrega, condição, observação) ficam no cabeçalho.
  if (atual && (atual.entregaPrevista !== po.entregaPrevista || atual.observacao !== po.observacao || atual.condicaoPagamento.join() !== po.condicaoPagamento.join())) {
    const res = await ctx.sb.from('purchase_orders').update({ entrega_prevista: po.entregaPrevista ?? null, observacao: po.observacao ?? null, condicao_pagamento: po.condicaoPagamento }).eq('id', po.id).eq('tenant_id', ctx.tenantId())
    if (res.error && res.error.code !== '42501') checar(res)
  }
  return carregarFatias(ctx, ['purchaseOrders'])
}

async function idDaNfe(ctx: Ctx, chave: string): Promise<string> {
  let id = ctx.mapas.nfeIds.get(chave)
  if (!id) {
    const res = await ctx.sb.from('nfe_inbound').select('id').eq('tenant_id', ctx.tenantId()).eq('chave', chave).maybeSingle()
    id = (res.data as { id: string } | null)?.id
    if (id) ctx.mapas.nfeIds.set(chave, id)
  }
  if (!id) throw new Error('NF-e não encontrada.')
  return id
}

/** Grava cabeçalho, itens e vínculos com OC pela RPC idempotente (mesma usada pelo worker no e-mail). */
export async function upsertNfe(ctx: Ctx, n: NfeInbound): Promise<Patch> {
  const id = await rpc<string | null>(ctx, 'upsert_nfe_inbound', { p_tenant_id: ctx.tenantId(), p_nfe: nfeParaBanco(n), p_itens: nfeItensParaBanco(n.itens) })
  if (typeof id === 'string') ctx.mapas.nfeIds.set(n.chave, id)
  return carregarFatias(ctx, ['nfes', 'purchaseOrders'])
}

export async function receiveNfe(ctx: Ctx, chave: string, itens: NfeInbound['itens'], porOc: Record<string, number>, opts: { lote: string }): Promise<Patch> {
  const s = ctx.estado()
  const nfe = s.nfes.find((n) => n.chave === chave)
  if (!nfe) throw new Error('NF-e não encontrada.')
  // Garante que os De-Para editados na tela estejam gravados antes de receber.
  await upsertNfe(ctx, { ...nfe, itens })
  const nfeId = await idDaNfe(ctx, chave)
  if (!ctx.mapas.nfeItemIds.has(`${chave}:${itens[0]?.nItem ?? 1}`)) await carregarFatias(ctx, ['nfes'])
  const pos = s.purchaseOrders.filter((po) => nfe.poIds.includes(po.id))
  const usados = new Set<string>()
  const linhas = itens
    .filter((it) => it.materialId && it.qtdConsumo)
    .map((it) => {
      const poItem = pos.flatMap((po) => po.itens).find((pi) => pi.materialId === it.materialId && porOc[pi.id] && !usados.has(pi.id))
      if (poItem) usados.add(poItem.id)
      const itemId = ctx.mapas.nfeItemIds.get(`${chave}:${it.nItem}`)
      if (!itemId) throw new Error(`Item ${it.nItem} da NF-e não está gravado no banco.`)
      return { item_id: itemId, material_id: it.materialId, fator: it.fator ?? 1, qtd_consumo: it.qtdConsumo, purchase_order_item_id: poItem?.id ?? null, divergente: false, motivo: null }
    })
  if (!linhas.length) throw new Error('Nenhum item com De-Para para receber.')
  await rpc(ctx, 'receive_nfe', { p_tenant_id: ctx.tenantId(), p_nfe_id: nfeId, p_location_id: localPadraoId(ctx), p_itens: linhas, p_idempotency_key: `nfe:${chave}:${opts.lote}` })
  return carregarFatias(ctx, ['materials', 'stockMoves', 'purchaseOrders', 'nfes'])
}
