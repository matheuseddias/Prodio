// Componentes compartilhados pelas abas de Configurações.
import { Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../../ui'

export function SaveBar({ onSave, dirty, aviso }: { onSave: () => void; dirty: boolean; aviso?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
      {aviso && <span className="text-[13px] text-warn">{aviso}</span>}
      {ok && (
        <span className="inline-flex items-center gap-1 text-[13px] text-ok">
          <Check size={14} /> Salvo
        </span>
      )}
      <Button
        variant="primary"
        disabled={!dirty}
        onClick={() => {
          onSave()
          setOk(true)
          window.setTimeout(() => setOk(false), 1500)
        }}
      >
        Salvar alterações
      </Button>
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 border-b border-border/70 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6 sm:items-start">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
