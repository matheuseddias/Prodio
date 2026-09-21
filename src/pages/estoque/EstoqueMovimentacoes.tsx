import { useMemo, useState } from 'react'
import { brl, dataHoraBR } from '../../domain/format'
import { useLookups } from '../../domain/store'
import type { MoveType, StockMove } from '../../domain/types'
import { Card, EmptyState, SearchInput, Select, Table, Td, Th, cx } from '../../ui'
import EstoqueMoveBadge from './EstoqueMoveBadge'
import { MOVE_LABEL, MS_DIA, casasDe, mesmoDia, sinal } from './estoqueShared'

type Periodo = 'hoje' | '7' | '30' | 'todos'

export default function EstoqueMovimentacoes({ moves, onAbrir }: { moves: StockMove[]; onAbrir: (materialId: string) => void }) {
  const { material } = useLookups()
  const [tipo, setTipo] = useState<MoveType | 'todos'>('todos')
  const [periodo, setPeriodo] = useState<Periodo>('30')
  const [busca, setBusca] = useState('')

  const lista = useMemo(() => {
    const agora = new Date().getTime()
    const limite = periodo === 'hoje' ? null : periodo === 'todos' ? 0 : agora - Number(periodo) * MS_DIA
    const q = busca.trim().toLowerCase()
    return [...moves]
      .filter((mv) => tipo === 'todos' || mv.tipo === tipo)
      .filter((mv) => (limite === null ? mesmoDia(mv.em) : new Date(mv.em).getTime() >= limite))
      .filter((mv) => {
        if (!q) return true
        const m = material(mv.materialId)
        return m?.nome.toLowerCase().includes(q) || m?.sku.toLowerCase().includes(q) || mv.ref?.toLowerCase().includes(q) || mv.por.toLowerCase().includes(q)
      })
      .sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime())
  }, [moves, tipo, periodo, busca, material])

  const resumo = useMemo(() => {
    let entradas = 0, saidas = 0
    for (const mv of lista) {
      const m = material(mv.materialId)
      const v = mv.delta * (mv.custoUnit ?? m?.custoMedio ?? 0)
      if (v > 0) entradas += v
      else saidas += -v
    }
    return { entradas, saidas }
  }, [lista, material])

  return (
    <Card>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <SearchInput value={busca} onChange={setBusca} placeholder="Insumo, referência ou quem…" className="lg:w-72" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as MoveType | 'todos')} className="sm:w-44">
            <option value="todos">Todos os tipos</option>
            {(Object.keys(MOVE_LABEL) as MoveType[]).map((t) => <option key={t} value={t}>{MOVE_LABEL[t]}</option>)}
          </Select>
          <Select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} className="sm:w-40">
            <option value="hoje">Hoje</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="todos">Todo o período</option>
          </Select>
        </div>
        <div className="lg:ml-auto text-[13px] text-muted tabular-nums">
          <span className="text-ok">+{brl(resumo.entradas)}</span> · <span className="text-danger">−{brl(resumo.saidas)}</span> · {lista.length} mov.
        </div>
      </div>
      {lista.length === 0 ? (
        <EmptyState title="Nenhuma movimentação" description="Nenhum movimento corresponde aos filtros escolhidos." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data/hora</Th>
              <Th>Insumo</Th>
              <Th>Tipo</Th>
              <Th right>Delta</Th>
              <Th right>Custo unit.</Th>
              <Th>Referência / motivo</Th>
              <Th>Quem</Th>
            </tr>
          </thead>
          <tbody>
            {lista.map((mv) => {
              const m = material(mv.materialId)
              const casas = m ? casasDe(m) : 2
              return (
                <tr key={mv.id} onClick={() => onAbrir(mv.materialId)} className="cursor-pointer hover:bg-surface-2/60 transition-colors">
                  <Td className="whitespace-nowrap text-muted">{dataHoraBR(mv.em)}</Td>
                  <Td>
                    <div className="font-medium leading-tight">{m?.nome ?? mv.materialId}</div>
                    <div className="text-[12px] text-muted font-mono">{m?.sku}</div>
                  </Td>
                  <Td><EstoqueMoveBadge tipo={mv.tipo} /></Td>
                  <Td right className={cx('font-medium', mv.delta > 0 ? 'text-ok' : 'text-danger')}>{sinal(mv.delta, casas)} <span className="text-[12px] text-muted font-normal">{m?.unidadeConsumo}</span></Td>
                  <Td right className="text-muted">{mv.custoUnit !== undefined ? brl(mv.custoUnit) : '—'}</Td>
                  <Td className="text-muted">{mv.ref ?? mv.motivo ?? '—'}</Td>
                  <Td className="text-muted">{mv.por}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}
