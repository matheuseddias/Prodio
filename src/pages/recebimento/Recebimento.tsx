import { AlertTriangle, Ban, Check, Copy, FileUp, Link2, Mail, Monitor, Plug, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, chaveFmt, dataBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeInbound, NfeItem } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Stat, Table, Tabs, Td, Th, cx, type Tone } from '../../ui'
import { ORIGEM_LABEL, STATUS_LABEL, cfopInfo, porOcFromItens, previsaoOcs } from './nfeUtils'

type Tab = 'pendentes' | 'recebidas' | 'ignoradas' | 'todas'

const STATUS_TONE: Record<NfeInbound['status'], Tone> = {
  aguardando_xml: 'warn',
  pendente: 'info',
  conferida: 'accent',
  recebida: 'ok',
  ignorada: 'neutral',
}
const ORIGEM_TONE: Record<NfeInbound['origem'], Tone> = { email: 'info', upload: 'neutral', erp: 'accent', dfe: 'accent', sem_xml: 'warn' }

const EMAIL_XML = 'xml@eddias.prodio.app'

export default function Recebimento() {
  const store = useStore()
  const { supplier } = useLookups()
  const [tab, setTab] = useState<Tab>('pendentes')
  const [aberta, setAberta] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [upload, setUpload] = useState<string | null>(null)
  const [semanaAtras] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString())

  const { listas, stats } = useMemo(() => {
    const byEmissao = (a: NfeInbound, b: NfeInbound) => b.emissao.localeCompare(a.emissao)
    const todas = store.nfes.slice().sort(byEmissao)
    const listas = {
      pendentes: todas.filter((n) => n.status === 'pendente' || n.status === 'aguardando_xml' || n.status === 'conferida'),
      recebidas: todas.filter((n) => n.status === 'recebida'),
      ignoradas: todas.filter((n) => n.status === 'ignorada'),
      todas,
    }
    const stats = {
      pendentes: listas.pendentes.length,
      semXml: store.nfes.filter((n) => n.status === 'aguardando_xml').length,
      semDePara: store.nfes.filter((n) => n.status !== 'ignorada' && n.status !== 'recebida').reduce((a, n) => a + n.itens.filter((i) => !i.materialId).length, 0),
      recebidasSemana: store.nfes.filter((n) => n.status === 'recebida' && n.emissao >= semanaAtras).length,
    }
    return { listas, stats }
  }, [store.nfes, semanaAtras])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL_XML)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const nfeAberta = aberta ? store.nfes.find((n) => n.chave === aberta) : undefined
  const linhas = listas[tab]

  return (
    <>
      <PageHeader title="Recebimento" subtitle="Notas fiscais de compra que chegaram e o que falta para entrarem no estoque." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mb-5">
        <Stat label="Pendentes" value={stats.pendentes} tone={stats.pendentes ? 'info' : 'neutral'} hint="aguardando conferência" />
        <Stat label="Sem XML" value={stats.semXml} tone={stats.semXml ? 'warn' : 'neutral'} hint="recebidas às cegas ou sem arquivo" />
        <Stat label="Itens sem De-Para" value={stats.semDePara} tone={stats.semDePara ? 'danger' : 'ok'} hint="precisam de vínculo com insumo" />
        <Stat label="Recebidas na semana" value={stats.recebidasSemana} tone="ok" hint="últimos 7 dias" />
      </div>

      <Card padded>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: 'pendentes', label: 'Pendentes', count: listas.pendentes.length },
            { id: 'recebidas', label: 'Recebidas', count: listas.recebidas.length },
            { id: 'ignoradas', label: 'Ignoradas', count: listas.ignoradas.length },
            { id: 'todas', label: 'Todas', count: listas.todas.length },
          ]}
        />
        {linhas.length === 0 ? (
          <EmptyState title="Nenhuma nota aqui" description="Quando um XML chegar por e-mail, upload ou ERP, ele aparece nesta lista." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Emissão</Th>
                <Th>Fornecedor</Th>
                <Th>Número</Th>
                <Th>Chave</Th>
                <Th>Origem</Th>
                <Th>OCs</Th>
                <Th right>Valor</Th>
                <Th right>Itens</Th>
                <Th>Status</Th>
                <Th>Alerta</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((n) => {
                const semDePara = n.itens.filter((i) => !i.materialId).length
                const ocs = store.purchaseOrders.filter((po) => n.poIds.includes(po.id))
                return (
                  <tr key={n.chave} onClick={() => setAberta(n.chave)} className="cursor-pointer hover:bg-surface-2/60">
                    <Td className="whitespace-nowrap">{dataBR(n.emissao)}</Td>
                    <Td>
                      <div className="font-medium">{n.emitente}</div>
                      {!n.supplierId && <div className="text-[12px] text-warn">fornecedor não cadastrado</div>}
                    </Td>
                    <Td mono>
                      {n.numero}
                      <span className="text-faint">/{n.serie}</span>
                    </Td>
                    <Td mono>
                      <span title={chaveFmt(n.chave)} className="text-muted">
                        {chaveFmt(n.chave).slice(0, 19)}…
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={ORIGEM_TONE[n.origem]}>{ORIGEM_LABEL[n.origem]}</Badge>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {ocs.map((po) => (
                          <Badge key={po.id} tone="accent">
                            OC {po.numero}
                          </Badge>
                        ))}
                        {ocs.length === 0 && <span className="text-faint">—</span>}
                      </div>
                    </Td>
                    <Td right>{brl(n.valorTotal)}</Td>
                    <Td right>{n.itens.length || <span className="text-faint">—</span>}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                    </Td>
                    <Td>
                      {semDePara > 0 && n.status !== 'ignorada' && n.status !== 'recebida' ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-warn">
                          <AlertTriangle size={14} /> {semDePara} item{semDePara === 1 ? '' : 's'} sem De-Para
                        </span>
                      ) : n.status === 'aguardando_xml' ? (
                        <span className="inline-flex items-center gap-1 text-[12px] text-warn">
                          <AlertTriangle size={14} /> sem XML
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Como as notas chegam">
          <ul className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-info-soft text-info">
                <Mail size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">XML por e-mail</div>
                <div className="text-muted">Peça ao fornecedor (ou ao seu contador) para mandar o XML para este endereço. A nota aparece aqui em segundos.</div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px]">{EMAIL_XML}</code>
                  <Button size="sm" onClick={copiar}>
                    {copiado ? <Check size={14} /> : <Copy size={14} />}
                    {copiado ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                <Upload size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">Upload de XML</div>
                <div className="text-muted">Arraste o arquivo ou escolha no computador.</div>
                <label className="mt-2 inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                  <FileUp size={14} /> Escolher XML
                  <input type="file" accept=".xml,text/xml" className="hidden" onChange={(e) => setUpload(e.target.files?.[0]?.name ?? null)} />
                </label>
                {upload && (
                  <div className="mt-2 text-[12px] text-muted">
                    <span className="font-mono">{upload}</span> · <span className="text-warn">parser no servidor: em breve</span>
                  </div>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
                <Plug size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">ERP conectado</div>
                <div className="text-muted">
                  Bling, Tiny ou Omie trazem as NF-e de compra automaticamente.{' '}
                  {store.connectors.some((c) => c.status === 'conectado' && c.capacidades.nfeCompra) ? (
                    <Badge tone="ok">ativo</Badge>
                  ) : (
                    <Badge tone="neutral">nenhum ERP com NF-e de compra conectado</Badge>
                  )}
                </div>
              </div>
            </li>
          </ul>
        </Card>

        <Card title="Regras de CFOP">
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 flex items-center gap-2 font-medium">
                <Badge tone="ok">entram automático</Badge>
              </div>
              <ul className="text-muted space-y-0.5">
                <li>
                  <span className="font-mono text-text">5101 / 5102</span> · venda de produção ou de terceiros
                </li>
                <li>
                  <span className="font-mono text-text">5401 / 5403 / 5405</span> · venda com substituição tributária
                </li>
                <li>
                  <span className="font-mono text-text">6xxx</span> · os mesmos códigos de outro estado
                </li>
              </ul>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-2 font-medium">
                <Badge tone="warn">pedem classificação manual</Badge>
              </div>
              <ul className="text-muted space-y-0.5">
                <li>
                  <span className="font-mono text-text">5901 / 5902</span> · remessa e retorno de industrialização
                </li>
                <li>
                  <span className="font-mono text-text">5910</span> · bonificação ou brinde
                </li>
                <li>
                  <span className="font-mono text-text">5915 / 5916</span> · remessa e retorno de conserto
                </li>
                <li>
                  <span className="font-mono text-text">5202</span> · devolução de compra
                </li>
                <li>
                  <span className="font-mono text-text">5949</span> · outras saídas
                </li>
              </ul>
            </div>
            <p className="text-[12px] text-faint">A regra vale por item: uma nota pode ter itens que entram e itens que não entram no estoque.</p>
          </div>
        </Card>
      </div>

      {nfeAberta && <DetalheNfe nfe={nfeAberta} fornecedor={supplier(nfeAberta.supplierId)?.nome} onClose={() => setAberta(null)} />}
    </>
  )
}

// ---------------------------------------------------------------------------

function DetalheNfe({ nfe, fornecedor, onClose }: { nfe: NfeInbound; fornecedor?: string; onClose: () => void }) {
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
          <EmptyState title="Sem itens" description="Esta nota está aguardando o XML. Os itens aparecem quando o arquivo chegar." />
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
              <Select value={selMat} onChange={(e) => {
                setSelMat(e.target.value)
                const m = store.materials.find((x) => x.id === e.target.value)
                if (m) setFator(String(m.fatorConversao))
              }}>
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
