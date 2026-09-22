import { CheckCircle2, Link2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { num } from '../../domain/format'
import { useStore } from '../../domain/store'
import { cx } from '../../ui'
import { norm, similaridade } from '../recebimento/nfeUtils'
import { Chip } from './ReceberNfeItem'
import type { ItemConf } from './ReceberNfeTipos'
import Sheet from './Sheet'

interface Props {
  item: ItemConf
  fornecedor: string
  /** Vínculo já gravado para este código neste fornecedor (supplier_materials), quando houver. */
  sugestao?: { materialId: string; fator?: number }
  /** A nota tem fornecedor cadastrado? Sem ele não há onde guardar o vínculo. */
  guarda: boolean
  onClose: () => void
  onPick: (materialId: string, fator: number) => void
}

/** Folha para escolher o insumo (De-Para) e o fator de conversão de um item da nota. */
export default function VincularInsumoSheet({ item, fornecedor, sugestao, guarda, onClose, onPick }: Props) {
  const store = useStore()
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<string | null>(item.materialId ?? sugestao?.materialId ?? null)
  const [fator, setFator] = useState<string>(String(item.fator ?? sugestao?.fator ?? ''))

  const lista = useMemo(() => {
    const q = norm(busca.trim())
    const base = q ? store.materials.filter((m) => norm(m.nome).includes(q) || norm(m.sku).includes(q)) : store.materials
    return base
      .map((m) => ({ m, score: similaridade(item.xProd, m.nome) }))
      .sort((a, b) => b.score - a.score || a.m.nome.localeCompare(b.m.nome))
  }, [busca, store.materials, item.xProd])

  const escolher = (id: string) => {
    setSel(id)
    const m = store.materials.find((x) => x.id === id)
    if (m) setFator(String(m.fatorConversao))
  }
  const selM = sel ? store.materials.find((x) => x.id === sel) : undefined
  const f = Number(fator.replace(',', '.'))
  const valido = !!selM && f > 0

  return (
    <Sheet titulo="Vincular insumo" onClose={onClose}>
      <div className="rounded-xl bg-slate-800/60 p-3 text-[14px]">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Item do fornecedor</div>
        <div className="font-medium">{item.xProd}</div>
        <div className="font-mono text-[12px] text-slate-500">{item.cProd} · {num(item.qCom)} {item.uCom}</div>
      </div>
      <div className="relative mt-3">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar insumo por nome ou SKU…"
          className="h-14 w-full rounded-xl border border-slate-700 bg-slate-900 pl-10 pr-3 text-[16px] text-slate-100 placeholder:text-slate-500 focus:border-teal-400 focus:outline-none"
        />
      </div>
      <ul className="mt-3 max-h-[36vh] space-y-1.5 overflow-y-auto">
        {lista.map(({ m, score }) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => escolher(m.id)}
              className={cx('flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left', sel === m.id ? 'border-teal-400 bg-teal-500/10' : 'border-slate-800 bg-slate-900 active:bg-slate-800')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{m.nome}</span>
                <span className="block font-mono text-[12px] text-slate-500">
                  {m.sku} · {m.unidadeCompra} → {m.unidadeConsumo} × {num(m.fatorConversao, m.fatorConversao % 1 ? 2 : 0)}
                </span>
              </span>
              {score > 0 && !busca && <Chip tone="info">sugestão</Chip>}
              {sel === m.id && <CheckCircle2 size={20} className="text-teal-300" />}
            </button>
          </li>
        ))}
        {lista.length === 0 && <li className="p-4 text-center text-slate-500">Nenhum insumo com esse nome.</li>}
      </ul>
      <label className="mt-3 block">
        <span className="text-[13px] text-slate-400">
          Fator: 1 {item.uCom} da nota = quantos {selM?.unidadeConsumo ?? '…'}?
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={fator}
          onChange={(e) => setFator(e.target.value)}
          placeholder="ex.: 7,7"
          className="mt-1 h-14 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-[20px] font-semibold tabular-nums text-slate-100 focus:border-teal-400 focus:outline-none"
        />
      </label>
      {valido && (
        <div className="mt-2 text-[13px] text-slate-400">
          {num(item.qCom)} {item.uCom} × {num(f, f % 1 ? 2 : 0)} = <span className="font-semibold text-teal-300">{num(item.qCom * f, (item.qCom * f) % 1 ? 2 : 0)} {selM!.unidadeConsumo}</span>
        </div>
      )}
      <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[13px] text-sky-200">
        {guarda ? `O vínculo fica salvo para as próximas notas de ${fornecedor}.` : 'Esta nota não está ligada a um fornecedor cadastrado: o vínculo vale só para ela.'}
      </div>
      <button
        type="button"
        disabled={!valido}
        onClick={() => onPick(sel!, f)}
        className="mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[17px] font-semibold text-slate-950 active:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500"
      >
        <Link2 size={20} /> Vincular
      </button>
    </Sheet>
  )
}
