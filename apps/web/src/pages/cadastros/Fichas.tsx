import { Calculator, Copy, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { brl, dataHoraBR, relativo } from '../../domain/format'
import { custoFicha, explodeBom, useStore } from '../../domain/store'
import type { Bom, BomLine, Material, Product } from '../../domain/types'
import { Button, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Toggle, cx } from '../../ui'
import FichasCalculadora from './FichasCalculadora'
import FichasExplosao, { type LinhaExplosao, type Versao } from './FichasExplosao'
import FichasItemPicker from './FichasItemPicker'
import FichasLista from './FichasLista'

const uid = () => Math.random().toString(36).slice(2, 10)

export default function Fichas() {
  const { products, materials, boms, saveBom } = useStore()
  const [params, setParams] = useSearchParams()
  const paramId = params.get('produto')
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

  const explosao = useMemo<LinhaExplosao[]>(() => {
    if (!selecionadoId) return []
    const exp = explodeBom(selecionadoId, 1, bomsLive)
    return Object.entries(exp)
      .map(([mid, q]) => ({ mid, q, m: matById.get(mid) }))
      .sort((a, b) => (b.m ? b.q * b.m.custoMedio : 0) - (a.m ? a.q * a.m.custoMedio : 0))
  }, [selecionadoId, bomsLive, matById])

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
  // Item que não está mais na lista (excluído em outra aba) não pode entrar na ficha nem quebrar a tela.
  const setMaterial = (id: string, m?: Material) => m && upd(id, { materialId: m.id, componentId: undefined, unidade: m.unidadeConsumo })
  const setComponente = (id: string, p?: Product) => p && upd(id, { componentId: p.id, materialId: undefined, unidade: 'un' })

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
        <FichasLista products={products} boms={boms} selecionadoId={selecionadoId} onSelect={selecionar} />

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
                                <FichasItemPicker opcoes={opcoesMat} value={l.materialId} onChange={(id) => setMaterial(l.id, matById.get(id))} placeholder="Escolher insumo…" />
                              ) : (
                                <FichasItemPicker opcoes={opcoesProd} value={l.componentId} onChange={(id) => setComponente(l.id, prodById.get(id))} placeholder="Escolher produto…" />
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

            <FichasExplosao explosao={explosao} custoTotal={custoTotal} bomAtual={bomAtual} hist={hist} />
          </div>
        )}
      </div>

      {calcLinha && (
        <FichasCalculadora
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
