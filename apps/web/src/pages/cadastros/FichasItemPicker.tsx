import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SearchInput, cx } from '../../ui'

export interface OpcaoItem {
  id: string
  sku: string
  nome: string
  extra?: string
}

/** Picker de insumo/produto com busca simples (usado nas linhas da ficha). */
export default function FichasItemPicker({ opcoes, value, onChange, placeholder }: { opcoes: OpcaoItem[]; value?: string; onChange: (id: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const sel = opcoes.find((o) => o.id === value)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const ql = q.trim().toLowerCase()
  const lista = (ql ? opcoes.filter((o) => o.sku.toLowerCase().includes(ql) || o.nome.toLowerCase().includes(ql)) : opcoes).slice(0, 40)
  return (
    <div ref={ref} className="relative min-w-[200px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx('h-9 w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 text-left text-sm hover:bg-surface-2', !sel && 'text-faint')}
      >
        <span className="truncate">
          {sel ? (
            <>
              <span className="font-mono text-[12px] text-muted mr-1.5">{sel.sku}</span>
              {sel.nome}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[min(360px,90vw)] rounded-xl border border-border bg-surface shadow-xl p-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por SKU ou nome…" />
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {lista.length === 0 && <li className="px-2 py-3 text-[13px] text-muted">Nada encontrado.</li>}
            {lista.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id)
                    setOpen(false)
                    setQ('')
                  }}
                  className={cx('w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 flex items-center gap-2', o.id === value && 'bg-accent-soft/50')}
                >
                  <span className="font-mono text-[12px] text-muted w-20 shrink-0">{o.sku}</span>
                  <span className="truncate flex-1">{o.nome}</span>
                  {o.extra && <span className="text-[12px] text-faint shrink-0">{o.extra}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
