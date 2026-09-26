// Um fornecedor da Necessidade de compra: os insumos dele, do que vence antes para o que vence depois.
import { ChevronDown, ChevronRight } from 'lucide-react'
import { brl, dataBR, num } from '../../domain/format'
import { Badge, Card, Table, Td, Th, cx, type Tone } from '../../ui'
import type { GrupoFornecedor, LinhaCompra } from './necessidadeLogica'

const ABC_TONE: Record<'A' | 'B' | 'C', Tone> = { A: 'accent', B: 'info', C: 'neutral' }
const casasDe = (un: string) => (un === 'un' ? 0 : 2)

function badgePrazo({ l }: LinhaCompra) {
  if (!Number.isFinite(l.folgaDias) || !l.comprarAte) return <span className="text-faint">—</span>
  const dias = Math.floor(l.folgaDias)
  if (dias < 0) return <Badge tone="danger">venceu há {num(-dias)} d</Badge>
  if (dias <= 3) return <Badge tone="warn">{dataBR(l.comprarAte)}</Badge>
  return <span>{dataBR(l.comprarAte)}</span>
}

export default function NecessidadeGrupo({
  g,
  sel,
  fechado,
  onToggle,
  onToggleGrupo,
  onToggleFechado,
}: {
  g: GrupoFornecedor
  sel: Set<string>
  fechado: boolean
  onToggle: (id: string) => void
  onToggleGrupo: (ids: string[], marcar: boolean) => void
  onToggleFechado: () => void
}) {
  const ids = g.linhas.filter((x) => x.l.qtdCompra > 0).map((x) => x.m.id)
  const todos = ids.length > 0 && ids.every((id) => sel.has(id))
  const alguns = ids.some((id) => sel.has(id))
  const custoGrupo = g.linhas.reduce((s, x) => s + x.custo, 0)
  const semSup = g.sup.id === ''
  return (
    <Card padded={false}>
      <header className="flex items-center gap-3 px-5 py-3 border-b border-border">
        <input
          type="checkbox"
          className="h-4 w-4 accent-accent"
          checked={todos}
          ref={(el) => {
            if (el) el.indeterminate = !todos && alguns
          }}
          disabled={semSup || ids.length === 0}
          onChange={(e) => onToggleGrupo(ids, e.target.checked)}
          aria-label={`Selecionar todos de ${g.sup.nome}`}
        />
        <button type="button" onClick={onToggleFechado} className="flex items-center gap-2 min-w-0 text-left">
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
                <Th right>Cobertura</Th>
                <Th right>Trânsito</Th>
                <Th right>Lead</Th>
                <Th className="whitespace-nowrap">Comprar até</Th>
                <Th right>Comprar</Th>
                <Th right className="whitespace-nowrap">Custo est.</Th>
              </tr>
            </thead>
            <tbody>
              {g.linhas.map((x) => {
                const { l, m } = x
                const casas = casasDe(m.unidadeConsumo)
                const marcado = sel.has(m.id)
                return (
                  <tr key={m.id} className={cx(marcado && 'bg-accent-soft/30')}>
                    <Td>
                      <input type="checkbox" className="h-4 w-4 accent-accent" checked={marcado} disabled={semSup || l.qtdCompra <= 0} onChange={() => onToggle(m.id)} aria-label={`Selecionar ${m.nome}`} />
                    </Td>
                    <Td className="min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium leading-tight">{m.nome}</span>
                        <Badge tone={ABC_TONE[l.curva]}>{l.curva}</Badge>
                      </div>
                      <div className="text-[12px] text-muted font-mono">
                        {m.sku} · {m.unidadeConsumo}
                      </div>
                    </Td>
                    <Td right>
                      <div className={cx(m.saldo < m.minimo && 'text-danger font-medium')}>{num(l.saldo, casas)}</div>
                      <div className="text-[11px] text-muted whitespace-nowrap">{l.consumoDia > 0 ? `${num(l.consumoDia, 2)}/dia` : 'sem consumo'}</div>
                    </Td>
                    <Td right className={cx(Number.isFinite(l.coberturaDias) && l.coberturaDias < l.leadDias && 'text-danger font-medium')}>
                      {Number.isFinite(l.coberturaDias) ? `${num(l.coberturaDias, 1)} d` : '—'}
                    </Td>
                    <Td right className="text-muted">{l.emTransito > 0 ? num(l.emTransito, casas) : '—'}</Td>
                    <Td right className="text-muted">
                      <span title={l.leadAprendido ? 'média das últimas OCs do fornecedor' : 'do cadastro'}>{l.leadDias} d</span>
                    </Td>
                    <Td className="whitespace-nowrap">{badgePrazo(x)}</Td>
                    <Td right className="whitespace-nowrap">
                      {l.qtdCompra > 0 ? (
                        <>
                          <div className="font-medium">
                            {num(l.qtdCompra)} <span className="text-muted text-[12px] font-normal">{m.unidadeCompra}</span>
                          </div>
                          <div className="text-[11px] text-muted">
                            {num(l.necessidade, casas)} {m.unidadeConsumo}
                          </div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                    <Td right className="whitespace-nowrap">{x.custo > 0 ? brl(x.custo) : <span className="text-faint">—</span>}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}
