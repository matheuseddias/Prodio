import { AlertTriangle, ArrowUpToLine, Calculator, Plus, Printer, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { locations } from '../../domain/mock'
import { num, pct } from '../../domain/format'
import { explodeBom, useLookups, useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, Field, Modal, Progress, Select, Table, Td, Th, cx } from '../../ui'

function QtyInput({ value, onCommit, highlight }: { value: number; onCommit: (v: number) => void; highlight?: boolean }) {
  const [draft, setDraft] = useState(String(value))
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setDraft(String(value))
  }
  const commit = () => {
    const v = Math.max(0, Math.round(Number(draft) || 0))
    setDraft(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cx(
        'h-8 w-20 rounded-md border bg-surface px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent',
        highlight ? 'border-ok bg-ok-soft' : 'border-border',
      )}
      aria-label="Projetado"
    />
  )
}

export default function LinhaDeHoje() {
  const s = useStore()
  const { product, material } = useLookups()
  const nav = useNavigate()
  const [local, setLocal] = useState(locations[0]?.id ?? '')
  const [modal, setModal] = useState(false)
  const [rascunho, setRascunho] = useState<Record<string, number>>({})
  const [elevadas, setElevadas] = useState<Set<string>>(new Set())
  const [novoSku, setNovoSku] = useState('')

  const linhas = s.dailyPlan
  const totais = useMemo(
    () => ({
      projetado: linhas.reduce((a, l) => a + l.projetado, 0),
      impresso: linhas.reduce((a, l) => a + l.impresso, 0),
      bipado: linhas.reduce((a, l) => a + l.bipado, 0),
    }),
    [linhas],
  )
  const aderencia = totais.projetado > 0 ? totais.bipado / totais.projetado : 0

  const formula = (l: (typeof linhas)[number]) => {
    const emProducao = Math.max(0, l.impresso - l.bipado)
    return Math.max(0, Math.round(l.demandaDia * s.tenant.diasCobertura - l.saldoHub - emProducao))
  }

  const abrirModal = () => {
    setRascunho(Object.fromEntries(linhas.map((l) => [l.productId, l.projetado])))
    setModal(true)
  }
  const preencherPelaFormula = () => setRascunho(Object.fromEntries(linhas.map((l) => [l.productId, formula(l)])))
  const aplicarRascunho = () => {
    for (const l of linhas) {
      const v = rascunho[l.productId]
      if (v !== undefined && v !== l.projetado) s.setProjetado(l.productId, v)
    }
    setModal(false)
  }

  const elevarCarteira = () => {
    const subiram = new Set<string>()
    for (const l of linhas) {
      if (l.carteira > l.projetado) {
        s.setProjetado(l.productId, l.carteira)
        subiram.add(l.productId)
      }
    }
    setElevadas(subiram)
  }

  const foraDoPlano = s.products.filter((p) => p.status === 'ativo' && !linhas.some((l) => l.productId === p.id))
  const adicionarSku = () => {
    if (!novoSku) return
    s.setProjetado(novoSku, 0)
    setNovoSku('')
  }

  // Insumos consumidos hoje (explosão da ficha sobre o bipado)
  const consumoHoje = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const l of linhas) {
      if (l.bipado <= 0) continue
      const exp = explodeBom(l.productId, l.bipado, s.boms)
      for (const [mid, q] of Object.entries(exp)) acc[mid] = (acc[mid] ?? 0) + q
    }
    return Object.entries(acc)
      .map(([mid, q]) => ({ m: material(mid), q }))
      .filter((x) => x.m)
      .sort((a, b) => b.q * (b.m!.custoMedio) - a.q * (a.m!.custoMedio))
      .slice(0, 5)
  }, [linhas, s.boms, material])

  const semImpressao = linhas.filter((l) => l.projetado > 0 && l.impresso === 0).length

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Linha de hoje</h1>
          <p className="text-sm text-muted mt-1 capitalize">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={local} onChange={(e) => setLocal(e.target.value)} className="w-auto" aria-label="Local">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </Select>
          <Button onClick={abrirModal}>
            <Calculator size={16} /> Definir projeção de hoje
          </Button>
          <Button onClick={elevarCarteira}>
            <ArrowUpToLine size={16} /> Elevar à carteira
          </Button>
          <Button variant="primary" onClick={() => nav('/producao/etiquetas')}>
            <Printer size={16} /> Imprimir etiquetas
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Projetado', v: totais.projetado },
          { label: 'Impresso', v: totais.impresso },
          { label: 'Bipado', v: totais.bipado },
        ].map((t) => (
          <div key={t.label} className="bg-surface border border-border rounded-[var(--radius-card)] p-4">
            <div className="text-[13px] text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{num(t.v)}</div>
          </div>
        ))}
        <div className="bg-surface border border-border rounded-[var(--radius-card)] p-4">
          <div className="text-[13px] text-muted">Aderência</div>
          <div className={cx('mt-1 text-2xl font-semibold tabular-nums', aderencia >= 1 ? 'text-ok' : aderencia >= 0.6 ? 'text-accent-text' : 'text-warn')}>{pct(aderencia)}</div>
          <div className="mt-2">
            <Progress value={totais.bipado} max={totais.projetado} tone={aderencia >= 1 ? 'ok' : 'accent'} />
          </div>
        </div>
      </div>

      {semImpressao > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {semImpressao} SKU(s) com projeção e nenhuma etiqueta impressa. A linha só consegue bipar depois de imprimir.
          </span>
        </div>
      )}

      <Card padded={false}>
        {linhas.length === 0 ? (
          <EmptyState title="Nenhum SKU no plano de hoje" description="Adicione um SKU abaixo ou defina a projeção do dia." />
        ) : (
          <div className="px-5">
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th right>Demanda/dia</Th>
                  <Th right>Saldo hub</Th>
                  <Th right>Carteira</Th>
                  <Th right>Projetado</Th>
                  <Th right>Impresso</Th>
                  <Th right>Bipado</Th>
                  <Th right>Falta</Th>
                  <Th className="w-44">Progresso</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const p = product(l.productId)
                  const falta = Math.max(0, l.projetado - l.bipado)
                  const r = l.projetado > 0 ? l.bipado / l.projetado : 0
                  const semEtiqueta = l.impresso === 0
                  const alerta = l.projetado > 0 && semEtiqueta
                  const tone = l.projetado > 0 && r >= 1 ? 'ok' : semEtiqueta ? 'neutral' : 'warn'
                  return (
                    <tr key={l.productId} className={cx(alerta && 'bg-warn-soft/40', elevadas.has(l.productId) && 'bg-ok-soft/40')}>
                      <Td>
                        <div className="font-medium">
                          {p?.nome} <span className="uppercase text-accent-text">· {p?.atributos.cor}</span>
                        </div>
                        <div className="text-[12px] text-muted font-mono">
                          {p?.sku}
                          {p?.atributos.tamanho && <span className="font-sans"> · {p.atributos.tamanho}</span>}
                        </div>
                      </Td>
                      <Td right className="text-muted">{num(l.demandaDia)}</Td>
                      <Td right className="text-muted">{num(l.saldoHub)}</Td>
                      <Td right className={cx(l.carteira > l.projetado && 'text-warn font-medium')}>{num(l.carteira)}</Td>
                      <Td right>
                        <QtyInput value={l.projetado} onCommit={(v) => s.setProjetado(l.productId, v)} highlight={elevadas.has(l.productId)} />
                      </Td>
                      <Td right>{num(l.impresso)}</Td>
                      <Td right className="font-medium">{num(l.bipado)}</Td>
                      <Td right className={cx(falta === 0 && l.projetado > 0 ? 'text-ok' : falta > 0 ? 'text-text' : 'text-faint')}>{num(falta)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Progress value={l.bipado} max={l.projetado} tone={tone} />
                          <span className="text-[12px] text-muted tabular-nums w-10 text-right">{pct(r)}</span>
                        </div>
                      </Td>
                      <Td>
                        {l.projetado === 0 ? (
                          <Badge>Sem projeção</Badge>
                        ) : r >= 1 ? (
                          <Badge tone="ok">Concluído</Badge>
                        ) : semEtiqueta ? (
                          <Badge tone="warn">
                            <AlertTriangle size={12} /> Sem etiquetas
                          </Badge>
                        ) : (
                          <Badge tone="warn">Em andamento</Badge>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 px-5 py-4 border-t border-border">
          <Field label="Adicionar SKU ao plano" className="flex-1 max-w-md">
            <Select value={novoSku} onChange={(e) => setNovoSku(e.target.value)}>
              <option value="">Selecione um produto…</option>
              {foraDoPlano.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.nome} · {p.atributos.cor}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={adicionarSku} disabled={!novoSku}>
            <Plus size={16} /> Adicionar
          </Button>
        </div>
      </Card>

      <Card className="mt-5" title="Fechamento do dia">
        <p className="text-sm text-muted mb-4">
          Não existe "fechar o dia" manual: a baixa de insumos é automática a cada bipe, pela ficha técnica de cada SKU. Abaixo, os insumos mais consumidos hoje a partir do que já foi bipado ({num(totais.bipado)} un).
        </p>
        {consumoHoje.length === 0 ? (
          <EmptyState title="Nada bipado ainda" description="Os consumos aparecem aqui conforme a linha bipa." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {consumoHoje.map(({ m, q }) => (
              <div key={m!.id} className="rounded-lg border border-border bg-surface-2/50 p-3 min-w-0">
                <div className="text-[12px] text-muted font-mono">{m!.sku}</div>
                <div className="text-sm font-medium truncate" title={m!.nome}>
                  {m!.nome}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {num(q, q < 10 ? 2 : 0)} <span className="text-[12px] text-muted font-normal">{m!.unidadeConsumo}</span>
                </div>
                <div className={cx('text-[12px] tabular-nums', m!.saldo - q < m!.minimo ? 'text-danger' : 'text-muted')}>saldo {num(m!.saldo, 1)} · mín {num(m!.minimo)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => nav('/estoque')}>
            <Tag size={14} /> Ver estoque de insumos
          </Button>
        </div>
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Definir projeção de hoje"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={aplicarRascunho}>
              Aplicar projeção
            </Button>
          </>
        }
      >
        <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm mb-4">
          <div className="font-mono text-[13px]">projetado = max(0, demanda × diasCobertura − saldoHub − emProdução)</div>
          <div className="text-[12px] text-muted mt-1">
            diasCobertura = {s.tenant.diasCobertura} (configurações) · emProdução = impresso − bipado. Você pode ajustar cada linha antes de aplicar.
          </div>
        </div>
        <div className="flex justify-end mb-3">
          <Button size="sm" onClick={preencherPelaFormula}>
            <Calculator size={14} /> Pré-preencher todos pela fórmula
          </Button>
        </div>
        <div className="-mx-5">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th right>Demanda</Th>
                <Th right>Saldo hub</Th>
                <Th right>Em prod.</Th>
                <Th right>Fórmula</Th>
                <Th right>Projetado</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const p = product(l.productId)
                const f = formula(l)
                return (
                  <tr key={l.productId}>
                    <Td>
                      <div className="font-medium truncate max-w-[220px]">
                        {p?.nome} <span className="text-muted">· {p?.atributos.cor}</span>
                      </div>
                      <div className="text-[12px] text-muted font-mono">{p?.sku}</div>
                    </Td>
                    <Td right className="text-muted">{num(l.demandaDia)}</Td>
                    <Td right className="text-muted">{num(l.saldoHub)}</Td>
                    <Td right className="text-muted">{num(Math.max(0, l.impresso - l.bipado))}</Td>
                    <Td right className="text-muted">{num(f)}</Td>
                    <Td right>
                      <QtyInput value={rascunho[l.productId] ?? l.projetado} onCommit={(v) => setRascunho((r) => ({ ...r, [l.productId]: v }))} />
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  )
}
