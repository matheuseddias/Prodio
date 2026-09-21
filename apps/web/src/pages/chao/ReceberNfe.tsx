import { ArrowLeft, Check, FileQuestion, Link2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { brl, chaveFmt, dataBR } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeInbound, NfeItem, PurchaseOrder } from '../../domain/types'
import { ORIGEM_LABEL, cfopInfo, porOcFromItens, previsaoOcs } from '../recebimento/nfeUtils'
import { beepAviso, beepOk } from './feedback'
import { AguardandoXml, Sucesso } from './ReceberNfeAguardando'
import { Chip, ReceberNfeItem } from './ReceberNfeItem'
import { limpar, type ItemConf, type Resumo } from './ReceberNfeTipos'
import Sheet from './Sheet'
import VincularInsumoSheet from './VincularInsumoSheet'

export default function ReceberNfe() {
  const { chave = '' } = useParams()
  const store = useStore()
  const nfe = store.nfes.find((n) => n.chave === chave)

  if (!nfe) {
    return (
      <div className="px-4 pt-6 text-center">
        <FileQuestion size={40} className="mx-auto text-slate-500" />
        <h1 className="mt-3 text-xl font-semibold">Nota não encontrada</h1>
        <p className="mt-1 font-mono text-[13px] text-slate-500 break-all">{chaveFmt(chave)}</p>
        <Link to="/chao/receber" className="mt-6 inline-flex h-14 items-center gap-2 rounded-xl bg-slate-800 px-6 text-[16px] font-medium">
          <ArrowLeft size={18} /> Voltar para Receber hoje
        </Link>
      </div>
    )
  }

  if (nfe.status === 'aguardando_xml') {
    const po = store.purchaseOrders.find((p) => p.id === nfe.poIds[0])
    return <AguardandoXml key={nfe.chave} nfe={nfe} po={po} />
  }
  return <Conferencia key={nfe.chave} nfe={nfe} />
}

// ---------------------------------------------------------------------------
// Conferência com XML
// ---------------------------------------------------------------------------

