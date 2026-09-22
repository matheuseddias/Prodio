// Preferências de notificação (tabela `notification_settings`, uma linha por tenant).
//
// A tabela tem escrita direta para admin (policy notification_settings_write, migration
// 20260921000900) e guarda tudo num jsonb. Quem dispara o aviso é o worker — e ele ainda NÃO lê
// esta tabela: nada é enviado hoje. Por isso a tela grava de verdade e diz, na própria tela, que o
// envio não está ligado. O que não pode acontecer é o que acontecia antes: quatro webhooks de
// exemplo exibidos como se o cliente já os tivesse cadastrado, e um "Salvo" sem escrita nenhuma.
import { checar } from './erros'
import { clienteSupabase, modoDados } from './supabaseClient'

export interface WebhookChat {
  id: string
  nome: string
  url: string
}

/** Por evento: e-mail ligado e/ou id do espaço de chat que recebe. */
export interface PreferenciaEvento {
  email?: boolean
  chat?: string
}

export interface ConfigNotificacoes {
  eventos: Record<string, PreferenciaEvento>
  webhooks: WebhookChat[]
}

export const CONFIG_NOTIFICACOES_VAZIA: ConfigNotificacoes = { eventos: {}, webhooks: [] }

function normalizar(bruto: unknown): ConfigNotificacoes {
  const c = (bruto ?? {}) as { eventos?: unknown; webhooks?: unknown }
  const eventos = typeof c.eventos === 'object' && c.eventos ? (c.eventos as Record<string, PreferenciaEvento>) : {}
  const webhooks = Array.isArray(c.webhooks) ? (c.webhooks as WebhookChat[]).filter((w) => w && typeof w.id === 'string') : []
  return { eventos, webhooks }
}

export async function lerConfigNotificacoes(): Promise<ConfigNotificacoes> {
  if (modoDados() === 'memoria') return CONFIG_NOTIFICACOES_VAZIA
  const res = await clienteSupabase().from('notification_settings').select('config').maybeSingle()
  const row = checar(res) as { config: unknown } | null
  return normalizar(row?.config)
}

export async function salvarConfigNotificacoes(tenantId: string | null, config: ConfigNotificacoes): Promise<void> {
  if (modoDados() === 'memoria') return
  if (!tenantId) throw new Error('Sua conta não está vinculada a nenhuma empresa.')
  checar(await clienteSupabase().from('notification_settings').upsert({ tenant_id: tenantId, config, updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' }))
}
