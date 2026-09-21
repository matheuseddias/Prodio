import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { brl, dataBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { PoStatus, Supplier } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Progress, SearchInput, Select, Table, Tabs, Td, Th, cx } from '../../ui'
import { STATUS_LABEL, STATUS_TONE, condicaoLabel, diasAte, hojeLocal, itemTotal, ocAtrasada, ocRecebidoPct, ocTotal, parseData, somaDias, toISODate } from './ocUtils'

type Aba = PoStatus | 'todas'

export default function Ordens() {
  const { purchaseOrders, suppliers } = useStore()
  const { supplier } = useLookups()
  const navigate = useNavigate()
  const [aba, setAba] = useState<Aba>('aberta')
  const [busca, setBusca] = useState('')
  const [nova, setNova] = useState(false)

  const contagem = useMemo(() => {
    const c: Record<Aba, number> = { aberta: 0, parcial: 0, recebida: 0, cancelada: 0, todas: purchaseOrders.length }
    for (const po of purchaseOrders) c[po.status]++
    return c
  }, [purchaseOrders])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return purchaseOrders
      .filter((po) => aba === 'todas' || po.status === aba)
      .filter((po) => !q || String(po.numero).includes(q) || supplier(po.supplierId)?.nome.toLowerCase().includes(q))
      .sort((a, b) => b.numero - a.numero)
  }, [purchaseOrders, aba, busca, supplier])

  const atrasadas = purchaseOrders.filter(ocAtrasada).length

  return (
    <>
      <PageHeader
        title="Ordens de compra"
        subtitle={atrasadas > 0 ? <span><span className="text-danger font-medium">{atrasadas} {atrasadas === 1 ? 'ordem atrasada' : 'ordens atrasadas'}</span> · entrega prevista já passou.</span> : 'Nenhuma ordem atrasada.'}
        actions={
          <Button variant="primary" onClick={() => setNova(true)}>
            <Plus size={16} /> Nova OC
          </Button>
        }
      />

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'aberta', label: 'Abertas', count: contagem.aberta },
          { id: 'parcial', label: 'Parciais', count: contagem.parcial },
          { id: 'recebida', label: 'Recebidas', count: contagem.recebida },
          { id: 'cancelada', label: 'Canceladas', count: contagem.cancelada },
          { id: 'todas', label: 'Todas', count: contagem.todas },
        ]}
      />

      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <SearchInput value={busca} onChange={setBusca} placeholder="Número ou fornecedor…" className="sm:w-80" />
          <span className="text-[13px] text-muted sm:ml-auto tabular-nums">{lista.length} {lista.length === 1 ? 'ordem' : 'ordens'} · {brl(lista.reduce((s, po) => s + ocTotal(po), 0))}</span>
        </div>
        {lista.length === 0 ? (
          <EmptyState title="Nenhuma ordem aqui" description={busca ? 'Nenhuma OC corresponde à busca.' : 'Gere ordens pela Necessidade de compra ou crie uma manualmente.'} action={<Button onClick={() => navigate('/compras/necessidade')}>Ver necessidade de compra</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Número</Th>
                <Th>Fornecedor</Th>
                <Th>Criada em</Th>
                <Th>Entrega prevista</Th>
                <Th right>Itens</Th>
                <Th right>Total</Th>
                <Th className="w-40">Recebido</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((po) => {
                const pct = ocRecebidoPct(po)
                const atras = ocAtrasada(po)
                return (
                  <tr key={po.id} onClick={() => navigate(`/compras/ordens/${po.id}`)} className="cursor-pointer hover:bg-surface-2/60 transition-colors">
                    <Td mono className="font-medium">OC {po.numero}</Td>
                    <Td>
                      <div className="font-medium leading-tight">{supplier(po.supplierId)?.nome ?? '—'}</div>
                      <div className="text-[12px] text-muted">{condicaoLabel(po.condicaoPagamento)}</div>
                    </Td>
                    <Td className="text-muted whitespace-nowrap">{dataBR(po.criadaEm)}</Td>
                    <Td className="whitespace-nowrap">
                      {po.entregaPrevista ? (
                        <span className="inline-flex items-center gap-2">
                          {dataBR(parseData(po.entregaPrevista).toISOString())}
                          {atras && <Badge tone="danger">atrasada {num(-diasAte(po.entregaPrevista))} d</Badge>}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                    <Td right>{po.itens.length}</Td>
                    <Td right className="font-medium">{brl(ocTotal(po))}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Progress value={pct} max={100} tone={pct >= 100 ? 'ok' : pct > 0 ? 'warn' : 'neutral'} />
                        <span className="text-[12px] text-muted tabular-nums w-9 text-right">{pct}%</span>
                      </div>
                    </Td>
                    <Td><Badge tone={STATUS_TONE[po.status]}>{STATUS_LABEL[po.status]}</Badge></Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {nova && <NovaOc onClose={() => setNova(false)} suppliersDisponiveis={suppliers} />}
    </>
  )
}

// ---------- Nova OC ----------

interface ItemForm {
  key: string
  materialId: string
  unidadeCompra: string
  fator: string
  qtd: string
  preco: string
  ipiPct: string
}

const n = (v: string) => Number(String(v).replace(',', '.')) || 0

function NovaOc({ onClose, suppliersDisponiveis }: { onClose: () => void; suppliersDisponiveis: Supplier[] }) {
  const { materials, createPurchaseOrder } = useStore()
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState(suppliersDisponiveis[0]?.id ?? '')
  const sup = suppliersDisponiveis.find((s) => s.id === supplierId)
  const [condicao, setCondicao] = useState(sup?.condicaoPagamento.join('/') ?? '30')
  const [entrega, setEntrega] = useState(toISODate(somaDias(hojeLocal(), sup?.leadTimeDias ?? 7)))
  const [obs, setObs] = useState('')

  const novoItem = (materialId?: string): ItemForm => {
    const m = materials.find((x) => x.id === materialId) ?? materials[0]
    return { key: Math.random().toString(36).slice(2), materialId: m.id, unidadeCompra: m.unidadeCompra, fator: String(m.fatorConversao), qtd: '1', preco: String(Math.round(m.custoMedio * m.fatorConversao * 100) / 100), ipiPct: '0' }
  }
  const [itens, setItens] = useState<ItemForm[]>(() => [novoItem(materials.find((m) => m.fornecedorPadraoId === supplierId)?.id)])

  const trocarFornecedor = (id: string) => {
    setSupplierId(id)
    const s = suppliersDisponiveis.find((x) => x.id === id)
    if (s) {
      setCondicao(s.condicaoPagamento.join('/'))
      setEntrega(toISODate(somaDias(hojeLocal(), s.leadTimeDias)))
    }
  }
  const setItem = (key: string, patch: Partial<ItemForm>) => setItens((l) => l.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const trocarMaterial = (key: string, materialId: string) => {
    const m = materials.find((x) => x.id === materialId)
    if (!m) return
    setItem(key, { materialId, unidadeCompra: m.unidadeCompra, fator: String(m.fatorConversao), preco: String(Math.round(m.custoMedio * m.fatorConversao * 100) / 100) })
  }

  const total = itens.reduce((s, it) => s + itemTotal({ qtd: n(it.qtd), preco: n(it.preco), ipiPct: n(it.ipiPct) }), 0)
  const valido = !!supplierId && itens.length > 0 && itens.every((it) => n(it.qtd) > 0 && n(it.preco) >= 0)

  const salvar = () => {
    if (!valido) return
    createPurchaseOrder({
      supplierId,
      status: 'aberta',
      entregaPrevista: entrega || undefined,
      condicaoPagamento: condicao.split(/[/,;\s]+/).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)),
      observacao: obs || undefined,
      itens: itens.map((it) => ({ id: it.key, materialId: it.materialId, unidadeCompra: it.unidadeCompra, fator: n(it.fator) || 1, qtd: n(it.qtd), qtdRecebida: 0, preco: n(it.preco), ipiPct: n(it.ipiPct) })),
    })
    onClose()
    navigate('/compras/ordens')
  }

  const fornecedorMateriais = materials.filter((m) => m.fornecedorPadraoId === supplierId)

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova ordem de compra"
      size="xl"
      footer={
        <>
          <div className="mr-auto text-sm">
            <span className="text-muted">Total</span> <strong className="tabular-nums text-base">{brl(total)}</strong>
          </div>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valido} onClick={salvar}>Criar OC</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Field label="Fornecedor">
          <Select value={supplierId} onChange={(e) => trocarFornecedor(e.target.value)}>
            {suppliersDisponiveis.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </Select>
        </Field>
        <Field label="Condição de pagamento" hint="Dias separados por / (0 = à vista)">
          <Input value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="28/42" />
        </Field>
        <Field label="Entrega prevista">
          <Input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} />
        </Field>
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-medium text-muted">Itens</span>
        <Button size="sm" onClick={() => setItens((l) => [...l, novoItem(fornecedorMateriais.find((m) => !l.some((it) => it.materialId === m.id))?.id)])}><Plus size={14} /> Adicionar linha</Button>
      </div>
      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr>
              <Th className="px-2">Insumo</Th>
              <Th className="px-2">Un. compra</Th>
              <Th className="px-2" right>Fator</Th>
              <Th className="px-2" right>Qtd</Th>
              <Th className="px-2" right>Preço</Th>
              <Th className="px-2" right>IPI %</Th>
              <Th className="px-2" right>Total</Th>
              <Th className="px-2"></Th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it) => {
              const m = materials.find((x) => x.id === it.materialId)
              return (
                <tr key={it.key}>
                  <Td className="px-2 min-w-[220px]">
                    <Select value={it.materialId} onChange={(e) => trocarMaterial(it.key, e.target.value)}>
                      {[...fornecedorMateriais, ...materials.filter((x) => x.fornecedorPadraoId !== supplierId)].map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                    </Select>
                    {m && <div className="text-[11px] text-muted mt-1">{num(n(it.qtd) * n(it.fator), m.unidadeConsumo === 'un' ? 0 : 2)} {m.unidadeConsumo} · custo médio {brl(m.custoMedio)}/{m.unidadeConsumo}</div>}
                  </Td>
                  <Td className="px-2 w-24"><Input value={it.unidadeCompra} onChange={(e) => setItem(it.key, { unidadeCompra: e.target.value })} /></Td>
                  <Td className="px-2 w-24"><Input inputMode="decimal" className="text-right" value={it.fator} onChange={(e) => setItem(it.key, { fator: e.target.value })} /></Td>
                  <Td className="px-2 w-24"><Input inputMode="decimal" className="text-right" value={it.qtd} onChange={(e) => setItem(it.key, { qtd: e.target.value })} /></Td>
                  <Td className="px-2 w-28"><Input inputMode="decimal" className="text-right" value={it.preco} onChange={(e) => setItem(it.key, { preco: e.target.value })} /></Td>
                  <Td className="px-2 w-20"><Input inputMode="decimal" className="text-right" value={it.ipiPct} onChange={(e) => setItem(it.key, { ipiPct: e.target.value })} /></Td>
                  <Td className="px-2" right>{brl(itemTotal({ qtd: n(it.qtd), preco: n(it.preco), ipiPct: n(it.ipiPct) }))}</Td>
                  <Td className="px-2" right>
                    <button type="button" onClick={() => setItens((l) => l.filter((x) => x.key !== it.key))} disabled={itens.length === 1} className={cx('text-muted hover:text-danger p-1 rounded', itens.length === 1 && 'opacity-40 cursor-not-allowed')} aria-label="Remover linha">
                      <Trash2 size={15} />
                    </button>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Field label="Observação" className="mt-4">
        <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
      </Field>
    </Modal>
  )
}
