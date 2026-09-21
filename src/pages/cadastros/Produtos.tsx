import { Copy, Pencil, Plus, Upload, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { brl } from '../../domain/format'
import { custoFicha, useStore } from '../../domain/store'
import type { Product } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Stat, Table, Td, Th, cx } from '../../ui'
import ImportarPlanilha, { type CampoImport, type LinhaImport } from './ImportarPlanilha'

const uid = () => Math.random().toString(36).slice(2, 10)

const camposImport: CampoImport[] = [
  { key: 'sku', label: 'SKU', obrigatorio: true, aliases: ['codigo', 'código', 'cod'], exemplo: ['TM000076', 'ED000001'] },
  { key: 'nome', label: 'Nome', obrigatorio: true, aliases: ['descricao', 'descrição', 'produto'], exemplo: ['Espelho Redondo Adnet 40cm', 'Mouse Pad Desk Pad 90x40'] },
  { key: 'familia', label: 'Família', aliases: ['categoria', 'grupo', 'linha'], exemplo: ['Espelho', 'Mousepad'] },
  { key: 'cor', label: 'Cor', aliases: ['color'], exemplo: ['Preto', 'Caramelo'] },
  { key: 'tamanho', label: 'Tamanho', aliases: ['tam', 'medida'], exemplo: ['40cm', '90x40'] },
  { key: 'ean', label: 'EAN', aliases: ['gtin', 'codigo de barras'], exemplo: ['7898676461347', ''] },
  { key: 'ncm', label: 'NCM', exemplo: ['7009.91.00', '5603.94.10'] },
  { key: 'aliases', label: 'Aliases (SKUs comerciais)', aliases: ['alias', 'sku comercial', 'skus'], exemplo: ['ED000130|ED000131', ''] },
]

interface Atributo {
  k: string
  v: string
}

type Modo = { tipo: 'novo' } | { tipo: 'editar'; produto: Product } | { tipo: 'duplicar'; origem: Product }

function vazio(): Product {
  return { id: uid(), sku: '', nome: '', familia: '', atributos: {}, status: 'ativo', aliases: [], temFicha: false }
}

