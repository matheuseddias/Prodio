import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { brl, num } from '../../domain/format'
import { Badge, Card, EmptyState, SearchInput, Table, Td, Th, Toggle, cx } from '../../ui'
import { ESTADO_BADGE, casasDe, type Estado, type LinhaSaldo } from './estoqueShared'

type SortKey = 'nome' | 'saldo' | 'minimo' | 'cobertura' | 'custoMedio' | 'valor' | 'estado'
function SortTh({ children, k, sort, onSort, right }: { children: ReactNode; k: SortKey; sort: { k: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; right?: boolean }) {
  const ativo = sort.k === k
  return (
    <Th right={right}>
      <button type="button" onClick={() => onSort(k)} className={cx('inline-flex items-center gap-1 uppercase hover:text-text', ativo && 'text-text')}>
        {children}
        {ativo ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="text-faint" />}
      </button>
    </Th>
  )
}

export default function EstoqueSaldos({ linhas, onAbrir }: { linhas: LinhaSaldo[]; onAbrir: (materialId: string) => void }) {
  const [busca, setBusca] = useState('')
  const [soAbaixo, setSoAbaixo] = useState(false)
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'estado', dir: 1 })

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const ordem: Record<Estado, number> = { critico: 0, atencao: 1, ok: 2 }
    const fil = linhas.filter((l) => {
      if (soAbaixo && l.estado !== 'critico') return false
      if (!q) return true
      return l.m.nome.toLowerCase().includes(q) || l.m.sku.toLowerCase().includes(q)
    })
    const val = (l: LinhaSaldo): number | string => {
      switch (sort.k) {
        case 'nome': return l.m.nome
        case 'saldo': return l.m.saldo
        case 'minimo': return l.m.minimo
        case 'cobertura': return l.cobertura ?? Number.POSITIVE_INFINITY
        case 'custoMedio': return l.m.custoMedio
        case 'valor': return l.valor
        case 'estado': return ordem[l.estado]
      }
    }
    return fil.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'string' ? va.localeCompare(String(vb), 'pt-BR') : va - (vb as number)
      return c * sort.dir || a.m.nome.localeCompare(b.m.nome, 'pt-BR')
    })
  }, [linhas, busca, soAbaixo, sort])

  const onSort = (k: SortKey) => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: k === 'nome' || k === 'estado' ? 1 : -1 }))

  return (
    <Card padded>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome ou SKU…" className="sm:w-80" />
        <Toggle checked={soAbaixo} onChange={setSoAbaixo} label="Só abaixo do mínimo" />
        <span className="text-[13px] text-muted sm:ml-auto tabular-nums">{visiveis.length} de {linhas.length} insumos</span>
      </div>
      {visiveis.length === 0 ? (
        <EmptyState title="Nenhum insumo encontrado" description={soAbaixo ? 'Nenhum insumo está abaixo do mínimo com esse filtro.' : 'Ajuste a busca para encontrar o insumo.'} />
      ) : (
        <Table>
          <thead>
            <tr>
              <SortTh k="nome" sort={sort} onSort={onSort}>Insumo</SortTh>
              <Th>Un.</Th>
              <SortTh k="saldo" sort={sort} onSort={onSort} right>Saldo</SortTh>
              <SortTh k="minimo" sort={sort} onSort={onSort} right>Mínimo</SortTh>
              <SortTh k="cobertura" sort={sort} onSort={onSort} right>Cobertura</SortTh>
              <SortTh k="custoMedio" sort={sort} onSort={onSort} right>Custo médio</SortTh>
              <SortTh k="valor" sort={sort} onSort={onSort} right>Valor</SortTh>
              <SortTh k="estado" sort={sort} onSort={onSort}>Estado</SortTh>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => {
              const e = ESTADO_BADGE[l.estado]
              return (
                <tr key={l.m.id} onClick={() => onAbrir(l.m.id)} className="cursor-pointer hover:bg-surface-2/60 transition-colors">
                  <Td>
                    <div className="font-medium leading-tight">{l.m.nome}</div>
                    <div className="text-[12px] text-muted font-mono">{l.m.sku}</div>
                  </Td>
                  <Td className="text-muted">{l.m.unidadeConsumo}</Td>
                  <Td right className={cx('font-medium', l.estado === 'critico' && 'text-danger')}>{num(l.m.saldo, casasDe(l.m))}</Td>
                  <Td right className="text-muted">{num(l.m.minimo, casasDe(l.m))}</Td>
                  <Td right>
                    {l.cobertura === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className={cx(l.cobertura < l.m.leadTimeDias && 'text-danger font-medium')}>{num(l.cobertura, 1)} d</span>
                    )}
                  </Td>
                  <Td right className="text-muted">{brl(l.m.custoMedio)}</Td>
                  <Td right>{brl(l.valor)}</Td>
                  <Td><Badge tone={e.tone}>{e.label}</Badge></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}
