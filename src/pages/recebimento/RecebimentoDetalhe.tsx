import { AlertTriangle, Ban, Check, Link2, Monitor } from 'lucide-react'
import { useState } from 'react'
import { brl, chaveFmt, dataBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeInbound, NfeItem } from '../../domain/types'
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Td, Th, cx } from '../../ui'
import { ORIGEM_LABEL, ORIGEM_TONE, STATUS_LABEL, STATUS_TONE, cfopInfo, porOcFromItens, previsaoOcs } from './nfeUtils'

export function DetalheNfe({ nfe, fornecedor, onClose }: { nfe: NfeInbound; fornecedor?: string; onClose: () => void }) {
  const store = useStore()
  const { material } = useLookups()
  const [vinculando, setVinculando] = useState<number | null>(null)
  const [selMat, setSelMat] = useState('')
  const [fator, setFator] = useState('')
  const [ignorando, setIgnorando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [feito, setFeito] = useState<string | null>(null)

  const ocs = store.purchaseOrders.filter((po) => nfe.poIds.includes(po.id))
  const semDePara = nfe.itens.filter((i) => !i.materialId).length
  const podeReceber = nfe.status !== 'recebida' && nfe.status !== 'ignorada' && nfe.itens.length > 0 && semDePara === 0

  const abrirVinculo = (it: NfeItem) => {
    setVinculando(it.nItem)
    setSelMat(it.materialId ?? '')
    setFator(it.fator ? String(it.fator) : '')
  }
  const salvarVinculo = () => {
    const f = Number(fator.replace(',', '.'))
    if (!selMat || !(f > 0) || vinculando === null) return
    store.updateNfe({
      ...nfe,
      itens: nfe.itens.map((i) => (i.nItem === vinculando ? { ...i, materialId: selMat, fator: f, qtdConsumo: Math.round(i.qCom * f * 1000) / 1000 } : i)),
    })
    setVinculando(null)
  }
  const ignorar = () => {
    store.updateNfe({ ...nfe, status: 'ignorada' })
    setFeito(`Nota ${nfe.numero} ignorada${motivo ? `: ${motivo}` : ''}.`)
    setIgnorando(false)
  }
  const receber = () => {
    const itens = nfe.itens.map((i) => {
      const info = cfopInfo(i.cfop)
      if (!info.auto) return { ...i, materialId: undefined, fator: undefined, qtdConsumo: undefined }
      return { ...i, qtdConsumo: Math.round(i.qCom * (i.fator ?? 1) * 1000) / 1000 }
    })
    const porOc = porOcFromItens(nfe.poIds, itens, store.purchaseOrders)
    const prev = previsaoOcs(nfe.poIds, porOc, store.purchaseOrders)
    store.receiveNfe(nfe.chave, itens, porOc)
    const ocTxt = prev.map((p) => `OC ${p.po.numero} ${p.status === 'total' ? 'baixada' : p.status === 'parcial' ? 'parcial' : 'sem baixa'}`).join(', ')
    setFeito(`Nota ${nfe.numero} recebida no computador. ${ocTxt || 'Sem OC vinculada.'}`)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`NF-e ${nfe.numero} · ${nfe.emitente}`}
      size="xl"
      footer={
        <>
          {nfe.status !== 'ignorada' && nfe.status !== 'recebida' && (
            <Button variant="danger" onClick={() => setIgnorando(true)}>
              <Ban size={16} /> Ignorar nota
            </Button>
          )}
          <Button variant="primary" disabled={!podeReceber} onClick={receber} title={podeReceber ? 'Recebe sem passar pelo celular' : 'Vincule todos os itens antes de receber'}>
            <Monitor size={16} /> Receber no computador
          </Button>
        </>
      }
    >
      {feito && (
        <div className="mb-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok flex items-center gap-2">
          <Check size={16} /> {feito}
        </div>
      )}
      <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <span className="text-muted">Fornecedor: </span>
          {fornecedor ?? <span className="text-warn">não cadastrado ({nfe.emitente})</span>}
        </div>
        <div>
          <span className="text-muted">Emissão: </span>
          {dataBR(nfe.emissao)} · série {nfe.serie}
        </div>
        <div>
          <span className="text-muted">Valor: </span>
          <span className="font-medium">{brl(nfe.valorTotal)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Status: </span>
          <Badge tone={STATUS_TONE[nfe.status]}>{STATUS_LABEL[nfe.status]}</Badge>
          <Badge tone={ORIGEM_TONE[nfe.origem]}>{ORIGEM_LABEL[nfe.origem]}</Badge>
        </div>
        <div className="sm:col-span-2 font-mono text-[12px] text-muted break-all">{chaveFmt(nfe.chave)}</div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
          <span className="text-muted">OCs:</span>
          {ocs.map((po) => (
            <Badge key={po.id} tone="accent">
              OC {po.numero} · {po.status}
            </Badge>
          ))}
          {ocs.length === 0 && <span className="text-faint">nenhuma</span>}
        </div>
      </div>

      <div className="mt-4 -mx-5">
        {nfe.itens.length === 0 ? (
          <EmptyState
            title="Sem itens"
            description={nfe.origem === 'sem_xml' ? 'Recebida às cegas contra a OC. Os itens aparecem quando o XML chegar por e-mail, ERP ou consulta por chave.' : 'Esta nota está aguardando o XML. Os itens aparecem quando o arquivo chegar.'}
          />
        ) : (
          <table className="w-full text-sm min-w-[880px]">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Produto do fornecedor</Th>
                <Th>CFOP</Th>
                <Th right>Qtd</Th>
                <Th right>Valor</Th>
                <Th>Insumo vinculado</Th>
                <Th right>Fator</Th>
                <Th right>Convertido</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {nfe.itens.map((it) => {
                const m = it.materialId ? material(it.materialId) : undefined
                const info = cfopInfo(it.cfop)
                const conv = it.qtdConsumo ?? (it.fator ? it.qCom * it.fator : undefined)
                return (
                  <tr key={it.nItem}>
                    <Td className="text-muted">{it.nItem}</Td>
                    <Td>
                      <div className="font-medium">{it.xProd}</div>
                      <div className="font-mono text-[12px] text-muted">
                        {it.cProd} · NCM {it.ncm}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={info.auto ? 'ok' : 'warn'}>{it.cfop}</Badge>
                      <div className="text-[11px] text-muted mt-0.5">{info.label}</div>
                    </Td>
                    <Td right>
                      {num(it.qCom, it.qCom % 1 ? 2 : 0)} {it.uCom}
                    </Td>
                    <Td right>
                      <div>{brl(it.vProd)}</div>
                      <div className="text-[11px] text-muted">{brl(it.vUnCom)}/{it.uCom}</div>
                    </Td>
                    <Td>
                      {m ? (
                        <>
                          <div className="font-medium">{m.nome}</div>
                          <div className="font-mono text-[12px] text-muted">{m.sku}</div>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warn">
                          <AlertTriangle size={14} /> sem De-Para
                        </span>
                      )}
                    </Td>
                    <Td right>{it.fator ? num(it.fator, it.fator % 1 ? 2 : 0) : <span className="text-faint">—</span>}</Td>
                    <Td right>
                      {conv !== undefined && m ? (
                        <span className="font-medium">
                          {num(conv, conv % 1 ? 2 : 0)} {m.unidadeConsumo}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                    <Td>
                      {nfe.status !== 'recebida' && nfe.status !== 'ignorada' && (
                        <Button size="sm" onClick={() => abrirVinculo(it)}>
                          <Link2 size={14} /> {m ? 'Trocar' : 'Vincular insumo'}
                        </Button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {vinculando !== null && (
        <div className="mt-4 rounded-lg border border-border bg-surface-2/50 p-4">
          <div className="mb-3 text-sm font-medium">Vincular insumo ao item {vinculando}</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <Field label="Insumo">
              <Select
                value={selMat}
                onChange={(e) => {
                  setSelMat(e.target.value)
                  const m = store.materials.find((x) => x.id === e.target.value)
                  if (m) setFator(String(m.fatorConversao))
                }}
              >
                <option value="">Selecione…</option>
                {store.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.sku} · {m.nome} ({m.unidadeCompra} → {m.unidadeConsumo})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fator (un. nota → un. consumo)">
              <Input value={fator} onChange={(e) => setFator(e.target.value)} inputMode="decimal" placeholder="ex.: 7,7" />
            </Field>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setVinculando(null)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={salvarVinculo} disabled={!selMat || !(Number(fator.replace(',', '.')) > 0)}>
                Salvar vínculo
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-muted">O vínculo fica salvo para as próximas notas deste fornecedor.</p>
        </div>
      )}

      {ignorando && (
        <div className={cx('mt-4 rounded-lg border border-danger/30 bg-danger-soft/40 p-4')}>
          <div className="mb-2 text-sm font-medium">Ignorar esta nota?</div>
          <p className="mb-3 text-[13px] text-muted">Ela some dos pendentes e nada entra no estoque. Use para remessas, consertos e notas que não são compra.</p>
          <Field label="Motivo">
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: remessa para conserto, não é compra" />
          </Field>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIgnorando(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={ignorar}>
              <Ban size={16} /> Confirmar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
