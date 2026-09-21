import { ArrowLeft, Camera, Check, CheckCircle2, FileQuestion, Link2, Plus, Search, TriangleAlert } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useChaoSession } from '../../app/MobileShell'
import { brl, chaveFmt, dataBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeInbound, NfeItem, PurchaseOrder } from '../../domain/types'
import { cx } from '../../ui'
import { ORIGEM_LABEL, cfopInfo, pendenteOcConsumo, porOcFromItens, previsaoOcs, similaridade, norm } from '../recebimento/nfeUtils'
import { beepAviso, beepErro, beepOk } from './feedback'
import Sheet from './Sheet'

type Conf = 'ok' | 'divergente'
type Classe = 'entra' | 'nao_entra'
interface ItemConf extends NfeItem {
  conf?: Conf
  qtdRec?: number
  motivo?: string
  foto?: string
  classe?: Classe
}

interface Resumo {
  entradas: { nome: string; qtd: number; un: string }[]
  ocs: { numero: number; status: 'total' | 'parcial' | 'sem_baixa' }[]
}

const MOTIVOS = ['Faltou volume', 'Veio a mais', 'Avaria', 'Item trocado', 'Outro']

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'info'; children: ReactNode }) {
  const t = {
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    danger: 'bg-red-500/15 text-red-300',
    neutral: 'bg-slate-800 text-slate-300',
    info: 'bg-sky-500/15 text-sky-300',
  }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium', t)}>{children}</span>
}

const limpar = (it: ItemConf): NfeItem => {
  const { nItem, cProd, xProd, ncm, cfop, uCom, qCom, vUnCom, vProd, materialId, fator, qtdConsumo } = it
  return { nItem, cProd, xProd, ncm, cfop, uCom, qCom, vUnCom, vProd, materialId, fator, qtdConsumo }
}

export default function ReceberNfe() {
  const { chave = '' } = useParams()
  const loc = useLocation()
  const semXml = (loc.state as { semXml?: { chave: string; poId: string } } | null)?.semXml
  const store = useStore()
  const nfe = store.nfes.find((n) => n.chave === chave)

  if (!nfe && !semXml) {
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

  if (!nfe || nfe.status === 'aguardando_xml') {
    const po = store.purchaseOrders.find((p) => p.id === (nfe?.poIds[0] ?? semXml?.poId))
    return <AguardandoXml chave={chave} nfe={nfe} po={po} />
  }
  return <Conferencia nfe={nfe} />
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
          <Chip tone="neutral">{ORIGEM_LABEL[nfe.origem]}</Chip>
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
          <ItemCard
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
        <VincularSheet
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

function ItemCard({ item: it, poIds, onPatch, onVincular }: { item: ItemConf; poIds: string[]; onPatch: (p: Partial<ItemConf>) => void; onVincular: () => void }) {
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

function VincularSheet({ item, fornecedor, onClose, onPick }: { item: ItemConf; fornecedor: string; onClose: () => void; onPick: (materialId: string, fator: number) => void }) {
  const store = useStore()
  const [busca, setBusca] = useState('')
  const [sel, setSel] = useState<string | null>(item.materialId ?? null)
  const [fator, setFator] = useState<string>(item.fator ? String(item.fator) : '')

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
        O vínculo fica salvo para as próximas notas de {fornecedor}.
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

// ---------------------------------------------------------------------------
// Aguardando XML / recebimento às cegas
// ---------------------------------------------------------------------------

function AguardandoXml({ chave, nfe, po }: { chave: string; nfe?: NfeInbound; po?: PurchaseOrder }) {
  const store = useStore()
  const { material, supplier } = useLookups()
  const { operador } = useChaoSession()
  const nav = useNavigate()
  const [qtds, setQtds] = useState<Record<string, number>>(() => Object.fromEntries((po?.itens ?? []).map((pi) => [pi.id, Math.max(0, pi.qtd - pi.qtdRecebida)])))
  const [resumo, setResumo] = useState<Resumo | null>(null)

  if (resumo) return <Sucesso resumo={resumo} onVoltar={() => nav('/chao/receber')} />

  const forn = po ? supplier(po.supplierId) : undefined

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
    if (nfe) {
      store.receiveNfe(nfe.chave, itens, porOc)
    } else {
      // Sem ação addNfe no store: aplica entradas e baixa a OC diretamente.
      for (const it of itens) {
        store.addStockMove({ materialId: it.materialId!, tipo: 'entrada_nfe', delta: it.qtdConsumo!, custoUnit: it.vUnCom / (it.fator || 1), ref: `NF-e ${chave.slice(25, 34).replace(/^0+/, '')} (sem XML)`, por: operador ?? 'Recebimento' })
      }
      const itensPo = po.itens.map((pi) => ({ ...pi, qtdRecebida: pi.qtdRecebida + (porOc[pi.id] ?? 0) }))
      const completo = itensPo.every((pi) => pi.qtdRecebida >= pi.qtd)
      store.updatePurchaseOrder({ ...po, itens: itensPo, status: completo ? 'recebida' : 'parcial' })
    }
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
          {nfe ? `NF-e ${nfe.numero} · ${nfe.emitente}` : forn ? `Nota de ${forn.nome}` : 'Nota sem XML'} · a nota fiscal ainda não chegou no Prodio.
        </div>
        <div className="mt-2 font-mono text-[12px] text-amber-100/60 break-all">{chaveFmt(chave)}</div>
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

function Sucesso({ resumo, onVoltar }: { resumo: Resumo; onVoltar: () => void }) {
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
