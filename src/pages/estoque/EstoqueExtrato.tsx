import { RotateCcw, Scale, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, dataBR, dataHoraBR, num } from '../../domain/format'
import type { Material, StockMove } from '../../domain/types'
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Table, Td, Th, cx } from '../../ui'
import EstoqueMoveBadge from './EstoqueMoveBadge'
import { ESTADO_BADGE, MOTIVOS_PERDA, MOVE_LABEL, casasDe, estadoDe, sinal } from './estoqueShared'

type AddMove = (mv: Omit<StockMove, 'id' | 'em'>) => void

export default function EstoqueExtrato({ material: m, moves, consumo, onClose, addStockMove }: { material: Material; moves: StockMove[]; consumo?: number; onClose: () => void; addStockMove: AddMove }) {
  const [modal, setModal] = useState<'ajuste' | 'perda' | null>(null)
  const [contagem, setContagem] = useState(String(m.saldo))
  const [motivoAjuste, setMotivoAjuste] = useState('Contagem física')
  const [qtdPerda, setQtdPerda] = useState('')
  const [motivoPerda, setMotivoPerda] = useState(MOTIVOS_PERDA[0])
  const casas = casasDe(m)
  const e = ESTADO_BADGE[estadoDe(m)]

  // mais recentes primeiro; saldo corrente calculado de trás para frente a partir do saldo atual
  const extrato = useMemo(() => {
    const ordenado = [...moves].sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime())
    const acumulado = ordenado.reduce<number[]>((acc, mv, i) => {
      acc.push((i === 0 ? 0 : acc[i - 1]) + mv.delta)
      return acc
    }, [])
    return ordenado.map((mv, i) => ({ mv, saldo: Math.round((m.saldo - (i === 0 ? 0 : acumulado[i - 1])) * 1000) / 1000 }))
  }, [moves, m.saldo])

  // mini gráfico: saldo ao fim de cada um dos últimos 14 dias
  const serie = useMemo(() => {
    const dias: number[] = []
    for (let i = 13; i >= 0; i--) {
      const fim = new Date()
      fim.setHours(23, 59, 59, 999)
      fim.setDate(fim.getDate() - i)
      const posteriores = moves.filter((mv) => new Date(mv.em).getTime() > fim.getTime()).reduce((s, mv) => s + mv.delta, 0)
      dias.push(m.saldo - posteriores)
    }
    return dias
  }, [moves, m.saldo])

  const salvarAjuste = () => {
    const nova = Number(contagem.replace(',', '.'))
    if (!Number.isFinite(nova)) return
    const delta = Math.round((nova - m.saldo) * 1000) / 1000
    if (delta !== 0) addStockMove({ materialId: m.id, tipo: 'ajuste', delta, motivo: motivoAjuste || 'Ajuste de saldo', por: 'Matheus Moreno' })
    setModal(null)
  }
  const salvarPerda = () => {
    const q = Number(qtdPerda.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) return
    addStockMove({ materialId: m.id, tipo: 'perda', delta: -q, motivo: motivoPerda, custoUnit: m.custoMedio, por: 'Matheus Moreno' })
    setQtdPerda('')
    setModal(null)
  }
  const estornar = (mv: StockMove) => {
    addStockMove({ materialId: m.id, tipo: 'estorno', delta: -mv.delta, custoUnit: mv.custoUnit, ref: `Estorno ${mv.ref ?? MOVE_LABEL[mv.tipo]} (${dataBR(mv.em)})`, motivo: mv.motivo, por: 'Matheus Moreno' })
  }
  const jaEstornado = (mv: StockMove) => moves.some((x) => x.tipo === 'estorno' && x.ref?.includes(`(${dataBR(mv.em)})`) && x.delta === -mv.delta && new Date(x.em) > new Date(mv.em))

  return (
    <Modal open onClose={onClose} title={`Extrato · ${m.nome}`} size="xl" footer={<Button onClick={onClose}>Fechar</Button>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Saldo atual</div>
          <div className="text-lg font-semibold tabular-nums">{num(m.saldo, casas)} <span className="text-[12px] text-muted font-normal">{m.unidadeConsumo}</span></div>
          <Badge tone={e.tone} className="mt-1">{e.label}</Badge>
        </div>
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Mínimo</div>
          <div className="text-lg font-semibold tabular-nums">{num(m.minimo, casas)}</div>
          <div className="text-[12px] text-muted">lead time {m.leadTimeDias} d</div>
        </div>
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Consumo/dia (7 d)</div>
          <div className="text-lg font-semibold tabular-nums">{consumo ? num(consumo, 2) : '—'}</div>
          <div className="text-[12px] text-muted">{consumo ? `cobre ${num(m.saldo / consumo, 1)} dias` : 'sem baixas recentes'}</div>
        </div>
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Saldo · 14 dias</div>
          <Sparkline valores={serie} minimo={m.minimo} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button size="sm" variant="primary" onClick={() => { setContagem(String(m.saldo)); setModal('ajuste') }}><Scale size={14} /> Ajustar saldo</Button>
        <Button size="sm" variant="danger" onClick={() => setModal('perda')}><TrendingDown size={14} /> Registrar perda</Button>
        <span className="text-[12px] text-muted sm:ml-auto tabular-nums">{extrato.length} movimentos · custo médio {brl(m.custoMedio)}</span>
      </div>

      {extrato.length === 0 ? (
        <EmptyState title="Sem movimentos" description="Este insumo ainda não teve entradas, baixas ou ajustes." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data/hora</Th>
              <Th>Tipo</Th>
              <Th right>Delta</Th>
              <Th right>Saldo</Th>
              <Th right>Custo unit.</Th>
              <Th>Referência</Th>
              <Th>Quem</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {extrato.map(({ mv, saldo }) => (
              <tr key={mv.id}>
                <Td className="whitespace-nowrap text-muted">{dataHoraBR(mv.em)}</Td>
                <Td><EstoqueMoveBadge tipo={mv.tipo} /></Td>
                <Td right className={cx('font-medium', mv.delta > 0 ? 'text-ok' : mv.delta < 0 ? 'text-danger' : '')}>{sinal(mv.delta, casas)}</Td>
                <Td right>{num(saldo, casas)}</Td>
                <Td right className="text-muted">{mv.custoUnit !== undefined ? brl(mv.custoUnit) : '—'}</Td>
                <Td className="text-muted max-w-[220px] truncate">{mv.ref ?? mv.motivo ?? '—'}</Td>
                <Td className="text-muted">{mv.por}</Td>
                <Td right>
                  {mv.tipo !== 'estorno' && (
                    <Button size="sm" variant="ghost" disabled={jaEstornado(mv)} onClick={() => estornar(mv)} title="Gera movimento contrário"><RotateCcw size={13} /> Estornar</Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={modal === 'ajuste'}
        onClose={() => setModal(null)}
        title="Ajustar saldo"
        size="sm"
        footer={<><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="primary" onClick={salvarAjuste}>Gerar ajuste</Button></>}
      >
        <div className="space-y-4">
          <div className="text-sm text-muted">Saldo no sistema: <strong className="text-text tabular-nums">{num(m.saldo, casas)} {m.unidadeConsumo}</strong></div>
          <Field label={`Nova contagem (${m.unidadeConsumo})`}>
            <Input inputMode="decimal" value={contagem} onChange={(e) => setContagem(e.target.value)} autoFocus />
          </Field>
          <Field label="Motivo">
            <Input value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} placeholder="Ex.: contagem física" />
          </Field>
          {(() => {
            const nova = Number(contagem.replace(',', '.'))
            if (!Number.isFinite(nova)) return null
            const d = nova - m.saldo
            return (
              <div className={cx('rounded-lg px-3 py-2 text-sm', d === 0 ? 'bg-surface-2 text-muted' : d > 0 ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
                Ajuste de <strong className="tabular-nums">{sinal(d, casas)} {m.unidadeConsumo}</strong>{d !== 0 && ` (${brl(Math.abs(d) * m.custoMedio)})`}
              </div>
            )
          })()}
        </div>
      </Modal>

      <Modal
        open={modal === 'perda'}
        onClose={() => setModal(null)}
        title="Registrar perda"
        size="sm"
        footer={<><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="danger" onClick={salvarPerda}>Registrar perda</Button></>}
      >
        <div className="space-y-4">
          <Field label={`Quantidade perdida (${m.unidadeConsumo})`}>
            <Input inputMode="decimal" value={qtdPerda} onChange={(e) => setQtdPerda(e.target.value)} placeholder="0" autoFocus />
          </Field>
          <Field label="Motivo">
            <Select value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)}>
              {MOTIVOS_PERDA.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <div className="text-[12px] text-muted">A perda sai do saldo pelo custo médio atual ({brl(m.custoMedio)}/{m.unidadeConsumo}).</div>
        </div>
      </Modal>
    </Modal>
  )
}

function Sparkline({ valores, minimo }: { valores: number[]; minimo: number }) {
  const W = 140, H = 44, P = 3
  const max = Math.max(...valores, minimo) || 1
  const min = Math.min(...valores, minimo, 0)
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P)
  const x = (i: number) => P + (i / (valores.length - 1)) * (W - 2 * P)
  const d = valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ultimo = valores[valores.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11 mt-1" role="img" aria-label="Evolução do saldo nos últimos 14 dias">
      <line x1={P} x2={W - P} y1={y(minimo)} y2={y(minimo)} className="stroke-danger/60" strokeDasharray="3 3" strokeWidth={1} />
      <path d={d} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(valores.length - 1)} cy={y(ultimo)} r={2.5} className={ultimo < minimo ? 'fill-danger' : 'fill-accent'} />
    </svg>
  )
}
