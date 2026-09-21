import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Boxes, ClipboardList, Coins, History, RotateCcw, Scale, TrendingDown } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { brl, dataBR, dataHoraBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { Material, MoveType, StockMove } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Stat, Table, Tabs, Td, Th, Toggle, cx, type Tone } from '../../ui'

// ---------- helpers de domínio ----------

const MOVE_LABEL: Record<MoveType, string> = {
  entrada_nfe: 'Entrada NF-e',
  entrada_manual: 'Entrada manual',
  baixa_producao: 'Baixa produção',
  ajuste: 'Ajuste',
  perda: 'Perda',
  estorno: 'Estorno',
  saldo_inicial: 'Saldo inicial',
}
const MOVE_TONE: Record<MoveType, Tone> = {
  entrada_nfe: 'ok',
  entrada_manual: 'ok',
  baixa_producao: 'neutral',
  ajuste: 'info',
  perda: 'danger',
  estorno: 'warn',
  saldo_inicial: 'accent',
}
const MOTIVOS_PERDA = ['Quebra', 'Defeito de material', 'Erro de corte', 'Deterioração', 'Extravio', 'Outro']

type Estado = 'critico' | 'atencao' | 'ok'
const estadoDe = (m: Material): Estado => (m.saldo < m.minimo ? 'critico' : m.saldo < m.minimo * 1.3 ? 'atencao' : 'ok')
const ESTADO_BADGE: Record<Estado, { tone: Tone; label: string }> = {
  critico: { tone: 'danger', label: 'Crítico' },
  atencao: { tone: 'warn', label: 'Atenção' },
  ok: { tone: 'ok', label: 'OK' },
}

const MS_DIA = 86_400_000
const mesmoDia = (iso: string, ref = new Date()) => {
  const d = new Date(iso)
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}

/** Consumo médio diário (unidade de consumo) a partir das baixas de produção dos últimos 7 dias. */
function consumoDiario(materialId: string, moves: StockMove[]) {
  const limite = Date.now() - 7 * MS_DIA
  const total = moves
    .filter((m) => m.materialId === materialId && m.tipo === 'baixa_producao' && new Date(m.em).getTime() >= limite)
    .reduce((s, m) => s + Math.abs(m.delta), 0)
  return total > 0 ? total / 7 : undefined
}

