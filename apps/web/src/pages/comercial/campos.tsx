import { useState } from 'react'
import { num } from '../../domain/format'
import { Badge, cx } from '../../ui'
import { parseNumBR, pctBR, toneMargem } from './precoUtils'

export function MargemBadge({ margem, alvo, className }: { margem: number; alvo: number; className?: string }) {
  return (
    <Badge tone={toneMargem(margem, alvo)} className={className}>
      {pctBR(margem)}
    </Badge>
  )
}

/**
 * Campo numérico com rascunho local: aceita vírgula ou ponto, confirma no blur/Enter.
 * `value` undefined mostra vazio; `onCommit(undefined)` quando o usuário limpa o campo.
 */
export function NumInput({
  value,
  onCommit,
  casas = 2,
  className,
  placeholder,
  prefix,
  suffix,
  min,
  allowEmpty = false,
  highlight,
  ariaLabel,
  autoFocus,
}: {
  value: number | undefined
  onCommit: (v: number | undefined) => void
  casas?: number
  className?: string
  placeholder?: string
  prefix?: string
  suffix?: string
  min?: number
  allowEmpty?: boolean
  highlight?: boolean
  ariaLabel?: string
  autoFocus?: boolean
}) {
  const fmt = (v: number | undefined) => (v === undefined ? '' : num(v, casas))
  const [draft, setDraft] = useState(fmt(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(fmt(value))
  }
  const commit = () => {
    if (draft.trim() === '') {
      if (allowEmpty) {
        setDraft('')
        if (value !== undefined) onCommit(undefined)
      } else setDraft(fmt(value))
      return
    }
    const n = parseNumBR(draft)
    if (Number.isNaN(n)) {
      setDraft(fmt(value))
      return
    }
    const v = Math.round(Math.max(min ?? -Infinity, n) * 10 ** casas) / 10 ** casas
    setDraft(fmt(v))
    if (v !== value) onCommit(v)
  }
  return (
    <span className={cx('inline-flex items-center gap-1', className)}>
      {prefix && <span className="text-[12px] text-muted">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={cx(
          'h-8 w-full min-w-0 rounded-md border bg-surface px-2 text-right text-sm tabular-nums placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent',
          highlight ? 'border-ok bg-ok-soft' : 'border-border',
        )}
      />
      {suffix && <span className="text-[12px] text-muted">{suffix}</span>}
    </span>
  )
}
