import { CalendarClock, ChevronRight, FileSearch, FileUp, Loader2, PackageOpen, ScanBarcode, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { chaveFmt, dataBR, hojeISO, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { PurchaseOrder } from '../../domain/types'
import { cx } from '../../ui'
import { ORIGEM_LABEL, validaChaveNfe } from '../recebimento/nfeUtils'
import { beepAviso, beepErro, beepOk } from './feedback'
import Scanner from './Scanner'
import Sheet from './Sheet'

const FORMATOS = ['code_128']
const CHAVE_DEMO = '35260912345678000190550010000482111000482119'

type Folha = null | { tipo: 'leitor' } | { tipo: 'nao_encontrada'; chave: string }

export default function Receber() {
  const store = useStore()
  const { supplier, material } = useLookups()
  const nav = useNavigate()
  const [folha, setFolha] = useState<Folha>(null)
  const [erroChave, setErroChave] = useState<string | null>(null)
  const hoje = hojeISO()

  const ocs = useMemo(() => {
    const abertas = store.purchaseOrders.filter((po) => po.status === 'aberta' || po.status === 'parcial')
    return abertas.sort((a, b) => {
      if (!a.entregaPrevista && !b.entregaPrevista) return b.numero - a.numero
      if (!a.entregaPrevista) return 1
      if (!b.entregaPrevista) return -1
      return a.entregaPrevista.localeCompare(b.entregaPrevista)
    })
  }, [store.purchaseOrders])

  const notas = useMemo(() => store.nfes.filter((n) => n.status === 'pendente' || n.status === 'aguardando_xml'), [store.nfes])

  const procurar = (raw: string) => {
    const digitos = raw.replace(/\D/g, '')
    const existente = store.nfes.find((n) => n.chave === digitos)
    if (existente) {
      beepOk()
      setFolha(null)
      nav(`/chao/receber/${existente.chave}`)
      return
    }
    const v = validaChaveNfe(digitos)
    if (!v.ok) {
      beepErro()
      setErroChave(v.motivo === 'tamanho' ? `A chave tem ${digitos.length} dígitos; precisa de 44.` : 'Dígito verificador inválido — confira a chave.')
      return
    }
    beepAviso()
    setErroChave(null)
    setFolha({ tipo: 'nao_encontrada', chave: v.chave })
  }

  return (
    <div className="px-4 pb-28">
      <h1 className="pt-1 text-2xl font-semibold tracking-tight">Receber hoje</h1>
      <p className="text-[14px] text-slate-400">{dataBR(new Date().toISOString())} · {ocs.length} OC{ocs.length === 1 ? '' : 's'} esperando entrega</p>

      <section className="mt-4 space-y-2">
        {ocs.map((po) => {
          const s = supplier(po.supplierId)
          const prev = po.entregaPrevista
          const atrasada = !!prev && prev < hoje
          const ehHoje = prev === hoje
          return (
            <article
              key={po.id}
              className={cx(
                'rounded-2xl border p-4',
                ehHoje ? 'border-teal-400/60 bg-teal-500/10' : atrasada ? 'border-amber-500/50 bg-amber-500/10' : 'border-slate-800 bg-slate-900',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[17px] font-semibold">{s?.nome ?? '—'}</div>
                  <div className="text-[13px] text-slate-400">
                    OC {po.numero} · {po.status === 'parcial' ? 'parcialmente recebida' : 'aberta'}
                  </div>
                </div>
                <span
                  className={cx(
                    'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium',
                    ehHoje ? 'bg-teal-400 text-slate-950' : atrasada ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300',
                  )}
                >
                  {!prev ? 'Sem data' : ehHoje ? 'Hoje' : atrasada ? `Atrasada · ${dataBR(prev)}` : dataBR(prev)}
                </span>
              </div>
              <ul className="mt-3 space-y-1 text-[14px]">
                {po.itens.map((it) => {
                  const m = material(it.materialId)
                  const pend = Math.max(0, it.qtd - it.qtdRecebida)
                  return (
                    <li key={it.id} className="flex justify-between gap-3">
                      <span className="truncate text-slate-300">{m?.nome ?? it.materialId}</span>
                      <span className="shrink-0 tabular-nums text-slate-400">
                        {num(pend, pend % 1 ? 2 : 0)} {it.unidadeCompra}
                        {it.qtdRecebida > 0 && <span className="text-slate-500"> (de {num(it.qtd)})</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </article>
          )
        })}
        {ocs.length === 0 && <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-slate-500">Nenhuma OC aberta.</div>}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-slate-400">Notas já conhecidas</h2>
        <ul className="space-y-2">
          {notas.map((n) => {
            const semDePara = n.itens.filter((i) => !i.materialId).length
            return (
              <li key={n.chave}>
                <button
                  type="button"
                  onClick={() => nav(`/chao/receber/${n.chave}`)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left active:bg-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-medium">{n.emitente}</div>
                    <div className="text-[13px] text-slate-400">
                      NF-e {n.numero} · {dataBR(n.emissao)} ·{' '}
                      <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', n.origem === 'sem_xml' ? 'bg-amber-500/20 text-amber-200' : 'bg-slate-800 text-slate-300')}>
                        {n.status === 'aguardando_xml' ? 'Aguardando XML' : ORIGEM_LABEL[n.origem]}
                      </span>
                      {semDePara > 0 && <span className="ml-1.5 text-amber-300">· {semDePara} sem De-Para</span>}
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-500" />
                </button>
              </li>
            )
          })}
          {notas.length === 0 && <li className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-slate-500">Nenhuma nota pendente.</li>}
        </ul>
      </section>

      <button
        type="button"
        onClick={() => procurar(CHAVE_DEMO)}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 text-[14px] text-slate-400 active:bg-slate-900"
      >
        <ScanBarcode size={16} /> Simular bipe da NF-e 48211
      </button>

      {/* Rodapé fixo */}
      <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pb-2" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
        <button
          type="button"
          onClick={() => {
            setErroChave(null)
            setFolha({ tipo: 'leitor' })
          }}
          className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-teal-500 text-[18px] font-semibold text-slate-950 shadow-lg shadow-teal-500/20 active:bg-teal-400"
        >
          <ScanBarcode size={26} /> Bipar nota fiscal
        </button>
      </div>

      {folha?.tipo === 'leitor' && (
        <Sheet titulo="Bipar a chave da NF-e" onClose={() => setFolha(null)}>
          <Scanner
            formats={FORMATOS}
            onRead={procurar}
            numeric
            mask={chaveFmt}
            placeholder="44 dígitos da chave…"
            hint="Code-128 no DANFE, logo abaixo do título. Leitor Bluetooth ou digitação também funcionam."
          />
          {erroChave && <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-[14px] text-red-200">{erroChave}</div>}
        </Sheet>
      )}

      {folha?.tipo === 'nao_encontrada' && (
        <NaoEncontrada
          chave={folha.chave}
          ocs={ocs}
          onClose={() => setFolha(null)}
          onCegas={(po) => nav(`/chao/receber/${folha.chave}`, { state: { semXml: { chave: folha.chave, poId: po.id } } })}
        />
      )}
    </div>
  )
}

function NaoEncontrada({ chave, ocs, onClose, onCegas }: { chave: string; ocs: PurchaseOrder[]; onClose: () => void; onCegas: (po: PurchaseOrder) => void }) {
  const { supplier } = useLookups()
  const [erp, setErp] = useState<'idle' | 'buscando' | 'falhou'>('idle')
  const [xml, setXml] = useState<string | null>(null)
  const [escolherOc, setEscolherOc] = useState(false)

  const buscarErp = () => {
    setErp('buscando')
    window.setTimeout(() => {
      setErp('falhou')
      beepErro()
    }, 1500)
  }

  return (
    <Sheet titulo="Nota não encontrada" onClose={onClose}>
      <div className="rounded-xl bg-slate-800/70 p-3 font-mono text-[13px] leading-relaxed text-slate-300 break-all">{chaveFmt(chave)}</div>
      <p className="mt-3 text-[14px] text-slate-400">O XML desta nota ainda não chegou no Prodio. O que você quer fazer?</p>

      <div className="mt-4 space-y-2">
        <label className="flex h-16 cursor-pointer items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 active:bg-slate-800">
          <FileUp size={22} className="text-teal-300" />
          <span className="flex-1">
            <span className="block text-[16px] font-medium">Compartilhar XML</span>
            <span className="block text-[12px] text-slate-400">{xml ? `${xml} — parser no servidor: em breve` : 'Do e-mail, WhatsApp ou arquivos'}</span>
          </span>
          <input type="file" accept=".xml,text/xml" className="hidden" onChange={(e) => setXml(e.target.files?.[0]?.name ?? null)} />
        </label>

        <button
          type="button"
          onClick={buscarErp}
          disabled={erp === 'buscando'}
          className="flex h-16 w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-left active:bg-slate-800 disabled:opacity-70"
        >
          {erp === 'buscando' ? <Loader2 size={22} className="animate-spin text-slate-300" /> : <FileSearch size={22} className="text-teal-300" />}
          <span className="flex-1">
            <span className="block text-[16px] font-medium">Buscar no ERP conectado</span>
            <span className={cx('block text-[12px]', erp === 'falhou' ? 'text-red-300' : 'text-slate-400')}>
              {erp === 'buscando' ? 'Consultando Bling…' : erp === 'falhou' ? 'O ERP não devolveu esta chave. Tente o XML ou receba às cegas.' : 'Procura a NF-e pela chave'}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setEscolherOc((v) => !v)}
          className="flex h-16 w-full items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 text-left active:bg-amber-500/20"
        >
          <PackageOpen size={22} className="text-amber-300" />
          <span className="flex-1">
            <span className="block text-[16px] font-medium text-amber-100">Receber às cegas contra a OC</span>
            <span className="block text-[12px] text-amber-200/80">Entra o que a OC pede; o XML acerta depois</span>
          </span>
        </button>

        {escolherOc && (
          <ul className="space-y-2 pl-2">
            {ocs.map((po) => {
              const s = supplier(po.supplierId)
              return (
                <li key={po.id}>
                  <button
                    type="button"
                    onClick={() => onCegas(po)}
                    className="flex h-14 w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 text-left active:bg-slate-800"
                  >
                    <Truck size={18} className="text-slate-400" />
                    <span className="flex-1 truncate">
                      <span className="font-medium">OC {po.numero}</span> <span className="text-slate-400">· {s?.nome}</span>
                    </span>
                    {po.entregaPrevista && (
                      <span className="flex items-center gap-1 text-[12px] text-slate-500">
                        <CalendarClock size={14} /> {dataBR(po.entregaPrevista)}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
            {ocs.length === 0 && <li className="text-[13px] text-slate-500">Nenhuma OC aberta para vincular.</li>}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
