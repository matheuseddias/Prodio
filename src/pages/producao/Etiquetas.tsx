import { AlertTriangle, Ban, Printer, RotateCcw, Wand2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useNavigate } from 'react-router-dom'
import { hojeISO, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { Label, Product } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Td, Th, Toggle, cx } from '../../ui'

type Tamanho = '50x30' | '60x40' | '100x50'
const TAMANHOS: Record<Tamanho, { w: number; h: number; qr: number; fonte: number }> = {
  '50x30': { w: 50, h: 30, qr: 22, fonte: 8 },
  '60x40': { w: 60, h: 40, qr: 30, fonte: 9 },
  '100x50': { w: 100, h: 50, qr: 40, fonte: 11 },
}

interface Req {
  productId: string
  qtd: number
  tipo: 'unidade' | 'caixa'
}

function Etiqueta({ label, p, n, total, tam, montagem }: { label: Label; p: Product; n: number; total: number; tam: Tamanho; montagem?: boolean }) {
  const t = TAMANHOS[tam]
  return (
    <div
      className="etiqueta box-border flex items-center gap-2 border border-dashed border-border bg-white text-black p-[2mm] overflow-hidden print:border-0"
      style={{ width: `${t.w}mm`, height: `${t.h}mm`, fontSize: `${t.fonte}pt` }}
    >
      {!montagem && <QRCodeSVG value={label.serial} size={t.qr * 3.78} level="M" style={{ width: `${t.qr}mm`, height: `${t.qr}mm`, flexShrink: 0 }} />}
      <div className="min-w-0 flex-1 leading-tight">
        {montagem && <div className="font-bold uppercase tracking-wide">Montagem</div>}
        <div className="font-bold uppercase truncate" style={{ fontSize: '1.15em' }}>
          {p.atributos.cor}
        </div>
        <div className="truncate">{p.nome}</div>
        <div className="font-mono opacity-80" style={{ fontSize: '0.85em' }}>
          {p.sku}
          {p.atributos.tamanho && ` · ${p.atributos.tamanho}`}
        </div>
        <div className="font-mono mt-0.5" style={{ fontSize: '0.9em' }}>
          {label.serial}
        </div>
        <div className="tabular-nums opacity-80" style={{ fontSize: '0.85em' }}>
          {n}/{total}
          {label.tipo === 'caixa' && ` · cx ${label.quantidade}`}
        </div>
      </div>
    </div>
  )
}

