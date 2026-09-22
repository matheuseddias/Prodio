import { Calculator, ChevronDown, ChevronRight, Settings2, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { brl, dataBR, num } from '../../domain/format'
import { explodeBom, useStore } from '../../domain/store'
import type { Material, Supplier } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Stat, Table, Td, Th, Toggle, cx, type Tone } from '../../ui'
import { hojeLocal, somaDias, toISODate } from './ocUtils'

type Modo = 'metrica' | 'saldo'

interface Params {
  periodoVendas: number
  margemPct: number
  diasCobertura: number
  diasUteis: number
}

interface LinhaNec {
  m: Material
  necessidade: number
  emTransito: number
  consumoDia: number
  cobertura: number | undefined
  folga: number | undefined
  comprarAte: Date | undefined
  comprar: number
  comprarCompra: number
  custo: number
  abc: 'A' | 'B' | 'C'
  valorNecessidade: number
}

const ABC_TONE: Record<'A' | 'B' | 'C', Tone> = { A: 'accent', B: 'info', C: 'neutral' }
const casasDe = (m: Material) => (m.unidadeConsumo === 'un' ? 0 : 2)

export default function Necessidade() {
  const { materials, suppliers, boms, dailyPlan, purchaseOrders, tenant, createPurchaseOrder, setTenant } = useStore()
  const navigate = useNavigate()
  const [modo, setModo] = useState<Modo>('metrica')
  const [params, setParams] = useState<Params>({ periodoVendas: 30, margemPct: Math.round(tenant.margemProjecao * 100), diasCobertura: tenant.diasCobertura, diasUteis: tenant.diasUteisMes })
  const [editParams, setEditParams] = useState(false)
  // Três dos quatro campos existem no Tenant e são os mesmos de Configurações › Produção. Antes
  // "Aplicar" só fechava a janela: a sugestão de compra mudava na tela e voltava ao antigo na visita
  // seguinte, sem aviso — e é desta tela que saem as OCs.
  const aplicarParams = () => {
    setTenant({ ...tenant, margemProjecao: params.margemPct / 100, diasCobertura: params.diasCobertura, diasUteisMes: params.diasUteis })
    setEditParams(false)
  }
  const [soComprar, setSoComprar] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [fechados, setFechados] = useState<Set<string>>(new Set())

  const linhas = useMemo<LinhaNec[]>(() => {
    const hoje = hojeLocal()
    // 1) necessidade por insumo: explode a ficha de cada produto pela demanda mensal
    const nec: Record<string, number> = {}
    for (const l of dailyPlan) {
      const demandaMensal = l.demandaDia * params.diasUteis
      if (demandaMensal <= 0) continue
      const exp = explodeBom(l.productId, demandaMensal, boms)
      for (const [mid, q] of Object.entries(exp)) nec[mid] = (nec[mid] ?? 0) + q
    }
    // 2) em trânsito: OCs abertas/parciais
    const transito: Record<string, number> = {}
    for (const po of purchaseOrders) {
      if (po.status !== 'aberta' && po.status !== 'parcial') continue
      for (const it of po.itens) transito[it.materialId] = (transito[it.materialId] ?? 0) + Math.max(0, it.qtd - it.qtdRecebida) * it.fator
    }
    const margem = params.margemPct / 100
    const base = materials.map((m) => {
      const necessidade = nec[m.id] ?? 0
      const emTransito = transito[m.id] ?? 0
      const consumoDia = necessidade / 30
      const cobertura = consumoDia > 0 ? m.saldo / consumoDia : undefined
      const folga = cobertura === undefined ? undefined : cobertura - m.leadTimeDias - params.diasCobertura
      const comprarAte = folga === undefined ? undefined : somaDias(hoje, Math.floor(folga))
      const comprar =
        modo === 'metrica'
          ? Math.max(0, necessidade * (1 + margem) - m.saldo - emTransito)
          : Math.max(0, consumoDia * (m.leadTimeDias + params.diasCobertura) * (1 + margem) - m.saldo - emTransito)
      const comprarCompra = comprar > 0 ? Math.ceil(comprar / m.fatorConversao - 1e-9) : 0
      const custo = comprarCompra * m.fatorConversao * m.custoMedio
      return { m, necessidade, emTransito, consumoDia, cobertura, folga, comprarAte, comprar, comprarCompra, custo, valorNecessidade: necessidade * m.custoMedio, abc: 'C' as const }
    })
    // 3) curva ABC pela participação no valor da necessidade
    const totalValor = base.reduce((s, l) => s + l.valorNecessidade, 0) || 1
    const ordenado = [...base].sort((a, b) => b.valorNecessidade - a.valorNecessidade)
    let acum = 0
    const abc: Record<string, 'A' | 'B' | 'C'> = {}
    for (const l of ordenado) {
      acum += l.valorNecessidade / totalValor
      abc[l.m.id] = l.valorNecessidade === 0 ? 'C' : acum <= 0.8 ? 'A' : acum <= 0.95 ? 'B' : 'C'
    }
    return base.map((l) => ({ ...l, abc: abc[l.m.id] }))
  }, [materials, boms, dailyPlan, purchaseOrders, params, modo])

  const grupos = useMemo(() => {
    const semFornecedor: Supplier = { id: '', nome: 'Sem fornecedor padrão', cnpj: '', regime: 'simples', leadTimeDias: 0, condicaoPagamento: [] }
    const map = new Map<string, { sup: Supplier; linhas: LinhaNec[] }>()
    for (const l of linhas) {
      if (l.necessidade <= 0 && l.comprar <= 0) continue
      if (soComprar && l.comprar <= 0) continue
      const sup = suppliers.find((s) => s.id === l.m.fornecedorPadraoId) ?? semFornecedor
      const g = map.get(sup.id) ?? { sup, linhas: [] }
      g.linhas.push(l)
      map.set(sup.id, g)
    }
    return [...map.values()]
      .map((g) => ({ ...g, linhas: g.linhas.sort((a, b) => (a.folga ?? Infinity) - (b.folga ?? Infinity)) }))
      .sort((a, b) => Math.min(...a.linhas.map((l) => l.folga ?? Infinity)) - Math.min(...b.linhas.map((l) => l.folga ?? Infinity)))
  }, [linhas, suppliers, soComprar])

  const selecionadas = linhas.filter((l) => sel.has(l.m.id) && l.comprar > 0 && l.m.fornecedorPadraoId)
  const totalSel = selecionadas.reduce((s, l) => s + l.custo, 0)
  const fornecedoresSel = new Set(selecionadas.map((l) => l.m.fornecedorPadraoId!))

  const stats = useMemo(() => {
    const aComprar = linhas.filter((l) => l.comprar > 0)
    const atrasados = aComprar.filter((l) => l.folga !== undefined && l.folga < 0).length
    return { itens: aComprar.length, atrasados, custo: aComprar.reduce((s, l) => s + l.custo, 0), fornecedores: new Set(aComprar.map((l) => l.m.fornecedorPadraoId).filter(Boolean)).size }
  }, [linhas])

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleGrupo = (ids: string[], marcar: boolean) =>
    setSel((s) => {
      const n = new Set(s)
      for (const id of ids) {
        if (marcar) n.add(id)
        else n.delete(id)
      }
      return n
    })
  const toggleFechado = (id: string) =>
    setFechados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const gerarOrdens = () => {
    const hoje = hojeLocal()
    for (const supId of fornecedoresSel) {
      const sup = suppliers.find((s) => s.id === supId)!
      const itens = selecionadas.filter((l) => l.m.fornecedorPadraoId === supId)
      const lead = Math.max(sup.leadTimeDias, ...itens.map((l) => l.m.leadTimeDias))
      createPurchaseOrder({
        supplierId: supId,
        status: 'aberta',
        entregaPrevista: toISODate(somaDias(hoje, lead)),
        condicaoPagamento: sup.condicaoPagamento,
        observacao: `Gerada pela necessidade de compra (${modo === 'metrica' ? 'métrica do mês' : 'por saldo'})`,
        itens: itens.map((l, i) => ({
          id: `${Date.now().toString(36)}${i}`,
          materialId: l.m.id,
          unidadeCompra: l.m.unidadeCompra,
          fator: l.m.fatorConversao,
          qtd: l.comprarCompra,
          qtdRecebida: 0,
          preco: Math.round(l.m.custoMedio * l.m.fatorConversao * 100) / 100,
          ipiPct: 0,
        })),
      })
    }
    setSel(new Set())
    navigate('/compras/ordens')
  }

  const badgePrazo = (l: LinhaNec) => {
    if (l.folga === undefined || !l.comprarAte) return <span className="text-faint">—</span>
    const dias = Math.floor(l.folga)
    if (dias < 0) return <Badge tone="danger">venceu há {num(-dias)} d</Badge>
    if (dias <= 3) return <Badge tone="warn">{dataBR(l.comprarAte.toISOString())}</Badge>
    return <span>{dataBR(l.comprarAte.toISOString())}</span>
  }

  return (
    <>
      <PageHeader
        title="Necessidade de compra"
        subtitle="O que comprar, quanto e até quando, para a produção não parar."
        actions={
          <Button onClick={() => setEditParams(true)}>
            <Settings2 size={16} /> Parâmetros
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-3">
            <span className={cx('text-sm font-medium', modo === 'metrica' ? 'text-text' : 'text-muted')}>Métrica do mês</span>
            <Toggle checked={modo === 'saldo'} onChange={(v) => setModo(v ? 'saldo' : 'metrica')} />
            <span className={cx('text-sm font-medium', modo === 'saldo' ? 'text-text' : 'text-muted')}>Por saldo</span>
          </div>
          <p className="text-sm text-muted md:ml-2">
            {modo === 'metrica'
              ? 'Demanda diária × dias úteis, explodida pela ficha técnica de cada produto, mais a margem de projeção.'
              : 'Compra só o que falta para cobrir lead time + dias de cobertura, olhando saldo e trânsito.'}
          </p>
          <div className="md:ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted tabular-nums">
            <span>vendas {params.periodoVendas} d</span>
            <span>margem {params.margemPct}%</span>
            <span>cobertura {params.diasCobertura} d</span>
            <span>{params.diasUteis} dias úteis</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Insumos a comprar" value={num(stats.itens)} hint={`${stats.fornecedores} fornecedores`} />
        <Stat label="Já deveriam ter sido comprados" value={num(stats.atrasados)} tone={stats.atrasados > 0 ? 'danger' : 'ok'} hint="prazo de compra vencido" />
        <Stat label="Custo estimado" value={brl(stats.custo)} hint="pelo custo médio" />
        <Stat label="Selecionado" value={brl(totalSel)} tone={selecionadas.length ? 'accent' : undefined} hint={`${selecionadas.length} itens`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px] items-start pb-24">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Toggle checked={soComprar} onChange={setSoComprar} label="Só insumos com compra sugerida" />
            <span className="text-[13px] text-muted ml-auto tabular-nums">{grupos.reduce((s, g) => s + g.linhas.length, 0)} insumos</span>
          </div>

          {grupos.length === 0 && (
            <Card>
              <EmptyState icon={<ShoppingCart size={28} />} title="Nada a comprar" description="Saldo e ordens em trânsito cobrem a necessidade do período." />
            </Card>
          )}

          {grupos.map((g) => {
            const ids = g.linhas.filter((l) => l.comprar > 0).map((l) => l.m.id)
            const todos = ids.length > 0 && ids.every((id) => sel.has(id))
            const alguns = ids.some((id) => sel.has(id))
            const fechado = fechados.has(g.sup.id)
            const custoGrupo = g.linhas.reduce((s, l) => s + l.custo, 0)
            const semSup = g.sup.id === ''
            return (
              <Card key={g.sup.id || 'sem'} padded={false}>
                <header className="flex items-center gap-3 px-5 py-3 border-b border-border">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={todos}
                    ref={(el) => { if (el) el.indeterminate = !todos && alguns }}
                    disabled={semSup || ids.length === 0}
                    onChange={(e) => toggleGrupo(ids, e.target.checked)}
                    aria-label={`Selecionar todos de ${g.sup.nome}`}
                  />
                  <button type="button" onClick={() => toggleFechado(g.sup.id)} className="flex items-center gap-2 min-w-0 text-left">
                    {fechado ? <ChevronRight size={16} className="text-faint" /> : <ChevronDown size={16} className="text-faint" />}
                    <span className="font-semibold truncate">{g.sup.nome}</span>
                  </button>
                  <span className="hidden sm:inline text-[12px] text-muted">{semSup ? 'defina o fornecedor no cadastro do insumo' : `lead time ${g.sup.leadTimeDias} d · ${g.sup.condicaoPagamento.join('/') || 'à vista'}`}</span>
                  <span className="ml-auto text-sm tabular-nums font-medium shrink-0">{brl(custoGrupo)}</span>
                </header>
                {!fechado && (
                  <div className="px-5 pb-1">
                    <Table>
                      <thead>
                        <tr>
                          <Th className="w-8"></Th>
                          <Th>Insumo</Th>
                          <Th right>Saldo</Th>
                          <Th right>Cons./dia</Th>
                          <Th right>Cobertura</Th>
                          <Th right>Trânsito</Th>
                          <Th right>Lead</Th>
                          <Th>Comprar até</Th>
                          <Th right>Comprar</Th>
                          <Th right>Un. compra</Th>
                          <Th right>Custo est.</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.linhas.map((l) => {
                          const casas = casasDe(l.m)
                          const marcado = sel.has(l.m.id)
                          return (
                            <tr key={l.m.id} className={cx(marcado && 'bg-accent-soft/30')}>
                              <Td>
                                <input type="checkbox" className="h-4 w-4 accent-accent" checked={marcado} disabled={semSup || l.comprar <= 0} onChange={() => toggle(l.m.id)} aria-label={`Selecionar ${l.m.nome}`} />
                              </Td>
                              <Td>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium leading-tight">{l.m.nome}</span>
                                  <Badge tone={ABC_TONE[l.abc]}>{l.abc}</Badge>
                                </div>
                                <div className="text-[12px] text-muted font-mono">{l.m.sku} · {l.m.unidadeConsumo}</div>
                              </Td>
                              <Td right className={cx(l.m.saldo < l.m.minimo && 'text-danger font-medium')}>{num(l.m.saldo, casas)}</Td>
                              <Td right className="text-muted">{l.consumoDia > 0 ? num(l.consumoDia, 2) : '—'}</Td>
                              <Td right className={cx(l.cobertura !== undefined && l.cobertura < l.m.leadTimeDias && 'text-danger font-medium')}>{l.cobertura === undefined ? '—' : `${num(l.cobertura, 1)} d`}</Td>
                              <Td right className="text-muted">{l.emTransito > 0 ? num(l.emTransito, casas) : '—'}</Td>
                              <Td right className="text-muted">{l.m.leadTimeDias} d</Td>
                              <Td className="whitespace-nowrap">{badgePrazo(l)}</Td>
                              <Td right className="font-medium">{l.comprar > 0 ? `${num(l.comprar, casas)} ${l.m.unidadeConsumo}` : <span className="text-faint">—</span>}</Td>
                              <Td right>{l.comprarCompra > 0 ? <span>{num(l.comprarCompra)} <span className="text-muted text-[12px]">{l.m.unidadeCompra}</span></span> : <span className="text-faint">—</span>}</Td>
                              <Td right>{l.custo > 0 ? brl(l.custo) : <span className="text-faint">—</span>}</Td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Card>
            )
          })}
        </div>

        <Card title="Como calculamos" className="lg:sticky lg:top-4">
          <dl className="space-y-3 text-[13px]">
            {[
              ['Necessidade', 'Σ ficha × demanda mensal (demanda/dia × dias úteis), com perdas'],
              ['Em trânsito', 'Σ (qtd − recebida) × fator das OCs abertas e parciais'],
              ['Consumo/dia', 'necessidade ÷ 30'],
              ['Cobertura', 'saldo ÷ consumo/dia'],
              ['Folga', 'cobertura − lead time − dias de cobertura'],
              ['Comprar até', 'hoje + folga'],
              modo === 'metrica'
                ? ['Comprar', 'máx(0, necessidade × (1 + margem) − saldo − trânsito)']
                : ['Comprar', 'máx(0, consumo/dia × (lead time + cobertura) × (1 + margem) − saldo − trânsito)'],
              ['Un. de compra', 'comprar ÷ fator de conversão, arredondado para cima'],
              ['Custo estimado', 'qtd em un. de compra × fator × custo médio'],
              ['Curva ABC', 'A = 80% do valor da necessidade, B = até 95%, C = restante'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium">{k}</dt>
                <dd className="text-muted font-mono text-[12px] leading-relaxed">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex items-center gap-2 text-[12px] text-faint"><Calculator size={14} /> Preços das OCs geradas usam o custo médio atual.</div>
        </Card>
      </div>

      {/* rodapé fixo */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] z-30 border-t border-border bg-surface/95 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-sm">
            <span className="text-muted">Selecionado:</span> <strong className="tabular-nums">{brl(totalSel)}</strong>
            <span className="text-muted tabular-nums"> · {selecionadas.length} {selecionadas.length === 1 ? 'insumo' : 'insumos'}</span>
          </div>
          <div className="sm:ml-auto flex gap-2">
            {sel.size > 0 && <Button variant="ghost" onClick={() => setSel(new Set())}>Limpar</Button>}
            <Button variant="primary" disabled={fornecedoresSel.size === 0} onClick={gerarOrdens}>
              <ShoppingCart size={16} />
              Gerar ordens de compra ({fornecedoresSel.size} {fornecedoresSel.size === 1 ? 'fornecedor' : 'fornecedores'})
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={editParams}
        onClose={() => setEditParams(false)}
        title="Parâmetros do cálculo"
        size="sm"
        footer={
          <Button variant="primary" onClick={aplicarParams}>
            Aplicar e salvar
          </Button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">
          Margem, cobertura e dias úteis são da empresa: ao aplicar, ficam salvos e valem também em Configurações › Produção e na Linha de hoje.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Período de vendas (dias)" hint="Só nesta sessão: não é gravado na empresa.">
            <Input inputMode="numeric" value={params.periodoVendas} onChange={(e) => setParams((p) => ({ ...p, periodoVendas: Number(e.target.value) || 0 }))} />
          </Field>
          <Field label="Margem (%)" hint="Folga sobre a necessidade">
            <Input inputMode="numeric" value={params.margemPct} onChange={(e) => setParams((p) => ({ ...p, margemPct: Number(e.target.value) || 0 }))} />
          </Field>
          <Field label="Dias de cobertura" hint="Segurança além do lead time">
            <Input inputMode="numeric" value={params.diasCobertura} onChange={(e) => setParams((p) => ({ ...p, diasCobertura: Number(e.target.value) || 0 }))} />
          </Field>
          <Field label="Dias úteis no mês">
            <Input inputMode="numeric" value={params.diasUteis} onChange={(e) => setParams((p) => ({ ...p, diasUteis: Number(e.target.value) || 0 }))} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
