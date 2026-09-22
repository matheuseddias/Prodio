import { ArrowLeft, Ban, CheckCircle2, CircleDot, FileText, PackageCheck, Printer, Truck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { brl, chaveFmt, cnpjFmt, dataBR, dataHoraBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeStatus, PurchaseOrder } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Progress, Table, Td, Th, cx, type Tone } from '../../ui'
import { STATUS_LABEL, STATUS_TONE, condicaoLabel, diasAte, itemTotal, ocAtrasada, ocRecebidoPct, ocTotal, parcelas, parseData } from './ocUtils'

const NFE_STATUS: Record<NfeStatus, { label: string; tone: Tone }> = {
  aguardando_xml: { label: 'Aguardando XML', tone: 'warn' },
  pendente: { label: 'Pendente', tone: 'info' },
  conferida: { label: 'Conferida', tone: 'accent' },
  recebida: { label: 'Recebida', tone: 'ok' },
  ignorada: { label: 'Ignorada', tone: 'neutral' },
}

const dataPrevista = (iso?: string) => (iso ? dataBR(parseData(iso).toISOString()) : '—')

export default function OrdemDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { purchaseOrders, nfes, tenant, stockMoves, updatePurchaseOrder } = useStore()
  const { supplier, material } = useLookups()
  const po = purchaseOrders.find((x) => x.id === id)
  const [receber, setReceber] = useState(false)
  const [cancelar, setCancelar] = useState(false)

  if (!po) {
    return (
      <>
        <PageHeader title="Ordem de compra" breadcrumb={<Link to="/compras/ordens" className="hover:underline">Ordens de compra</Link>} />
        <Card>
          <EmptyState
            title="Ordem não encontrada"
            description={`Não existe ordem de compra com o identificador "${id}".`}
            action={<Button onClick={() => navigate('/compras/ordens')}><ArrowLeft size={16} /> Voltar para ordens</Button>}
          />
        </Card>
      </>
    )
  }

  const sup = supplier(po.supplierId)
  const total = ocTotal(po)
  const subtotal = po.itens.reduce((s, it) => s + it.qtd * it.preco, 0)
  const ipi = total - subtotal
  const pct = ocRecebidoPct(po)
  const atras = ocAtrasada(po)
  const notas = nfes.filter((n) => n.poIds.includes(po.id))
  const parc = parcelas(po)
  const aberta = po.status === 'aberta' || po.status === 'parcial'

  // recebimentos: entradas de NF-e ligadas às notas desta OC
  const recebimentos = stockMoves
    .filter((mv) => mv.tipo === 'entrada_nfe' && notas.some((n) => mv.ref === `NF-e ${n.numero}`))
    .sort((a, b) => new Date(a.em).getTime() - new Date(b.em).getTime())

  const timeline: { titulo: string; sub?: string; em?: string; soData?: boolean; tone: Tone; icon: ReactNode }[] = [
    { titulo: 'Criada', sub: po.observacao, em: po.criadaEm, tone: 'accent', icon: <CircleDot size={14} /> },
    ...(po.entregaPrevista
      ? [{ titulo: 'Entrega prevista', sub: atras ? `atrasada ${num(-diasAte(po.entregaPrevista))} d` : diasAte(po.entregaPrevista) >= 0 && aberta ? `em ${diasAte(po.entregaPrevista)} d` : undefined, em: parseData(po.entregaPrevista).toISOString(), soData: true, tone: (atras ? 'danger' : 'info') as Tone, icon: <Truck size={14} /> }]
      : []),
    ...recebimentos.map((mv) => ({ titulo: `Recebimento · ${mv.ref}`, sub: `${material(mv.materialId)?.nome ?? ''} +${num(mv.delta, 2)}`, em: mv.em, tone: 'ok' as Tone, icon: <PackageCheck size={14} /> })),
    ...(po.status === 'recebida' && recebimentos.length === 0 ? [{ titulo: 'Recebida', sub: 'marcada manualmente', tone: 'ok' as Tone, icon: <CheckCircle2 size={14} /> }] : []),
    ...(po.status === 'cancelada' ? [{ titulo: 'Cancelada', tone: 'neutral' as Tone, icon: <Ban size={14} /> }] : []),
  ]

  const cancelarOc = () => {
    updatePurchaseOrder({ ...po, status: 'cancelada' })
    setCancelar(false)
  }

  return (
    <>
      <div className="no-print">
        <PageHeader
          breadcrumb={<Link to="/compras/ordens" className="hover:underline">Ordens de compra</Link>}
          title={`OC ${po.numero} · ${sup?.nome ?? 'Fornecedor'}`}
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge tone={STATUS_TONE[po.status]}>{STATUS_LABEL[po.status]}</Badge>
              <span>criada em {dataBR(po.criadaEm)}</span>
              <span>· entrega {dataPrevista(po.entregaPrevista)}{atras && <Badge tone="danger" className="ml-1">atrasada</Badge>}</span>
              <span>· {condicaoLabel(po.condicaoPagamento)}</span>
            </span>
          }
          actions={
            <>
              <Button onClick={() => window.print()}><Printer size={16} /> Imprimir</Button>
              {aberta && <Button variant="primary" onClick={() => setReceber(true)}><PackageCheck size={16} /> Dar entrada sem nota</Button>}
              {aberta && <Button variant="danger" onClick={() => setCancelar(true)}><Ban size={16} /> Cancelar</Button>}
            </>
          }
        />

        <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
          <div className="space-y-4">
            <Card title="Itens" actions={<span className="text-[12px] text-muted tabular-nums">{po.itens.length} {po.itens.length === 1 ? 'item' : 'itens'}</span>}>
              <Table>
                <thead>
                  <tr>
                    <Th>Insumo</Th>
                    <Th>Un.</Th>
                    <Th right>Fator</Th>
                    <Th right>Qtd</Th>
                    <Th right>Consumo</Th>
                    <Th right>Recebido</Th>
                    <Th right>Pendente</Th>
                    <Th right>Preço</Th>
                    <Th right>IPI</Th>
                    <Th right>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {po.itens.map((it) => {
                    const m = material(it.materialId)
                    const pend = Math.max(0, it.qtd - it.qtdRecebida)
                    const casas = m?.unidadeConsumo === 'un' ? 0 : 2
                    return (
                      <tr key={it.id}>
                        <Td>
                          <div className="font-medium leading-tight">{m?.nome ?? it.materialId}</div>
                          <div className="text-[12px] text-muted font-mono">{m?.sku}</div>
                        </Td>
                        <Td className="text-muted">{it.unidadeCompra}</Td>
                        <Td right className="text-muted">{num(it.fator, it.fator % 1 ? 2 : 0)}</Td>
                        <Td right className="font-medium">{num(it.qtd)}</Td>
                        <Td right className="text-muted">{num(it.qtd * it.fator, casas)} {m?.unidadeConsumo}</Td>
                        <Td right className={cx(it.qtdRecebida > 0 && 'text-ok')}>{num(it.qtdRecebida)}</Td>
                        <Td right className={cx(pend > 0 && aberta ? 'text-warn font-medium' : 'text-muted')}>{num(pend)}</Td>
                        <Td right>{brl(it.preco)}</Td>
                        <Td right className="text-muted">{it.ipiPct}%</Td>
                        <Td right className="font-medium">{brl(itemTotal(it))}</Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
              <div className="flex flex-col items-end gap-1 mt-2 text-sm tabular-nums">
                <div className="flex gap-6"><span className="text-muted">Subtotal</span><span className="w-28 text-right">{brl(subtotal)}</span></div>
                <div className="flex gap-6"><span className="text-muted">IPI</span><span className="w-28 text-right">{brl(ipi)}</span></div>
                <div className="flex gap-6 font-semibold text-base"><span>Total</span><span className="w-28 text-right">{brl(total)}</span></div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[12px] text-muted mb-1"><span>Recebido</span><span className="tabular-nums">{pct}%</span></div>
                <Progress value={pct} max={100} tone={pct >= 100 ? 'ok' : pct > 0 ? 'warn' : 'neutral'} />
              </div>
            </Card>

            <Card title="Notas vinculadas" actions={<span className="text-[12px] text-muted">{notas.length}</span>}>
              {notas.length === 0 ? (
                <EmptyState icon={<FileText size={24} />} title="Nenhuma NF-e vinculada" description="Quando a nota do fornecedor chegar, ela aparece aqui e alimenta o recebimento." />
              ) : (
                <ul className="divide-y divide-border/70">
                  {notas.map((n) => (
                    <li key={n.chave} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">NF-e {n.numero} <span className="text-muted font-normal">série {n.serie}</span></div>
                        <div className="text-[11px] text-muted font-mono break-all">{chaveFmt(n.chave)}</div>
                      </div>
                      <div className="text-sm tabular-nums sm:text-right">
                        <div>{brl(n.valorTotal)}</div>
                        <div className="text-[12px] text-muted">{dataBR(n.emissao)}</div>
                      </div>
                      <Badge tone={NFE_STATUS[n.status].tone}>{NFE_STATUS[n.status].label}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Fornecedor">
              {sup ? (
                <div className="text-sm space-y-1">
                  <div className="font-medium">{sup.nome}</div>
                  <div className="text-muted font-mono text-[12px]">{cnpjFmt(sup.cnpj)}</div>
                  <div className="text-muted">Regime {sup.regime} · lead time {sup.leadTimeDias} d</div>
                  {sup.contato && <div className="text-muted">Contato: {sup.contato}</div>}
                </div>
              ) : (
                <div className="text-sm text-muted">Fornecedor não encontrado.</div>
              )}
            </Card>

            <Card title="Parcelas previstas">
              <ul className="space-y-2 text-sm">
                {parc.map((p) => (
                  <li key={p.n} className="flex items-center justify-between gap-3">
                    <span className="text-muted">{p.n}ª · {p.dias === 0 ? 'à vista' : `${p.dias} dias`}</span>
                    <span className="text-muted">{dataBR(p.vencimento.toISOString())}</span>
                    <span className="font-medium tabular-nums">{brl(p.valor)}</span>
                  </li>
                ))}
              </ul>
              <div className="text-[12px] text-faint mt-3">Contadas a partir da entrega prevista.</div>
            </Card>

            <Card title="Linha do tempo">
              <ol className="relative border-l border-border ml-2 space-y-4">
                {timeline.map((t, i) => (
                  <li key={i} className="pl-5">
                    <span className={cx('absolute -left-[9px] grid h-[18px] w-[18px] place-items-center rounded-full bg-surface border', { accent: 'text-accent-text border-accent', info: 'text-info border-info', danger: 'text-danger border-danger', ok: 'text-ok border-ok', warn: 'text-warn border-warn', neutral: 'text-muted border-border' }[t.tone])}>
                      {t.icon}
                    </span>
                    <div className="text-sm font-medium leading-tight">{t.titulo}</div>
                    {t.em && <div className="text-[12px] text-muted">{t.soData ? dataBR(t.em) : dataHoraBR(t.em)}</div>}
                    {t.sub && <div className="text-[12px] text-muted">{t.sub}</div>}
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      </div>

      {/* ---------- versão de impressão ---------- */}
      <div className="hidden print:block text-black text-[12px]">
        <div className="flex items-start justify-between gap-6 border-b border-black pb-4 mb-4">
          <div>
            <div className="text-lg font-bold">{tenant.nome}</div>
            <div>CNPJ {cnpjFmt(tenant.cnpj)}</div>
            <div className="mt-3 text-xl font-bold">Ordem de compra nº {po.numero}</div>
            <div>Emitida em {dataBR(po.criadaEm)} · Entrega prevista {dataPrevista(po.entregaPrevista)}</div>
            <div>Condição de pagamento: {condicaoLabel(po.condicaoPagamento)}</div>
          </div>
          <div className="text-center">
            <QRCodeSVG value={`OC:${po.numero}`} size={96} />
            <div className="font-mono mt-1">OC:{po.numero}</div>
          </div>
        </div>
        <div className="mb-4">
          <div className="font-bold uppercase text-[11px] mb-1">Fornecedor</div>
          <div className="font-semibold">{sup?.nome}</div>
          <div>CNPJ {sup ? cnpjFmt(sup.cnpj) : '—'}{sup?.contato && ` · Contato: ${sup.contato}`}</div>
        </div>
        <table className="w-full border-collapse mb-4">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Insumo</th>
              <th className="py-1 pr-2">Un.</th>
              <th className="py-1 pr-2 text-right">Qtd</th>
              <th className="py-1 pr-2 text-right">Preço</th>
              <th className="py-1 pr-2 text-right">IPI</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {po.itens.map((it, i) => {
              const m = material(it.materialId)
              return (
                <tr key={it.id} className="border-b border-gray-300">
                  <td className="py-1 pr-2">{i + 1}</td>
                  <td className="py-1 pr-2">{m?.nome} <span className="text-gray-600">({m?.sku})</span></td>
                  <td className="py-1 pr-2">{it.unidadeCompra}</td>
                  <td className="py-1 pr-2 text-right">{num(it.qtd)}</td>
                  <td className="py-1 pr-2 text-right">{brl(it.preco)}</td>
                  <td className="py-1 pr-2 text-right">{it.ipiPct}%</td>
                  <td className="py-1 text-right">{brl(itemTotal(it))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex justify-end mb-4">
          <table className="text-right">
            <tbody>
              <tr><td className="pr-6">Subtotal</td><td>{brl(subtotal)}</td></tr>
              <tr><td className="pr-6">IPI</td><td>{brl(ipi)}</td></tr>
              <tr className="font-bold text-sm"><td className="pr-6">Total</td><td>{brl(total)}</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="font-bold uppercase text-[11px] mb-1">Parcelas previstas</div>
          <table className="border-collapse">
            <tbody>
              {parc.map((p) => (
                <tr key={p.n}><td className="pr-6">{p.n}ª parcela</td><td className="pr-6">{dataBR(p.vencimento.toISOString())}</td><td className="text-right">{brl(p.valor)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {po.observacao && <div className="mt-4"><span className="font-bold">Observação:</span> {po.observacao}</div>}
      </div>

      {receber && <ReceberModal po={po} onClose={() => setReceber(false)} onSave={updatePurchaseOrder} />}

      <Modal open={cancelar} onClose={() => setCancelar(false)} title={`Cancelar OC ${po.numero}`} size="sm" footer={<><Button onClick={() => setCancelar(false)}>Voltar</Button><Button variant="danger" onClick={cancelarOc}>Cancelar ordem</Button></>}>
        <p className="text-sm text-muted">A ordem sai da necessidade de compra (deixa de contar como “em trânsito”) e não pode mais receber notas. Itens já recebidos permanecem no estoque.</p>
      </Modal>
    </>
  )
}

/**
 * Recebimento sem nota fiscal.
 *
 * ATENÇÃO — isto MOVE ESTOQUE. A quantidade informada aqui vira chamada à RPC `receive_manual`
 * (data/escritasCadastros.ts), que cria o recebimento, posta `stock_moves` do tipo entrada manual e
 * recalcula saldo e custo médio com o preço da OC. O texto anterior dizia o contrário ("o saldo de
 * estoque não é alterado por aqui"): quem marcasse a OC confiando nele e depois recebesse a NF-e
 * dobrava o saldo, num ledger que é append-only.
 */
function ReceberModal({ po, onClose, onSave }: { po: PurchaseOrder; onClose: () => void; onSave: (po: PurchaseOrder) => void }) {
  const { material } = useLookups()
  const [qtds, setQtds] = useState<Record<string, string>>(() => Object.fromEntries(po.itens.map((it) => [it.id, String(Math.max(0, it.qtd - it.qtdRecebida))])))
  const parse = (v: string) => Math.max(0, Number(String(v).replace(',', '.')) || 0)

  const preview = useMemo(() => {
    const itens = po.itens.map((it) => ({ ...it, qtdRecebida: it.qtdRecebida + parse(qtds[it.id] ?? '0') }))
    const completo = itens.every((it) => it.qtdRecebida >= it.qtd)
    const algum = itens.some((it) => it.qtdRecebida > 0)
    return { itens, status: (completo ? 'recebida' : algum ? 'parcial' : po.status) as PurchaseOrder['status'] }
  }, [po, qtds])

  const salvar = () => {
    onSave({ ...po, itens: preview.itens, status: preview.status })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Dar entrada sem nota"
      size="md"
      footer={
        <>
          <span className="mr-auto text-[13px] text-muted">Status após salvar: <Badge tone={STATUS_TONE[preview.status]}>{STATUS_LABEL[preview.status]}</Badge></span>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={salvar}>Salvar recebimento</Button>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-warn/40 bg-warn-soft/40 p-3 text-sm">
        <div className="font-medium">Isto dá entrada no estoque.</div>
        <p className="mt-0.5 text-muted">
          A quantidade informada, em unidade de compra, entra no saldo com o preço desta OC e recalcula o custo médio. Use quando a mercadoria chegou e a nota não vem pelo sistema.{' '}
          <strong>Se a NF-e desta compra chegar depois, receba a nota pelo Recebimento e não lance aqui de novo</strong> — o mesmo insumo entraria duas vezes, e o movimento de estoque não tem
          como ser apagado.
        </p>
      </div>
      <div className="space-y-3">
        {po.itens.map((it) => {
          const m = material(it.materialId)
          const pend = Math.max(0, it.qtd - it.qtdRecebida)
          return (
            <div key={it.id} className="grid grid-cols-[1fr_120px] gap-3 items-center">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{m?.nome}</div>
                <div className="text-[12px] text-muted tabular-nums">pedido {num(it.qtd)} {it.unidadeCompra} · recebido {num(it.qtdRecebida)} · pendente {num(pend)}</div>
              </div>
              <Field label={it.unidadeCompra}>
                <Input inputMode="decimal" className="text-right" value={qtds[it.id] ?? ''} onChange={(e) => setQtds((q) => ({ ...q, [it.id]: e.target.value }))} />
              </Field>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
