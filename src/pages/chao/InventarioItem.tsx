import { Minus, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { brl, num } from '../../domain/format'
import { cx } from '../../ui'
import { MOTIVOS_DIVERGENCIA, casasDe, dimensional, pecaLivre, totalPecas, unLabel, type ItemAvaliado, type ItemSessao, type MotivoDivergencia, type PecaContada } from '../estoque/inventarioSessoes'
import { beepOk } from './feedback'

const fmtQ = (v: number, casas: number) => num(v, Math.abs(v) % 1 ? Math.max(casas, 2) : 0)

interface Props {
  a: ItemAvaliado
  bipado: boolean
  onChange: (patch: Partial<ItemSessao>) => void
  onRemover: () => void
}

/** Cartão de contagem de um insumo (toque): total digitado ou "por peças" com + e − por tamanho. */
export default function InventarioItem({ a, bipado, onChange, onRemover }: Props) {
  const { item, material: m } = a
  if (!m) return null
  const casas = casasDe(m)
  const un = unLabel(m.unidadeConsumo)
  const dim = dimensional(m)
  const porPecas = item.modo === 'pecas'
  const delta = a.delta ?? null
  const pct = delta !== null && a.saldo > 0 ? (delta / a.saldo) * 100 : null
  const diverge = delta !== null && delta !== 0
  const abaixo = m.saldo < m.minimo

  return (
    <article className={cx('rounded-2xl border bg-slate-900 p-4', delta === null ? 'border-slate-800' : delta === 0 ? 'border-emerald-500/40' : 'border-amber-500/50')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold">{m.nome}</div>
          <div className="font-mono text-[12px] text-slate-500">
            {m.sku} · {brl(m.custoMedio)}/{un}
            {abaixo && <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-200">abaixo do mínimo</span>}
            {bipado && <span className="ml-1.5 rounded bg-teal-500/20 px-1.5 py-0.5 text-[11px] text-teal-200">bipado</span>}
          </div>
        </div>
        <button type="button" aria-label="Remover" onClick={onRemover} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 active:bg-slate-800">
          <X size={18} />
        </button>
      </div>

      {dim && (
        <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-700 p-1 text-[14px] font-medium">
          <button type="button" onClick={() => onChange({ modo: 'total' })} className={cx('h-12 rounded-lg', !porPecas ? 'bg-teal-500/20 text-teal-200' : 'text-slate-400')}>Total em {un}</button>
          <button type="button" onClick={() => onChange({ modo: 'pecas' })} className={cx('h-12 rounded-lg', porPecas ? 'bg-teal-500/20 text-teal-200' : 'text-slate-400')}>Por peças</button>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-800/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Sistema</div>
          <div className="text-[22px] font-semibold tabular-nums">
            {fmtQ(a.saldo, casas)} <span className="text-[13px] text-slate-400">{un}</span>
          </div>
        </div>
        {porPecas ? (
          <div className="rounded-xl bg-slate-800/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Contado (peças)</div>
            <div className="text-[22px] font-semibold tabular-nums text-teal-200">
              {fmtQ(totalPecas(item.pecas), casas)} <span className="text-[13px] text-slate-400">{un}</span>
            </div>
          </div>
        ) : (
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Contado</span>
            <input
              id={`cont-${m.id}`}
              type="text"
              inputMode="decimal"
              value={item.contadoTexto}
              onChange={(e) => onChange({ contadoTexto: e.target.value.replace(/[^\d.,]/g, '') })}
              placeholder="0"
              className="mt-0.5 h-[52px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[24px] font-semibold tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-teal-400 focus:outline-none"
            />
          </label>
        )}
      </div>

      {porPecas && <Pecas pecas={item.pecas} un={un} casas={casas} onChange={(pecas) => onChange({ pecas })} onAddLivre={() => onChange({ pecas: [...item.pecas, pecaLivre(m)] })} />}

      <div className="mt-3 flex items-center justify-between text-[14px]">
        <span className="text-slate-400">Diferença</span>
        {delta === null ? (
          <span className="text-slate-500">—</span>
        ) : (
          <span className={cx('font-semibold tabular-nums', delta === 0 ? 'text-emerald-300' : delta > 0 ? 'text-teal-300' : 'text-red-300')}>
            {delta === 0 ? 'bateu' : `${delta > 0 ? '+' : ''}${fmtQ(delta, casas)} ${un}`}
            {pct !== null && delta !== 0 && <span className="ml-1 text-[12px] opacity-80">({pct > 0 ? '+' : ''}{num(pct, 1)}% · {brl(a.valor ?? 0)})</span>}
          </span>
        )}
      </div>

      {diverge && (
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Motivo {!item.motivo && <span className="text-amber-300">· obrigatório</span>}</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {MOTIVOS_DIVERGENCIA.map((mo) => (
              <button
                key={mo}
                type="button"
                onClick={() => onChange({ motivo: mo as MotivoDivergencia })}
                className={cx('h-11 rounded-xl border px-3 text-[14px] font-medium', item.motivo === mo ? 'border-teal-400 bg-teal-500/15 text-teal-200' : 'border-slate-700 bg-slate-950 text-slate-300 active:bg-slate-800')}
              >
                {mo}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

function Pecas({ pecas, un, casas, onChange, onAddLivre }: { pecas: PecaContada[]; un: string; casas: number; onChange: (p: PecaContada[]) => void; onAddLivre: () => void }) {
  const [txt, setTxt] = useState<Record<string, string>>({})
  const upd = (id: string, patch: Partial<PecaContada>) => onChange(pecas.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const numOf = (t: string) => { const n = Number(t.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0 }
  const mais = (p: PecaContada, d: number) => { upd(p.id, { qtd: Math.max(0, p.qtd + d) }); beepOk() }
  return (
    <div className="mt-3 space-y-2">
      {pecas.map((p) => (
        <div key={p.id} className="flex items-center gap-2 rounded-xl bg-slate-800/60 p-2">
          <div className="min-w-0 flex-1 pl-1">
            <div className="truncate text-[14px] font-medium">{p.rotulo}</div>
            {p.livre ? (
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={txt[p.id] ?? (p.medida || '')}
                  onChange={(e) => { const t = e.target.value.replace(/[^\d.,]/g, ''); setTxt((x) => ({ ...x, [p.id]: t })); upd(p.id, { medida: numOf(t) }) }}
                  placeholder="0,00"
                  className="h-11 w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 text-right text-[16px] font-semibold tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-teal-400 focus:outline-none"
                />
                <span className="text-[12px] text-slate-500">{un} cada</span>
                <button type="button" aria-label="Remover tamanho" onClick={() => onChange(pecas.filter((x) => x.id !== p.id))} className="ml-auto grid h-11 w-11 place-items-center rounded-full text-slate-500 active:bg-slate-700"><X size={16} /></button>
              </div>
            ) : (
              <div className="text-[12px] text-slate-500 tabular-nums">{num(p.medida, 2)} {un} cada · {fmtQ(p.medida * p.qtd, casas)} {un}</div>
            )}
          </div>
          <button type="button" aria-label="Menos" onClick={() => mais(p, -1)} disabled={p.qtd === 0} className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-950 text-slate-200 active:bg-slate-700 disabled:opacity-40"><Minus size={22} /></button>
          <span className="w-9 shrink-0 text-center text-[22px] font-semibold tabular-nums">{p.qtd}</span>
          <button type="button" aria-label="Mais" onClick={() => mais(p, 1)} className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-teal-500/20 text-teal-200 active:bg-teal-500/40"><Plus size={22} /></button>
        </div>
      ))}
      <button type="button" onClick={onAddLivre} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 text-[14px] text-slate-300 active:bg-slate-800">
        <Plus size={16} /> Outro tamanho / retalho aproveitável
      </button>
    </div>
  )
}
