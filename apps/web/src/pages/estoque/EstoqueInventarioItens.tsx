import { Plus, Trash2, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import { brl, num } from '../../domain/format'
import { Button, EmptyState, Input, Select, Table, Td, Th, cx } from '../../ui'
import { MOTIVOS_DIVERGENCIA, casasDe, dimensional, pecaLivre, totalPecas, unLabel, type ItemAvaliado, type ItemSessao, type MotivoDivergencia, type PecaContada } from './inventarioSessoes'

interface Props {
  itens: ItemAvaliado[]
  somenteLeitura: boolean
  onChange: (materialId: string, patch: Partial<ItemSessao>) => void
  onRemover: (materialId: string) => void
}

const sinal = (v: number, casas: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), casas)}`

/** Tabela de contagem item a item, com modo "por peças" para insumos dimensionais. */
export default function EstoqueInventarioItens({ itens, somenteLeitura, onChange, onRemover }: Props) {
  if (itens.length === 0) return <EmptyState title="Sem insumos na sessão" description="Volte e escolha os insumos que serão contados." />
  return (
    <Table>
      <thead>
        <tr>
          <Th>Insumo</Th>
          <Th right>Saldo sistema</Th>
          <Th>Contado</Th>
          <Th right>Diferença</Th>
          <Th right>R$</Th>
          <Th>Motivo</Th>
          {!somenteLeitura && <Th></Th>}
        </tr>
      </thead>
      <tbody>
        {itens.map((a) => {
          const { item, material: m } = a
          const casas = m ? casasDe(m) : 2
          const un = m ? unLabel(m.unidadeConsumo) : ''
          const dim = !!m && dimensional(m)
          const porPecas = item.modo === 'pecas'
          const diverge = a.delta !== undefined && a.delta !== 0
          return (
            <Fragment key={item.materialId}>
              <tr className={cx(a.contado === undefined ? '' : diverge ? 'bg-warn-soft/30' : 'bg-ok-soft/20')}>
                <Td>
                  <div className="font-medium leading-tight">{m?.nome ?? item.materialId}</div>
                  <div className="text-[12px] text-muted font-mono">{m?.sku} · {brl(a.custo)}/{un}</div>
                </Td>
                <Td right className="tabular-nums">{num(a.saldo, casas)} <span className="text-[12px] text-muted">{un}</span></Td>
                <Td>
                  {somenteLeitura ? (
                    <span className="tabular-nums">{a.contado === undefined ? '—' : `${num(a.contado, casas)} ${un}`}</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      {porPecas ? (
                        <span className="h-9 min-w-24 inline-flex items-center rounded-lg bg-surface-2 px-2.5 text-sm font-medium tabular-nums">{num(totalPecas(item.pecas), casas)} {un}</span>
                      ) : (
                        <Input inputMode="decimal" value={item.contadoTexto} onChange={(e) => onChange(item.materialId, { contadoTexto: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="0" className="h-9 w-28 text-right tabular-nums" />
                      )}
                      {dim && (
                        <div className="inline-flex rounded-lg border border-border p-0.5 text-[12px]">
                          <button type="button" onClick={() => onChange(item.materialId, { modo: 'total' })} className={cx('rounded-md px-2 py-1', !porPecas ? 'bg-accent-soft text-accent-text font-medium' : 'text-muted hover:text-text')}>Total</button>
                          <button type="button" onClick={() => onChange(item.materialId, { modo: 'pecas' })} className={cx('rounded-md px-2 py-1', porPecas ? 'bg-accent-soft text-accent-text font-medium' : 'text-muted hover:text-text')}>Por peças</button>
                        </div>
                      )}
                    </div>
                  )}
                </Td>
                <Td right className={cx('tabular-nums font-medium', a.delta === undefined ? 'text-faint' : diverge ? (a.delta! > 0 ? 'text-ok' : 'text-danger') : 'text-ok')}>
                  {a.delta === undefined ? '—' : diverge ? `${sinal(a.delta!, casas)} ${un}` : 'bateu'}
                </Td>
                <Td right className={cx('tabular-nums', diverge ? 'text-warn font-medium' : 'text-muted')}>{a.valor === undefined || !diverge ? '—' : brl(a.valor)}</Td>
                <Td>
                  {diverge ? (
                    somenteLeitura ? (
                      <span className="text-sm">{item.motivo ?? '—'}</span>
                    ) : (
                      <Select value={item.motivo ?? ''} onChange={(e) => onChange(item.materialId, { motivo: (e.target.value || undefined) as MotivoDivergencia | undefined })} className={cx('h-9 w-44', !item.motivo && 'border-warn')}>
                        <option value="">Escolher motivo…</option>
                        {MOTIVOS_DIVERGENCIA.map((x) => <option key={x}>{x}</option>)}
                      </Select>
                    )
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
                {!somenteLeitura && (
                  <Td right>
                    <Button variant="ghost" size="sm" onClick={() => onRemover(item.materialId)} aria-label="Remover da sessão" title="Remover da sessão"><Trash2 size={14} /></Button>
                  </Td>
                )}
              </tr>
              {porPecas && !somenteLeitura && m && (
                <tr>
                  <td colSpan={7} className="px-5 pb-3 border-b border-border/70">
                    <Pecas pecas={item.pecas} un={un} casas={casas} onChange={(pecas) => onChange(item.materialId, { pecas })} onAddLivre={() => onChange(item.materialId, { pecas: [...item.pecas, pecaLivre(m)] })} />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </Table>
  )
}

/** Peças inteiras × área/comprimento de cada tamanho; retalhos aproveitáveis com medida digitada. */
function Pecas({ pecas, un, casas, onChange, onAddLivre }: { pecas: PecaContada[]; un: string; casas: number; onChange: (p: PecaContada[]) => void; onAddLivre: () => void }) {
  const [txt, setTxt] = useState<Record<string, string>>({})
  const upd = (id: string, patch: Partial<PecaContada>) => onChange(pecas.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const numOf = (t: string) => { const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0 }
  return (
    <div className="rounded-lg border border-border bg-surface-2/50 p-3">
      <div className="grid grid-cols-[1fr_110px_90px_110px_32px] gap-2 text-[11px] uppercase tracking-wide text-muted mb-1 px-1">
        <span>Tamanho</span><span className="text-right">{un} / peça</span><span className="text-right">Peças</span><span className="text-right">Subtotal</span><span />
      </div>
      <div className="space-y-1.5">
        {pecas.map((p) => (
          <div key={p.id} className="grid grid-cols-[1fr_110px_90px_110px_32px] gap-2 items-center px-1">
            <span className="text-sm truncate">{p.rotulo}</span>
            {p.livre ? (
              <Input inputMode="decimal" value={txt[p.id] ?? (p.medida || '')} onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setTxt((x) => ({ ...x, [p.id]: t })); upd(p.id, { medida: numOf(t) }) }} placeholder="0,00" className="h-8 text-right tabular-nums" />
            ) : (
              <span className="text-sm text-right tabular-nums text-muted">{num(p.medida, 2)}</span>
            )}
            <Input inputMode="numeric" value={p.qtd} onChange={(e) => upd(p.id, { qtd: Math.max(0, Math.floor(numOf(e.target.value))) })} className="h-8 text-right tabular-nums" />
            <span className="text-sm text-right tabular-nums font-medium">{num(p.medida * p.qtd, casas)}</span>
            {p.livre ? (
              <button type="button" onClick={() => onChange(pecas.filter((x) => x.id !== p.id))} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger" aria-label="Remover tamanho"><X size={14} /></button>
            ) : <span />}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={onAddLivre}><Plus size={14} /> Outro tamanho / retalho</Button>
        <span className="text-sm tabular-nums">Total <strong>{num(totalPecas(pecas), casas)} {un}</strong></span>
      </div>
    </div>
  )
}
