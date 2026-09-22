// Notificações: matriz eventos × canais, guardada em `notification_settings` (data/notificacoes.ts).
//
// A lista de espaços começa vazia de propósito: as quatro URLs que apareciam aqui eram inventadas e
// pareciam já cadastradas pelo cliente. O envio em si é do worker, que ainda não lê esta tabela —
// e a tela diz isso em vez de deixar o dono acreditando que será avisado.
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../app/auth'
import { mensagemErro } from '../../data/erros'
import { lerConfigNotificacoes, salvarConfigNotificacoes, type ConfigNotificacoes, type WebhookChat } from '../../data/notificacoes'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, Input, Select, Toggle, cx } from '../../ui'
import { uid } from './ConfigConst'
import { Nota } from './ConectorCard'
import { SaveBar } from './ConfigShared'

const EVENTOS = [
  { id: 'minimo', label: 'Insumo cruzou o mínimo' },
  { id: 'oc_atrasada', label: 'OC atrasada' },
  { id: 'nfe', label: 'NF-e sem De-Para' },
  { id: 'outbox', label: 'Outbox com erro' },
  { id: 'auditor', label: 'Divergência do auditor' },
  { id: 'inventario', label: 'Divergência de inventário' },
] as const
type EventoId = (typeof EVENTOS)[number]['id']

const CHAT_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\//

export default function ConfigNotificacoes() {
  const { modo } = useStore()
  const { tenantId } = useAuth()
  const [cfg, setCfg] = useState<ConfigNotificacoes>({ eventos: {}, webhooks: [] })
  const [carregando, setCarregando] = useState(modo === 'supabase')
  const [erro, setErro] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (modo !== 'supabase') return
    let ativo = true
    void lerConfigNotificacoes()
      .then((c) => ativo && setCfg(c))
      .catch((e) => ativo && setErro(mensagemErro(e)))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [modo])

  const webhooks = cfg.webhooks
  const webhooksInvalidos = webhooks.filter((w) => !w.nome.trim() || !CHAT_RE.test(w.url)).length
  const preferencia = (ev: EventoId) => cfg.eventos[ev] ?? {}

  const mudar = (fn: (c: ConfigNotificacoes) => ConfigNotificacoes) => {
    setCfg(fn)
    setDirty(true)
  }
  const setEvento = (ev: EventoId, delta: { email?: boolean; chat?: string }) =>
    mudar((c) => ({ ...c, eventos: { ...c.eventos, [ev]: { ...(c.eventos[ev] ?? {}), ...delta } } }))
  const patchWebhook = (id: string, delta: Partial<WebhookChat>) => mudar((c) => ({ ...c, webhooks: c.webhooks.map((w) => (w.id === id ? { ...w, ...delta } : w)) }))
  const removerWebhook = (id: string) =>
    mudar((c) => ({
      webhooks: c.webhooks.filter((w) => w.id !== id),
      eventos: Object.fromEntries(Object.entries(c.eventos).map(([k, v]) => [k, v.chat === id ? { ...v, chat: undefined } : v])),
    }))

  return (
    <Card title="Notificações">
      <Nota tone="warn">
        As escolhas abaixo ficam guardadas na empresa, mas o envio ainda não está ligado: quem dispara e-mail e mensagem no Google Chat é o worker, e ele ainda não lê estas preferências. Não
        conte com elas para ser avisado de insumo no mínimo ou de erro no outbox.
      </Nota>
      {erro && <p className="mt-3 text-[13px] text-danger">{erro}</p>}
      {carregando ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Lendo as preferências…
        </div>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto -mx-5 px-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-[12px] uppercase tracking-wide text-muted">
                  <th className="py-2 text-left font-medium">Evento</th>
                  <th className="py-2 text-center font-medium">E-mail</th>
                  <th className="py-2 text-left font-medium">Google Chat (espaço)</th>
                  <th className="py-2 text-center font-medium">
                    WhatsApp
                    <Badge tone="neutral" className="ml-1.5 normal-case tracking-normal">
                      em breve
                    </Badge>
                  </th>
                </tr>
              </thead>
              <tbody>
                {EVENTOS.map((ev) => (
                  <tr key={ev.id} className="border-t border-border/70">
                    <td className="py-3 pr-3">{ev.label}</td>
                    <td className="py-3 text-center">
                      <Toggle checked={!!preferencia(ev.id).email} onChange={(v) => setEvento(ev.id, { email: v })} />
                    </td>
                    <td className="py-3 pr-3">
                      <Select value={preferencia(ev.id).chat ?? ''} onChange={(e) => setEvento(ev.id, { chat: e.target.value || undefined })} className="h-9 max-w-[200px]">
                        <option value="">Não enviar</option>
                        {webhooks.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.nome || 'Sem nome'}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-3 text-center">
                      <span className={cx('inline-flex', 'opacity-40 pointer-events-none')}>
                        <Toggle checked={false} onChange={() => {}} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Espaços do Google Chat</div>
                <p className="mt-0.5 text-[12px] text-muted">Um webhook de entrada por espaço. Crie o webhook no espaço (Apps e integrações → Webhooks) e cole a URL.</p>
              </div>
              <Button size="sm" onClick={() => mudar((c) => ({ ...c, webhooks: [...c.webhooks, { id: uid(), nome: '', url: '' }] }))}>
                <Plus size={14} /> Adicionar espaço
              </Button>
            </div>
            <ul className="mt-3 space-y-2">
              {webhooks.map((w) => {
                const urlOk = CHAT_RE.test(w.url)
                return (
                  <li key={w.id} className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-start">
                    <Input value={w.nome} placeholder="Nome do espaço" onChange={(e) => patchWebhook(w.id, { nome: e.target.value })} className="h-9" />
                    <div>
                      <Input
                        value={w.url}
                        placeholder="https://chat.googleapis.com/v1/spaces/…/messages?key=…"
                        onChange={(e) => patchWebhook(w.id, { url: e.target.value.trim() })}
                        className={cx('h-9 font-mono text-[12px]', w.url && !urlOk && 'border-danger')}
                      />
                      {w.url && !urlOk && <div className="mt-1 text-[11px] text-danger">A URL precisa começar com https://chat.googleapis.com/v1/spaces/</div>}
                    </div>
                    <Button size="sm" variant="ghost" className="h-9 text-danger" onClick={() => removerWebhook(w.id)} aria-label={`Remover ${w.nome || 'espaço'}`}>
                      <Trash2 size={14} />
                    </Button>
                  </li>
                )
              })}
              {webhooks.length === 0 && <li className="text-[13px] text-muted">Nenhum espaço cadastrado.</li>}
            </ul>
          </div>

          <SaveBar
            dirty={dirty && webhooksInvalidos === 0}
            aviso={webhooksInvalidos > 0 ? `${webhooksInvalidos} ${webhooksInvalidos === 1 ? 'espaço sem nome ou URL válida' : 'espaços sem nome ou URL válida'}` : undefined}
            onSave={async () => {
              await salvarConfigNotificacoes(tenantId, cfg)
              setDirty(false)
            }}
          />
        </>
      )}
    </Card>
  )
}
