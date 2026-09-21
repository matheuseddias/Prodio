import { AlertTriangle, Calculator, ChevronDown, Copy, History, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { brl, dataHoraBR, num, relativo } from '../../domain/format'
import { custoFicha, explodeBom, useStore } from '../../domain/store'
import type { Bom, BomLine, Material, Product } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Table, Td, Th, Toggle, cx } from '../../ui'

const uid = () => Math.random().toString(36).slice(2, 10)
const r4 = (v: number) => Math.round(v * 10000) / 10000

interface Versao {
  versao: number
  em: string
  custo: number
  linhas: number
}

/* ---------- Picker de item com busca simples ---------- */
function ItemPicker({ opcoes, value, onChange, placeholder }: { opcoes: { id: string; sku: string; nome: string; extra?: string }[]; value?: string; onChange: (id: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const sel = opcoes.find((o) => o.id === value)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  const ql = q.trim().toLowerCase()
  const lista = (ql ? opcoes.filter((o) => o.sku.toLowerCase().includes(ql) || o.nome.toLowerCase().includes(ql)) : opcoes).slice(0, 40)
  return (
    <div ref={ref} className="relative min-w-[200px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx('h-9 w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 text-left text-sm hover:bg-surface-2', !sel && 'text-faint')}
      >
        <span className="truncate">
          {sel ? (
            <>
              <span className="font-mono text-[12px] text-muted mr-1.5">{sel.sku}</span>
              {sel.nome}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-[min(360px,90vw)] rounded-xl border border-border bg-surface shadow-xl p-2">
          <SearchInput value={q} onChange={setQ} placeholder="Buscar por SKU ou nome…" />
          <ul className="mt-2 max-h-60 overflow-y-auto">
            {lista.length === 0 && <li className="px-2 py-3 text-[13px] text-muted">Nada encontrado.</li>}
            {lista.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id)
                    setOpen(false)
                    setQ('')
                  }}
                  className={cx('w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 flex items-center gap-2', o.id === value && 'bg-accent-soft/50')}
                >
                  <span className="font-mono text-[12px] text-muted w-20 shrink-0">{o.sku}</span>
                  <span className="truncate flex-1">{o.nome}</span>
                  {o.extra && <span className="text-[12px] text-faint shrink-0">{o.extra}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ---------- Calculadora de consumo ---------- */
type TipoCalc = 'area' | 'rolo' | 'comprimento' | 'peso' | 'unidade'
function CalculadoraModal({ unidade, onClose, onApply }: { unidade: string; onClose: () => void; onApply: (v: number) => void }) {
  const sugerido: TipoCalc = unidade === 'm2' ? 'area' : unidade === 'm' ? 'rolo' : unidade === 'kg' ? 'peso' : unidade === 'g' ? 'peso' : 'unidade'
  const [tipo, setTipo] = useState<TipoCalc>(sugerido)
  const [larg, setLarg] = useState('40')
  const [alt, setAlt] = useState('40')
  const [pecas, setPecas] = useState('1')
  const [rolo, setRolo] = useState('1.4')
  const [comp, setComp] = useState('100')
  const [peso, setPeso] = useState('10')
  const [un, setUn] = useState('1')
  const n = (s: string) => Number(String(s).replace(',', '.')) || 0

  const area = (n(larg) / 100) * (n(alt) / 100) * n(pecas)
  let resultado = 0
  let unidadeRes = unidade
  let explic = ''
  if (tipo === 'area') {
    resultado = area
    unidadeRes = 'm²'
    explic = `${larg} cm × ${alt} cm × ${pecas} peça(s) ÷ 10.000`
  } else if (tipo === 'rolo') {
    resultado = n(rolo) > 0 ? area / n(rolo) : 0
    unidadeRes = 'm (lineares)'
    explic = `área ${num(area, 4)} m² ÷ largura do rolo ${rolo} m`
  } else if (tipo === 'comprimento') {
    resultado = (n(comp) / 100) * n(pecas)
    unidadeRes = 'm'
    explic = `${comp} cm × ${pecas} peça(s) ÷ 100`
  } else if (tipo === 'peso') {
    resultado = unidade === 'g' ? n(peso) * n(pecas) : (n(peso) / 1000) * n(pecas)
    unidadeRes = unidade === 'g' ? 'g' : 'kg'
    explic = unidade === 'g' ? `${peso} g × ${pecas} peça(s)` : `${peso} g × ${pecas} peça(s) ÷ 1.000`
  } else {
    resultado = n(un) * n(pecas)
    unidadeRes = unidade || 'un'
    explic = `${un} × ${pecas} peça(s)`
  }

  const tipos: { id: TipoCalc; label: string }[] = [
    { id: 'area', label: 'Área' },
    { id: 'rolo', label: 'Rolo' },
    { id: 'comprimento', label: 'Comprimento' },
    { id: 'peso', label: 'Peso' },
    { id: 'unidade', label: 'Unidade' },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Calculadora de consumo"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={resultado <= 0} onClick={() => onApply(r4(resultado))}>
            Aplicar {num(r4(resultado), 4)}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1 mb-4">
        {tipos.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTipo(t.id)}
            className={cx('rounded-lg px-3 py-1.5 text-[13px] border transition-colors', tipo === t.id ? 'bg-accent-soft border-accent text-accent-text font-medium' : 'border-border text-muted hover:bg-surface-2')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(tipo === 'area' || tipo === 'rolo') && (
          <>
            <Field label="Largura (cm)">
              <Input type="number" inputMode="decimal" value={larg} onChange={(e) => setLarg(e.target.value)} />
            </Field>
            <Field label="Altura (cm)">
              <Input type="number" inputMode="decimal" value={alt} onChange={(e) => setAlt(e.target.value)} />
            </Field>
          </>
        )}
        {tipo === 'rolo' && (
          <Field label="Largura do rolo (m)">
            <Input type="number" inputMode="decimal" step="0.01" value={rolo} onChange={(e) => setRolo(e.target.value)} />
          </Field>
        )}
        {tipo === 'comprimento' && (
          <Field label="Comprimento (cm)">
            <Input type="number" inputMode="decimal" value={comp} onChange={(e) => setComp(e.target.value)} />
          </Field>
        )}
        {tipo === 'peso' && (
          <Field label="Peso por peça (g)">
            <Input type="number" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
          </Field>
        )}
        {tipo === 'unidade' && (
          <Field label="Quantidade por peça">
            <Input type="number" inputMode="decimal" value={un} onChange={(e) => setUn(e.target.value)} />
          </Field>
        )}
        <Field label="Peças por produto">
          <Input type="number" inputMode="numeric" value={pecas} onChange={(e) => setPecas(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5">
        <div className="text-[12px] text-muted">{explic}</div>
        <div className="text-lg font-semibold tabular-nums">
          {num(r4(resultado), 4)} <span className="text-sm font-normal text-muted">{unidadeRes}</span>
        </div>
        {unidade && unidadeRes.replace(' (lineares)', '').replace('²', '2') !== unidade && (
          <div className="mt-1 text-[12px] text-warn flex items-center gap-1">
            <AlertTriangle size={12} /> A unidade de consumo do insumo é «{unidade}». Confira antes de aplicar.
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ---------- Página ---------- */
export default function Fichas() {
  const { products, materials, boms, saveBom } = useStore()
  const [params, setParams] = useSearchParams()
  const paramId = params.get('produto')
  const [busca, setBusca] = useState('')
  const selecionadoId = paramId && products.some((p) => p.id === paramId) ? paramId : (products.find((p) => p.temFicha)?.id ?? products[0]?.id)
  const produto = products.find((p) => p.id === selecionadoId)
  const bomAtual = boms.find((b) => b.productId === selecionadoId && b.ativa) ?? boms.find((b) => b.productId === selecionadoId)

  const [linhas, setLinhas] = useState<BomLine[]>([])
  const [ativa, setAtiva] = useState(true)
  const [sujo, setSujo] = useState(false)
  const [calcLinha, setCalcLinha] = useState<string>()
  const [copiarDe, setCopiarDe] = useState('')
  const [historico, setHistorico] = useState<Record<string, Versao[]>>({})
  const [salvoEm, setSalvoEm] = useState<string>()

  // carrega o rascunho quando muda o produto
  useEffect(() => {
    setLinhas(bomAtual ? bomAtual.linhas.map((l) => ({ ...l })) : [])
    setAtiva(bomAtual?.ativa ?? true)
    setSujo(false)
    setCopiarDe('')
    setSalvoEm(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionadoId])

  const selecionar = (id: string) => setParams({ produto: id })

  const listaProdutos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return products
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.nome.toLowerCase().includes(q))
      .sort((a, b) => Number(a.temFicha) - Number(b.temFicha) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [products, busca])

  const matById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials])
  const prodById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // boms "ao vivo": o rascunho substitui a ficha do produto selecionado
  const bomsLive: Bom[] = useMemo(() => {
    if (!selecionadoId) return boms
    const draft: Bom = { productId: selecionadoId, versao: (bomAtual?.versao ?? 0) + 1, ativa: true, linhas, atualizadoEm: new Date().toISOString() }
    return [...boms.filter((b) => b.productId !== selecionadoId), draft]
  }, [boms, selecionadoId, linhas, bomAtual])

  const custoLinha = (l: BomLine) => {
    const fator = l.consumo * (1 + l.perdaPct / 100)
    if (l.tipo === 'insumo') return fator * (l.materialId ? (matById.get(l.materialId)?.custoMedio ?? 0) : 0)
    if (l.componentId) return fator * (custoFicha(l.componentId, bomsLive, materials) ?? 0)
    return 0
  }
  const custoTotal = selecionadoId ? (custoFicha(selecionadoId, bomsLive, materials) ?? 0) : 0

  const explosao = useMemo(() => {
    if (!selecionadoId) return []
    const exp = explodeBom(selecionadoId, 1, bomsLive)
    return Object.entries(exp)
      .map(([mid, q]) => ({ mid, q, m: matById.get(mid) }))
      .sort((a, b) => (b.m ? b.q * b.m.custoMedio : 0) - (a.m ? a.q * a.m.custoMedio : 0))
  }, [selecionadoId, bomsLive, matById])
  const insumosInexistentes = explosao.filter((e) => !e.m)

  // ciclo simples: a ficha do componente (multinível) contém o produto?
  const contem = (compId: string, alvo: string, vis = new Set<string>()): boolean => {
    if (compId === alvo) return true
    if (vis.has(compId)) return false
    vis.add(compId)
    const b = bomsLive.find((x) => x.productId === compId && x.ativa)
    if (!b) return false
    return b.linhas.some((l) => l.tipo === 'produto' && !!l.componentId && contem(l.componentId, alvo, vis))
  }
  const erroLinha = (l: BomLine): string | undefined => {
    if (l.tipo === 'insumo') {
      if (!l.materialId) return 'Escolha o insumo'
      if (!matById.has(l.materialId)) return 'Insumo não existe mais'
    } else {
      if (!l.componentId) return 'Escolha o componente'
      if (l.componentId === selecionadoId) return 'Componente igual ao próprio produto'
      if (contem(l.componentId, selecionadoId!)) return 'Ciclo: a ficha deste componente usa este produto'
    }
    if (!(l.consumo > 0)) return 'Consumo deve ser maior que zero'
    return undefined
  }
  const erros = linhas.map(erroLinha)
  const temErro = erros.some(Boolean)

  const upd = (id: string, patch: Partial<BomLine>) => {
    setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))
    setSujo(true)
  }
  const addLinha = () => {
    setLinhas((ls) => [...ls, { id: uid(), tipo: 'insumo', consumo: 1, unidade: '', perdaPct: 0 }])
    setSujo(true)
  }
  const setMaterial = (id: string, m: Material) => upd(id, { materialId: m.id, componentId: undefined, unidade: m.unidadeConsumo })
  const setComponente = (id: string, p: Product) => upd(id, { componentId: p.id, materialId: undefined, unidade: 'un' })

  const copiar = () => {
    const b = boms.find((x) => x.productId === copiarDe && x.ativa)
    if (!b) return
    setLinhas(b.linhas.map((l) => ({ ...l, id: uid() })))
    setSujo(true)
    setCopiarDe('')
  }

  const salvar = () => {
    if (!selecionadoId || temErro) return
    const versao = (bomAtual?.versao ?? 0) + 1
    const em = new Date().toISOString()
    saveBom({ productId: selecionadoId, versao, ativa, linhas, atualizadoEm: em })
    setHistorico((h) => ({ ...h, [selecionadoId]: [{ versao, em, custo: custoTotal, linhas: linhas.length }, ...(h[selecionadoId] ?? [])] }))
    setSujo(false)
    setSalvoEm(em)
  }

  const opcoesMat = materials.map((m) => ({ id: m.id, sku: m.sku, nome: m.nome, extra: `${brl(m.custoMedio)}/${m.unidadeConsumo}` }))
  const opcoesProd = products.filter((p) => p.id !== selecionadoId).map((p) => ({ id: p.id, sku: p.sku, nome: p.nome, extra: p.temFicha ? 'com ficha' : 'sem ficha' }))
  const hist = selecionadoId ? (historico[selecionadoId] ?? []) : []

  return (
    <>
      <PageHeader title="Fichas técnicas" subtitle="Quanto de cada insumo entra em uma unidade do produto. É daqui que saem o custo, a baixa de estoque e a necessidade de compra." />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
        {/* Lista */}
        <Card padded={false} className="lg:sticky lg:top-4">
          <div className="p-3 border-b border-border">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar produto…" />
          </div>
          <ul className="max-h-[40vh] lg:max-h-[calc(100vh-200px)] overflow-y-auto">
            {listaProdutos.length === 0 && <li className="px-4 py-6 text-[13px] text-muted text-center">Nenhum produto.</li>}
            {listaProdutos.map((p) => {
              const b = boms.find((x) => x.productId === p.id && x.ativa)
              const sel = p.id === selecionadoId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selecionar(p.id)}
                    className={cx('w-full flex items-center gap-3 px-4 py-2.5 text-left border-l-2 transition-colors', sel ? 'bg-accent-soft/40 border-accent' : 'border-transparent hover:bg-surface-2')}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.nome}</div>
                      <div className="text-[12px] text-muted font-mono">
                        {p.sku}
                        {Object.values(p.atributos).length > 0 && <span className="font-sans"> · {Object.values(p.atributos).join(' · ')}</span>}
                      </div>
                    </div>
                    {p.temFicha && b ? <Badge tone="ok">v{b.versao}</Badge> : <Badge tone="warn">sem ficha</Badge>}
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Editor */}
        {!produto ? (
          <Card>
            <EmptyState title="Selecione um produto" description="Escolha um produto na lista para ver ou montar a ficha técnica." />
          </Card>
        ) : (
          <div className="space-y-4 min-w-0">
            <Card padded={false}>
              <div className="p-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="text-[12px] text-muted font-mono">{produto.sku}</div>
                  <h2 className="text-lg font-semibold truncate">{produto.nome}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                    <span>
                      Versão <span className="font-medium text-text tabular-nums">{bomAtual ? `v${bomAtual.versao}` : '—'}</span>
                      {sujo && <span className="text-warn"> → v{(bomAtual?.versao ?? 0) + 1} ao salvar</span>}
                    </span>
                    <span>
                      Atualizado <span className="text-text">{bomAtual ? relativo(bomAtual.atualizadoEm) : 'nunca'}</span>
                    </span>
                    <Toggle checked={ativa} onChange={(v) => { setAtiva(v); setSujo(true) }} label="Ativa" />
                  </div>
                </div>
                <div className="shrink-0 rounded-xl bg-surface-2 px-4 py-3 text-right">
                  <div className="text-[12px] text-muted">Custo por unidade (ao vivo)</div>
                  <div className="text-2xl font-semibold tabular-nums tracking-tight">{brl(custoTotal)}</div>
                  <div className="text-[12px] text-muted tabular-nums">
                    {linhas.length} {linhas.length === 1 ? 'linha' : 'linhas'} · {explosao.length} insumos na explosão
                  </div>
                </div>
              </div>

              {linhas.length === 0 ? (
                <div className="border-t border-border">
                  <EmptyState
                    title="Ficha vazia"
                    description="Adicione as linhas de insumo, ou copie a ficha de um produto parecido e ajuste."
                    action={
                      <Button variant="primary" onClick={addLinha}>
                        <Plus size={16} /> Adicionar linha
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="px-5 border-t border-border">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Tipo</Th>
                        <Th>Item</Th>
                        <Th right>Consumo / un</Th>
                        <Th>Unid.</Th>
                        <Th right>Perda %</Th>
                        <Th right>Custo linha</Th>
                        <Th right></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.map((l, i) => {
                        const err = erros[i]
                        return (
                          <tr key={l.id} className={cx(err && 'bg-danger-soft/30')}>
                            <Td>
                              <Select
                                value={l.tipo}
                                onChange={(e) => upd(l.id, { tipo: e.target.value as BomLine['tipo'], materialId: undefined, componentId: undefined, unidade: '' })}
                                className="h-9 w-[130px]"
                              >
                                <option value="insumo">Insumo</option>
                                <option value="produto">Produto comp.</option>
                              </Select>
                            </Td>
                            <Td>
                              {l.tipo === 'insumo' ? (
                                <ItemPicker opcoes={opcoesMat} value={l.materialId} onChange={(id) => setMaterial(l.id, matById.get(id)!)} placeholder="Escolher insumo…" />
                              ) : (
                                <ItemPicker opcoes={opcoesProd} value={l.componentId} onChange={(id) => setComponente(l.id, prodById.get(id)!)} placeholder="Escolher produto…" />
                              )}
                              {err && <div className="mt-1 text-[12px] text-danger">{err}</div>}
                            </Td>
                            <Td right>
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.0001"
                                  min="0"
                                  value={l.consumo}
                                  onChange={(e) => upd(l.id, { consumo: Number(e.target.value) })}
                                  className="h-9 w-28 text-right tabular-nums"
                                />
                                <Button variant="ghost" size="sm" onClick={() => setCalcLinha(l.id)} aria-label="Calculadora de consumo" title="Calculadora de consumo">
                                  <Calculator size={15} />
                                </Button>
                              </div>
                            </Td>
                            <Td className="text-muted">{l.unidade || <span className="text-faint">—</span>}</Td>
                            <Td right>
                              <Input type="number" inputMode="decimal" step="0.5" min="0" value={l.perdaPct} onChange={(e) => upd(l.id, { perdaPct: Number(e.target.value) })} className="h-9 w-20 text-right tabular-nums" />
                            </Td>
                            <Td right className="font-medium">{brl(custoLinha(l))}</Td>
                            <Td right>
                              <Button variant="ghost" size="sm" onClick={() => { setLinhas((ls) => ls.filter((x) => x.id !== l.id)); setSujo(true) }} aria-label="Remover linha" title="Remover">
                                <Trash2 size={15} />
                              </Button>
                            </Td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </Table>
                </div>
              )}

              <div className="flex flex-col gap-3 p-4 border-t border-border sm:flex-row sm:items-center">
                <Button onClick={addLinha}>
                  <Plus size={16} /> Adicionar linha
                </Button>
                <div className="flex items-center gap-2 sm:ml-auto">
                  <Select value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)} className="h-9 sm:w-64">
                    <option value="">Copiar ficha de…</option>
                    {products
                      .filter((p) => p.id !== selecionadoId && boms.some((b) => b.productId === p.id && b.ativa && b.linhas.length > 0))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.nome}
                        </option>
                      ))}
                  </Select>
                  <Button size="sm" disabled={!copiarDe} onClick={copiar}>
                    <Copy size={14} /> Copiar
                  </Button>
                </div>
                <Button variant="primary" disabled={!sujo || temErro || linhas.length === 0} onClick={salvar}>
                  <Save size={16} /> Salvar v{(bomAtual?.versao ?? 0) + 1}
                </Button>
              </div>
              {salvoEm && !sujo && <div className="px-5 pb-3 text-[12px] text-ok">Ficha salva às {dataHoraBR(salvoEm)}.</div>}
            </Card>

            <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
              <Card title="Explosão (1 unidade)" padded={false}>
                {insumosInexistentes.length > 0 && (
                  <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-warn-soft text-warn px-3 py-2 text-[13px]">
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    {insumosInexistentes.length} insumo(s) referenciado(s) na ficha não existem mais no cadastro de insumos. Eles não entram no custo.
                  </div>
                )}
                {explosao.length === 0 ? (
                  <EmptyState title="Nada para explodir" description="A explosão soma os insumos da ficha, incluindo os de produtos componentes." />
                ) : (
                  <div className="px-5 pb-2">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Insumo</Th>
                          <Th right>Quantidade</Th>
                          <Th>Unid.</Th>
                          <Th right>Custo médio</Th>
                          <Th right>Custo</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {explosao.map((e) => (
                          <tr key={e.mid}>
                            <Td>
                              {e.m ? (
                                <>
                                  <span className="font-mono text-[12px] text-muted mr-1.5">{e.m.sku}</span>
                                  {e.m.nome}
                                </>
                              ) : (
                                <span className="text-danger">insumo {e.mid} não encontrado</span>
                              )}
                            </Td>
                            <Td right>{num(e.q, 4)}</Td>
                            <Td className="text-muted">{e.m?.unidadeConsumo ?? '—'}</Td>
                            <Td right className="text-muted">{e.m ? brl(e.m.custoMedio) : '—'}</Td>
                            <Td right className="font-medium">{e.m ? brl(e.q * e.m.custoMedio) : '—'}</Td>
                          </tr>
                        ))}
                        <tr>
                          <td className="px-5 py-3 border-b border-border/70 align-middle font-semibold" colSpan={4}>
                            Total
                          </td>
                          <Td right className="font-semibold">{brl(custoTotal)}</Td>
                        </tr>
                      </tbody>
                    </Table>
                  </div>
                )}
              </Card>

              <Card
                title={
                  <span className="inline-flex items-center gap-2">
                    <History size={16} className="text-faint" /> Versões nesta sessão
                  </span>
                }
              >
                {hist.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    Cada «Salvar» cria uma nova versão. {bomAtual ? `A versão atual (v${bomAtual.versao}) foi salva ${relativo(bomAtual.atualizadoEm)}.` : 'Este produto ainda não tem ficha.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {hist.map((v) => (
                      <li key={v.versao} className="py-2 flex items-center gap-3 text-sm">
                        <Badge tone={v.versao === bomAtual?.versao ? 'ok' : 'neutral'}>v{v.versao}</Badge>
                        <span className="text-muted text-[12px] flex-1">{dataHoraBR(v.em)} · {v.linhas} linhas</span>
                        <span className="font-medium tabular-nums">{brl(v.custo)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>

      {calcLinha && (
        <CalculadoraModal
          unidade={linhas.find((l) => l.id === calcLinha)?.unidade ?? ''}
          onClose={() => setCalcLinha(undefined)}
          onApply={(v) => {
            upd(calcLinha, { consumo: v })
            setCalcLinha(undefined)
          }}
        />
      )}
    </>
  )
}
