import { Pencil, Plus, TrendingUp, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cnpjFmt, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Supplier } from '../../domain/types'
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Table, Td, Th, cx } from '../../ui'
import FornecedorModal, { vazio } from './FornecedorModal'
import ImportarPlanilha, { type CampoImport, type LinhaImport } from './ImportarPlanilha'
import { parseNumBR } from './numeros'

const camposImport: CampoImport[] = [
  { key: 'cnpj', label: 'CNPJ', obrigatorio: true, aliases: ['documento', 'cpf cnpj'], exemplo: ['12.345.678/0001-90', '23456789000101'] },
  { key: 'nome', label: 'Nome', obrigatorio: true, aliases: ['razao social', 'razão social', 'fornecedor', 'fantasia'], exemplo: ['Vidros Guarulhos Ltda', 'Montana Tecidos Sintéticos'] },
  { key: 'regime', label: 'Regime (simples|normal)', aliases: ['regime tributario', 'regime tributário'], exemplo: ['normal', 'simples'] },
  { key: 'lead_time', label: 'Lead time (dias)', numerico: true, aliases: ['leadtime', 'prazo', 'prazo entrega'], exemplo: ['7', '12'] },
  { key: 'condicao', label: 'Condição (dias, ex.: 28/42)', aliases: ['condicao pagamento', 'condição de pagamento', 'pagamento'], exemplo: ['28/42', '30'] },
  { key: 'contato', label: 'Contato', aliases: ['vendedor', 'responsavel', 'responsável', 'email', 'telefone'], exemplo: ['Marcos', 'Renata'] },
]

const condFmt = (c: number[]) => (c.length === 0 ? '—' : c.length === 1 && c[0] === 0 ? 'à vista' : `${c.join('/')} dias`)
const parseCond = (s: string) =>
  s
    .split(/[/,;\s]+/)
    .map((x) => Number(x))
    .filter((n) => !Number.isNaN(n) && n >= 0)

