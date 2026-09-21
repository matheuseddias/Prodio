import { Pencil, Plus, TrendingUp, Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cnpjFmt, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Supplier } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Table, Td, Th, cx } from '../../ui'
import ImportarPlanilha, { type CampoImport, type LinhaImport } from './ImportarPlanilha'
import { parseNumBR } from './numeros'

const uid = () => Math.random().toString(36).slice(2, 10)

const camposImport: CampoImport[] = [
  { key: 'cnpj', label: 'CNPJ', obrigatorio: true, aliases: ['documento', 'cpf cnpj'], exemplo: ['12.345.678/0001-90', '23456789000101'] },
  { key: 'nome', label: 'Nome', obrigatorio: true, aliases: ['razao social', 'razão social', 'fornecedor', 'fantasia'], exemplo: ['Vidros Guarulhos Ltda', 'Montana Tecidos Sintéticos'] },
  { key: 'regime', label: 'Regime (simples|normal)', aliases: ['regime tributario', 'regime tributário'], exemplo: ['normal', 'simples'] },
  { key: 'lead_time', label: 'Lead time (dias)', numerico: true, aliases: ['leadtime', 'prazo', 'prazo entrega'], exemplo: ['7', '12'] },
  { key: 'condicao', label: 'Condição (dias, ex.: 28/42)', aliases: ['condicao pagamento', 'condição de pagamento', 'pagamento'], exemplo: ['28/42', '30'] },
  { key: 'contato', label: 'Contato', aliases: ['vendedor', 'responsavel', 'responsável', 'email', 'telefone'], exemplo: ['Marcos', 'Renata'] },
]