export default function Etiquetas() {
  const s = useStore()
  const { product } = useLookups()
  const nav = useNavigate()
  const hoje = hojeISO()

  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const [modo, setModo] = useState<'unidade' | 'caixa'>('unidade')
  const [porCaixa, setPorCaixa] = useState(6)
  const [tam, setTam] = useState<Tamanho>('60x40')
  const [montagem, setMontagem] = useState(false)
  const [paraAmanha, setParaAmanha] = useState(false)
  const [reqs, setReqs] = useState<Req[] | null>(null)
  const [anuladas, setAnuladas] = useState<Set<string>>(new Set())

  const linhas = s.dailyPlan
  const sugerido = (l: (typeof linhas)[number]) => Math.max(0, l.projetado - l.impresso)
  const bloqueada = (l: (typeof linhas)[number]) => l.projetado === 0 && !paraAmanha

  const preencherRestante = () => {
    const q: Record<string, number> = {}
    const sl: Record<string, boolean> = {}
    for (const l of linhas) {
      const r = sugerido(l)
      if (r > 0) {
        q[l.productId] = modo === 'caixa' ? Math.ceil(r / porCaixa) : r
        sl[l.productId] = true
      }
    }
    setQtd(q)
    setSel(sl)
  }

  const selecionadas = linhas.filter((l) => sel[l.productId] && (qtd[l.productId] ?? 0) > 0 && !bloqueada(l))
  const totalEtiquetas = selecionadas.reduce((a, l) => a + (qtd[l.productId] ?? 0), 0)

  const gerar = () => {
    const r: Req[] = []
    for (const l of selecionadas) {
      const q = qtd[l.productId] ?? 0
      s.printLabels(l.productId, q, modo)
      r.push({ productId: l.productId, qtd: q, tipo: modo })
    }
    setReqs(r)
    setSel({})
    setQtd({})
  }

  // Pré-visualização derivada do store (últimas N etiquetas de hoje por SKU)
  const preview = useMemo(() => {
    if (!reqs) return []
    return reqs.map((r) => {
      const todas = s.labels.filter((l) => l.productId === r.productId && l.dia === hoje)
      return { p: product(r.productId)!, labels: todas.slice(-r.qtd), tipo: r.tipo }
    })
  }, [reqs, s.labels, hoje, product])

  const historico = useMemo(() => {
    const grupos = new Map<string, Label[]>()
    for (const l of s.labels) {
      if (l.dia !== hoje) continue
      const arr = grupos.get(l.productId) ?? []
      arr.push(l)
      grupos.set(l.productId, arr)
    }
    return [...grupos.entries()].map(([pid, ls]) => ({ p: product(pid)!, labels: ls.sort((a, b) => b.seq - a.seq) }))
  }, [s.labels, hoje, product])

  const anularReimprimir = (l: Label) => {
    if (!window.confirm(`Anular ${l.serial} e imprimir uma nova etiqueta?`)) return
    setAnuladas((a) => new Set(a).add(l.serial))
    s.printLabels(l.productId, 1, l.tipo)
    setReqs([{ productId: l.productId, qtd: 1, tipo: l.tipo }])
  }

  const statusDe = (l: Label) => (anuladas.has(l.serial) ? 'anulada' : l.status)
  const bipadas = useMemo(() => new Set(s.scans.filter((x) => x.tipo === 'produzido').map((x) => x.serial)), [s.scans])

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
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Etiquetas</h1>
            <p className="text-sm text-muted mt-1">Gere seriais únicos por unidade ou caixa. Só o que tem etiqueta consegue ser bipado.</p>
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
                      <Th right>Projetado</Th>
                      <Th right>Impresso</Th>
                      <Th right>Sugerido</Th>
                      <Th right>Quantidade</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const p = product(l.productId)
                      const b = bloqueada(l)
                      const sug = sugerido(l)
                      return (
                        <tr key={l.productId} className={cx(b && 'opacity-70')}>
                          <Td>
                            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={!!sel[l.productId] && !b} disabled={b} onChange={(e) => setSel((x) => ({ ...x, [l.productId]: e.target.checked }))} aria-label={`Selecionar ${p?.sku}`} />
                          </Td>
                          <Td>
                            <div className="font-medium">
                              {p?.nome} <span className="uppercase text-accent-text">· {p?.atributos.cor}</span>
                            </div>
                            <div className="text-[12px] text-muted font-mono flex items-center gap-2">
                              {p?.sku}
                              {l.projetado === 0 && (
                                <Badge tone={paraAmanha ? 'info' : 'warn'}>
                                  <AlertTriangle size={12} /> {paraAmanha ? 'Impressão para amanhã' : 'Sem projeção do dia'}
                                </Badge>
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
                              aria-label="Quantidade"
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
              <Field label="Modo">
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1">
                  {(['unidade', 'caixa'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setModo(m)} className={cx('h-8 rounded-md text-sm capitalize transition-colors', modo === m ? 'bg-surface shadow-[var(--shadow-card)] font-medium' : 'text-muted hover:text-text')}>
                      {m}
                    </button>
                  ))}
                </div>
              </Field>
              {modo === 'caixa' && (
                <Field label="Unidades por caixa" hint="A quantidade acima passa a ser em caixas.">
                  <Input type="number" min={1} value={porCaixa} onChange={(e) => setPorCaixa(Math.max(1, Number(e.target.value) || 1))} />
                </Field>
              )}
              <Field label="Tamanho da etiqueta">
                <Select value={tam} onChange={(e) => setTam(e.target.value as Tamanho)}>
                  <option value="50x30">50 × 30 mm</option>
                  <option value="60x40">60 × 40 mm</option>
                  <option value="100x50">100 × 50 mm</option>
                </Select>
              </Field>
              <Toggle checked={montagem} onChange={setMontagem} label="Incluir etiqueta de montagem" />
              <div className="border-t border-border pt-4">
                <Toggle checked={paraAmanha} onChange={setParaAmanha} label="Permitir imprimir para amanhã" />
                <p className="text-[12px] text-faint mt-1.5">SKUs sem projeção do dia ficam bloqueados para hoje. Ative para adiantar etiquetas de amanhã.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {reqs && preview.length > 0 && (
        <Card
          className="mt-5 print-area print:border-0 print:shadow-none"
          title={<span className="no-print">Pré-visualização · {num(preview.reduce((a, g) => a + g.labels.length, 0))} etiqueta(s)</span>}
          actions={
            <div className="no-print flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReqs(null)}>
                <X size={14} /> Fechar
              </Button>
              <Button variant="primary" size="sm" onClick={() => window.print()}>
                <Printer size={14} /> Imprimir
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap gap-2 print:gap-0 bg-surface-2/40 print:bg-white p-3 print:p-0 rounded-lg">
            {preview.flatMap((g) =>
              g.labels.flatMap((l, i) => {
                const n = i + 1
                const total = g.labels.length
                const out = [<Etiqueta key={l.serial} label={l} p={g.p} n={n} total={total} tam={tam} />]
                if (montagem) out.push(<Etiqueta key={l.serial + '-m'} label={l} p={g.p} n={n} total={total} tam={tam} montagem />)
                return out
              }),
            )}
          </div>
        </Card>
      )}

      <Card className="mt-5 no-print" title="Histórico do dia" padded={false}>
        {historico.length === 0 ? (
          <EmptyState title="Nenhuma etiqueta impressa hoje" />
        ) : (
          <div className="divide-y divide-border">
            {historico.map((g) => (
              <details key={g.p.id} className="group">
                <summary className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer hover:bg-surface-2/60 list-none">
                  <div className="min-w-0">
                    <span className="font-medium">{g.p.nome}</span> <span className="uppercase text-accent-text">· {g.p.atributos.cor}</span>
                    <span className="ml-2 text-[12px] text-muted font-mono">{g.p.sku}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[12px] text-muted tabular-nums">
                    <span>{num(g.labels.length)} seriais</span>
                    {g.labels.some((l) => anuladas.has(l.serial)) && <Badge tone="danger">{g.labels.filter((l) => anuladas.has(l.serial)).length} anulada(s)</Badge>}
                  </div>
                </summary>
                <div className="px-5 pb-3">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Serial</Th>
                        <Th>Tipo</Th>
                        <Th>Status</Th>
                        <Th right>Ação</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.labels.slice(0, 40).map((l) => {
                        const st = statusDe(l)
                        const bipada = bipadas.has(l.serial)
                        return (
                          <tr key={l.serial} className={cx(st === 'anulada' && 'opacity-60')}>
                            <Td mono className={cx(st === 'anulada' && 'line-through')}>{l.serial}</Td>
                            <Td className="capitalize">{l.tipo}{l.tipo === 'caixa' && ` (${l.quantidade})`}</Td>
                            <Td>
                              {st === 'anulada' ? <Badge tone="danger"><Ban size={12} /> Anulada</Badge> : bipada ? <Badge tone="ok">Bipada</Badge> : <Badge tone="info">Impressa</Badge>}
                            </Td>
                            <Td right>
                              <Button size="sm" variant="ghost" disabled={st === 'anulada' || bipada} onClick={() => anularReimprimir(l)}>
                                <RotateCcw size={14} /> Anular e reimprimir
                              </Button>
                            </Td>
                          </tr>
                        )
                      })}
                      {g.labels.length > 40 && (
                        <tr>
                          <td colSpan={4} className="px-5 py-3 text-muted text-[12px]">
                            … e mais {num(g.labels.length - 40)} seriais
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </Table>
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
