import { AlertTriangle, Printer, Settings2, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { diaProducao, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { Label, LabelKind } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Select, Table, Td, Th, Toggle, cx } from '../../ui'
import { EtiquetasHistorico } from './EtiquetasHistorico'
import { EtiquetasPreview, type GrupoPreview } from './EtiquetasPreview'
import { DESCRICAO_TIPO, NOME_TIPO, ORDEM_TIPOS, caixasPara, etiquetasDoPedido, perfilDe, resumoPerfis, type ItemPreview, type Req, type Tamanho } from './etiquetasUtils'

export default function Etiquetas() {
  const s = useStore()
  const { product, productRef } = useLookups()
  const nav = useNavigate()
  // Mesmo dia que a camada de dados usou para buscar plano e etiquetas (hora de virada do tenant).
  const hoje = diaProducao(s.tenant.horaVirada)
  const perfis = s.tenant.perfisEtiqueta
  const exigeProjecao = s.tenant.exigirProjecaoParaImprimir

  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const [tiposOff, setTiposOff] = useState<Record<string, LabelKind[]>>({})
  const [tam, setTam] = useState<Tamanho>('60x40')
  const [paraAmanha, setParaAmanha] = useState(false)
  const [reqs, setReqs] = useState<Req[] | null>(null)

  const linhas = s.dailyPlan
  const sugerido = (l: (typeof linhas)[number]) => Math.max(0, l.projetado - l.impresso)
  const bloqueada = (l: (typeof linhas)[number]) => exigeProjecao && l.projetado === 0 && !paraAmanha
  const tiposAtivos = (pid: string, tipos: LabelKind[]) => tipos.filter((t) => !(tiposOff[pid] ?? []).includes(t))
  const alternarTipo = (pid: string, t: LabelKind) =>
    setTiposOff((x) => {
      const atual = x[pid] ?? []
      return { ...x, [pid]: atual.includes(t) ? atual.filter((k) => k !== t) : [...atual, t] }
    })

  const preencherRestante = () => {
    const q: Record<string, number> = {}
    const sl: Record<string, boolean> = {}
    for (const l of linhas) {
      const r = sugerido(l)
      if (r > 0 && !bloqueada(l)) {
        q[l.productId] = r
        sl[l.productId] = true
      }
    }
    setQtd(q)
    setSel(sl)
  }

  // Pedidos desta impressão (estado de tela derivado; barato o bastante para recalcular a cada render).
  const pedidos: Req[] = linhas
    .filter((l) => sel[l.productId] && (qtd[l.productId] ?? 0) > 0 && !bloqueada(l))
    .map((l) => {
      const perfil = perfilDe(perfis, product(l.productId))
      const tipos = tiposAtivos(l.productId, perfil.tipos)
      const unidades = qtd[l.productId] ?? 0
      return { productId: l.productId, unidades, caixas: tipos.includes('caixa') ? caixasPara(unidades, perfil.unidadesPorCaixa) : 0, tipos }
    })
    .filter((r) => r.tipos.length > 0)
  const totalEtiquetas = pedidos.reduce((a, r) => a + etiquetasDoPedido(r), 0)

  const gerar = () => {
    for (const r of pedidos) {
      if (r.tipos.includes('produto') || r.tipos.includes('montagem')) s.printLabels(r.productId, r.unidades, 'unidade')
      if (r.tipos.includes('caixa') && r.caixas > 0) s.printLabels(r.productId, r.caixas, 'caixa')
    }
    setReqs(pedidos)
    setSel({})
    setQtd({})
    setTiposOff({})
  }

  const reimprimir = (l: Label) => {
    const perfil = perfilDe(perfis, product(l.productId))
    s.annulLabel(l.serial)
    s.printLabels(l.productId, 1, l.tipo)
    const tipos: LabelKind[] = l.tipo === 'caixa' ? ['caixa'] : perfil.tipos.filter((t) => t !== 'caixa')
    setReqs([{ productId: l.productId, unidades: l.tipo === 'unidade' ? 1 : 0, caixas: l.tipo === 'caixa' ? 1 : 0, tipos: tipos.length ? tipos : ['produto'] }])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Pré-visualização derivada do store: últimas N etiquetas de hoje por SKU, agrupadas por tipo na ordem de colagem.
  const preview = useMemo<GrupoPreview[] | null>(() => {
    if (!reqs) return null
    const grupos: Record<LabelKind, ItemPreview[]> = { produto: [], montagem: [], caixa: [] }
    for (const r of reqs) {
      const p = product(r.productId)
      if (!p) continue
      const perfil = perfilDe(perfis, p)
      const deHoje = s.labels.filter((l) => l.productId === r.productId && l.dia === hoje)
      const unidades = r.unidades > 0 ? deHoje.filter((l) => l.tipo === 'unidade').slice(-r.unidades) : []
      const caixas = r.caixas > 0 ? deHoje.filter((l) => l.tipo === 'caixa').slice(-r.caixas) : []
      const itens = (ls: Label[]) => ls.map((label, i) => ({ label, p, perfil, n: i + 1, total: ls.length }))
      if (r.tipos.includes('produto')) grupos.produto.push(...itens(unidades))
      if (r.tipos.includes('montagem')) grupos.montagem.push(...itens(unidades))
      if (r.tipos.includes('caixa')) grupos.caixa.push(...itens(caixas))
    }
    return ORDEM_TIPOS.map((tipo) => ({ tipo, itens: grupos[tipo] })).filter((g) => g.itens.length > 0)
  }, [reqs, s.labels, hoje, product, perfis])

  return (
    <>
      <style>{`@media print {
        aside, header, nav, .no-print { display: none !important; }
        html, body, #root, main, .h-full { height: auto !important; overflow: visible !important; }
        .print-area { display: block !important; }
        .etiqueta { break-inside: avoid; page-break-inside: avoid; }
        @page { margin: 6mm; }
      }`}</style>

      <div className="no-print">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Etiquetas</h1>
            <p className="text-sm text-muted mt-1">Gere seriais únicos por peça. O perfil da família decide quais etiquetas saem; só o que tem etiqueta consegue ser bipado.</p>
            <p className="text-[12px] text-muted mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                <span className="font-medium text-text">Perfis:</span> {perfis.length ? resumoPerfis(perfis) : 'nenhum perfil cadastrado (todas as famílias saem só com Produto)'}
              </span>
              <Link to="/configuracoes" className="inline-flex items-center gap-1 text-accent-text hover:underline">
                <Settings2 size={12} /> Configurar perfis de etiqueta
              </Link>
            </p>
          </div>
          <Button variant="primary" onClick={gerar} disabled={totalEtiquetas === 0}>
            <Printer size={16} /> Gerar e imprimir {totalEtiquetas > 0 && `(${num(totalEtiquetas)})`}
          </Button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card
            className="xl:col-span-2"
            title="SKUs do plano de hoje"
            padded={false}
            actions={
              <Button size="sm" onClick={preencherRestante}>
                <Wand2 size={14} /> Preencher restante do projetado
              </Button>
            }
          >
            {linhas.length === 0 ? (
              <EmptyState title="Plano vazio" description="Defina a projeção do dia na Linha de hoje." action={<Button size="sm" onClick={() => nav('/producao/linha-de-hoje')}>Ir para Linha de hoje</Button>} />
            ) : (
              <div className="px-5 pb-2">
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-10"></Th>
                      <Th>Produto</Th>
                      <Th>Etiquetas do perfil</Th>
                      <Th right>Projetado</Th>
                      <Th right>Impresso</Th>
                      <Th right>Sugerido</Th>
                      <Th right>Peças</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const p = product(l.productId)
                      const ref = productRef(l.productId)
                      const perfil = perfilDe(perfis, p)
                      const b = bloqueada(l)
                      const sug = sugerido(l)
                      const ativos = tiposAtivos(l.productId, perfil.tipos)
                      const q = qtd[l.productId] ?? 0
                      return (
                        <tr key={l.productId} className={cx(b && 'opacity-70')}>
                          <Td>
                            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={!!sel[l.productId] && !b} disabled={b} onChange={(e) => setSel((x) => ({ ...x, [l.productId]: e.target.checked }))} aria-label={`Selecionar ${ref.sku}`} />
                          </Td>
                          <Td>
                            <div className="font-medium whitespace-nowrap">
                              <span className={cx(ref.removido && 'text-muted italic')}>{ref.nome}</span>
                              {ref.cor && <span className="uppercase text-accent-text"> · {ref.cor}</span>}
                            </div>
                            <div className="text-[12px] text-muted font-mono flex items-center gap-2">
                              {ref.sku}
                              {l.projetado === 0 && exigeProjecao && (
                                <Badge tone={paraAmanha ? 'info' : 'warn'}>
                                  <AlertTriangle size={12} /> {paraAmanha ? 'Impressão para amanhã' : 'Sem projeção do dia'}
                                </Badge>
                              )}
                            </div>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center gap-1">
                              {perfil.tipos.map((t) => {
                                const on = ativos.includes(t)
                                return (
                                  <button
                                    key={t}
                                    type="button"
                                    disabled={b}
                                    onClick={() => alternarTipo(l.productId, t)}
                                    title={on ? `${DESCRICAO_TIPO[t]} Clique para não imprimir desta vez.` : `Desmarcada nesta impressão. Clique para incluir.`}
                                    aria-pressed={on}
                                    className={cx(
                                      'h-7 rounded-md border px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed',
                                      on ? 'border-accent/40 bg-accent-soft text-accent-text' : 'border-border bg-surface text-faint line-through',
                                    )}
                                  >
                                    {NOME_TIPO[t]}
                                    {t === 'caixa' && <span className="ml-1 font-normal tabular-nums">{q > 0 && on ? `${caixasPara(q, perfil.unidadesPorCaixa)} cx` : `${perfil.unidadesPorCaixa}/cx`}</span>}
                                  </button>
                                )
                              })}
                              {perfil.padrao && (
                                <span className="text-[11px] text-faint" title="Família sem perfil: sai só a etiqueta de produto com prefixo PR.">
                                  sem perfil
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td right>{num(l.projetado)}</Td>
                          <Td right className="text-muted">{num(l.impresso)}</Td>
                          <Td right className={cx(sug > 0 ? 'font-medium' : 'text-faint')}>{num(sug)}</Td>
                          <Td right>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              disabled={b}
                              value={qtd[l.productId] ?? ''}
                              placeholder="0"
                              onChange={(e) => {
                                const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                                setQtd((x) => ({ ...x, [l.productId]: v }))
                                if (v > 0) setSel((x) => ({ ...x, [l.productId]: true }))
                              }}
                              className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
                              aria-label="Quantidade de peças"
                            />
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>

          <Card title="Opções de impressão">
            <div className="space-y-4">
              <Field label="Tamanho da etiqueta">
                <Select value={tam} onChange={(e) => setTam(e.target.value as Tamanho)}>
                  <option value="50x30">50 × 30 mm</option>
                  <option value="60x40">60 × 40 mm</option>
                  <option value="100x50">100 × 50 mm</option>
                </Select>
              </Field>

              <div className="rounded-lg bg-surface-2/60 p-3 text-[12px] text-muted space-y-1.5">
                <div className="font-medium text-text text-[13px]">O que sai por peça</div>
                {ORDEM_TIPOS.map((t) => (
                  <div key={t}>
                    <span className="font-medium text-text">{NOME_TIPO[t]}</span> — {DESCRICAO_TIPO[t]}
                  </div>
                ))}
                <div className="text-faint pt-1">A quantidade informada é em peças. Caixas são calculadas pelo perfil da família.</div>
              </div>

              {pedidos.length > 0 && (
                <div className="rounded-lg border border-border p-3 text-[12px] space-y-1">
                  <div className="font-medium text-[13px]">Resumo desta impressão</div>
                  {pedidos.map((r) => {
                    const ref = productRef(r.productId)
                    return (
                      <div key={r.productId} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-muted">{ref.sku}</span>
                        <span className="tabular-nums whitespace-nowrap">
                          {r.tipos.filter((t) => t !== 'caixa').map((t) => `${num(r.unidades)} ${NOME_TIPO[t].toLowerCase()}`).join(' + ')}
                          {r.tipos.includes('caixa') && ` + ${num(r.caixas)} caixa(s)`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {exigeProjecao ? (
                <div className="border-t border-border pt-4">
                  <Toggle checked={paraAmanha} onChange={setParaAmanha} label="Permitir imprimir para amanhã" />
                  <p className="text-[12px] text-faint mt-1.5">SKUs sem projeção do dia ficam bloqueados para hoje. Ative para adiantar etiquetas de amanhã.</p>
                </div>
              ) : (
                <p className="text-[12px] text-faint border-t border-border pt-4">Impressão liberada sem projeção do dia (configuração da empresa).</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {preview && preview.length > 0 && <EtiquetasPreview grupos={preview} tam={tam} onClose={() => setReqs(null)} />}

      <EtiquetasHistorico hoje={hoje} onReimprimir={reimprimir} />
    </>
  )
}
