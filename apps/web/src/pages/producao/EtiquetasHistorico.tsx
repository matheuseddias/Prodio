// Histórico de etiquetas do dia: status vem do store (annulLabel), não de estado local.
import { Ban, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { Label } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Table, Td, Th, cx } from '../../ui'

export function EtiquetasHistorico({ hoje, onReimprimir }: { hoje: string; onReimprimir: (l: Label) => void }) {
  const s = useStore()
  const { productRef } = useLookups()

  // A etiqueta do dia continua na lista mesmo se o produto tiver sido excluído depois de impressa:
  // ela existe no chão de fábrica e precisa poder ser anulada. Quem sumiu aparece como removido.
  const historico = useMemo(() => {
    const grupos = new Map<string, Label[]>()
    for (const l of s.labels) {
      if (l.dia !== hoje) continue
      const arr = grupos.get(l.productId) ?? []
      arr.push(l)
      grupos.set(l.productId, arr)
    }
    return [...grupos.entries()].map(([pid, ls]) => ({ ref: productRef(pid), labels: ls.sort((a, b) => b.seq - a.seq) }))
  }, [s.labels, hoje, productRef])

  const bipadas = useMemo(() => new Set(s.scans.filter((x) => x.tipo === 'produzido').map((x) => x.serial)), [s.scans])

  const anular = (l: Label) => {
    if (!window.confirm(`Anular ${l.serial}? A etiqueta deixa de ser bipável e sai do impresso do dia.`)) return
    s.annulLabel(l.serial)
  }
  const reimprimir = (l: Label) => {
    if (!window.confirm(`Anular ${l.serial} e imprimir uma nova etiqueta?`)) return
    onReimprimir(l)
  }

  return (
    <Card className="mt-5 no-print" title="Histórico do dia" padded={false}>
      {historico.length === 0 ? (
        <EmptyState title="Nenhuma etiqueta impressa hoje" />
      ) : (
        <div className="divide-y divide-border">
          {historico.map((g) => {
            const anuladas = g.labels.filter((l) => l.status === 'anulada').length
            return (
              <details key={g.ref.id} className="group">
                <summary className="flex items-center justify-between gap-3 px-5 py-3 cursor-pointer hover:bg-surface-2/60 list-none">
                  <div className="min-w-0">
                    <span className={cx('font-medium', g.ref.removido && 'text-muted italic')}>{g.ref.nome}</span>
                    {g.ref.cor && <span className="uppercase text-accent-text"> · {g.ref.cor}</span>}
                    <span className="ml-2 text-[12px] text-muted font-mono">{g.ref.sku}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-[12px] text-muted tabular-nums">
                    <span>{num(g.labels.length)} seriais</span>
                    {anuladas > 0 && <Badge tone="danger">{anuladas} anulada(s)</Badge>}
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
                        const anulada = l.status === 'anulada'
                        const bipada = bipadas.has(l.serial)
                        return (
                          <tr key={l.serial} className={cx(anulada && 'opacity-60')}>
                            <Td mono className={cx(anulada && 'line-through')}>{l.serial}</Td>
                            <Td className="capitalize">
                              {l.tipo}
                              {l.tipo === 'caixa' && ` (${l.quantidade} un)`}
                            </Td>
                            <Td>
                              {anulada ? (
                                <Badge tone="danger">
                                  <Ban size={12} /> Anulada
                                </Badge>
                              ) : bipada ? (
                                <Badge tone="ok">Bipada</Badge>
                              ) : (
                                <Badge tone="info">Impressa</Badge>
                              )}
                            </Td>
                            <Td right>
                              <div className="inline-flex gap-1">
                                <Button size="sm" variant="ghost" disabled={anulada || bipada} onClick={() => anular(l)}>
                                  <Ban size={14} /> Anular
                                </Button>
                                <Button size="sm" variant="ghost" disabled={anulada || bipada} onClick={() => reimprimir(l)}>
                                  <RotateCcw size={14} /> Anular e reimprimir
                                </Button>
                              </div>
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
            )
          })}
        </div>
      )}
    </Card>
  )
}
