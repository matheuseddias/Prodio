import { useMemo, useState } from 'react'
import type { Bom, Product } from '../../domain/types'
import { Badge, Card, SearchInput, cx } from '../../ui'

/** Lista lateral de produtos com busca; sem ficha primeiro. */
export default function FichasLista({ products, boms, selecionadoId, onSelect }: { products: Product[]; boms: Bom[]; selecionadoId?: string; onSelect: (id: string) => void }) {
  const [busca, setBusca] = useState('')
  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return products
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.nome.toLowerCase().includes(q))
      .sort((a, b) => Number(a.temFicha) - Number(b.temFicha) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [products, busca])

  return (
    <Card padded={false} className="lg:sticky lg:top-4">
      <div className="p-3 border-b border-border">
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto…" />
      </div>
      <ul className="max-h-[40vh] lg:max-h-[calc(100vh-200px)] overflow-y-auto">
        {lista.length === 0 && <li className="px-4 py-6 text-[13px] text-muted text-center">Nenhum produto.</li>}
        {lista.map((p) => {
          const b = boms.find((x) => x.productId === p.id && x.ativa)
          const sel = p.id === selecionadoId
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className={cx('w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-2 transition-colors', sel ? 'bg-accent-soft/40 border-accent' : 'border-transparent hover:bg-surface-2')}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{p.nome}</div>
                  <div className="text-[12px] text-muted font-mono">
                    {p.sku}
                    {Object.values(p.atributos).length > 0 && <span className="font-sans"> · {Object.values(p.atributos).join(' · ')}</span>}
                  </div>
                </div>
                {p.temFicha && b ? <Badge tone="ok">v{b.versao}</Badge> : <Badge tone="warn">sem ficha</Badge>}
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
