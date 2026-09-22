import { CheckCircle2, ChevronRight, ClipboardCheck, Plus } from 'lucide-react'
import { useState } from 'react'
import { useChaoSession } from '../../app/MobileShell'
import { brl, dataBR, num, relativo } from '../../domain/format'
import { useStore } from '../../domain/store'
import { cx } from '../../ui'
import { casasDe, congelarItens, locaisDeContagem, resumoSessao, sessoesExemplo, uid, unLabel, type SessaoInventario } from '../estoque/inventarioSessoes'
import InventarioSessao from './InventarioSessao'
import { beepAviso } from './feedback'

// A sessão vive no estado desta tela: as RPCs open/save/close_inventory_session existem no banco e
// ainda não estão ligadas. Duas consequências que a tela precisa assumir em vez de esconder:
// (1) com banco de verdade não se semeia nada — as sessões de exemplo eram de outra empresa;
// (2) recarregar o app no meio da contagem perde o que foi contado, e isso é dito na tela.
export default function Inventario() {
  const store = useStore()
  const { operador } = useChaoSession()
  const [sessoes, setSessoes] = useState<SessaoInventario[]>(() => (store.modo === 'memoria' ? sessoesExemplo(store.materials) : []))
  const [ativaId, setAtivaId] = useState<string | null>(null)
  const [fechada, setFechada] = useState<SessaoInventario | null>(null)
  const [novoLocal, setNovoLocal] = useState<string | null>(null)
  const locais = locaisDeContagem(store.locations, store.modo)

  const salvar = (s: SessaoInventario) => setSessoes((l) => (l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [s, ...l]))

  const criar = (local: string) => {
    const s: SessaoInventario = { id: `inv-${uid()}`, abertaEm: new Date().toISOString(), local, por: operador ?? 'Contagem', origem: 'celular', status: 'aberta', itens: [] }
    salvar(s)
    setNovoLocal(null)
    setAtivaId(s.id)
  }

  const fechar = (s: SessaoInventario) => {
    const itens = congelarItens(s, store.materials)
    const por = operador ?? s.por
    for (const it of itens) {
      if (!it.delta) continue
      store.addStockMove({ materialId: it.materialId, tipo: 'ajuste', delta: it.delta, custoUnit: it.custoUnit, motivo: `Inventário · ${it.motivo ?? 'Outro'}`, ref: `Sessão ${dataBR(s.abertaEm)} · ${s.local}`, por })
    }
    const done: SessaoInventario = { ...s, status: 'fechada', fechadaEm: new Date().toISOString(), por, itens }
    salvar(done)
    beepAviso()
    setAtivaId(null)
    setFechada(done)
  }

  const ativa = ativaId ? sessoes.find((s) => s.id === ativaId) : undefined

  if (fechada) {
    const ajustados = fechada.itens.filter((a) => a.delta)
    return (
      <div className="flex min-h-full flex-col px-4 pb-6 pt-8">
        <div className="text-center">
          <CheckCircle2 size={64} className="mx-auto text-emerald-400" strokeWidth={2.2} />
          <h1 className="mt-3 text-2xl font-bold">Sessão fechada</h1>
          <p className="mt-1 text-[14px] text-slate-400">
            {fechada.itens.length} insumo{fechada.itens.length === 1 ? '' : 's'} contado{fechada.itens.length === 1 ? '' : 's'} · {ajustados.length} ajuste{ajustados.length === 1 ? '' : 's'} lançado{ajustados.length === 1 ? '' : 's'}
          </p>
        </div>
        <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-slate-400">Ajustes (motivo: Inventário · …)</h2>
          <ul className="mt-2 space-y-2">
            {fechada.itens.map((it) => {
              const m = store.materials.find((x) => x.id === it.materialId)
              const d = it.delta ?? 0
              return (
                <li key={it.materialId} className="flex items-center justify-between gap-3 text-[15px]">
                  <span className="min-w-0 truncate">
                    {m?.nome ?? it.materialId}
                    {d !== 0 && it.motivo && <span className="ml-1.5 text-[12px] text-slate-500">{it.motivo}</span>}
                  </span>
                  <span className={cx('shrink-0 font-semibold tabular-nums', d === 0 ? 'text-slate-500' : d > 0 ? 'text-emerald-300' : 'text-red-300')}>
                    {d === 0 ? 'bateu' : `${d > 0 ? '+' : ''}${num(d, m ? casasDe(m) : 2)} ${m ? unLabel(m.unidadeConsumo) : ''}`}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
        <button type="button" onClick={() => setFechada(null)} className="mt-auto flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 active:bg-teal-400">
          <ClipboardCheck size={22} /> Voltar às sessões
        </button>
      </div>
    )
  }

  if (ativa) {
    return <InventarioSessao sessao={ativa} todas={sessoes} onChange={salvar} onFechar={() => fechar(ativa)} onVoltar={() => setAtivaId(null)} />
  }

  const abertas = sessoes.filter((s) => s.status === 'aberta').sort((a, b) => b.abertaEm.localeCompare(a.abertaEm))
  const fechadas = sessoes.filter((s) => s.status === 'fechada').sort((a, b) => (b.fechadaEm ?? '').localeCompare(a.fechadaEm ?? '')).slice(0, 3)

  return (
    <div className="px-4 pb-8">
      <h1 className="pt-1 text-2xl font-semibold tracking-tight">Contagem</h1>
      <p className="text-[14px] text-slate-400">Conte por sessão; só o que divergir vira ajuste. Sobra aproveitável conta, quebra não.</p>

      {store.modo !== 'memoria' && (
        <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
          A contagem fica só neste aparelho até você fechar a sessão. Se o app for recarregado no meio, ela se perde — feche a sessão antes de sair.
        </div>
      )}

      <button
        type="button"
        disabled={locais.length === 0}
        onClick={() => setNovoLocal(locais[0] ?? '')}
        className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-teal-500 text-[16px] font-semibold text-slate-950 active:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500"
      >
        <Plus size={20} /> Nova sessão
      </button>
      {locais.length === 0 && <div className="mt-2 text-center text-[13px] text-slate-500">Nenhum local cadastrado nesta empresa. O escritório cadastra em Configurações › Locais.</div>}

      {novoLocal !== null && (
        <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div className="px-1 text-[12px] uppercase tracking-wide text-slate-500">Onde você está?</div>
          <ul className="mt-2 space-y-1.5">
            {locais.map((l) => (
              <li key={l}>
                <button type="button" onClick={() => criar(l)} className="flex min-h-14 w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 text-left text-[15px] font-medium active:bg-slate-800">
                  {l} <ChevronRight size={18} className="text-slate-500" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setNovoLocal(null)} className="mt-2 h-12 w-full rounded-xl text-[14px] text-slate-400 active:bg-slate-800">Cancelar</button>
        </div>
      )}

      <h2 className="mt-6 text-[13px] font-medium uppercase tracking-wide text-slate-400">Sessões abertas</h2>
      {abertas.length === 0 ? (
        <div className="mt-2 rounded-2xl border border-dashed border-slate-800 p-6 text-center text-[14px] text-slate-500">Nenhuma sessão aberta. Abra uma nova para começar a contar.</div>
      ) : (
        <ul className="mt-2 space-y-2">
          {abertas.map((s) => {
            const r = resumoSessao(s, store.materials)
            return (
              <li key={s.id}>
                <button type="button" onClick={() => setAtivaId(s.id)} className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-teal-500/40 bg-slate-900 px-4 py-3 text-left active:bg-slate-800">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{s.local}</span>
                    <span className="block text-[13px] text-slate-400">
                      {s.por} · aberta {relativo(s.abertaEm)} · {r.contados.length} de {s.itens.length} contados
                    </span>
                  </span>
                  <ChevronRight size={20} className="shrink-0 text-teal-300" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {fechadas.length > 0 && (
        <>
          <h2 className="mt-6 text-[13px] font-medium uppercase tracking-wide text-slate-400">Fechadas recentemente</h2>
          <ul className="mt-2 space-y-2">
            {fechadas.map((s) => {
              const r = resumoSessao(s, store.materials)
              return (
                <li key={s.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[15px] font-medium text-slate-200">{s.local}</span>
                    <span className={cx('shrink-0 text-[13px] font-semibold tabular-nums', r.valorDiverg > 0 ? 'text-amber-300' : 'text-emerald-300')}>{brl(r.valorDiverg)}</span>
                  </div>
                  <div className="text-[13px] text-slate-500">
                    {s.por} · {dataBR(s.fechadaEm ?? s.abertaEm)} · {s.itens.length} contados · {r.divergentes.length} divergente{r.divergentes.length === 1 ? '' : 's'} ({num(r.pct, 1)}%)
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
