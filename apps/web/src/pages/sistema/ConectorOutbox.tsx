import { Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dataHoraBR, horaBR, num, relativo } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, Modal, Select, Table, Td, Th, cx } from '../../ui'
import { Logo } from './ConectorCard'

// ---------- Outbox ----------
export function ConectorOutbox() {
  const { outbox, connectors, retryOutbox } = useStore()
  const { product } = useLookups()
  const [filtro, setFiltro] = useState<'todos' | 'pendente' | 'aplicado' | 'erro'>('todos')
  const cont = useMemo(
    () => ({
      pendente: outbox.filter((o) => o.status === 'pendente').length,
      aplicado: outbox.filter((o) => o.status === 'aplicado').length,
      erro: outbox.filter((o) => o.status === 'erro').length,
    }),
    [outbox],
  )
  const lista = useMemo(() => {
    const l = filtro === 'todos' ? outbox : outbox.filter((o) => o.status === filtro)
    return [...l].sort((a, b) => b.em.localeCompare(a.em))
  }, [outbox, filtro])
  const tone = { pendente: 'warn', aplicado: 'ok', erro: 'danger' } as const

  return (
    <Card
      title="Outbox de estoque"
      actions={
        <Select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="h-8 w-auto text-[13px]">
          <option value="todos">Todos</option>
          <option value="pendente">Pendentes</option>
          <option value="aplicado">Aplicados</option>
          <option value="erro">Erros</option>
        </Select>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span>
          <span className="font-semibold tabular-nums text-warn">{cont.pendente}</span> <span className="text-muted">pendentes</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums text-ok">{cont.aplicado}</span> <span className="text-muted">aplicados</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums text-danger">{cont.erro}</span> <span className="text-muted">erros</span>
        </span>
        <span className="basis-full text-muted sm:basis-auto sm:ml-auto">Cada bipe vira +1 na fila; o worker aplica em lote e o auditor noturno confere.</span>
      </div>
      {lista.length === 0 ? (
        <EmptyState title="Nada aqui" description="Nenhum item do outbox com este filtro." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Hora</Th>
              <Th>Conector</Th>
              <Th>Produto</Th>
              <Th right>Delta</Th>
              <Th>Status</Th>
              <Th>Erro</Th>
              <Th right />
            </tr>
          </thead>
          <tbody>
            {lista.map((o) => {
              const c = connectors.find((x) => x.id === o.connectorId)
              const p = product(o.productId)
              return (
                <tr key={o.id}>
                  <Td className="tabular-nums whitespace-nowrap">{horaBR(o.em)}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      {c && <Logo p={c.plataforma} size="sm" />}
                      <span className="whitespace-nowrap">{c?.nome.split(' ')[0] ?? o.connectorId}</span>
                    </span>
                  </Td>
                  <Td>
                    <div className="font-medium">{p?.nome ?? '—'}</div>
                    <div className="font-mono text-[12px] text-muted">{p?.sku}</div>
                  </Td>
                  <Td right className="font-semibold">
                    {o.delta > 0 ? `+${o.delta}` : o.delta}
                  </Td>
                  <Td>
                    <Badge tone={tone[o.status]}>{o.status}</Badge>
                  </Td>
                  <Td className="max-w-[260px] text-[13px] text-danger">{o.erro ?? <span className="text-faint">—</span>}</Td>
                  <Td right>
                    {o.status === 'erro' && (
                      <Button size="sm" onClick={() => retryOutbox(o.id)}>
                        <RefreshCw size={13} /> Reenviar
                      </Button>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------- Auditor noturno ----------
interface Divergencia {
  productId: string
  prodio: number
  hub: number
}

export function ConectorAuditor() {
  const { product } = useLookups()
  const [divergencias, setDivergencias] = useState<Divergencia[]>([
    { productId: 'p2', prodio: 148, hub: 128 },
    { productId: 'p7', prodio: 312, hub: 307 },
  ])
  const [open, setOpen] = useState(false)
  const [corrigindo, setCorrigindo] = useState<string | null>(null)
  const [ultima] = useState(() => {
    const d = new Date()
    const agora = d.getTime()
    d.setHours(3, 10, 0, 0)
    if (d.getTime() > agora) d.setDate(d.getDate() - 1)
    return d.toISOString()
  })

  const corrigir = (id: string) => {
    setCorrigindo(id)
    window.setTimeout(() => {
      setDivergencias((l) => l.filter((x) => x.productId !== id))
      setCorrigindo(null)
    }, 800)
  }

  return (
    <>
      <Card title="Auditor noturno">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', divergencias.length ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
              <ShieldCheck size={20} />
            </span>
            <div>
              <div className="font-medium">
                {divergencias.length === 0 ? 'Saldos conferem com o hub' : `${divergencias.length} SKUs com saldo diferente no hub`}
              </div>
              <div className="text-[13px] text-muted">
                Última execução {dataHoraBR(ultima)} · {relativo(ultima)} · comparou 11 SKUs em Base.com
              </div>
            </div>
          </div>
          {divergencias.length > 0 && (
            <Button onClick={() => setOpen(true)} className="sm:shrink-0">
              Ver divergências
            </Button>
          )}
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Roda todo dia após a virada: lê o saldo no hub, compara com o esperado a partir dos bipes e aponta o que divergir. Nada é alterado sem confirmação.
        </p>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Divergências do auditor" footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}>
        {divergencias.length === 0 ? (
          <EmptyState title="Sem divergências" description="Todos os saldos foram corrigidos." />
        ) : (
          <div className="space-y-3">
            {divergencias.map((d) => {
              const p = product(d.productId)
              const diff = d.prodio - d.hub
              return (
                <div key={d.productId} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p?.nome}</div>
                      <div className="font-mono text-[12px] text-muted">{p?.sku}</div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted">Prodio</div>
                        <div className="font-semibold tabular-nums">{num(d.prodio)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted">Hub</div>
                        <div className="font-semibold tabular-nums">{num(d.hub)}</div>
                      </div>
                      <Badge tone={diff > 0 ? 'warn' : 'danger'}>{diff > 0 ? `+${diff}` : diff}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="primary" disabled={corrigindo === d.productId} onClick={() => corrigir(d.productId)}>
                      {corrigindo === d.productId ? <Loader2 size={13} className="animate-spin" /> : null}
                      Corrigir no hub
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    </>
  )
}
