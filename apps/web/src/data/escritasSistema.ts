// Escritas de sistema e comercial: avisos, conectores, outbox, membros, aparelhos, operadores,
// empresa, canais e preços. RPCs conforme docs/schema.md (0001, 0002, 0008, 0009).
import type { Channel, Connector, Device, Member, Tenant } from '../domain/types'
import { checar } from './erros'
import { carregarFatias } from './fatias'
import { channelParaBanco, connectorConfigParaBanco, perfilParaBanco, tenantParaBanco } from './mapeadores'
import { ehUuid, type OperadorInput, type Patch } from './repo'
import { rpc, type Ctx } from './supabaseCtx'

export async function markNotification(ctx: Ctx, id: string): Promise<Patch> {
  checar(await ctx.sb.from('notifications').update({ lida: true }).eq('id', id).eq('tenant_id', ctx.tenantId()))
  return carregarFatias(ctx, ['notifications'])
}

export async function setConnector(ctx: Ctx, c: Connector): Promise<Patch> {
  await rpc(ctx, 'upsert_connector', { p_tenant_id: ctx.tenantId(), p_id: ehUuid(c.id) ? c.id : null, p_plataforma: c.plataforma, p_nome: c.nome, p_config: connectorConfigParaBanco(c) })
  return carregarFatias(ctx, ['connectors', 'outbox'])
}

/** Item em erro volta a 'pendente' pela RPC retry_outbox; o worker aplica no próximo ciclo. */
export async function retryOutbox(ctx: Ctx, id: string): Promise<Patch> {
  await rpc(ctx, 'retry_outbox', { p_tenant_id: ctx.tenantId(), p_id: Number(id) })
  return carregarFatias(ctx, ['outbox', 'connectors'])
}

export async function upsertMember(ctx: Ctx, m: Member): Promise<Patch> {
  if (!ehUuid(m.id)) throw new Error('Convite por e-mail ainda não está disponível: o usuário precisa entrar uma vez para aparecer aqui.')
  checar(await ctx.sb.from('memberships').upsert({ tenant_id: ctx.tenantId(), user_id: m.id, role: m.papel, location_id: m.localId ?? null, nome: m.nome }, { onConflict: 'tenant_id,user_id' }))
  return carregarFatias(ctx, ['members'])
}

export async function removeMember(ctx: Ctx, id: string): Promise<Patch> {
  checar(await ctx.sb.from('memberships').delete().eq('tenant_id', ctx.tenantId()).eq('user_id', id))
  return carregarFatias(ctx, ['members'])
}

interface DeviceJson {
  device_id: string
  pair_code: string
}
/** Cria o aparelho e devolve o código de pareamento num aviso (a tela de configurações mostra a lista pelo store). */
export async function upsertDevice(ctx: Ctx, d: Device): Promise<Patch> {
  if (ehUuid(d.id) && ctx.estado().devices.some((x) => x.id === d.id)) {
    checar(await ctx.sb.from('devices').update({ nome: d.nome, location_id: d.localId || null }).eq('id', d.id).eq('tenant_id', ctx.tenantId()))
    return carregarFatias(ctx, ['devices'])
  }
  const rows = await rpc<DeviceJson[]>(ctx, 'create_device', { p_tenant_id: ctx.tenantId(), p_nome: d.nome, p_location_id: ehUuid(d.localId) ? d.localId : null })
  const r = rows?.[0]
  const patch = await carregarFatias(ctx, ['devices', 'notifications'])
  if (r) {
    const aviso = { id: `pareamento-${r.device_id}`, tipo: 'cadastro' as const, texto: `Código de pareamento de "${d.nome}": ${r.pair_code} (vale por 1 hora). Digite no aparelho em Modo chão de fábrica.`, em: new Date().toISOString(), lida: false }
    patch.notifications = [aviso, ...(patch.notifications ?? ctx.estado().notifications)]
  }
  return patch
}

export async function removeDevice(ctx: Ctx, id: string): Promise<Patch> {
  await rpc(ctx, 'revoke_device', { p_device_id: id })
  return carregarFatias(ctx, ['devices', 'members'])
}

export async function upsertOperator(ctx: Ctx, o: OperadorInput): Promise<Patch> {
  await rpc(ctx, 'upsert_operator', { p_tenant_id: ctx.tenantId(), p_id: ehUuid(o.id) ? o.id : null, p_nome: o.nome, p_pin: o.pin ?? null })
  return carregarFatias(ctx, ['operators'])
}

export async function setTenant(ctx: Ctx, t: Tenant): Promise<Patch> {
  const tenant = ctx.tenantId()
  checar(await ctx.sb.from('tenants').update(tenantParaBanco(t)).eq('id', tenant))
  const familias = t.perfisEtiqueta.map((p) => p.familia)
  if (t.perfisEtiqueta.length) checar(await ctx.sb.from('label_profiles').upsert(t.perfisEtiqueta.map((p) => perfilParaBanco(tenant, p)), { onConflict: 'tenant_id,familia' }))
  const del = ctx.sb.from('label_profiles').delete().eq('tenant_id', tenant)
  checar(await (familias.length ? del.not('familia', 'in', `(${familias.map((f) => `"${f.replace(/"/g, '')}"`).join(',')})`) : del))
  return carregarFatias(ctx, ['tenant'])
}

export async function upsertChannel(ctx: Ctx, c: Channel): Promise<Patch> {
  await rpc(ctx, 'upsert_channel', { p_tenant_id: ctx.tenantId(), p_id: ehUuid(c.id) ? c.id : null, p_channel: channelParaBanco(ctx.tenantId(), c) })
  return carregarFatias(ctx, ['channels'])
}

export async function removeChannel(ctx: Ctx, id: string): Promise<Patch> {
  await rpc(ctx, 'remove_channel', { p_tenant_id: ctx.tenantId(), p_id: id })
  return carregarFatias(ctx, ['channels', 'products'])
}

export async function setPrecoVenda(ctx: Ctx, productId: string, channelId: string, preco: number | undefined): Promise<Patch> {
  await rpc(ctx, 'set_product_price', { p_tenant_id: ctx.tenantId(), p_product_id: productId, p_channel_id: channelId, p_preco: preco ?? null })
  return carregarFatias(ctx, ['products'])
}
