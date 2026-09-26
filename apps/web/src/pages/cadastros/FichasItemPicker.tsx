import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BomLine } from '../../domain/types'
import { SearchInput, cx } from '../../ui'

export interface OpcaoItem {
  id: string
  sku: string
  nome: string
  extra?: string
}

type Tipo = BomLine['tipo']

const ABAS: { id: Tipo; label: string }[] = [
  { id: 'insumo', label: 'Insumos' },
  { id: 'produto', label: 'Componentes' },
]

const filtrar = (opcoes: OpcaoItem[], q: string) => (q ? opcoes.filter((o) => o.sku.toLowerCase().includes(q) || o.nome.toLowerCase().includes(q)) : opcoes)

/**
 * Escolha do item de uma linha da ficha: insumo ou produto componente (fabricado) no mesmo seletor.
 * As abas substituem a antiga coluna "Tipo", que sozinha tomava 170 px da tabela.
 */
export default function FichasItemPicker({ insumos, produtos, tipo, value, onChange }: { insumos: OpcaoItem[]; produtos: OpcaoItem[]; tipo: Tipo; value?: string; onChange: (tipo: Tipo, id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [aba, setAba] = useState<Tipo>(tipo)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const sel = (tipo === 'insumo' ? insumos : produtos).find((o) => o.id === value)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const ql = q.trim().toLowerCase()
  const achados = { insumo: filtrar(insumos, ql), produto: filtrar(produtos, ql) }
  const lista = achados[aba].slice(0, 40)
  const abrir = () => {
    setAba(tipo)
    setOpen((o) => !o)
  }
  return (
    <div ref={ref} className="relative min-w-[180px]">
      <button
        type="button"
        onClick={abrir}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={sel ? `${sel.sku} · ${sel.nome}` : undefined}
        className={cx('h-9 w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 text-left text-sm hover:bg-surface-2', !sel && 'text-faint')}
      >
        {/* w-0 flex-1: o nome longo não entra na largura mínima da coluna (senão a tabela da ficha rola de lado) */}
        <span className="w-0 flex-1 truncate">
          {sel ? (
            <>
              {tipo === 'produto' && <span className="mr-1.5 rounded bg-info-soft px-1 py-px text-[11px] font-medium text-info">comp.</span>}
              <span className="font-mono text-[12px] text-muted mr-1.5">{sel.sku}</span>
              {sel.nome}
            </>
          ) : (
            'Escolher insumo ou componente…'
          )}
        </span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[min(380px,90vw)] rounded-xl border border-border bg-surface shadow-xl p-2">
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="tablist">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={aba === a.id}
                onClick={() => setAba(a.id)}
                className={cx('rounded-md px-2 py-1.5 text-[13px] transition-colors', aba === a.id ? 'bg-surface font-medium text-text shadow-sm' : 'text-muted hover:text-text')}
              >
                {a.label} <span className="tabular-nums text-faint">{achados[a.id].length}</span>
              </button>
            ))}
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por SKU ou nome…" />
          <ul className="mt-2 max-h-60 overflow-y-auto" role="listbox">
            {lista.length === 0 && <li className="px-2 py-3 text-[13px] text-muted">Nada encontrado{achados[aba === 'insumo' ? 'produto' : 'insumo'].length > 0 ? ' aqui; veja a outra aba.' : '.'}</li>}
            {lista.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={tipo === aba && o.id === value}
                  onClick={() => {
                    onChange(aba, o.id)
                    setOpen(false)
                    setQ('')
                  }}
                  className={cx('w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 flex items-center gap-2', tipo === aba && o.id === value && 'bg-accent-soft/50')}
                >
                  <span className="font-mono text-[12px] text-muted w-20 shrink-0 truncate">{o.sku}</span>
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
