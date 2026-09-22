import { CalendarClock, FileSearch, FileUp, Loader2, PackageOpen, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth'
import { mensagemErro } from '../../data/erros'
import { enviarXmlNfe } from '../../data/nfeXml'
import { chaveFmt, dataBR } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { PurchaseOrder } from '../../domain/types'
import { cx } from '../../ui'
import { nfeDaChave, partesChave } from '../recebimento/nfeUtils'
import { beepAviso, beepErro, beepOk } from './feedback'
import Sheet from './Sheet'

/** Chave que o provedor "encontra" na demonstração (Embalagens Paulista, NF-e 9150). */
export const CHAVE_DEMO_PROVEDOR = '35260934567890000112550010000091501000091509'

type Estado = 'idle' | 'buscando' | 'falhou'

/** Folha "Nota não encontrada": a chave bipada é válida mas o XML não está no Prodio. */
export default function ReceberNaoEncontrada({ chave, ocs, onClose }: { chave: string; ocs: PurchaseOrder[]; onClose: () => void }) {
  const store = useStore()
  const { supplier } = useLookups()
  const { tenantId } = useAuth()
  const nav = useNavigate()
  const [provedor, setProvedor] = useState<Estado>('idle')
  const [erp, setErp] = useState<Estado>('idle')
  const [xml, setXml] = useState<string | null>(null)
  const [enviandoXml, setEnviandoXml] = useState(false)
  const [erroXml, setErroXml] = useState<string | null>(null)
  // Demonstração sem banco: a consulta ao provedor é encenada. Com banco de verdade não existe
  // rota de consulta por chave no worker, e fabricar a nota a partir do pendente da OC colocaria
  // um documento fiscal inventado em nfe_inbound — então o botão fica desligado com o motivo.
  const demo = store.modo === 'memoria'

  // OC sugerida pelo CNPJ do emitente (está na chave); senão a primeira aberta.
  const { cnpj } = partesChave(chave)
  const fornChave = store.suppliers.find((s) => s.cnpj === cnpj)
  const sugerida = ocs.find((po) => po.supplierId === fornChave?.id) ?? ocs[0]
  const [poId, setPoId] = useState<string | null>(sugerida?.id ?? null)
  const po = ocs.find((x) => x.id === poId)

  const erpNfe = store.connectors.find((c) => c.status === 'conectado' && c.capacidades.nfeCompra)
  const ocupado = provedor === 'buscando' || erp === 'buscando' || enviandoXml

  const consultarProvedor = () => {
    if (!demo) return
    setProvedor('buscando')
    window.setTimeout(() => {
      if (chave !== CHAVE_DEMO_PROVEDOR) {
        setProvedor('falhou')
        beepErro()
        return
      }
      store.addNfe(nfeDaChave(chave, 'dfe', po, store.materials, store.suppliers))
      beepOk()
      onClose()
      nav(`/chao/receber/${chave}`)
    }, 2000)
  }

  // Upload de XML: o arquivo vai para o worker, que roda o parser do core e grava a nota. A tela
  // não inventa item nenhum — só mostra o que voltou. Chave diferente da bipada é caso comum
  // (o operador escolheu o arquivo errado): o aviso diz isso e a nota fica no Recebimento.
  const enviarXml = async (arquivo: File | undefined) => {
    if (!arquivo) return
    setErroXml(null)
    setXml(arquivo.name)
    if (demo) {
      setErroXml('Sem banco configurado, o XML não é enviado a lugar nenhum. Este modo é só demonstração.')
      return
    }
    setEnviandoXml(true)
    try {
      const r = await enviarXmlNfe(arquivo, tenantId)
      await store.recarregar()
      beepOk()
      onClose()
      nav(`/chao/receber/${r.chave}`)
    } catch (e) {
      beepErro()
      setErroXml(mensagemErro(e))
    } finally {
      setEnviandoXml(false)
    }
  }

  // Buscar no ERP também depende de uma rota de consulta por chave no worker (findInboundNfe), que
  // ainda não existe: fora da demonstração o botão fica desligado em vez de encenar uma busca.
  const buscarErp = () => {
    if (!erpNfe || !demo) return
    setErp('buscando')
    window.setTimeout(() => {
      setErp('falhou')
      beepErro()
    }, 1500)
  }

  const receberCegas = () => {
    if (!po) return
    store.addNfe(nfeDaChave(chave, 'sem_xml', po, store.materials, store.suppliers))
    beepAviso()
    onClose()
    nav(`/chao/receber/${chave}`)
  }

  return (
    <Sheet titulo="Nota não encontrada" onClose={onClose}>
      <div className="rounded-xl bg-slate-800/70 p-3 font-mono text-[13px] leading-relaxed text-slate-300 break-all">{chaveFmt(chave)}</div>
      <p className="mt-3 text-[14px] text-slate-400">
        {fornChave ? `Emitida por ${fornChave.nome}. ` : ''}O XML desta nota ainda não chegou no Prodio. O que você quer fazer?
      </p>

      {/* OC a vincular */}
      <div className="mt-4">
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-slate-500">OC desta entrega</div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {ocs.map((x) => {
            const s = supplier(x.supplierId)
            const on = x.id === poId
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => setPoId(x.id)}
                className={cx('flex h-14 shrink-0 flex-col justify-center rounded-xl border px-3 text-left', on ? 'border-teal-400 bg-teal-500/10 text-teal-100' : 'border-slate-700 bg-slate-900 text-slate-300')}
              >
                <span className="text-[14px] font-medium">
                  OC {x.numero} {x.id === sugerida?.id && <span className="text-[11px] font-normal text-teal-300">· sugerida</span>}
                </span>
                <span className="flex items-center gap-1 text-[12px] text-slate-400">
                  <span className="max-w-[160px] truncate">{s?.nome}</span>
                  {x.entregaPrevista && (
                    <>
                      <CalendarClock size={12} /> {dataBR(x.entregaPrevista)}
                    </>
                  )}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setPoId(null)}
            className={cx('h-14 shrink-0 rounded-xl border px-3 text-[14px]', poId === null ? 'border-slate-400 bg-slate-800 text-slate-100' : 'border-slate-700 bg-slate-900 text-slate-400')}
          >
            Sem OC
          </button>
          {ocs.length === 0 && <span className="self-center text-[13px] text-slate-500">Nenhuma OC aberta para vincular.</span>}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={consultarProvedor}
          disabled={ocupado || !demo}
          className="flex h-16 w-full items-center gap-3 rounded-2xl border border-teal-500/40 bg-teal-500/10 px-4 text-left active:bg-teal-500/20 disabled:opacity-60"
        >
          {provedor === 'buscando' ? <Loader2 size={22} className="animate-spin text-teal-300" /> : <ScanSearch size={22} className="text-teal-300" />}
          <span className="flex-1">
            <span className="block text-[16px] font-medium">Consultar por chave no provedor</span>
            <span className={cx('block text-[12px]', provedor === 'falhou' ? 'text-red-300' : 'text-slate-400')}>
              {!demo
                ? 'Nenhum provedor de NF-e configurado — a consulta por chave ainda não está disponível. Use o XML ou receba às cegas.'
                : provedor === 'buscando'
                  ? 'Consultando a SEFAZ pelo provedor de NF-e…'
                  : provedor === 'falhou'
                    ? 'O provedor não encontrou esta chave. Tente o ERP, o XML ou receba às cegas.'
                    : 'Busca o XML na SEFAZ agora (demonstração)'}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={buscarErp}
          disabled={ocupado || !erpNfe || !demo}
          className="flex h-16 w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 text-left active:bg-slate-800 disabled:opacity-60"
        >
          {erp === 'buscando' ? <Loader2 size={22} className="animate-spin text-slate-300" /> : <FileSearch size={22} className="text-teal-300" />}
          <span className="flex-1">
            <span className="block text-[16px] font-medium">Buscar no ERP conectado</span>
            <span className={cx('block text-[12px]', erp === 'falhou' ? 'text-red-300' : 'text-slate-400')}>
              {!erpNfe
                ? 'Nenhum ERP com NF-e de compra conectado'
                : !demo
                  ? 'Busca por chave no ERP ainda não disponível'
                  : erp === 'buscando'
                    ? `Consultando ${erpNfe.nome.split(' ')[0]}…`
                    : erp === 'falhou'
                      ? 'O ERP não devolveu esta chave. Tente o XML ou receba às cegas.'
                      : `Procura a NF-e pela chave em ${erpNfe.nome.split(' ')[0]}`}
            </span>
          </span>
        </button>

        <label className={cx('flex h-16 items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4', enviandoXml ? 'opacity-60' : 'cursor-pointer active:bg-slate-800')}>
          {enviandoXml ? <Loader2 size={22} className="animate-spin text-teal-300" /> : <FileUp size={22} className="text-teal-300" />}
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-medium">Compartilhar XML</span>
            <span className={cx('block truncate text-[12px]', erroXml ? 'text-red-300' : 'text-slate-400')}>
              {erroXml ?? (enviandoXml ? `Enviando ${xml}…` : xml ? xml : 'Do e-mail, WhatsApp ou arquivos')}
            </span>
          </span>
          <input type="file" accept=".xml,text/xml" className="hidden" disabled={enviandoXml} onChange={(e) => void enviarXml(e.target.files?.[0])} />
        </label>

        <button
          type="button"
          onClick={receberCegas}
          disabled={ocupado || !po}
          className="flex h-16 w-full items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 text-left active:bg-amber-500/20 disabled:opacity-60"
        >
          <PackageOpen size={22} className="text-amber-300" />
          <span className="flex-1">
            <span className="block text-[16px] font-medium text-amber-100">Receber às cegas contra a OC</span>
            <span className="block text-[12px] text-amber-200/80">{po ? `Entra o que a OC ${po.numero} pede; o XML acerta depois` : 'Escolha uma OC acima'}</span>
          </span>
        </button>
      </div>
    </Sheet>
  )
}