export default function Fornecedores() {
  const { suppliers, materials, purchaseOrders, upsertSupplier } = useStore()
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<{ tipo: 'novo' } | { tipo: 'editar'; s: Supplier }>()
  const [importar, setImportar] = useState(false)

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return suppliers
      .filter((s) => !q || s.nome.toLowerCase().includes(q) || s.cnpj.includes(q.replace(/\D/g, '') || '§') || (s.contato ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [suppliers, busca])

  const insumosPor = useMemo(() => {
    const m = new Map<string, number>()
    for (const x of materials) if (x.fornecedorPadraoId) m.set(x.fornecedorPadraoId, (m.get(x.fornecedorPadraoId) ?? 0) + 1)
    return m
  }, [materials])
  const ocsAbertasPor = useMemo(() => {
    const m = new Map<string, number>()
    for (const po of purchaseOrders) if (po.status === 'aberta' || po.status === 'parcial') m.set(po.supplierId, (m.get(po.supplierId) ?? 0) + 1)
    return m
  }, [purchaseOrders])

  // Lead time aprendido: média de (entregaPrevista − criadaEm) das OCs recebidas/parciais
  const aprendido = useMemo(() => {
    const out: { s: Supplier; media?: number; n: number }[] = []
    for (const s of suppliers) {
      const ocs = purchaseOrders.filter((po) => po.supplierId === s.id && (po.status === 'recebida' || po.status === 'parcial') && po.entregaPrevista)
      const dias = ocs.map((po) => Math.max(0, Math.round((new Date(po.entregaPrevista!).getTime() - new Date(po.criadaEm).getTime()) / 86400000)))
      out.push({ s, n: dias.length, media: dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : undefined })
    }
    return out.sort((a, b) => (b.media ?? -1) - (a.media ?? -1))
  }, [suppliers, purchaseOrders])

  const onImport = (rows: LinhaImport[]) => {
    for (const r of rows) {
      const digitos = r.cnpj.replace(/\D/g, '')
      const ex = suppliers.find((s) => s.cnpj === digitos)
      const regimeRaw = (r.regime ?? '').trim().toLowerCase()
      const lead = r.lead_time?.trim() ? parseNumBR(r.lead_time) : NaN
      upsertSupplier({
        ...(ex ?? vazio()),
        nome: r.nome.trim(),
        cnpj: digitos,
        regime: regimeRaw.startsWith('s') ? 'simples' : regimeRaw ? 'normal' : (ex?.regime ?? 'normal'),
        leadTimeDias: Number.isNaN(lead) ? (ex?.leadTimeDias ?? 7) : lead,
        condicaoPagamento: r.condicao?.trim() ? parseCond(r.condicao) : (ex?.condicaoPagamento ?? [30]),
        contato: r.contato?.trim() || ex?.contato,
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Fornecedores"
        subtitle="Quem entrega os insumos. Lead time e condição alimentam a necessidade de compra e a OC."
        actions={
          <>
            <Button onClick={() => setImportar(true)}>
              <Upload size={16} /> Importar planilha
            </Button>
            <Button variant="primary" onClick={() => setModal({ tipo: 'novo' })}>
              <Plus size={16} /> Novo fornecedor
            </Button>
          </>
        }
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <Card padded={false}>
          <div className="p-4 border-b border-border">
            <SearchInput value={busca} onChange={setBusca} placeholder="Nome, CNPJ ou contato…" className="sm:w-80" />
          </div>
          {lista.length === 0 ? (
            <EmptyState title="Nenhum fornecedor encontrado" description={suppliers.length === 0 ? 'Cadastre o primeiro fornecedor ou importe uma planilha.' : 'Tente outra busca.'} />
          ) : (
            <div className="px-5">
              <Table>
                <thead>
                  <tr>
                    <Th>Nome</Th>
                    <Th>CNPJ</Th>
                    <Th>Regime</Th>
                    <Th right>Lead time</Th>
                    <Th>Condição</Th>
                    <Th>Contato</Th>
                    <Th right>Insumos</Th>
                    <Th right>OCs abertas</Th>
                    <Th right></Th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((s) => (
                    <tr key={s.id} className="group hover:bg-surface-2/60">
                      <Td>
                        <button type="button" onClick={() => setModal({ tipo: 'editar', s })} className="font-medium text-left hover:text-accent-text">
                          {s.nome}
                        </button>
                      </Td>
                      <Td mono className="text-muted whitespace-nowrap">{cnpjFmt(s.cnpj)}</Td>
                      <Td>
                        <Badge tone={s.regime === 'simples' ? 'info' : 'neutral'}>{s.regime === 'simples' ? 'Simples' : 'Normal'}</Badge>
                      </Td>
                      <Td right className="whitespace-nowrap">{s.leadTimeDias} d</Td>
                      <Td className="tabular-nums whitespace-nowrap">{condFmt(s.condicaoPagamento)}</Td>
                      <Td className="text-muted">{s.contato ?? <span className="text-faint">—</span>}</Td>
                      <Td right>{num(insumosPor.get(s.id) ?? 0)}</Td>
                      <Td right>
                        {(ocsAbertasPor.get(s.id) ?? 0) > 0 ? <Badge tone="info" className="tabular-nums">{ocsAbertasPor.get(s.id)}</Badge> : <span className="text-faint">0</span>}
                      </Td>
                      <Td right>
                        <Button variant="ghost" size="sm" className="sm:opacity-0 sm:group-hover:opacity-100" onClick={() => setModal({ tipo: 'editar', s })} aria-label="Editar" title="Editar">
                          <Pencil size={14} />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <TrendingUp size={16} className="text-faint" /> Lead time aprendido
            </span>
          }
        >
          <p className="text-[12px] text-muted mb-3">Média de dias entre a criação da OC e a entrega, nas OCs recebidas (ou parciais). Comparado com o cadastrado.</p>
          <ul className="divide-y divide-border">
            {aprendido.map(({ s, media, n }) => {
              const diff = media !== undefined ? media - s.leadTimeDias : 0
              return (
                <li key={s.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{s.nome}</div>
                    <div className="text-[12px] text-muted tabular-nums">
                      cadastrado {s.leadTimeDias} d ·{' '}
                      {media === undefined ? (
                        <span className="text-faint">sem OCs recebidas</span>
                      ) : (
                        <>
                          aprendido <span className={cx('font-medium', diff > 0 ? 'text-warn' : diff < 0 ? 'text-ok' : 'text-text')}>{media} d</span> ({n} OC{n > 1 ? 's' : ''})
                        </>
                      )}
                    </div>
                  </div>
                  {media !== undefined && diff !== 0 && (
                    <Button size="sm" onClick={() => upsertSupplier({ ...s, leadTimeDias: media })}>
                      Usar {media} d
                    </Button>
                  )}
                  {media !== undefined && diff === 0 && <Badge tone="ok">confere</Badge>}
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      {modal && (
        <FornecedorModal
          fornecedor={modal.tipo === 'editar' ? modal.s : undefined}
          todos={suppliers}
          onClose={() => setModal(undefined)}
          onSave={(s) => {
            upsertSupplier(s)
            setModal(undefined)
          }}
        />
      )}
      <ImportarPlanilha
        open={importar}
        onClose={() => setImportar(false)}
        titulo="Importar fornecedores"
        campos={camposImport}
        chave="cnpj"
        existentes={suppliers.map((s) => s.cnpj)}
        normalizaChave={(v) => v.replace(/\D/g, '')}
        onImport={onImport}
      />
    </>
  )
}
