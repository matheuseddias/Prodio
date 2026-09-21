import { ArrowLeft, Check, CheckCircle2, FileQuestion } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { chaveFmt, dataBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeInbound, NfeItem, PurchaseOrder } from '../../domain/types'
import { porOcFromItens, previsaoOcs } from '../recebimento/nfeUtils'
import { beepErro, beepOk } from './feedback'
import { Chip } from './ReceberNfeItem'
import type { Resumo } from './ReceberNfeTipos'

/** Nota criada sem XML (recebimento às cegas): entra o que a OC pede; o XML concilia depois. */
export function AguardandoXml({ nfe, po }: { nfe: NfeInbound; po?: PurchaseOrder }) {
  const store = useStore()
  const { material, supplier } = useLookups()
  const nav = useNavigate()
  const [qtds, setQtds] = useState<Record<string, number>>(() => Object.fromEntries((po?.itens ?? []).map((pi) => [pi.id, Math.max(0, pi.qtd - pi.qtdRecebida)])))
  const [resumo, setResumo] = useState<Resumo | null>(null)

  if (resumo) return <Sucesso resumo={resumo} onVoltar={() => nav('/chao/receber')} />

  const forn = supplier(nfe.supplierId) ?? (po ? supplier(po.supplierId) : undefined)

  const receberCegas = () => {
    if (!po) return
    const itens: NfeItem[] = po.itens
      .filter((pi) => (qtds[pi.id] ?? 0) > 0)
      .map((pi, idx) => {
        const m = material(pi.materialId)
        const q = qtds[pi.id] ?? 0
        return {
          nItem: idx + 1,
          cProd: m?.sku ?? pi.materialId,
          xProd: m?.nome ?? pi.materialId,
          ncm: m?.ncm ?? '',
          cfop: '5102',
          uCom: pi.unidadeCompra,
          qCom: q,
          vUnCom: pi.preco,
          vProd: Math.round(q * pi.preco * 100) / 100,
          materialId: pi.materialId,
          fator: pi.fator,
          qtdConsumo: Math.round(q * pi.fator * 1000) / 1000,
        }
      })
    if (!itens.length) {
      beepErro()
      return
    }
    const porOc = porOcFromItens([po.id], itens, store.purchaseOrders)
    const prev = previsaoOcs([po.id], porOc, store.purchaseOrders)
    if (!nfe.poIds.includes(po.id)) store.updateNfe({ ...nfe, poIds: [...nfe.poIds, po.id] })
    store.receiveNfe(nfe.chave, itens, porOc)
    beepOk()
    setResumo({
      entradas: itens.map((i) => {
        const m = material(i.materialId!)
        return { nome: m?.nome ?? i.xProd, qtd: i.qtdConsumo!, un: m?.unidadeConsumo ?? '' }
      }),
      ocs: prev.map((p) => ({ numero: p.po.numero, status: p.status })),
    })
  }

  return (
    <div className="px-4 pb-32">
      <Link to="/chao/receber" className="mt-1 inline-flex h-11 items-center gap-1 text-[14px] text-slate-400">
        <ArrowLeft size={16} /> Receber hoje
      </Link>
      <header className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
        <div className="flex items-center gap-2 text-amber-200">
          <FileQuestion size={22} />
          <span className="text-[18px] font-semibold">Aguardando XML</span>
        </div>
        <div className="mt-1 text-[14px] text-amber-100/80">
          NF-e {nfe.numero} · {forn?.nome ?? nfe.emitente} · a nota fiscal ainda não chegou no Prodio.
        </div>
        <div className="mt-2 font-mono text-[12px] text-amber-100/60 break-all">{chaveFmt(nfe.chave)}</div>
        {po && (
          <div className="mt-2 text-[13px] text-amber-100/80">
            Base: <strong>OC {po.numero}</strong> {po.entregaPrevista && `· prevista ${dataBR(po.entregaPrevista)}`}
          </div>
        )}
      </header>

      <h2 className="mb-2 mt-5 text-[13px] font-medium uppercase tracking-wide text-slate-400">Itens da OC (o que está chegando)</h2>
      {!po && <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-slate-500">Nenhuma OC vinculada a esta nota.</div>}
      <div className="space-y-3">
        {po?.itens.map((pi) => {
          const m = material(pi.materialId)
          const pend = Math.max(0, pi.qtd - pi.qtdRecebida)
          const q = qtds[pi.id] ?? 0
          return (
            <article key={pi.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-[16px] font-semibold">{m?.nome ?? pi.materialId}</div>
              <div className="font-mono text-[12px] text-slate-500">
                {m?.sku} · pendente {num(pend)} {pi.unidadeCompra} · 1 {pi.unidadeCompra} = {num(pi.fator, pi.fator % 1 ? 2 : 0)} {m?.unidadeConsumo}
              </div>
              <label className="mt-3 block">
                <span className="text-[12px] text-slate-400">Recebido ({pi.unidadeCompra})</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={q}
                  onChange={(e) => setQtds((s) => ({ ...s, [pi.id]: Math.max(0, Number(e.target.value) || 0) }))}
                  className="mt-1 h-14 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-[22px] font-semibold tabular-nums text-slate-100 focus:border-teal-400 focus:outline-none"
                />
              </label>
              <div className="mt-2 flex items-baseline justify-between text-[14px]">
                <span className="text-slate-400">Entra no estoque</span>
                <span className="font-semibold tabular-nums text-teal-300">
                  {num(q * pi.fator, (q * pi.fator) % 1 ? 2 : 0)} {m?.unidadeConsumo}
                </span>
              </div>
            </article>
          )
        })}
      </div>

      <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2">
        <button
          type="button"
          disabled={!po}
          onClick={receberCegas}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 text-[18px] font-semibold text-slate-950 shadow-lg shadow-amber-500/20 active:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
        >
          <Check size={24} /> Receber às cegas contra a OC
        </button>
        <div className="mt-1 text-center text-[12px] text-slate-500">Quando o XML chegar, o escritório concilia os valores.</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function Sucesso({ resumo, onVoltar }: { resumo: Resumo; onVoltar: () => void }) {
  return (
    <div className="flex min-h-full flex-col px-4 pb-6 pt-8">
      <div className="text-center">
        <CheckCircle2 size={64} className="mx-auto text-emerald-400" strokeWidth={2.2} />
        <h1 className="mt-3 text-2xl font-bold">Recebimento confirmado</h1>
        <p className="mt-1 text-[14px] text-slate-400">O estoque já foi atualizado.</p>
      </div>
      <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-slate-400">Entrou no estoque</h2>
        <ul className="mt-2 space-y-1.5">
          {resumo.entradas.map((e, i) => (
            <li key={i} className="flex justify-between gap-3 text-[15px]">
              <span className="truncate">{e.nome}</span>
              <span className="shrink-0 font-semibold tabular-nums text-emerald-300">
                +{num(e.qtd, e.qtd % 1 ? 2 : 0)} {e.un}
              </span>
            </li>
          ))}
          {resumo.entradas.length === 0 && <li className="text-slate-500">Nenhum item entrou no estoque.</li>}
        </ul>
      </section>
      <section className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-[13px] font-medium uppercase tracking-wide text-slate-400">Ordens de compra</h2>
        <ul className="mt-2 space-y-1.5">
          {resumo.ocs.map((o) => (
            <li key={o.numero} className="flex justify-between text-[15px]">
              <span>OC {o.numero}</span>
              <Chip tone={o.status === 'total' ? 'ok' : o.status === 'parcial' ? 'warn' : 'neutral'}>
                {o.status === 'total' ? 'baixa total' : o.status === 'parcial' ? 'baixa parcial' : 'sem baixa'}
              </Chip>
            </li>
          ))}
          {resumo.ocs.length === 0 && <li className="text-slate-500">Nenhuma OC vinculada.</li>}
        </ul>
      </section>
      <button type="button" onClick={onVoltar} className="mt-auto flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 active:bg-teal-400">
        <ArrowLeft size={22} /> Voltar para Receber hoje
      </button>
    </div>
  )
}
