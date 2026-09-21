import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { Product } from '../../domain/types'
import { Badge, Button, Field, Input, Modal, Select } from '../../ui'
import { produtoVazio, uid, type Modo } from './ProdutosModel'

interface Atributo {
  k: string
  v: string
}

/** Modal de cadastro/edição/variação de produto. */
export default function ProdutosModal({ modo, familias, produtos, onClose, onSave }: { modo: Modo; familias: string[]; produtos: Product[]; onClose: () => void; onSave: (p: Product) => void }) {
  const base: Product =
    modo.tipo === 'editar'
      ? modo.produto
      : modo.tipo === 'duplicar'
        ? { ...modo.origem, id: uid(), sku: '', ean: undefined, aliases: [], temFicha: false, custoFicha: undefined, atributos: { ...modo.origem.atributos } }
        : produtoVazio()
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
