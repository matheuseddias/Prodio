import { Calculator, Pencil, Plus, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { units } from '../../domain/mock'
import { brl, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Material } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Stat, Table, Td, Th } from '../../ui'
import CalcularMinimosModal from './CalcularMinimosModal'
import ImportarPlanilha, { type CampoImport, type LinhaImport } from './ImportarPlanilha'
import { parseNumBR } from './numeros'

const uid = () => Math.random().toString(36).slice(2, 10)

const camposImport: CampoImport[] = [
  { key: 'sku', label: 'SKU', obrigatorio: true, aliases: ['codigo', 'código', 'cod'], exemplo: ['MP0078', 'MP0040'] },
  { key: 'nome', label: 'Nome', obrigatorio: true, aliases: ['descricao', 'descrição', 'insumo', 'material'], exemplo: ['Chapa espelho 3mm 3,21x2,4', 'Montana Rockl Preto'] },
  { key: 'ncm', label: 'NCM', exemplo: ['7009.91.00', ''] },
  { key: 'unidade_compra', label: 'Unidade de compra', obrigatorio: true, aliases: ['un compra', 'unidade compra', 'ucom'], exemplo: ['un', 'rl'] },
  { key: 'unidade_consumo', label: 'Unidade de consumo', obrigatorio: true, aliases: ['un consumo', 'unidade consumo'], exemplo: ['m2', 'm2'] },
  { key: 'fator', label: 'Fator de conversão', obrigatorio: true, numerico: true, aliases: ['fator conversao', 'fator conversão', 'conversao'], exemplo: ['7,7', '70'] },
  { key: 'minimo', label: 'Mínimo', numerico: true, aliases: ['estoque minimo', 'estoque mínimo', 'min'], exemplo: ['40', '30'] },
  { key: 'fornecedor', label: 'Fornecedor padrão', aliases: ['fornecedor padrao', 'fornecedor padrão', 'cnpj fornecedor'], exemplo: ['Vidros Guarulhos Ltda', '23456789000101'] },
  { key: 'lead_time', label: 'Lead time (dias)', numerico: true, aliases: ['leadtime', 'prazo', 'prazo entrega'], exemplo: ['7', '12'] },
]

function vazio(): Material {
  return { id: uid(), sku: '', nome: '', unidadeCompra: 'un', unidadeConsumo: 'un', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 0, leadTimeDias: 0 }
}

