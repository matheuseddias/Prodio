// Campo de quantidade inteira da Linha de hoje: edita um rascunho e só grava ao sair do campo (ou Enter).
import { useState } from 'react'
import { cx } from '../../ui'

export default function QtyInput({ value, onCommit, highlight, label = 'Projetado' }: { value: number; onCommit: (v: number) => void; highlight?: boolean; label?: string }) {
  const [draft, setDraft] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(String(value))
  }
  const commit = () => {
    const v = Math.max(0, Math.round(Number(draft) || 0))
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx(
        'h-8 w-20 rounded-md border bg-surface px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent',
        highlight ? 'border-ok bg-ok-soft' : 'border-border',
      )}
      aria-label={label}
    />
  )
}
