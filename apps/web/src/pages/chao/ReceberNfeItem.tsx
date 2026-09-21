import { Camera, Check, Link2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { brl, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import { cx } from '../../ui'
import { cfopInfo, pendenteOcConsumo } from '../recebimento/nfeUtils'
import { MOTIVOS, type ItemConf } from './ReceberNfeTipos'

export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'info'; children: ReactNode }) {
  const t = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    danger: 'bg-red-500/15 text-red-300',
    neutral: 'bg-slate-800 text-slate-300',
    info: 'bg-sky-500/15 text-sky-300',
  }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium', t)}>{children}</span>
}

/** Cartão de um item da nota na conferência: CFOP, De-Para, OK/Divergente. */
export function ReceberNfeItem({ item: it, poIds, onPatch, onVincular }: { item: ItemConf; poIds: string[]; onPatch: (p: Partial<ItemConf>) => void; onVincular: () => void }) {
  const store = useStore()
  const { material } = useLookups()
  const info = cfopInfo(it.cfop)
  const m = it.materialId ? material(it.materialId) : undefined
  const fator = it.fator ?? m?.fatorConversao ?? 1
  const qtdRec = it.conf === 'divergente' ? (it.qtdRec ?? it.qCom) : it.qCom
  const convertida = Math.round(qtdRec * fator * 1000) / 1000
  const pendOc = it.materialId ? pendenteOcConsumo(poIds, it.materialId, store.purchaseOrders) : 0
  const divergOc = it.materialId && pendOc > 0 ? Math.abs(convertida - pendOc) / pendOc > 0.05 : false
  const naoEntra = it.classe === 'nao_entra'

  return (
    <article className={cx('rounded-2xl border p-4', naoEntra ? 'border-slate-800 bg-slate-950 opacity-70' : it.conf === 'divergente' ? 'border-amber-500/50 bg-slate-900' : it.conf === 'ok' ? 'border-emerald-500/40 bg-slate-900' : 'border-slate-800 bg-slate-900')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-tight">{it.xProd}</div>
          <div className="mt-0.5 font-mono text-[12px] text-slate-500">
            {it.cProd} · NCM {it.ncm}
          </div>
        </div>
        <Chip tone={info.auto ? 'ok' : it.classe ? 'info' : 'warn'}>CFOP {it.cfop}</Chip>
      </div>
      <div className="mt-1 text-[12px] text-slate-400">{info.label}</div>

      {!info.auto && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onPatch({ classe: 'entra' })} className={cx('h-12 rounded-xl text-[14px] font-medium', it.classe === 'entra' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300')}>
            Entra no estoque
          </button>
          <button type="button" onClick={() => onPatch({ classe: 'nao_entra' })} className={cx('h-12 rounded-xl text-[14px] font-medium', naoEntra ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-300')}>
            Não entra
          </button>
        </div>
      )}

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[13px] text-slate-400">Na nota</span>
        <span className="text-[20px] font-semibold tabular-nums">
          {num(it.qCom, it.qCom % 1 ? 2 : 0)} <span className="text-[14px] text-slate-400">{it.uCom}</span>
          <span className="ml-2 text-[13px] text-slate-500">{brl(it.vUnCom)}/{it.uCom}</span>
        </span>
      </div>

      {!naoEntra && (
        <div className="mt-3 rounded-xl bg-slate-800/60 p-3">
          {m ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">De-Para</div>
                  <div className="truncate text-[15px] font-medium text-teal-200">{m.nome}</div>
                  <div className="font-mono text-[12px] text-slate-500">
                    {m.sku} · 1 {it.uCom} = {num(fator, fator % 1 ? 2 : 0)} {m.unidadeConsumo}
                  </div>
                </div>
                <button type="button" onClick={onVincular} className="h-10 shrink-0 rounded-lg px-3 text-[13px] text-slate-300 active:bg-slate-700">
                  trocar
                </button>
              </div>
              <div className="mt-2 flex items-baseline justify-between">
                <span className="text-[13px] text-slate-400">Entra no estoque</span>
                <span className="text-[18px] font-semibold tabular-nums text-teal-300">
                  {num(convertida, convertida % 1 ? 2 : 0)} {m.unidadeConsumo}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[13px] text-slate-400">Pendente na OC</span>
                <span className="flex items-center gap-2 text-[14px] tabular-nums text-slate-300">
                  {pendOc > 0 ? `${num(pendOc, pendOc % 1 ? 2 : 0)} ${m.unidadeConsumo}` : '—'}
                  {divergOc && (
                    <Chip tone="danger">
                      <TriangleAlert size={12} /> divergente
                    </Chip>
                  )}
                </span>
              </div>
            </>
          ) : (
            <button type="button" onClick={onVincular} className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 text-[16px] font-semibold text-slate-950 active:bg-amber-300">
              <Link2 size={20} /> Vincular insumo
            </button>
          )}
        </div>
      )}

      {!naoEntra && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onPatch({ conf: 'ok' })} className={cx('flex h-14 items-center justify-center gap-2 rounded-xl text-[16px] font-semibold', it.conf === 'ok' ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200')}>
            <Check size={20} /> OK
          </button>
          <button type="button" onClick={() => onPatch({ conf: 'divergente', qtdRec: it.qtdRec ?? it.qCom })} className={cx('flex h-14 items-center justify-center gap-2 rounded-xl text-[16px] font-semibold', it.conf === 'divergente' ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-200')}>
            <TriangleAlert size={20} /> Divergente
          </button>
        </div>
      )}

      {!naoEntra && it.conf === 'divergente' && (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-500/30 p-3">
          <label className="block">
            <span className="text-[12px] text-slate-400">Quantidade recebida ({it.uCom})</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={it.qtdRec ?? it.qCom}
              onChange={(e) => onPatch({ qtdRec: Math.max(0, Number(e.target.value) || 0) })}
              className="mt-1 h-14 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[22px] font-semibold tabular-nums text-slate-100 focus:border-amber-400 focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {MOTIVOS.map((mo) => (
              <button key={mo} type="button" onClick={() => onPatch({ motivo: mo })} className={cx('h-11 rounded-full px-3 text-[13px]', it.motivo === mo ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300')}>
                {mo}
              </button>
            ))}
          </div>
          <label className="flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-600 px-3 text-[14px] text-slate-300">
            <Camera size={18} />
            {it.foto ? `Foto: ${it.foto}` : 'Tirar foto (opcional)'}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPatch({ foto: e.target.files?.[0]?.name })} />
          </label>
        </div>
      )}
    </article>
  )
}
