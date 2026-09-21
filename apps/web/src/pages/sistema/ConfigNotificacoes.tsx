// Notificações: matriz eventos × canais. Sem campo no Tenant ainda: estado local com SaveBar.
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, Input, Select, Toggle, cx } from '../../ui'
import { uid } from './ConfigConst'
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

interface Webhook {
  id: string
  nome: string
  url: string
}
const CHAT_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\//
const WEBHOOKS_INICIAIS: Webhook[] = [
  { id: 'w1', nome: 'Compras', url: 'https://chat.googleapis.com/v1/spaces/AAAAcompras/messages?key=…' },
  { id: 'w2', nome: 'Produção', url: 'https://chat.googleapis.com/v1/spaces/AAAAproducao/messages?key=…' },
  { id: 'w3', nome: 'Financeiro', url: 'https://chat.googleapis.com/v1/spaces/AAAAfinanceiro/messages?key=…' },
  { id: 'w4', nome: 'Cadastro', url: 'https://chat.googleapis.com/v1/spaces/AAAAcadastro/messages?key=…' },
]
const EMAIL_INICIAL: Partial<Record<EventoId, boolean>> = { minimo: true, oc_atrasada: true, nfe: true, outbox: true }
const CHAT_INICIAL: Partial<Record<EventoId, string>> = { minimo: 'w1', oc_atrasada: 'w1', nfe: 'w3', outbox: 'w4', auditor: 'w2', inventario: 'w2' }

export default function ConfigNotificacoes() {
  const [email, setEmail] = useState(EMAIL_INICIAL)
  const [chat, setChat] = useState(CHAT_INICIAL)
  const [webhooks, setWebhooks] = useState<Webhook[]>(WEBHOOKS_INICIAIS)
  const [dirty, setDirty] = useState(false)
  const touch = () => setDirty(true)
  const webhooksInvalidos = webhooks.filter((w) => !w.nome.trim() || !CHAT_RE.test(w.url)).length

  const setChatDe = (ev: EventoId, id: string) => {
    setChat((s) => ({ ...s, [ev]: id || undefined }))
    touch()
  }
  const patchWebhook = (id: string, delta: Partial<Webhook>) => {
    setWebhooks((ws) => ws.map((w) => (w.id === id ? { ...w, ...delta } : w)))
    touch()
  }
  const removerWebhook = (id: string) => {
    setWebhooks((ws) => ws.filter((w) => w.id !== id))
    setChat((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== id)))
    touch()
  }

  return (
    <Card title="Notificações">
      <div className="overflow-x-auto -mx-5 px-5">
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
                  <Toggle
                    checked={!!email[ev.id]}
                    onChange={(v) => {
                      setEmail((s) => ({ ...s, [ev.id]: v }))
                      touch()
                    }}
                  />
                </td>
                <td className="py-3 pr-3">
                  <Select value={chat[ev.id] ?? ''} onChange={(e) => setChatDe(ev.id, e.target.value)} className="h-9 max-w-[200px]">
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
          <Button
            size="sm"
            onClick={() => {
              setWebhooks((ws) => [...ws, { id: uid(), nome: '', url: '' }])
              touch()
            }}
          >
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
          {webhooks.length === 0 && <li className="text-[13px] text-muted">Nenhum espaço. Adicione um para enviar avisos ao Google Chat.</li>}
        </ul>
      </div>

      <SaveBar
        dirty={dirty && webhooksInvalidos === 0}
        aviso={webhooksInvalidos > 0 ? `${webhooksInvalidos} ${webhooksInvalidos === 1 ? 'espaço sem nome ou URL válida' : 'espaços sem nome ou URL válida'}` : undefined}
        onSave={() => setDirty(false)}
      />
    </Card>
  )
}