function InsumoModal({ material, insumos, onClose, onSave }: { material?: Material; insumos: Material[]; onClose: () => void; onSave: (m: Material) => void }) {
  const { suppliers } = useStore()
  const base = material ?? vazio()
  const [f, setF] = useState({
    sku: base.sku,
    nome: base.nome,
    ncm: base.ncm ?? '',
    unidadeCompra: base.unidadeCompra,
    unidadeConsumo: base.unidadeConsumo,
    fator: String(base.fatorConversao),
    minimo: String(base.minimo),
    fornecedorPadraoId: base.fornecedorPadraoId ?? '',
    leadTimeDias: String(base.leadTimeDias),
    custoMedio: String(base.custoMedio),
  })
  const [erro, setErro] = useState<string>()
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }))
  const fator = Number(f.fator.replace(',', '.'))

  const salvar = () => {
    const sku = f.sku.trim().toUpperCase()
    if (!sku) return setErro('Informe o SKU.')
    if (!f.nome.trim()) return setErro('Informe o nome.')
    if (insumos.some((m) => m.id !== base.id && m.sku.toUpperCase() === sku)) return setErro(`Já existe um insumo com o SKU ${sku}.`)
    if (!(fator > 0)) return setErro('Fator de conversão deve ser maior que zero.')
    onSave({
      ...base,
      sku,
      nome: f.nome.trim(),
      ncm: f.ncm.trim() || undefined,
      unidadeCompra: f.unidadeCompra,
      unidadeConsumo: f.unidadeConsumo,
      fatorConversao: fator,
      minimo: Number(f.minimo.replace(',', '.')) || 0,
      fornecedorPadraoId: f.fornecedorPadraoId || undefined,
      leadTimeDias: Number(f.leadTimeDias) || 0,
      custoMedio: Number(f.custoMedio.replace(',', '.')) || 0,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={material ? `Editar ${material.sku}` : 'Novo insumo'}
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
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_140px]">
          <Field label="SKU *">
            <Input value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="MP0078" className="font-mono uppercase" autoFocus={!material} />
          </Field>
          <Field label="Nome *">
            <Input value={f.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Chapa espelho 3mm" />
          </Field>
          <Field label="NCM">
            <Input value={f.ncm} onChange={(e) => set('ncm', e.target.value)} placeholder="7009.91.00" className="font-mono" />
          </Field>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="text-[13px] font-medium mb-3">Unidades e fator de conversão</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Unidade de compra">
              <Select value={f.unidadeCompra} onChange={(e) => set('unidadeCompra', e.target.value)}>
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} · {u.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidade de consumo">
              <Select value={f.unidadeConsumo} onChange={(e) => set('unidadeConsumo', e.target.value)}>
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} · {u.nome}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fator (consumo por compra)">
              <Input type="number" inputMode="decimal" step="0.01" min="0" value={f.fator} onChange={(e) => set('fator', e.target.value)} className="text-right tabular-nums" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge tone="accent" className="tabular-nums text-[13px]">
              1 {f.unidadeCompra} = {num(fator || 0, 2)} {f.unidadeConsumo}
            </Badge>
            <span className="text-[12px] text-muted">
              Você compra em <b>{f.unidadeCompra}</b> (NF-e, OC) mas a ficha consome em <b>{f.unidadeConsumo}</b>. O fator converte a entrada para a unidade da ficha e do estoque. Ex.: rolo de 70 m² → fator 70.
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={`Mínimo (${f.unidadeConsumo})`}>
            <Input type="number" inputMode="decimal" min="0" value={f.minimo} onChange={(e) => set('minimo', e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label="Fornecedor padrão">
            <Select value={f.fornecedorPadraoId} onChange={(e) => set('fornecedorPadraoId', e.target.value)}>
              <option value="">— sem padrão —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lead time (dias)">
            <Input type="number" inputMode="numeric" min="0" value={f.leadTimeDias} onChange={(e) => set('leadTimeDias', e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label={`Custo de referência (R$/${f.unidadeConsumo})`} hint={material ? 'O custo médio real é recalculado a cada NF-e recebida.' : 'Usado até a primeira entrada de NF-e.'}>
            <Input type="number" inputMode="decimal" step="0.01" min="0" value={f.custoMedio} onChange={(e) => set('custoMedio', e.target.value)} className="text-right tabular-nums" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

export default function Insumos() {
  const { materials, suppliers, upsertMaterial } = useStore()
  const [busca, setBusca] = useState('')
  const [fornecedor, setFornecedor] = useState('')
  const [soAbaixo, setSoAbaixo] = useState(false)
  const [modal, setModal] = useState<{ tipo: 'novo' } | { tipo: 'editar'; m: Material }>()
  const [calc, setCalc] = useState(false)
  const [importar, setImportar] = useState(false)

  const supById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return materials
      .filter((m) => !q || m.sku.toLowerCase().includes(q) || m.nome.toLowerCase().includes(q) || (m.ncm ?? '').includes(q))
      .filter((m) => !fornecedor || (fornecedor === '__sem' ? !m.fornecedorPadraoId : m.fornecedorPadraoId === fornecedor))
      .filter((m) => !soAbaixo || m.saldo < m.minimo)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [materials, busca, fornecedor, soAbaixo])

  const semFornecedor = materials.filter((m) => !m.fornecedorPadraoId)
  const abaixo = materials.filter((m) => m.saldo < m.minimo)
  const valorEstoque = materials.reduce((a, m) => a + m.saldo * m.custoMedio, 0)

  const onImport = (rows: LinhaImport[]) => {
    for (const r of rows) {
      const sku = r.sku.trim().toUpperCase()
      const ex = materials.find((m) => m.sku.toUpperCase() === sku)
      const fornRaw = (r.fornecedor ?? '').trim().toLowerCase()
      const forn = fornRaw
        ? suppliers.find((s) => s.nome.toLowerCase() === fornRaw || s.cnpj === fornRaw.replace(/\D/g, '') || s.nome.toLowerCase().includes(fornRaw))
        : undefined
      const fator = parseNumBR(r.fator)
      const minimo = r.minimo?.trim() ? parseNumBR(r.minimo) : (ex?.minimo ?? 0)
      const lead = r.lead_time?.trim() ? parseNumBR(r.lead_time) : (ex?.leadTimeDias ?? forn?.leadTimeDias ?? 0)
      upsertMaterial({
        ...(ex ?? vazio()),
        sku,
        nome: r.nome.trim(),
        ncm: r.ncm?.trim() || ex?.ncm,
        unidadeCompra: r.unidade_compra.trim().toLowerCase(),
        unidadeConsumo: r.unidade_consumo.trim().toLowerCase(),
        fatorConversao: fator > 0 ? fator : 1,
        minimo: Number.isNaN(minimo) ? 0 : minimo,
        fornecedorPadraoId: forn?.id ?? ex?.fornecedorPadraoId,
        leadTimeDias: Number.isNaN(lead) ? 0 : lead,
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Insumos"
        subtitle="Matérias-primas e embalagens. Compra-se numa unidade, consome-se em outra — o fator faz a ponte."
        actions={
          <>
            <Button onClick={() => setImportar(true)}>
              <Upload size={16} /> Importar planilha
            </Button>
            <Button onClick={() => setCalc(true)}>
              <Calculator size={16} /> Calcular mínimos
            </Button>
            <Button variant="primary" onClick={() => setModal({ tipo: 'novo' })}>
              <Plus size={16} /> Novo insumo
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Cadastrados" value={materials.length} />
        <Stat label="Sem fornecedor padrão" value={semFornecedor.length} tone={semFornecedor.length > 0 ? 'warn' : 'ok'} hint="OC automática precisa de um" />
        <Stat label="Abaixo do mínimo" value={abaixo.length} tone={abaixo.length > 0 ? 'danger' : 'ok'} hint={abaixo.slice(0, 2).map((m) => m.sku).join(', ')} />
        <Stat label="Valor em estoque" value={brl(valorEstoque)} hint="saldo × custo médio" />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-2 p-4 border-b border-border sm:flex-row sm:items-center">
          <SearchInput value={busca} onChange={setBusca} placeholder="SKU, nome ou NCM…" className="sm:w-72" />
          <Select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} className="sm:w-56">
            <option value="">Todos os fornecedores</option>
            <option value="__sem">Sem fornecedor padrão</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </Select>
          <label className="inline-flex items-center gap-2 text-sm text-muted sm:ml-auto">
            <input type="checkbox" checked={soAbaixo} onChange={(e) => setSoAbaixo(e.target.checked)} className="accent-accent" />
            só abaixo do mínimo
          </label>
        </div>
        {lista.length === 0 ? (
          <EmptyState title="Nenhum insumo encontrado" description={materials.length === 0 ? 'Cadastre o primeiro insumo ou importe uma planilha.' : 'Tente outra busca ou limpe os filtros.'} />
        ) : (
          <div className="px-5">
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Nome</Th>
                  <Th>Compra → consumo</Th>
                  <Th>NCM</Th>
                  <Th right>Mínimo</Th>
                  <Th right>Saldo</Th>
                  <Th right>Custo médio</Th>
                  <Th>Fornecedor padrão</Th>
                  <Th right>Lead time</Th>
                  <Th right></Th>
                </tr>
              </thead>
              <tbody>
                {lista.map((m) => {
                  const abaixoMin = m.saldo < m.minimo
                  const sup = supById.get(m.fornecedorPadraoId ?? '')
                  return (
                    <tr key={m.id} className="group hover:bg-surface-2/60">
                      <Td mono>{m.sku}</Td>
                      <Td>
                        <button type="button" onClick={() => setModal({ tipo: 'editar', m })} className="font-medium text-left hover:text-accent-text">
                          {m.nome}
                        </button>
                      </Td>
                      <Td>
                        <span className="text-muted">{m.unidadeCompra}</span> <span className="text-faint">→</span> <span>{m.unidadeConsumo}</span>
                        {m.fatorConversao !== 1 && <span className="text-muted tabular-nums"> · ×{num(m.fatorConversao, 2).replace(/,00$/, '')}</span>}
                      </Td>
                      <Td mono className="text-muted">{m.ncm ?? <span className="text-faint">—</span>}</Td>
                      <Td right className="text-muted">{num(m.minimo, 0)}</Td>
                      <Td right>
                        {abaixoMin ? (
                          <Badge tone="danger" className="tabular-nums">
                            {num(m.saldo, m.saldo % 1 ? 1 : 0)} {m.unidadeConsumo}
                          </Badge>
                        ) : (
                          <span>
                            {num(m.saldo, m.saldo % 1 ? 1 : 0)} <span className="text-muted">{m.unidadeConsumo}</span>
                          </span>
                        )}
                      </Td>
                      <Td right>{brl(m.custoMedio)}</Td>
                      <Td>{sup ? sup.nome : <Badge tone="warn">sem padrão</Badge>}</Td>
                      <Td right className="text-muted">{m.leadTimeDias} d</Td>
                      <Td right>
                        <Button variant="ghost" size="sm" className="sm:opacity-0 sm:group-hover:opacity-100" onClick={() => setModal({ tipo: 'editar', m })} aria-label="Editar" title="Editar">
                          <Pencil size={14} />
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {modal && (
        <InsumoModal
          material={modal.tipo === 'editar' ? modal.m : undefined}
          insumos={materials}
          onClose={() => setModal(undefined)}
          onSave={(m) => {
            upsertMaterial(m)
            setModal(undefined)
          }}
        />
      )}
      {calc && <CalcularMinimosModal onClose={() => setCalc(false)} />}
      <ImportarPlanilha
        open={importar}
        onClose={() => setImportar(false)}
        titulo="Importar insumos"
        campos={camposImport}
        chave="sku"
        existentes={materials.map((m) => m.sku)}
        onImport={onImport}
      />
    </>
  )
}
