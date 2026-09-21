import { CheckCircle2, ClipboardCheck, ScanBarcode, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useChaoSession } from '../../app/MobileShell'
import { brl, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Material } from '../../domain/types'
import { cx } from '../../ui'
import { beepAviso, beepErro, beepOk } from './feedback'
import Sheet from './Sheet'

interface Ajuste {
  material: Material
  contado: number
  delta: number
}

const fmtQ = (v: number) => num(v, Math.abs(v) % 1 ? 2 : 0)

export default function Inventario() {
  const store = useStore()
  const { operador } = useChaoSession()
  const [selecao, setSelecao] = useState<string[]>([])
  const [contagem, setContagem] = useState<Record<string, string>>({})
  const [bipados, setBipados] = useState<string[]>([])
  const [escolher, setEscolher] = useState(false)
  const [fechado, setFechado] = useState<Ajuste[] | null>(null)

  const sugestao = useMemo(() => {
    const abaixo = store.materials.filter((m) => m.saldo < m.minimo).sort((a, b) => a.saldo / a.minimo - b.saldo / b.minimo)
    const caros = store.materials
      .filter((m) => !abaixo.includes(m))
      .sort((a, b) => b.saldo * b.custoMedio - a.saldo * a.custoMedio)
    return [...abaixo, ...caros].slice(0, 5).map((m) => m.id)
  }, [store.materials])

  const selecionados = selecao.map((id) => store.materials.find((m) => m.id === id)).filter((m): m is Material => !!m)

  const ajustes: Ajuste[] = selecionados
    .map((m) => {
      const raw = contagem[m.id]
      if (raw === undefined || raw === '') return null
      const contado = Number(raw.replace(',', '.'))
      if (Number.isNaN(contado)) return null
      return { material: m, contado, delta: Math.round((contado - m.saldo) * 1000) / 1000 }
    })
    .filter((a): a is Ajuste => !!a)

  const divergentes = ajustes.filter((a) => a.delta !== 0)

  const biparInsumo = () => {
    // Simulação: "lê" a etiqueta de um insumo e o traz para a sessão.
    const fora = store.materials.filter((m) => !selecao.includes(m.id))
    const alvo = fora.length ? fora[Math.floor(Math.random() * fora.length)] : selecionados[Math.floor(Math.random() * selecionados.length)]
    if (!alvo) return beepErro()
    if (!selecao.includes(alvo.id)) setSelecao((s) => [...s, alvo.id])
    setBipados((b) => (b.includes(alvo.id) ? b : [...b, alvo.id]))
    beepOk()
    window.setTimeout(() => document.getElementById(`cont-${alvo.id}`)?.focus(), 50)
  }

  const fechar = () => {
    for (const a of divergentes) {
      store.addStockMove({ materialId: a.material.id, tipo: 'ajuste', delta: a.delta, motivo: 'Inventário cíclico', por: operador ?? 'Contagem' })
    }
    beepAviso()
    setFechado(ajustes)
  }

  const reiniciar = () => {
    setFechado(null)
    setSelecao([])
    setContagem({})
    setBipados([])
  }

  if (fechado) {
    const ajustados = fechado.filter((a) => a.delta !== 0)
    return (
      <div className="flex min-h-full flex-col px-4 pb-6 pt-8">
        <div className="text-center">
          <CheckCircle2 size={64} className="mx-auto text-emerald-400" strokeWidth={2.2} />
          <h1 className="mt-3 text-2xl font-bold">Sessão fechada</h1>
          <p className="mt-1 text-[14px] text-slate-400">
            {fechado.length} insumo{fechado.length === 1 ? '' : 's'} contado{fechado.length === 1 ? '' : 's'} · {ajustados.length} ajuste{ajustados.length === 1 ? '' : 's'} lançado{ajustados.length === 1 ? '' : 's'}
          </p>
        </div>
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-slate-400">Ajustes (motivo: Inventário cíclico)</h2>
          <ul className="mt-2 space-y-2">
            {fechado.map((a) => (
              <li key={a.material.id} className="flex items-center justify-between gap-3 text-[15px]">
                <span className="min-w-0 truncate">{a.material.nome}</span>
                <span className={cx('shrink-0 font-semibold tabular-nums', a.delta === 0 ? 'text-slate-500' : a.delta > 0 ? 'text-emerald-300' : 'text-red-300')}>
                  {a.delta === 0 ? 'bateu' : `${a.delta > 0 ? '+' : ''}${fmtQ(a.delta)} ${a.material.unidadeConsumo}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <button type="button" onClick={reiniciar} className="mt-auto flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 active:bg-teal-400">
          <ClipboardCheck size={22} /> Nova contagem
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 pb-32">
      <h1 className="pt-1 text-2xl font-semibold tracking-tight">Contagem cíclica</h1>
      <p className="text-[14px] text-slate-400">Conte poucos insumos por vez; só o que divergir vira ajuste.</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setSelecao((s) => Array.from(new Set([...s, ...sugestao])))} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 text-[14px] font-medium text-slate-200 active:bg-slate-800">
          <Sparkles size={18} className="text-amber-300" /> Sugerir 5
        </button>
        <button type="button" onClick={() => setEscolher(true)} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 text-[14px] font-medium text-slate-200 active:bg-slate-800">
          <ClipboardCheck size={18} /> Escolher insumos
        </button>
      </div>
      <button type="button" onClick={biparInsumo} className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-800 text-[15px] font-semibold text-teal-200 active:bg-slate-700">
        <ScanBarcode size={20} /> Bipar etiqueta do insumo
      </button>

      {selecionados.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-800 p-8 text-center text-[14px] text-slate-500">
          Nenhum insumo na sessão. Toque em <strong className="text-slate-300">Sugerir 5</strong> ou bipe uma etiqueta de prateleira.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {selecionados.map((m) => {
            const raw = contagem[m.id] ?? ''
            const contado = raw === '' ? null : Number(raw.replace(',', '.'))
            const delta = contado === null || Number.isNaN(contado) ? null : Math.round((contado - m.saldo) * 1000) / 1000
            const pct = delta !== null && m.saldo > 0 ? (delta / m.saldo) * 100 : null
            const abaixo = m.saldo < m.minimo
            return (
              <article key={m.id} className={cx('rounded-2xl border bg-slate-900 p-4', delta === null ? 'border-slate-800' : delta === 0 ? 'border-emerald-500/40' : 'border-amber-500/50')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold">{m.nome}</div>
                    <div className="font-mono text-[12px] text-slate-500">
                      {m.sku} · {brl(m.custoMedio)}/{m.unidadeConsumo}
                      {abaixo && <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-200">abaixo do mínimo</span>}
                      {bipados.includes(m.id) && <span className="ml-1.5 rounded bg-teal-500/20 px-1.5 py-0.5 text-[11px] text-teal-200">bipado</span>}
                    </div>
                  </div>
                  <button type="button" aria-label="Remover" onClick={() => setSelecao((s) => s.filter((x) => x !== m.id))} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 active:bg-slate-800">
                    <X size={18} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-800/60 p-3">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Sistema</div>
                    <div className="text-[22px] font-semibold tabular-nums">
                      {fmtQ(m.saldo)} <span className="text-[13px] text-slate-400">{m.unidadeConsumo}</span>
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">Contado</span>
                    <input
                      id={`cont-${m.id}`}
                      type="text"
                      inputMode="decimal"
                      value={raw}
                      onChange={(e) => setContagem((c) => ({ ...c, [m.id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                      placeholder="0"
                      className="mt-0.5 h-[52px] w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[24px] font-semibold tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-teal-400 focus:outline-none"
                    />
                  </label>
                </div>
                <div className="mt-2 flex items-center justify-between text-[14px]">
                  <span className="text-slate-400">Diferença</span>
                  {delta === null ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <span className={cx('font-semibold tabular-nums', delta === 0 ? 'text-emerald-300' : delta > 0 ? 'text-teal-300' : 'text-red-300')}>
                      {delta > 0 ? '+' : ''}
                      {fmtQ(delta)} {m.unidadeConsumo}
                      {pct !== null && <span className="ml-1 text-[12px] opacity-80">({pct > 0 ? '+' : ''}{num(pct, 1)}%)</span>}
                    </span>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {selecionados.length > 0 && (
        <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2">
          <button
            type="button"
            disabled={ajustes.length === 0}
            onClick={fechar}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 shadow-lg shadow-teal-500/20 active:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
          >
            <ClipboardCheck size={24} /> Fechar sessão
          </button>
          <div className="mt-1 text-center text-[12px] text-slate-500">
            {ajustes.length} de {selecionados.length} contado{ajustes.length === 1 ? '' : 's'} · {divergentes.length} ajuste{divergentes.length === 1 ? '' : 's'} a lançar
          </div>
        </div>
      )}

      {escolher && (
        <Sheet titulo="Insumos para contar" onClose={() => setEscolher(false)}>
          <ul className="space-y-1.5">
            {store.materials.map((m) => {
              const on = selecao.includes(m.id)
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelecao((s) => (on ? s.filter((x) => x !== m.id) : [...s, m.id]))}
                    className={cx('flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left', on ? 'border-teal-400 bg-teal-500/10' : 'border-slate-800 bg-slate-900 active:bg-slate-800')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{m.nome}</span>
                      <span className="block font-mono text-[12px] text-slate-500">
                        {m.sku} · {fmtQ(m.saldo)} {m.unidadeConsumo}
                        {m.saldo < m.minimo && <span className="text-amber-300"> · abaixo do mínimo</span>}
                      </span>
                    </span>
                    {sugestao.includes(m.id) && !on && <Sparkles size={16} className="text-amber-300" />}
                    {on && <CheckCircle2 size={20} className="text-teal-300" />}
                  </button>
                </li>
              )
            })}
          </ul>
          <button type="button" onClick={() => setEscolher(false)} className="mt-4 flex h-14 w-full items-center justify-center rounded-2xl bg-teal-500 text-[16px] font-semibold text-slate-950">
            Pronto · {selecao.length} selecionado{selecao.length === 1 ? '' : 's'}
          </button>
        </Sheet>
      )}
    </div>
  )
}
