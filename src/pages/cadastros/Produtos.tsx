import { Copy, Pencil, Plus, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { brl } from '../../domain/format'
import { custoFicha, useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, Stat, Table, Td, Th, cx } from '../../ui'
import ImportarPlanilha, { type CampoImport, type LinhaImport } from './ImportarPlanilha'
import ProdutosModal from './ProdutosModal'
import { produtoVazio, type Modo } from './ProdutosModel'

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
        ...(existente ?? produtoVazio()),
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
        <ProdutosModal
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
