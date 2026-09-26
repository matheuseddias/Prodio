// Tabela do plano de hoje. Demanda, saldo no hub e carteira vêm da demanda viva dos pedidos quando há
// (a linha gravada guarda o que valia quando entrou no plano); a sugestão aparece ao lado do projetado
// e só vira projetado com um clique da encarregada.
import { AlertTriangle } from 'lucide-react'
import type { LinhaSugerida } from '../../domain/demanda'
import { num, pct } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { DailyPlanLine } from '../../domain/types'
import { Badge, Progress, Table, Td, Th, cx } from '../../ui'
import QtyInput from './QtyInput'

export default function LinhaTabela({ linhas, sugestao, elevadas }: { linhas: DailyPlanLine[]; sugestao: Map<string, LinhaSugerida>; elevadas: Set<string> }) {
  const { setProjetado } = useStore()
  const { productRef } = useLookups()
  return (
    <div className="px-5">
      <Table>
        <thead>
          <tr>
            <Th>Produto</Th>
            <Th right>Demanda/dia</Th>
            <Th right>Saldo hub</Th>
            <Th right>Carteira</Th>
            <Th right>Projetado</Th>
            <Th right>Sugestão</Th>
            <Th right>Impresso</Th>
            <Th right>Bipado</Th>
            <Th className="w-44">Progresso</Th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const ref = productRef(l.productId)
            const s = sugestao.get(l.productId)
            const demandaDia = s?.demandaDia ?? l.demandaDia
            const saldoHub = s ? s.saldoHub : l.saldoHub
            const carteira = s?.carteira ?? l.carteira
            const r = l.projetado > 0 ? l.bipado / l.projetado : 0
            const semEtiqueta = l.impresso === 0
            const alerta = l.projetado > 0 && semEtiqueta
            const tone = l.projetado > 0 && r >= 1 ? 'ok' : semEtiqueta ? 'neutral' : 'warn'
            return (
              <tr key={l.productId} className={cx(alerta && 'bg-warn-soft/40', elevadas.has(l.productId) && 'bg-ok-soft/40')}>
                <Td className="min-w-[220px]">
                  <div className="font-medium">
                    <span className={cx(ref.removido && 'text-muted italic')}>{ref.nome}</span>
                    {ref.cor && <span className="uppercase text-accent-text"> · {ref.cor}</span>}
                  </div>
                  <div className="text-[12px] text-muted font-mono">
                    {ref.sku}
                    {ref.tamanho && <span className="font-sans"> · {ref.tamanho}</span>}
                  </div>
                </Td>
                <Td right className="text-muted">{num(demandaDia, 1)}</Td>
                <Td right className="text-muted">{saldoHub === undefined ? '—' : num(saldoHub)}</Td>
                <Td right className={cx(carteira > l.projetado && 'text-warn font-medium')}>{num(carteira)}</Td>
                <Td right>
                  <QtyInput value={l.projetado} onCommit={(v) => setProjetado(l.productId, v)} highlight={elevadas.has(l.productId)} />
                </Td>
                <Td right>
                  {!s ? (
                    <span className="text-faint">—</span>
                  ) : s.sugerido === l.projetado ? (
                    <span className="text-muted">{num(s.sugerido)}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setProjetado(l.productId, s.sugerido)}
                      className="rounded-md px-2 py-1 text-accent-text hover:bg-accent-soft tabular-nums"
                      title={`Usar a sugestão (${s.base === 'cobertura' ? 'repõe a cobertura com o saldo do hub' : 'meta de 1 dia, sem saldo do hub'})`}
                    >
                      {num(s.sugerido)}
                    </button>
                  )}
                </Td>
                <Td right>{num(l.impresso)}</Td>
                <Td right className="font-medium">
                  {num(l.bipado)}
                  {l.projetado > l.bipado && <div className="text-[11px] font-normal text-muted whitespace-nowrap">faltam {num(l.projetado - l.bipado)}</div>}
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Progress value={l.bipado} max={l.projetado} tone={tone} />
                    <span className="text-[12px] text-muted tabular-nums w-10 text-right">{pct(r)}</span>
                  </div>
                  <div className="mt-1.5">
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
                  </div>
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}