const sinal = (v: number, casas = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${num(Math.abs(v), casas)}`
const casasDe = (m: Material) => (m.unidadeConsumo === 'un' ? 0 : 2)

function MoveBadge({ tipo }: { tipo: MoveType }) {
  return <Badge tone={MOVE_TONE[tipo]}>{MOVE_LABEL[tipo]}</Badge>
}

// ---------- tabela de saldos ----------

type SortKey = 'nome' | 'saldo' | 'minimo' | 'cobertura' | 'custoMedio' | 'valor' | 'estado'
interface Linha {
  m: Material
  cobertura?: number
  consumo?: number
  valor: number
  estado: Estado
}

function SortTh({ children, k, sort, onSort, right }: { children: ReactNode; k: SortKey; sort: { k: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; right?: boolean }) {
  const ativo = sort.k === k
  return (
    <Th right={right}>
      <button type="button" onClick={() => onSort(k)} className={cx('inline-flex items-center gap-1 uppercase hover:text-text', ativo && 'text-text')}>
        {children}
        {ativo ? sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} className="text-faint" />}
      </button>
    </Th>
  )
}

// ---------- página ----------

type Aba = 'saldos' | 'movimentos' | 'inventario'

interface Sessao {
  id: string
  em: string
  local: string
  contados: number
  divergenciaPct: number
  por: string
}

const diasAtrasISO = (n: number, h = 8) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, 0, 0, 0)
  return d.toISOString()
}

const SESSOES_INICIAIS: Sessao[] = [
  { id: 'ic1', em: diasAtrasISO(2, 7), local: 'Galpão Vila Galvão · Prateleira A', contados: 4, divergenciaPct: 1.8, por: 'Encarregada' },
  { id: 'ic2', em: diasAtrasISO(9, 7), local: 'Galpão Vila Galvão · Tecidos', contados: 5, divergenciaPct: 4.2, por: 'Lucas' },
  { id: 'ic3', em: diasAtrasISO(16, 7), local: 'Galpão Pedro de Souza', contados: 6, divergenciaPct: 0.6, por: 'Thiago' },
  { id: 'ic4', em: diasAtrasISO(23, 7), local: 'Galpão Vila Galvão · Embalagens', contados: 2, divergenciaPct: 0, por: 'Encarregada' },
]

export default function Estoque() {
  const { materials, stockMoves, addStockMove } = useStore()
  const [aba, setAba] = useState<Aba>('saldos')
  const [busca, setBusca] = useState('')
  const [soAbaixo, setSoAbaixo] = useState(false)
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'estado', dir: 1 })
  const [aberto, setAberto] = useState<string | null>(null)

  const linhas = useMemo<Linha[]>(
    () =>
      materials.map((m) => {
        const consumo = consumoDiario(m.id, stockMoves)
        return { m, consumo, cobertura: consumo ? m.saldo / consumo : undefined, valor: m.saldo * m.custoMedio, estado: estadoDe(m) }
      }),
    [materials, stockMoves],
  )

  const stats = useMemo(() => {
    const abaixo = linhas.filter((l) => l.estado === 'critico').length
    const valor = linhas.reduce((s, l) => s + l.valor, 0)
    const hoje = stockMoves.filter((mv) => mesmoDia(mv.em)).length
    return { total: materials.length, abaixo, valor, hoje }
  }, [linhas, materials.length, stockMoves])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const ordem: Record<Estado, number> = { critico: 0, atencao: 1, ok: 2 }
    const fil = linhas.filter((l) => {
      if (soAbaixo && l.estado !== 'critico') return false
      if (!q) return true
      return l.m.nome.toLowerCase().includes(q) || l.m.sku.toLowerCase().includes(q)
    })
    const val = (l: Linha): number | string => {
      switch (sort.k) {
        case 'nome': return l.m.nome
        case 'saldo': return l.m.saldo
        case 'minimo': return l.m.minimo
        case 'cobertura': return l.cobertura ?? Number.POSITIVE_INFINITY
        case 'custoMedio': return l.m.custoMedio
        case 'valor': return l.valor
        case 'estado': return ordem[l.estado]
      }
    }
    return fil.sort((a, b) => {
      const va = val(a), vb = val(b)
      const c = typeof va === 'string' ? va.localeCompare(String(vb), 'pt-BR') : va - (vb as number)
      return c * sort.dir || a.m.nome.localeCompare(b.m.nome, 'pt-BR')
    })
  }, [linhas, busca, soAbaixo, sort])

  const onSort = (k: SortKey) => setSort((s) => (s.k === k ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: k === 'nome' || k === 'estado' ? 1 : -1 }))

  const materialAberto = aberto ? materials.find((m) => m.id === aberto) : undefined

  return (
    <>
      <PageHeader title="Estoque de insumos" subtitle="Saldos em unidade de consumo, cobertura e movimentações de cada insumo." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Insumos cadastrados" value={num(stats.total)} icon={<Boxes size={16} />} />
        <Stat label="Abaixo do mínimo" value={num(stats.abaixo)} tone={stats.abaixo > 0 ? 'danger' : 'ok'} icon={<AlertTriangle size={16} />} hint={stats.abaixo > 0 ? 'precisam de reposição' : 'tudo coberto'} />
        <Stat label="Valor em estoque" value={brl(stats.valor)} hint="Σ saldo × custo médio" icon={<Coins size={16} />} />
        <Stat label="Movimentos hoje" value={num(stats.hoje)} icon={<History size={16} />} />
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'saldos', label: 'Saldos', count: materials.length },
          { id: 'movimentos', label: 'Movimentações', count: stockMoves.length },
          { id: 'inventario', label: 'Inventário cíclico' },
        ]}
      />

      {aba === 'saldos' && (
        <Card padded>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome ou SKU…" className="sm:w-80" />
            <Toggle checked={soAbaixo} onChange={setSoAbaixo} label="Só abaixo do mínimo" />
            <span className="text-[13px] text-muted sm:ml-auto tabular-nums">{visiveis.length} de {materials.length} insumos</span>
          </div>
          {visiveis.length === 0 ? (
            <EmptyState title="Nenhum insumo encontrado" description={soAbaixo ? 'Nenhum insumo está abaixo do mínimo com esse filtro.' : 'Ajuste a busca para encontrar o insumo.'} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <SortTh k="nome" sort={sort} onSort={onSort}>Insumo</SortTh>
                  <Th>Un.</Th>
                  <SortTh k="saldo" sort={sort} onSort={onSort} right>Saldo</SortTh>
                  <SortTh k="minimo" sort={sort} onSort={onSort} right>Mínimo</SortTh>
                  <SortTh k="cobertura" sort={sort} onSort={onSort} right>Cobertura</SortTh>
                  <SortTh k="custoMedio" sort={sort} onSort={onSort} right>Custo médio</SortTh>
                  <SortTh k="valor" sort={sort} onSort={onSort} right>Valor</SortTh>
                  <SortTh k="estado" sort={sort} onSort={onSort}>Estado</SortTh>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const e = ESTADO_BADGE[l.estado]
                  return (
                    <tr key={l.m.id} onClick={() => setAberto(l.m.id)} className="cursor-pointer hover:bg-surface-2/60 transition-colors">
                      <Td>
                        <div className="font-medium leading-tight">{l.m.nome}</div>
                        <div className="text-[12px] text-muted font-mono">{l.m.sku}</div>
                      </Td>
                      <Td className="text-muted">{l.m.unidadeConsumo}</Td>
                      <Td right className={cx('font-medium', l.estado === 'critico' && 'text-danger')}>{num(l.m.saldo, casasDe(l.m))}</Td>
                      <Td right className="text-muted">{num(l.m.minimo, casasDe(l.m))}</Td>
                      <Td right>
                        {l.cobertura === undefined ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={cx(l.cobertura < l.m.leadTimeDias && 'text-danger font-medium')}>{num(l.cobertura, 1)} d</span>
                        )}
                      </Td>
                      <Td right className="text-muted">{brl(l.m.custoMedio)}</Td>
                      <Td right>{brl(l.valor)}</Td>
                      <Td><Badge tone={e.tone}>{e.label}</Badge></Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {aba === 'movimentos' && <Movimentacoes moves={stockMoves} onAbrir={setAberto} />}

      {aba === 'inventario' && <Inventario />}

      {materialAberto && (
        <Extrato
          material={materialAberto}
          moves={stockMoves.filter((mv) => mv.materialId === materialAberto.id)}
          consumo={consumoDiario(materialAberto.id, stockMoves)}
          onClose={() => setAberto(null)}
          addStockMove={addStockMove}
        />
      )}
    </>
  )
}

// ---------- extrato ----------

function Extrato({ material: m, moves, consumo, onClose, addStockMove }: { material: Material; moves: StockMove[]; consumo?: number; onClose: () => void; addStockMove: (mv: Omit<StockMove, 'id' | 'em'>) => void }) {
  const [modal, setModal] = useState<'ajuste' | 'perda' | null>(null)
  const [contagem, setContagem] = useState(String(m.saldo))
  const [motivoAjuste, setMotivoAjuste] = useState('Contagem física')
  const [qtdPerda, setQtdPerda] = useState('')
  const [motivoPerda, setMotivoPerda] = useState(MOTIVOS_PERDA[0])
  const casas = casasDe(m)
  const e = ESTADO_BADGE[estadoDe(m)]

  // mais recentes primeiro; saldo corrente calculado de trás para frente a partir do saldo atual
  const extrato = useMemo(() => {
    const ordenado = [...moves].sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime())
    // saldo após cada movimento = saldo atual − Σ deltas dos movimentos mais recentes que ele
    const acumulado = ordenado.reduce<number[]>((acc, mv, i) => {
      acc.push((i === 0 ? 0 : acc[i - 1]) + mv.delta)
      return acc
    }, [])
    return ordenado.map((mv, i) => ({ mv, saldo: Math.round((m.saldo - (i === 0 ? 0 : acumulado[i - 1])) * 1000) / 1000 }))
  }, [moves, m.saldo])

  // mini gráfico: saldo ao fim de cada um dos últimos 14 dias
  const serie = useMemo(() => {
    const dias: number[] = []
    for (let i = 13; i >= 0; i--) {
      const fim = new Date()
      fim.setHours(23, 59, 59, 999)
      fim.setDate(fim.getDate() - i)
      const posteriores = moves.filter((mv) => new Date(mv.em).getTime() > fim.getTime()).reduce((s, mv) => s + mv.delta, 0)
      dias.push(m.saldo - posteriores)
    }
    return dias
  }, [moves, m.saldo])

  const salvarAjuste = () => {
    const nova = Number(contagem.replace(',', '.'))
    if (!Number.isFinite(nova)) return
    const delta = Math.round((nova - m.saldo) * 1000) / 1000
    if (delta !== 0) addStockMove({ materialId: m.id, tipo: 'ajuste', delta, motivo: motivoAjuste || 'Ajuste de saldo', por: 'Matheus Moreno' })
    setModal(null)
  }
  const salvarPerda = () => {
    const q = Number(qtdPerda.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) return
    addStockMove({ materialId: m.id, tipo: 'perda', delta: -q, motivo: motivoPerda, custoUnit: m.custoMedio, por: 'Matheus Moreno' })
    setQtdPerda('')
    setModal(null)
  }
  const estornar = (mv: StockMove) => {
    addStockMove({ materialId: m.id, tipo: 'estorno', delta: -mv.delta, custoUnit: mv.custoUnit, ref: `Estorno ${mv.ref ?? MOVE_LABEL[mv.tipo]} (${dataBR(mv.em)})`, motivo: mv.motivo, por: 'Matheus Moreno' })
  }
  const jaEstornado = (mv: StockMove) => moves.some((x) => x.tipo === 'estorno' && x.ref?.includes(`(${dataBR(mv.em)})`) && x.delta === -mv.delta && new Date(x.em) > new Date(mv.em))

  return (
    <Modal open onClose={onClose} title={`Extrato · ${m.nome}`} size="xl" footer={<Button onClick={onClose}>Fechar</Button>}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Saldo atual</div>
          <div className="text-lg font-semibold tabular-nums">{num(m.saldo, casas)} <span className="text-[12px] text-muted font-normal">{m.unidadeConsumo}</span></div>
          <Badge tone={e.tone} className="mt-1">{e.label}</Badge>
        </div>
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Mínimo</div>
          <div className="text-lg font-semibold tabular-nums">{num(m.minimo, casas)}</div>
          <div className="text-[12px] text-muted">lead time {m.leadTimeDias} d</div>
        </div>
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Consumo/dia (7 d)</div>
          <div className="text-lg font-semibold tabular-nums">{consumo ? num(consumo, 2) : '—'}</div>
          <div className="text-[12px] text-muted">{consumo ? `cobre ${num(m.saldo / consumo, 1)} dias` : 'sem baixas recentes'}</div>
        </div>
        <div className="rounded-lg border border-border p-3 min-w-0">
          <div className="text-[12px] text-muted">Saldo · 14 dias</div>
          <Sparkline valores={serie} minimo={m.minimo} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button size="sm" variant="primary" onClick={() => { setContagem(String(m.saldo)); setModal('ajuste') }}><Scale size={14} /> Ajustar saldo</Button>
        <Button size="sm" variant="danger" onClick={() => setModal('perda')}><TrendingDown size={14} /> Registrar perda</Button>
        <span className="text-[12px] text-muted sm:ml-auto tabular-nums">{extrato.length} movimentos · custo médio {brl(m.custoMedio)}</span>
      </div>

      {extrato.length === 0 ? (
        <EmptyState title="Sem movimentos" description="Este insumo ainda não teve entradas, baixas ou ajustes." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data/hora</Th>
              <Th>Tipo</Th>
              <Th right>Delta</Th>
              <Th right>Saldo</Th>
              <Th right>Custo unit.</Th>
              <Th>Referência</Th>
              <Th>Quem</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {extrato.map(({ mv, saldo }) => (
              <tr key={mv.id}>
                <Td className="whitespace-nowrap text-muted">{dataHoraBR(mv.em)}</Td>
                <Td><MoveBadge tipo={mv.tipo} /></Td>
                <Td right className={cx('font-medium', mv.delta > 0 ? 'text-ok' : mv.delta < 0 ? 'text-danger' : '')}>{sinal(mv.delta, casas)}</Td>
                <Td right>{num(saldo, casas)}</Td>
                <Td right className="text-muted">{mv.custoUnit !== undefined ? brl(mv.custoUnit) : '—'}</Td>
                <Td className="text-muted max-w-[220px] truncate">{mv.ref ?? mv.motivo ?? '—'}</Td>
                <Td className="text-muted">{mv.por}</Td>
                <Td right>
                  {mv.tipo !== 'estorno' && (
                    <Button size="sm" variant="ghost" disabled={jaEstornado(mv)} onClick={() => estornar(mv)} title="Gera movimento contrário"><RotateCcw size={13} /> Estornar</Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal
        open={modal === 'ajuste'}
        onClose={() => setModal(null)}
        title="Ajustar saldo"
        size="sm"
        footer={<><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="primary" onClick={salvarAjuste}>Gerar ajuste</Button></>}
      >
        <div className="space-y-4">
          <div className="text-sm text-muted">Saldo no sistema: <strong className="text-text tabular-nums">{num(m.saldo, casas)} {m.unidadeConsumo}</strong></div>
          <Field label={`Nova contagem (${m.unidadeConsumo})`}>
            <Input inputMode="decimal" value={contagem} onChange={(e) => setContagem(e.target.value)} autoFocus />
          </Field>
          <Field label="Motivo">
            <Input value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} placeholder="Ex.: contagem física" />
          </Field>
          {(() => {
            const nova = Number(contagem.replace(',', '.'))
            if (!Number.isFinite(nova)) return null
            const d = nova - m.saldo
            return (
              <div className={cx('rounded-lg px-3 py-2 text-sm', d === 0 ? 'bg-surface-2 text-muted' : d > 0 ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
                Ajuste de <strong className="tabular-nums">{sinal(d, casas)} {m.unidadeConsumo}</strong>{d !== 0 && ` (${brl(Math.abs(d) * m.custoMedio)})`}
              </div>
            )
          })()}
        </div>
      </Modal>

      <Modal
        open={modal === 'perda'}
        onClose={() => setModal(null)}
        title="Registrar perda"
        size="sm"
        footer={<><Button onClick={() => setModal(null)}>Cancelar</Button><Button variant="danger" onClick={salvarPerda}>Registrar perda</Button></>}
      >
        <div className="space-y-4">
          <Field label={`Quantidade perdida (${m.unidadeConsumo})`}>
            <Input inputMode="decimal" value={qtdPerda} onChange={(e) => setQtdPerda(e.target.value)} placeholder="0" autoFocus />
          </Field>
          <Field label="Motivo">
            <Select value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)}>
              {MOTIVOS_PERDA.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
          <div className="text-[12px] text-muted">A perda sai do saldo pelo custo médio atual ({brl(m.custoMedio)}/{m.unidadeConsumo}).</div>
        </div>
      </Modal>
    </Modal>
  )
}

function Sparkline({ valores, minimo }: { valores: number[]; minimo: number }) {
  const W = 140, H = 44, P = 3
  const max = Math.max(...valores, minimo) || 1
  const min = Math.min(...valores, minimo, 0)
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P)
  const x = (i: number) => P + (i / (valores.length - 1)) * (W - 2 * P)
  const d = valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ultimo = valores[valores.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11 mt-1" role="img" aria-label="Evolução do saldo nos últimos 14 dias">
      <line x1={P} x2={W - P} y1={y(minimo)} y2={y(minimo)} className="stroke-danger/60" strokeDasharray="3 3" strokeWidth={1} />
      <path d={d} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(valores.length - 1)} cy={y(ultimo)} r={2.5} className={ultimo < minimo ? 'fill-danger' : 'fill-accent'} />
    </svg>
  )
}

// ---------- movimentações ----------

type Periodo = 'hoje' | '7' | '30' | 'todos'

function Movimentacoes({ moves, onAbrir }: { moves: StockMove[]; onAbrir: (materialId: string) => void }) {
  const { material } = useLookups()
  const [tipo, setTipo] = useState<MoveType | 'todos'>('todos')
  const [periodo, setPeriodo] = useState<Periodo>('30')
  const [busca, setBusca] = useState('')

  const lista = useMemo(() => {
    const agora = new Date().getTime()
    const limite = periodo === 'hoje' ? null : periodo === 'todos' ? 0 : agora - Number(periodo) * MS_DIA
    const q = busca.trim().toLowerCase()
    return [...moves]
      .filter((mv) => tipo === 'todos' || mv.tipo === tipo)
      .filter((mv) => (limite === null ? mesmoDia(mv.em) : new Date(mv.em).getTime() >= limite))
      .filter((mv) => {
        if (!q) return true
        const m = material(mv.materialId)
        return m?.nome.toLowerCase().includes(q) || m?.sku.toLowerCase().includes(q) || mv.ref?.toLowerCase().includes(q) || mv.por.toLowerCase().includes(q)
      })
      .sort((a, b) => new Date(b.em).getTime() - new Date(a.em).getTime())
  }, [moves, tipo, periodo, busca, material])

  const resumo = useMemo(() => {
    let entradas = 0, saidas = 0
    for (const mv of lista) {
      const m = material(mv.materialId)
      const v = mv.delta * (mv.custoUnit ?? m?.custoMedio ?? 0)
      if (v > 0) entradas += v
      else saidas += -v
    }
    return { entradas, saidas }
  }, [lista, material])

  return (
    <Card>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <SearchInput value={busca} onChange={setBusca} placeholder="Insumo, referência ou quem…" className="lg:w-72" />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as MoveType | 'todos')} className="sm:w-44">
            <option value="todos">Todos os tipos</option>
            {(Object.keys(MOVE_LABEL) as MoveType[]).map((t) => <option key={t} value={t}>{MOVE_LABEL[t]}</option>)}
          </Select>
          <Select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} className="sm:w-40">
            <option value="hoje">Hoje</option>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="todos">Todo o período</option>
          </Select>
        </div>
        <div className="lg:ml-auto text-[13px] text-muted tabular-nums">
          <span className="text-ok">+{brl(resumo.entradas)}</span> · <span className="text-danger">−{brl(resumo.saidas)}</span> · {lista.length} mov.
        </div>
      </div>
      {lista.length === 0 ? (
        <EmptyState title="Nenhuma movimentação" description="Nenhum movimento corresponde aos filtros escolhidos." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data/hora</Th>
              <Th>Insumo</Th>
              <Th>Tipo</Th>
              <Th right>Delta</Th>
              <Th right>Custo unit.</Th>
              <Th>Referência / motivo</Th>
              <Th>Quem</Th>
            </tr>
          </thead>
          <tbody>
            {lista.map((mv) => {
              const m = material(mv.materialId)
              const casas = m ? casasDe(m) : 2
              return (
                <tr key={mv.id} onClick={() => onAbrir(mv.materialId)} className="cursor-pointer hover:bg-surface-2/60 transition-colors">
                  <Td className="whitespace-nowrap text-muted">{dataHoraBR(mv.em)}</Td>
                  <Td>
                    <div className="font-medium leading-tight">{m?.nome ?? mv.materialId}</div>
                    <div className="text-[12px] text-muted font-mono">{m?.sku}</div>
                  </Td>
                  <Td><MoveBadge tipo={mv.tipo} /></Td>
                  <Td right className={cx('font-medium', mv.delta > 0 ? 'text-ok' : 'text-danger')}>{sinal(mv.delta, casas)} <span className="text-[12px] text-muted font-normal">{m?.unidadeConsumo}</span></Td>
                  <Td right className="text-muted">{mv.custoUnit !== undefined ? brl(mv.custoUnit) : '—'}</Td>
                  <Td className="text-muted">{mv.ref ?? mv.motivo ?? '—'}</Td>
                  <Td className="text-muted">{mv.por}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------- inventário cíclico ----------

function Inventario() {
  const { materials } = useStore()
  const [sessoes, setSessoes] = useState<Sessao[]>(SESSOES_INICIAIS)
  const [novo, setNovo] = useState(false)
  const [local, setLocal] = useState('Galpão Vila Galvão · Prateleira A')
  const [contados, setContados] = useState('5')

  const criar = () => {
    const n = Math.max(1, Math.min(materials.length, Number(contados) || 1))
    setSessoes((s) => [{ id: `ic${Date.now()}`, em: new Date().toISOString(), local, contados: n, divergenciaPct: 0, por: 'Matheus Moreno' }, ...s])
    setNovo(false)
  }
  const proximos = materials.slice().sort((a, b) => b.saldo * b.custoMedio - a.saldo * a.custoMedio).slice(0, 4)

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
      <Card title="Sessões de contagem" actions={<Button size="sm" variant="primary" onClick={() => setNovo(true)}><ClipboardList size={14} /> Nova sessão</Button>}>
        {sessoes.length === 0 ? (
          <EmptyState title="Nenhuma contagem registrada" description="Abra uma sessão para contar uma prateleira ou família de insumos." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Local</Th>
                <Th right>Insumos contados</Th>
                <Th right>Divergência</Th>
                <Th>Quem</Th>
              </tr>
            </thead>
            <tbody>
              {sessoes.map((s) => (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap">{dataBR(s.em)}</Td>
                  <Td>{s.local}</Td>
                  <Td right>{num(s.contados)}</Td>
                  <Td right>
                    <Badge tone={s.divergenciaPct === 0 ? 'ok' : s.divergenciaPct < 3 ? 'warn' : 'danger'}>{num(s.divergenciaPct, 1)}%</Badge>
                  </Td>
                  <Td className="text-muted">{s.por}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="space-y-4">
        <Card title="Como funciona">
          <p className="text-sm text-muted leading-relaxed">
            Em vez de parar a fábrica para um inventário geral, conte poucos insumos por vez, em rodízio. Cada sessão compara a contagem física com o saldo do sistema e gera ajustes automáticos; a divergência acumulada mostra onde o processo está vazando.
          </p>
          <p className="text-sm text-muted leading-relaxed mt-2">A contagem é feita pelo celular no chão de fábrica, bipando a etiqueta da prateleira.</p>
        </Card>
        <Card title="Sugestão para a próxima">
          <ul className="space-y-2">
            {proximos.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{m.nome}</span>
                <span className="text-muted tabular-nums shrink-0">{brl(m.saldo * m.custoMedio)}</span>
              </li>
            ))}
          </ul>
          <div className="text-[12px] text-faint mt-3">Maior valor imobilizado primeiro (classe A).</div>
        </Card>
      </div>

      <Modal open={novo} onClose={() => setNovo(false)} title="Nova sessão de contagem" size="sm" footer={<><Button onClick={() => setNovo(false)}>Cancelar</Button><Button variant="primary" onClick={criar}>Abrir sessão</Button></>}>
        <div className="space-y-4">
          <Field label="Local">
            <Select value={local} onChange={(e) => setLocal(e.target.value)}>
              <option>Galpão Vila Galvão · Prateleira A</option>
              <option>Galpão Vila Galvão · Tecidos</option>
              <option>Galpão Vila Galvão · Embalagens</option>
              <option>Galpão Pedro de Souza</option>
            </Select>
          </Field>
          <Field label="Quantos insumos contar" hint="Sugerimos entre 3 e 6 por sessão.">
            <Input inputMode="numeric" value={contados} onChange={(e) => setContados(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