function ProdutoModal({ modo, familias, produtos, onClose, onSave }: { modo: Modo; familias: string[]; produtos: Product[]; onClose: () => void; onSave: (p: Product) => void }) {
  const base: Product =
    modo.tipo === 'editar'
      ? modo.produto
      : modo.tipo === 'duplicar'
        ? { ...modo.origem, id: uid(), sku: '', ean: undefined, aliases: [], temFicha: false, custoFicha: undefined, atributos: { ...modo.origem.atributos } }
        : vazio()
  const [sku, setSku] = useState(base.sku)
  const [nome, setNome] = useState(base.nome)
  const [familia, setFamilia] = useState(base.familia)
  const [outraFamilia, setOutraFamilia] = useState(!familias.includes(base.familia) && base.familia !== '')
  const [atributos, setAtributos] = useState<Atributo[]>(Object.entries(base.atributos).map(([k, v]) => ({ k, v })))
  const [ean, setEan] = useState(base.ean ?? '')
  const [ncm, setNcm] = useState(base.ncm ?? '')
  const [status, setStatus] = useState<Product['status']>(base.status)
  const [aliases, setAliases] = useState<string[]>(base.aliases)
  const [novoAlias, setNovoAlias] = useState('')
  const [erro, setErro] = useState<string>()

  const titulo = modo.tipo === 'editar' ? `Editar ${modo.produto.sku}` : modo.tipo === 'duplicar' ? `Variação de ${modo.origem.sku}` : 'Novo produto'

  const addAlias = () => {
    const a = novoAlias.trim().toUpperCase()
    if (!a) return
    if (!aliases.includes(a)) setAliases((l) => [...l, a])
    setNovoAlias('')
  }

  const salvar = () => {
    const s = sku.trim().toUpperCase()
    if (!s) return setErro('Informe o SKU.')
    if (!nome.trim()) return setErro('Informe o nome.')
    if (produtos.some((p) => p.id !== base.id && p.sku.toUpperCase() === s)) return setErro(`Já existe um produto com o SKU ${s}.`)
    const attrs: Record<string, string> = {}
    for (const a of atributos) if (a.k.trim() && a.v.trim()) attrs[a.k.trim().toLowerCase()] = a.v.trim()
    onSave({
      ...base,
      sku: s,
      nome: nome.trim(),
      familia: familia.trim() || 'Sem família',
      atributos: attrs,
      ean: ean.trim() || undefined,
      ncm: ncm.trim() || undefined,
      status,
      aliases,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={titulo}
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
        {modo.tipo === 'duplicar' && (
          <div className="rounded-lg bg-info-soft text-info px-3 py-2 text-[13px]">
            Copiando nome, família, NCM e atributos de <span className="font-mono">{modo.origem.sku}</span>. Informe o novo SKU e ajuste cor/tamanho. A ficha técnica não é copiada — use «Copiar ficha de…» na tela de Fichas.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="SKU *">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="TM000076" className="font-mono uppercase" autoFocus={modo.tipo !== 'editar'} />
          </Field>
          <Field label="Nome *" className="sm:col-span-2">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Espelho Redondo Adnet 40cm" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Família">
            {outraFamilia ? (
              <div className="flex gap-2">
                <Input value={familia} onChange={(e) => setFamilia(e.target.value)} placeholder="Nova família" autoFocus />
                <Button variant="ghost" size="sm" className="h-10" onClick={() => { setOutraFamilia(false); setFamilia(familias[0] ?? '') }} aria-label="Voltar para a lista">
                  <X size={16} />
                </Button>
              </div>
            ) : (
              <Select
                value={familia}
                onChange={(e) => {
                  if (e.target.value === '__outra') {
                    setOutraFamilia(true)
                    setFamilia('')
                  } else setFamilia(e.target.value)
                }}
              >
                <option value="">—</option>
                {familias.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                <option value="__outra">Outra…</option>
              </Select>
            )}
          </Field>
          <Field label="EAN">
            <Input value={ean} onChange={(e) => setEan(e.target.value)} placeholder="7898676461347" className="font-mono" inputMode="numeric" />
          </Field>
          <Field label="NCM">
            <Input value={ncm} onChange={(e) => setNcm(e.target.value)} placeholder="7009.91.00" className="font-mono" />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-medium text-muted">Atributos</span>
            <Button size="sm" variant="ghost" onClick={() => setAtributos((l) => [...l, { k: '', v: '' }])}>
              <Plus size={14} /> Atributo
            </Button>
          </div>
          {atributos.length === 0 ? (
            <div className="text-[12px] text-faint">Ex.: cor, tamanho, material. Aparecem como chips na lista e servem para gerar variações.</div>
          ) : (
            <div className="space-y-2">
              {atributos.map((a, i) => (
                <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                  <Input value={a.k} onChange={(e) => setAtributos((l) => l.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="cor" list="attr-keys" />
                  <Input value={a.v} onChange={(e) => setAtributos((l) => l.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="Preto" />
                  <Button variant="ghost" size="sm" className="h-10" onClick={() => setAtributos((l) => l.filter((_, j) => j !== i))} aria-label="Remover atributo">
                    <X size={16} />
                  </Button>
                </div>
              ))}
              <datalist id="attr-keys">
                <option value="cor" />
                <option value="tamanho" />
                <option value="material" />
                <option value="acabamento" />
              </datalist>
            </div>
          )}
        </div>

        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Product['status'])} className="sm:max-w-[200px]">
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </Select>
        </Field>

        <div>
          <span className="block text-[13px] font-medium text-muted mb-1.5">Aliases (SKUs comerciais)</span>
          <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
            {aliases.map((a) => (
              <Badge key={a} tone="accent" className="font-mono">
                {a}
                <button type="button" onClick={() => setAliases((l) => l.filter((x) => x !== a))} className="ml-0.5 hover:text-danger" aria-label={`Remover ${a}`}>
                  <X size={12} />
                </button>
              </Badge>
            ))}
            {aliases.length === 0 && <span className="text-[12px] text-faint self-center">Nenhum alias.</span>}
          </div>
          <div className="flex gap-2">
            <Input
              value={novoAlias}
              onChange={(e) => setNovoAlias(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addAlias()
                }
              }}
              placeholder="ED000130"
              className="font-mono uppercase sm:max-w-[240px]"
            />
            <Button onClick={addAlias}>Adicionar</Button>
          </div>
          <p className="text-[12px] text-faint mt-1.5">
            É o De-Para com a base de pedidos: quando o marketplace/ERP vende um destes códigos, o Prodio conta a demanda neste produto.
          </p>
        </div>
      </div>
    </Modal>
  )
}

export default function Produtos() {
  const { products, boms, materials, upsertProduct } = useStore()
  const [busca, setBusca] = useState('')
  const [familia, setFamilia] = useState('')
  const [status, setStatus] = useState('')
  const [soSemFicha, setSoSemFicha] = useState(false)
  const [modo, setModo] = useState<Modo>()
  const [importar, setImportar] = useState(false)

  const familias = useMemo(() => Array.from(new Set(products.map((p) => p.familia))).sort((a, b) => a.localeCompare(b, 'pt-BR')), [products])

  const custos = useMemo(() => {
    const m = new Map<string, number | undefined>()
    for (const p of products) m.set(p.id, custoFicha(p.id, boms, materials))
    return m
  }, [products, boms, materials])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return products
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.nome.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q)))
      .filter((p) => !familia || p.familia === familia)
      .filter((p) => !status || p.status === status)
      .filter((p) => !soSemFicha || !p.temFicha)
      .sort((a, b) => a.familia.localeCompare(b.familia, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR') || a.sku.localeCompare(b.sku))
  }, [products, busca, familia, status, soSemFicha])

  const ativos = products.filter((p) => p.status === 'ativo')
  const semFicha = ativos.filter((p) => !p.temFicha)
  const comAlias = products.filter((p) => p.aliases.length > 0)

  const onImport = (rows: LinhaImport[]) => {
    for (const r of rows) {
      const sku = r.sku.trim().toUpperCase()
      const existente = products.find((p) => p.sku.toUpperCase() === sku)
      const atributos = { ...(existente?.atributos ?? {}) }
      if (r.cor?.trim()) atributos.cor = r.cor.trim()
      if (r.tamanho?.trim()) atributos.tamanho = r.tamanho.trim()
      const aliases = r.aliases
        ? r.aliases.split(/[|,\s]+/).map((a) => a.trim().toUpperCase()).filter(Boolean)
        : (existente?.aliases ?? [])
      upsertProduct({
        ...(existente ?? vazio()),
        sku,
        nome: r.nome.trim(),
        familia: r.familia?.trim() || existente?.familia || 'Sem família',
        atributos,
        ean: r.ean?.trim() || existente?.ean,
        ncm: r.ncm?.trim() || existente?.ncm,
        aliases: Array.from(new Set(aliases)),
      })
    }
  }

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle="O que a fábrica produz e vende. Cada produto precisa de uma ficha técnica para virar consumo de insumos."
        actions={
          <>
            <Button onClick={() => setImportar(true)}>
              <Upload size={16} /> Importar planilha
            </Button>
            <Button variant="primary" onClick={() => setModo({ tipo: 'novo' })}>
              <Plus size={16} /> Novo produto
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Ativos" value={ativos.length} hint={`${products.length - ativos.length} inativos`} />
        <Stat label="Sem ficha técnica" value={semFicha.length} tone={semFicha.length > 0 ? 'warn' : 'ok'} hint={semFicha.length > 0 ? 'não geram consumo' : 'tudo com ficha'} />
        <Stat label="Com alias comercial" value={comAlias.length} hint="De-Para com pedidos" />
        <Stat label="Famílias" value={familias.length} hint={familias.slice(0, 3).join(', ')} />
      </div>

      <Card padded={false}>
        <div className="flex flex-col gap-2 p-4 border-b border-border sm:flex-row sm:items-center">
          <SearchInput value={busca} onChange={setBusca} placeholder="SKU, nome ou alias…" className="sm:w-72" />
          <Select value={familia} onChange={(e) => setFamilia(e.target.value)} className="sm:w-44">
            <option value="">Todas as famílias</option>
            {familias.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-36">
            <option value="">Todos os status</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </Select>
          <label className="inline-flex items-center gap-2 text-sm text-muted sm:ml-auto">
            <input type="checkbox" checked={soSemFicha} onChange={(e) => setSoSemFicha(e.target.checked)} className="accent-accent" />
            só sem ficha
          </label>
        </div>
        {lista.length === 0 ? (
          <EmptyState
            title="Nenhum produto encontrado"
            description={products.length === 0 ? 'Cadastre o primeiro produto ou importe uma planilha.' : 'Tente outra busca ou limpe os filtros.'}
            action={
              <Button variant="primary" onClick={() => setModo({ tipo: 'novo' })}>
                <Plus size={16} /> Novo produto
              </Button>
            }
          />
        ) : (
          <div className="px-5">
            <Table>
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Nome</Th>
                  <Th>Atributos</Th>
                  <Th>Família</Th>
                  <Th>EAN</Th>
                  <Th>Aliases</Th>
                  <Th>Ficha</Th>
                  <Th>Status</Th>
                  <Th right></Th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const custo = custos.get(p.id)
                  const bom = boms.find((b) => b.productId === p.id && b.ativa)
                  return (
                    <tr key={p.id} className="group hover:bg-surface-2/60">
                      <Td mono>{p.sku}</Td>
                      <Td>
                        <button type="button" onClick={() => setModo({ tipo: 'editar', produto: p })} className="font-medium text-left hover:text-accent-text">
                          {p.nome}
                        </button>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(p.atributos).map(([k, v]) => (
                            <span key={k} title={k}>
                              <Badge>{v}</Badge>
                            </span>
                          ))}
                        </div>
                      </Td>
                      <Td className="text-muted">{p.familia}</Td>
                      <Td mono className="text-muted">{p.ean ?? <span className="text-faint">—</span>}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {p.aliases.length === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            p.aliases.map((a) => (
                              <Badge key={a} tone="accent" className="font-mono">
                                {a}
                              </Badge>
                            ))
                          )}
                        </div>
                      </Td>
                      <Td>
                        {p.temFicha && bom ? (
                          <Link to={`/cadastros/fichas?produto=${p.id}`}>
                            <Badge tone="ok" className="tabular-nums hover:brightness-95">
                              v{bom.versao} · {custo !== undefined ? brl(custo) : '—'}
                            </Badge>
                          </Link>
                        ) : (
                          <Link to={`/cadastros/fichas?produto=${p.id}`}>
                            <Badge tone="warn" className="hover:brightness-95">sem ficha →</Badge>
                          </Link>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={p.status === 'ativo' ? 'ok' : 'neutral'}>{p.status}</Badge>
                      </Td>
                      <Td right>
                        <div className={cx('flex justify-end gap-1 transition-opacity', 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100')}>
                          <Button variant="ghost" size="sm" onClick={() => setModo({ tipo: 'editar', produto: p })} aria-label="Editar" title="Editar">
                            <Pencil size={14} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setModo({ tipo: 'duplicar', origem: p })} aria-label="Duplicar como variação" title="Duplicar como variação">
                            <Copy size={14} />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {modo && (
        <ProdutoModal
          modo={modo}
          familias={familias}
          produtos={products}
          onClose={() => setModo(undefined)}
          onSave={(p) => {
            upsertProduct(p)
            setModo(undefined)
          }}
        />
      )}

      <ImportarPlanilha
        open={importar}
        onClose={() => setImportar(false)}
        titulo="Importar produtos"
        campos={camposImport}
        chave="sku"
        existentes={products.map((p) => p.sku)}
        onImport={onImport}
      />
    </>
  )
}
