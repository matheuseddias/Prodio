import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, chaveFmt, dataBR } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { NfeInbound } from '../../domain/types'
import { Badge, Card, EmptyState, PageHeader, Stat, Table, Tabs, Td, Th } from '../../ui'
import { ORIGEM_LABEL, ORIGEM_TONE, STATUS_LABEL, STATUS_TONE } from './nfeUtils'
import { ComoChegam, RegrasCfop } from './RecebimentoAjuda'
import { DetalheNfe } from './RecebimentoDetalhe'

type Tab = 'pendentes' | 'recebidas' | 'ignoradas' | 'todas'

export default function Recebimento() {
  const store = useStore()
  const { supplier } = useLookups()
  const [tab, setTab] = useState<Tab>('pendentes')
  const [aberta, setAberta] = useState<string | null>(null)
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
          <EmptyState title="Nenhuma nota aqui" description="Quando um XML chegar por e-mail, upload, ERP ou consulta por chave, ele aparece nesta lista." />
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
        <ComoChegam />
        <RegrasCfop />
      </div>

      {nfeAberta && <DetalheNfe nfe={nfeAberta} fornecedor={supplier(nfeAberta.supplierId)?.nome} onClose={() => setAberta(null)} />}
    </>
  )
}