/* ---------- CNPJ ---------- */
const mascaraCnpj = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}
function cnpjValido(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (len: number) => {
    let soma = 0
    let peso = len - 7
    for (let i = 0; i < len; i++) {
      soma += Number(d[i]) * peso--
      if (peso < 2) peso = 9
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

const condFmt = (c: number[]) => (c.length === 0 ? '—' : c.length === 1 && c[0] === 0 ? 'à vista' : `${c.join('/')} dias`)
const parseCond = (s: string) =>
  s
    .split(/[/,;\s]+/)
    .map((x) => Number(x))
    .filter((n) => !Number.isNaN(n) && n >= 0)

function vazio(): Supplier {
  return { id: uid(), nome: '', cnpj: '', regime: 'normal', leadTimeDias: 7, condicaoPagamento: [30] }
}

interface Vinculo {
  materialId: string
  codigoFornecedor: string
  fator: number
}

function FornecedorModal({ fornecedor, todos, onClose, onSave }: { fornecedor?: Supplier; todos: Supplier[]; onClose: () => void; onSave: (s: Supplier) => void }) {
  const { materials, nfes } = useStore()
  const base = fornecedor ?? vazio()
  const [nome, setNome] = useState(base.nome)
  const [cnpj, setCnpj] = useState(mascaraCnpj(base.cnpj))
  const [regime, setRegime] = useState<Supplier['regime']>(base.regime)
  const [lead, setLead] = useState(String(base.leadTimeDias))
  const [cond, setCond] = useState<number[]>(base.condicaoPagamento)
  const [novaCond, setNovaCond] = useState('')
  const [contato, setContato] = useState(base.contato ?? '')
  const [erro, setErro] = useState<string>()

  // De-Para (estado local: o store não guarda código do fornecedor por insumo)
  const [vinculos, setVinculos] = useState<Vinculo[]>(() =>
    materials
      .filter((m) => m.fornecedorPadraoId === base.id)
      .map((m) => {
        const item = nfes.filter((n) => n.supplierId === base.id).flatMap((n) => n.itens).find((it) => it.materialId === m.id)
        return { materialId: m.id, codigoFornecedor: item?.cProd ?? '', fator: item?.fator ?? m.fatorConversao }
      }),
  )

  const cnpjOk = cnpjValido(cnpj)
  const digitos = cnpj.replace(/\D/g, '')

  const addCond = () => {
    const n = Number(novaCond)
    if (Number.isNaN(n) || novaCond.trim() === '' || n < 0) return
    setCond((c) => Array.from(new Set([...c, n])).sort((a, b) => a - b))
    setNovaCond('')
  }

  const salvar = () => {
    if (!nome.trim()) return setErro('Informe o nome.')
    if (!cnpjOk) return setErro('CNPJ inválido — confira os dígitos.')
    if (todos.some((s) => s.id !== base.id && s.cnpj === digitos)) return setErro('Já existe um fornecedor com este CNPJ.')
    onSave({ ...base, nome: nome.trim(), cnpj: digitos, regime, leadTimeDias: Number(lead) || 0, condicaoPagamento: cond, contato: contato.trim() || undefined })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={fornecedor ? `Editar ${fornecedor.nome}` : 'Novo fornecedor'}
      size="lg"
      footer={
        <>
          {erro && <span className="mr-auto text-[13px] text-danger">{erro}</span>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={salvar}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Nome *">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Razão social ou fantasia" autoFocus={!fornecedor} />
          </Field>
          <Field label="CNPJ *" hint={digitos.length === 14 ? (cnpjOk ? 'dígitos verificadores ok' : 'dígitos verificadores não conferem') : undefined}>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(mascaraCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              className={cx('font-mono', digitos.length === 14 && (cnpjOk ? 'border-ok' : 'border-danger'))}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Regime" hint="Simples não destaca IPI/ICMS-ST na NF-e.">
            <Select value={regime} onChange={(e) => setRegime(e.target.value as Supplier['regime'])}>
              <option value="simples">Simples Nacional</option>
              <option value="normal">Regime normal</option>
            </Select>
          </Field>
          <Field label="Lead time (dias)">
            <Input type="number" inputMode="numeric" min="0" value={lead} onChange={(e) => setLead(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label="Contato">
            <Input value={contato} onChange={(e) => setContato(e.target.value)} placeholder="Nome, e-mail ou telefone" />
          </Field>
        </div>

        <div>
          <span className="block text-[13px] font-medium text-muted mb-1.5">Condição de pagamento (dias)</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {cond.map((c) => (
              <Badge key={c} tone="accent" className="tabular-nums">
                {c === 0 ? 'à vista' : `${c} d`}
                <button type="button" onClick={() => setCond((l) => l.filter((x) => x !== c))} className="ml-0.5 hover:text-danger" aria-label={`Remover ${c}`}>
                  <X size={12} />
                </button>
              </Badge>
            ))}
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              value={novaCond}
              onChange={(e) => setNovaCond(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCond()
                }
              }}
              placeholder="dias"
              className="h-8 w-24 text-right tabular-nums"
            />
            <Button size="sm" onClick={addCond}>
              Adicionar
            </Button>
          </div>
          <p className="text-[12px] text-faint mt-1.5">Ex.: 28 e 42 = duas parcelas, 28/42 dias. 0 = à vista.</p>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-medium">Insumos deste fornecedor</span>
            <span className="text-[12px] text-muted tabular-nums">{vinculos.length} vinculado(s)</span>
          </div>
          <p className="text-[12px] text-muted mb-3">
            É o De-Para usado ao ler a NF-e: o código do produto no XML do fornecedor (cProd) aponta para o seu insumo, e o fator converte a unidade da nota para a unidade de consumo.
          </p>
          {vinculos.length === 0 ? (
            <div className="text-[13px] text-faint">Nenhum insumo tem este fornecedor como padrão. Defina em Cadastros → Insumos.</div>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_150px_90px] gap-2 text-[11px] uppercase tracking-wide text-muted px-1">
                <span>Insumo</span>
                <span>Cód. no fornecedor</span>
                <span className="text-right">Fator</span>
              </div>
              {vinculos.map((v) => {
                const m = materials.find((x) => x.id === v.materialId)!
                return (
                  <div key={v.materialId} className="grid grid-cols-1 sm:grid-cols-[1fr_150px_90px] gap-2 items-center">
                    <div className="text-sm min-w-0">
                      <span className="font-mono text-[12px] text-muted mr-1.5">{m.sku}</span>
                      <span className="truncate">{m.nome}</span>
                      <span className="text-[12px] text-faint"> · {m.unidadeCompra} → {m.unidadeConsumo}</span>
                    </div>
                    <Input value={v.codigoFornecedor} onChange={(e) => setVinculos((l) => l.map((x) => (x.materialId === v.materialId ? { ...x, codigoFornecedor: e.target.value } : x)))} placeholder="cProd" className="h-9 font-mono" />
                    <Input type="number" inputMode="decimal" step="0.01" value={v.fator} onChange={(e) => setVinculos((l) => l.map((x) => (x.materialId === v.materialId ? { ...x, fator: Number(e.target.value) } : x)))} className="h-9 text-right tabular-nums" />
                  </div>
                )
              })}
              <p className="text-[12px] text-faint">Código e fator ficam salvos nesta sessão (o store ainda não guarda De-Para por fornecedor).</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

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

      <div className="grid gap-4 xl:grid-cols-[1fr_340px] items-start">
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
                      <Td mono className="text-muted">{cnpjFmt(s.cnpj)}</Td>
                      <Td>
                        <Badge tone={s.regime === 'simples' ? 'info' : 'neutral'}>{s.regime === 'simples' ? 'Simples' : 'Normal'}</Badge>
                      </Td>
                      <Td right>{s.leadTimeDias} d</Td>
                      <Td className="tabular-nums">{condFmt(s.condicaoPagamento)}</Td>
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
