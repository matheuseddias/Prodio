import { RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { lerUltimaAuditoria, type ExecucaoAuditor } from '../../data/conectores'
import { mensagemErro } from '../../data/erros'
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
//
// As divergências vêm da última linha de `audit_runs`, gravada pelo cron diário do worker
// (apps/worker/src/jobs/auditor.ts). Antes eram duas constantes no código, iguais para todo tenant
// e sempre com aparência recente. Enquanto o auditor não tiver rodado, o cartão diz isso.
//
// "Corrigir no hub" saiu: não existe RPC de cliente que enfileire correção no integration_outbox
// (enqueue_outbox é interna) nem rota no worker. O botão só apagava a linha da lista local.
export function ConectorAuditor() {
  const { product } = useLookups()
  const { modo } = useStore()
  const [open, setOpen] = useState(false)
  const [execucao, setExecucao] = useState<ExecucaoAuditor | null>(null)
  const [carregando, setCarregando] = useState(modo === 'supabase')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (modo !== 'supabase') return
    let ativo = true
    void lerUltimaAuditoria()
      .then((e) => ativo && setExecucao(e))
      .catch((e) => ativo && setErro(mensagemErro(e)))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [modo])

  const divergencias = execucao?.divergencias ?? []
  const nuncaRodou = !carregando && !erro && !execucao

  return (
    <>
      <Card title="Auditor noturno">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', divergencias.length ? 'bg-warn-soft text-warn' : nuncaRodou ? 'bg-surface-2 text-muted' : 'bg-ok-soft text-ok')}>
              <ShieldCheck size={20} />
            </span>
            <div>
              <div className="font-medium">
                {carregando
                  ? 'Lendo a última execução…'
                  : erro
                    ? 'Não foi possível ler as execuções do auditor'
                    : nuncaRodou
                      ? 'O auditor ainda não rodou'
                      : divergencias.length === 0
                        ? 'Saldos conferem com o hub'
                        : `${divergencias.length} ${divergencias.length === 1 ? 'SKU com saldo diferente' : 'SKUs com saldo diferente'} no hub`}
              </div>
              <div className="text-[13px] text-muted">
                {erro
                  ? erro
                  : execucao
                    ? `Última execução ${dataHoraBR(execucao.em)} · ${relativo(execucao.em)}`
                    : carregando
                      ? '—'
                      : 'Ele roda às 3h, pelo cron do worker. Nada aparece aqui até a primeira execução com um conector ativo.'}
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
          Roda todo dia após a virada: lê o saldo no hub, compara com o esperado a partir dos bipes e aponta o que divergir. Nada é alterado no hub por ele.
        </p>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Divergências do auditor" footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}>
        {divergencias.length === 0 ? (
          <EmptyState title="Sem divergências" description="A última execução do auditor não encontrou diferença de saldo." />
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">
              Esperado = saldo do hub na execução anterior + o que foi bipado no dia. Corrigir o saldo no hub ainda é manual: ajuste na plataforma ou refaça o envio pelo outbox.
            </p>
            {divergencias.map((d) => {
              const p = product(d.product_id)
              const diff = d.diferenca ?? 0
              return (
                <div key={d.product_id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p?.nome ?? d.sku}</div>
                      <div className="font-mono text-[12px] text-muted">{p?.sku ?? d.sku}</div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted">Esperado</div>
                        <div className="font-semibold tabular-nums">{d.esperado === null ? '—' : num(d.esperado)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted">Hub</div>
                        <div className="font-semibold tabular-nums">{num(d.saldo_hub)}</div>
                      </div>
                      <Badge tone={diff > 0 ? 'warn' : 'danger'}>{diff > 0 ? `+${num(diff)}` : num(diff)}</Badge>
                    </div>
                  </div>
                  <div className="mt-2 text-[12px] text-muted tabular-nums">
                    Anterior no hub {d.saldo_anterior === null ? '—' : num(d.saldo_anterior)} · bipado no dia {num(d.bipado_hoje)}
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