function Conferencia({ nfe }: { nfe: NfeInbound }) {
  const store = useStore()
  const { material, supplier } = useLookups()
  const nav = useNavigate()
  const [itens, setItens] = useState<ItemConf[]>(() => nfe.itens.map((i) => ({ ...i })))
  const [poIds, setPoIds] = useState<string[]>(nfe.poIds)
  const [folha, setFolha] = useState<null | { tipo: 'vincular'; nItem: number } | { tipo: 'oc' }>(null)
  const [resumo, setResumo] = useState<Resumo | null>(null)

  const ocsLigadas = store.purchaseOrders.filter((po) => poIds.includes(po.id))
  const ocsDisponiveis = store.purchaseOrders.filter((po) => !poIds.includes(po.id) && (po.status === 'aberta' || po.status === 'parcial'))

  const setItem = (nItem: number, patch: Partial<ItemConf>) => setItens((arr) => arr.map((i) => (i.nItem === nItem ? { ...i, ...patch } : i)))

  const pronto = itens.every((it) => {
    const info = cfopInfo(it.cfop)
    const classificado = info.auto || !!it.classe
    const comDePara = it.classe === 'nao_entra' || !!it.materialId
    return classificado && comDePara
  })

  const vincularOc = (po: PurchaseOrder) => {
    const novos = [...poIds, po.id]
    setPoIds(novos)
    store.updateNfe({ ...nfe, poIds: novos })
    setFolha(null)
    beepAviso()
  }

  const confirmar = () => {
    const finais: NfeItem[] = itens.map((it) => {
      if (it.classe === 'nao_entra') return limpar({ ...it, materialId: undefined, fator: undefined, qtdConsumo: undefined })
      const qtdRec = it.conf === 'divergente' ? (it.qtdRec ?? it.qCom) : it.qCom
      const fator = it.fator ?? 1
      return limpar({ ...it, qtdConsumo: Math.round(qtdRec * fator * 1000) / 1000 })
    })
    const porOc = porOcFromItens(poIds, finais, store.purchaseOrders)
    const prev = previsaoOcs(poIds, porOc, store.purchaseOrders)
    store.updateNfe({ ...nfe, poIds })
    store.receiveNfe(nfe.chave, finais, porOc)
    beepOk()
    setResumo({
      entradas: finais
        .filter((i) => i.materialId && i.qtdConsumo)
        .map((i) => {
          const m = material(i.materialId!)
          return { nome: m?.nome ?? i.xProd, qtd: i.qtdConsumo!, un: m?.unidadeConsumo ?? '' }
        }),
      ocs: prev.map((p) => ({ numero: p.po.numero, status: p.status })),
    })
  }

  if (resumo) return <Sucesso resumo={resumo} onVoltar={() => nav('/chao/receber')} />

  const forn = supplier(nfe.supplierId)

  return (
    <div className="px-4 pb-32">
      <Link to="/chao/receber" className="mt-1 inline-flex h-11 items-center gap-1 text-[14px] text-slate-400">
        <ArrowLeft size={16} /> Receber hoje
      </Link>

      {/* Cabeçalho */}
      <header className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="text-[18px] font-semibold leading-tight">{nfe.emitente}</div>
        <div className="mt-1 text-[14px] text-slate-400">
          NF-e {nfe.numero} · série {nfe.serie} · emitida {dataBR(nfe.emissao)}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-2xl font-semibold tabular-nums text-teal-300">{brl(nfe.valorTotal)}</span>
          <Chip tone={nfe.origem === 'dfe' ? 'info' : 'neutral'}>{nfe.origem === 'dfe' ? 'Consulta por chave' : ORIGEM_LABEL[nfe.origem]}</Chip>
        </div>
        <div className="mt-2 font-mono text-[12px] leading-relaxed text-slate-500 break-all">{chaveFmt(nfe.chave)}</div>
        {forn && <div className="mt-1 text-[12px] text-slate-500">Fornecedor cadastrado: {forn.nome} · lead time {forn.leadTimeDias} d</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] uppercase tracking-wide text-slate-500">OCs</span>
          {ocsLigadas.map((po) => (
            <span key={po.id} className="rounded-full border border-teal-500/40 bg-teal-500/10 px-3 py-1 text-[13px] font-medium text-teal-200">
              OC {po.numero}
            </span>
          ))}
          {ocsLigadas.length === 0 && <span className="text-[13px] text-amber-300">nenhuma sugerida</span>}
          <button type="button" onClick={() => setFolha({ tipo: 'oc' })} className="flex h-9 items-center gap-1 rounded-full border border-dashed border-slate-600 px-3 text-[13px] text-slate-300 active:bg-slate-800">
            <Plus size={14} /> vincular outra
          </button>
        </div>
      </header>

      {/* Itens */}
      <h2 className="mb-2 mt-5 text-[13px] font-medium uppercase tracking-wide text-slate-400">
        Itens da nota · {itens.length}
      </h2>
      <div className="space-y-3">
        {itens.map((it) => (
          <ReceberNfeItem
            key={it.nItem}
            item={it}
            poIds={poIds}
            onPatch={(p) => setItem(it.nItem, p)}
            onVincular={() => setFolha({ tipo: 'vincular', nItem: it.nItem })}
          />
        ))}
      </div>

      {/* Rodapé fixo */}
      <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2">
        <button
          type="button"
          disabled={!pronto}
          onClick={confirmar}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 shadow-lg shadow-teal-500/20 active:bg-teal-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
        >
          <Check size={24} /> Confirmar recebimento
        </button>
        {!pronto && <div className="mt-1 text-center text-[12px] text-amber-300">Falta De-Para ou classificação em algum item.</div>}
      </div>

      {folha?.tipo === 'vincular' && (
        <VincularInsumoSheet
          item={itens.find((i) => i.nItem === folha.nItem)!}
          fornecedor={nfe.emitente}
          onClose={() => setFolha(null)}
          onPick={(materialId, fator) => {
            const it = itens.find((i) => i.nItem === folha.nItem)!
            setItem(folha.nItem, { materialId, fator, qtdConsumo: Math.round(it.qCom * fator * 1000) / 1000, classe: it.classe ?? (cfopInfo(it.cfop).auto ? undefined : 'entra') })
            setFolha(null)
            beepOk()
          }}
        />
      )}
      {folha?.tipo === 'oc' && (
        <Sheet titulo="Vincular outra OC" onClose={() => setFolha(null)}>
          <ul className="space-y-2">
            {ocsDisponiveis.map((po) => {
              const s = supplier(po.supplierId)
              const mesmoForn = po.supplierId === nfe.supplierId
              return (
                <li key={po.id}>
                  <button type="button" onClick={() => vincularOc(po)} className="flex h-16 w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-left active:bg-slate-800">
                    <Link2 size={18} className={mesmoForn ? 'text-teal-300' : 'text-slate-500'} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[16px] font-medium">
                        OC {po.numero} <span className="text-slate-400">· {s?.nome}</span>
                      </span>
                      <span className="block text-[12px] text-slate-500">
                        {po.itens.length} item{po.itens.length === 1 ? '' : 's'} · {po.entregaPrevista ? dataBR(po.entregaPrevista) : 'sem data'}
                        {mesmoForn && ' · mesmo fornecedor'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            {ocsDisponiveis.length === 0 && <li className="p-4 text-center text-slate-500">Nenhuma OC aberta disponível.</li>}
          </ul>
        </Sheet>
      )}
    </div>
  )
}
