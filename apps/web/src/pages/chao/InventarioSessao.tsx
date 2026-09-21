import { ArrowLeft, CheckCircle2, ClipboardCheck, ScanBarcode, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { num, relativo } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Material } from '../../domain/types'
import { cx } from '../../ui'
import { REGRA_ABC_PADRAO, casasDe, novoItem, resumoSessao, sugestoes, unLabel, type ItemSessao, type SessaoInventario } from '../estoque/inventarioSessoes'
import InventarioItem from './InventarioItem'
import { beepErro, beepOk } from './feedback'
import Sheet from './Sheet'

interface Props {
  sessao: SessaoInventario
  todas: SessaoInventario[]
  onChange: (s: SessaoInventario) => void
  onFechar: () => void
  onVoltar: () => void
}

/** Contagem de uma sessão aberta no celular. */
export default function InventarioSessao({ sessao: s, todas, onChange, onFechar, onVoltar }: Props) {
  const { materials } = useStore()
  const [bipados, setBipados] = useState<string[]>([])
  const [escolher, setEscolher] = useState(false)

  const r = useMemo(() => resumoSessao(s, materials), [s, materials])
  const ids = s.itens.map((i) => i.materialId)
  const sugestao = useMemo(() => {
    const sg = sugestoes(materials, todas, REGRA_ABC_PADRAO)
    return Array.from(new Set([...sg.venceHoje, ...sg.abaixoMinimo, ...sg.maisCaros])).slice(0, 5)
  }, [materials, todas])

  const adicionar = (lista: string[]) => {
    const faltam = lista.filter((id) => !ids.includes(id)).map((id) => materials.find((m) => m.id === id)).filter((m): m is Material => !!m)
    if (faltam.length) onChange({ ...s, itens: [...s.itens, ...faltam.map(novoItem)] })
  }
  const remover = (id: string) => onChange({ ...s, itens: s.itens.filter((i) => i.materialId !== id) })
  const upd = (id: string, patch: Partial<ItemSessao>) => onChange({ ...s, itens: s.itens.map((i) => (i.materialId === id ? { ...i, ...patch } : i)) })

  const biparInsumo = () => {
    // Simulação: "lê" a etiqueta de um insumo e o traz para a sessão.
    const fora = materials.filter((m) => !ids.includes(m.id))
    const alvo = fora.length ? fora[Math.floor(Math.random() * fora.length)] : materials.find((m) => ids.includes(m.id))
    if (!alvo) return beepErro()
    adicionar([alvo.id])
    setBipados((b) => (b.includes(alvo.id) ? b : [...b, alvo.id]))
    beepOk()
    window.setTimeout(() => document.getElementById(`cont-${alvo.id}`)?.focus(), 50)
  }

  return (
    <div className="px-4 pb-32">
      <button type="button" onClick={onVoltar} className="-ml-2 flex h-12 items-center gap-1.5 pr-3 text-[14px] text-slate-400 active:text-slate-200">
        <ArrowLeft size={18} /> Sessões
      </button>
      <h1 className="text-2xl font-semibold tracking-tight">{s.local}</h1>
      <p className="text-[14px] text-slate-400">
        {s.por} · aberta {relativo(s.abertaEm)} · {r.contados.length} de {s.itens.length} contados
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => adicionar(sugestao)} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 text-[14px] font-medium text-slate-200 active:bg-slate-800">
          <Sparkles size={18} className="text-amber-300" /> Sugerir 5
        </button>
        <button type="button" onClick={() => setEscolher(true)} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 text-[14px] font-medium text-slate-200 active:bg-slate-800">
          <ClipboardCheck size={18} /> Escolher insumos
        </button>
      </div>
      <button type="button" onClick={biparInsumo} className="mt-2 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-slate-800 text-[15px] font-semibold text-teal-200 active:bg-slate-700">
        <ScanBarcode size={20} /> Bipar etiqueta do insumo
      </button>

      {s.itens.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-800 p-8 text-center text-[14px] text-slate-500">
          Nenhum insumo na sessão. Toque em <strong className="text-slate-300">Sugerir 5</strong> ou bipe uma etiqueta de prateleira.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {r.itens.map((a) => (
            <InventarioItem key={a.item.materialId} a={a} bipado={bipados.includes(a.item.materialId)} onChange={(patch) => upd(a.item.materialId, patch)} onRemover={() => remover(a.item.materialId)} />
          ))}
          <p className="px-1 text-[12px] text-slate-500">Sobras aproveitáveis contam como estoque. Quebra e caco não: viram diferença com motivo «Quebra».</p>
        </div>
      )}

      {s.itens.length > 0 && (
        <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2">
          <button
            type="button"
            disabled={r.contados.length === 0 || r.semMotivo.length > 0}
            onClick={onFechar}
            className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 shadow-lg shadow-teal-500/20 active:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
          >
            <ClipboardCheck size={24} /> Fechar sessão
          </button>
          <div className="mt-1 text-center text-[12px] text-slate-500">
            {r.contados.length} de {s.itens.length} contado{r.contados.length === 1 ? '' : 's'} · {r.divergentes.length} ajuste{r.divergentes.length === 1 ? '' : 's'} a lançar
            {r.semMotivo.length > 0 && <span className="text-amber-300"> · falta motivo em {r.semMotivo.length}</span>}
          </div>
        </div>
      )}

      {escolher && (
        <Sheet titulo="Insumos para contar" onClose={() => setEscolher(false)}>
          <ul className="space-y-1.5">
            {materials.map((m) => {
              const on = ids.includes(m.id)
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => (on ? remover(m.id) : adicionar([m.id]))}
                    className={cx('flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left', on ? 'border-teal-400 bg-teal-500/10' : 'border-slate-800 bg-slate-900 active:bg-slate-800')}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{m.nome}</span>
                      <span className="block font-mono text-[12px] text-slate-500">
                        {m.sku} · {num(m.saldo, casasDe(m))} {unLabel(m.unidadeConsumo)}
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
            Pronto · {ids.length} selecionado{ids.length === 1 ? '' : 's'}
          </button>
        </Sheet>
      )}
    </div>
  )
}
