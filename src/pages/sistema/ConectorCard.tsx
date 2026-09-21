import { AlertTriangle, Check, Info, Plug, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { num, relativo } from '../../domain/format'
import type { Connector } from '../../domain/types'
import { Badge, Button, Card, cx } from '../../ui'
import { CAPS, META, STATUS_LABEL, STATUS_TONE, type Plataforma } from './ConectorMeta'

export function Logo({ p, size = 'md' }: { p: Plataforma; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg font-bold text-white', META[p].cor, size === 'md' ? 'h-10 w-10 text-sm' : 'h-7 w-7 text-[11px]')}>
      {META[p].iniciais}
    </span>
  )
}

export function Nota({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : Info
  return (
    <div className={cx('flex gap-2 rounded-lg px-3 py-2 text-[13px]', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info')}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// ---------- Cartão ----------
export function ConectorCard({ c, onConnect, onConfig }: { c: Connector; onConnect: () => void; onConfig: () => void }) {
  const m = META[c.plataforma]
  const ativo = c.status === 'conectado'
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo p={c.plataforma} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{c.nome}</div>
            <div className="truncate text-[12px] text-muted">{m.curto}</div>
          </div>
        </div>
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-muted">Último sync</dt>
          <dd className="truncate font-medium">{c.ultimoSync ? relativo(c.ultimoSync) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Pedidos 24h</dt>
          <dd className="font-medium tabular-nums">{c.pedidos24h !== undefined ? num(c.pedidos24h) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Outbox</dt>
          <dd className="font-medium tabular-nums">
            {c.outboxPendentes ? <span className="text-warn">{c.outboxPendentes} pend.</span> : c.status === 'conectado' ? '0' : '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {CAPS.map((cap) => {
          const ok = c.capacidades[cap.key]
          return (
            <span
              key={cap.key}
              title={ok ? 'Suportado' : 'Não suportado'}
              className={cx(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                ok ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-faint line-through decoration-faint/60',
              )}
            >
              {ok && <Check size={11} />}
              {cap.label}
            </span>
          )
        })}
      </div>

      <div className="mt-4 flex gap-2 pt-1">
        {ativo ? (
          <>
            <Button size="sm" onClick={onConfig} className="flex-1">
              <Settings2 size={14} /> Configurar
            </Button>
            <Button size="sm" variant="ghost" onClick={onConnect}>
              Reconectar
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={onConnect} className="flex-1">
              <Plug size={14} /> Conectar
            </Button>
            {c.status === 'erro' && (
              <Button size="sm" variant="ghost" onClick={onConfig}>
                Configurar
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
