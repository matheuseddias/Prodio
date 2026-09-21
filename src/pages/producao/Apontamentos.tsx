import { CloudOff, RotateCcw, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { hojeISO, horaBR, num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { ScanEvent } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Stat, Table, Td, Th, cx } from '../../ui'
import { HourHistogram } from './charts'

const tipoTone = { produzido: 'ok', estorno: 'danger', refugo: 'warn' } as const

export default function Apontamentos() {
  const s = useStore()
  const { product } = useLookups()
  const hoje = hojeISO()

  const [data, setData] = useState(hoje)
  const [sku, setSku] = useState('')
  const [operador, setOperador] = useState('')
  const [dispositivo, setDispositivo] = useState('')
  const [tipo, setTipo] = useState('')
  const [estornar, setEstornar] = useState<ScanEvent | null>(null)

  const operadores = useMemo(() => [...new Set(s.scans.map((x) => x.operador))].sort(), [s.scans])
  const dispositivos = useMemo(() => [...new Set(s.scans.map((x) => x.dispositivo))].sort(), [s.scans])
  const skus = useMemo(() => [...new Set(s.scans.map((x) => x.productId))].map((id) => product(id)!).filter(Boolean), [s.scans, product])

  const doDia = useMemo(() => s.scans.filter((x) => x.competencia === data), [s.scans, data])
  const filtrados = useMemo(
    () =>
      doDia
        .filter((x) => !sku || x.productId === sku)
        .filter((x) => !operador || x.operador === operador)
        .filter((x) => !dispositivo || x.dispositivo === dispositivo)
        .filter((x) => !tipo || x.tipo === tipo)
        .sort((a, b) => b.em.localeCompare(a.em)),
    [doDia, sku, operador, dispositivo, tipo],
  )

  const bipes = doDia.filter((x) => x.tipo === 'produzido')
  const pendentes = doDia.filter((x) => !x.sincronizado).length
  const estornos = doDia.filter((x) => x.tipo === 'estorno').length
  const ranking = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const x of bipes) acc[x.operador] = (acc[x.operador] ?? 0) + x.quantidade
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [bipes])
  const porHora = useMemo(() => {
    const h = Array.from({ length: 24 }, () => 0)
    for (const x of filtrados) if (x.tipo === 'produzido') h[new Date(x.em).getHours()] += x.quantidade
    return h
  }, [filtrados])

  const limpar = () => {
    setSku('')
    setOperador('')
    setDispositivo('')
    setTipo('')
  }
  const temFiltro = sku || operador || dispositivo || tipo

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Apontamentos</h1>
        <p className="text-sm text-muted mt-1">Histórico de bipes da linha. Cada bipe é um serial único; estornos ficam registrados.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label={data === hoje ? 'Bipes hoje' : 'Bipes no dia'} value={num(bipes.reduce((a, x) => a + x.quantidade, 0))} hint={`${num(bipes.length)} leituras`} tone="accent" />
        <div className="bg-surface border border-border rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 min-w-0">
          <div className="text-[13px] text-muted">Por operador</div>
          {ranking.length === 0 ? (
            <div className="mt-1 text-sm text-faint">—</div>
          ) : (
            <ol className="mt-1.5 space-y-1">
              {ranking.slice(0, 3).map(([nome, q], i) => (
                <li key={nome} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    <span className="text-faint tabular-nums mr-1.5">{i + 1}.</span>
                    {nome}
                  </span>
                  <span className="font-semibold tabular-nums">{num(q)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <Stat label="Pendentes de sincronizar" value={num(pendentes)} tone={pendentes > 0 ? 'warn' : 'ok'} icon={<CloudOff size={16} />} hint={pendentes > 0 ? 'aguardando conexão do dispositivo' : 'tudo sincronizado'} />
        <Stat label="Estornos" value={num(estornos)} tone={estornos > 0 ? 'danger' : undefined} icon={<Undo2 size={16} />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-3" title="Por hora" actions={<span className="text-[13px] text-muted">bipes produzidos · filtros aplicados</span>}>
          {porHora.every((v) => v === 0) ? <EmptyState title="Sem bipes no período" /> : <HourHistogram porHora={porHora} />}
        </Card>

        <Card className="xl:col-span-3" padded={false}>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 px-5 pt-4 pb-3 items-end">
            <Field label="Data">
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Field>
            <Field label="SKU">
              <Select value={sku} onChange={(e) => setSku(e.target.value)}>
                <option value="">Todos</option>
                {skus.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.atributos.cor}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Operador">
              <Select value={operador} onChange={(e) => setOperador(e.target.value)}>
                <option value="">Todos</option>
                {operadores.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label="Dispositivo">
              <Select value={dispositivo} onChange={(e) => setDispositivo(e.target.value)}>
                <option value="">Todos</option>
                {dispositivos.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">Todos</option>
                <option value="produzido">Produzido</option>
                <option value="estorno">Estorno</option>
                <option value="refugo">Refugo</option>
              </Select>
            </Field>
            <div className="flex items-center justify-between gap-2 h-10">
              <span className="text-[12px] text-muted tabular-nums">{num(filtrados.length)} registro(s)</span>
              {temFiltro && (
                <Button variant="ghost" size="sm" onClick={limpar}>
                  Limpar
                </Button>
              )}
            </div>
          </div>

          {filtrados.length === 0 ? (
            <EmptyState title="Nenhum apontamento" description={temFiltro ? 'Tente remover algum filtro.' : 'Ainda não houve bipes nesta data.'} />
          ) : (
            <div className="px-5 pb-2">
              <Table>
                <thead>
                  <tr>
                    <Th>Hora</Th>
                    <Th>Serial</Th>
                    <Th>Produto</Th>
                    <Th>Operador</Th>
                    <Th>Dispositivo</Th>
                    <Th>Etapa</Th>
                    <Th>Tipo</Th>
                    <Th>Sync</Th>
                    <Th right></Th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((x) => {
                    const p = product(x.productId)
                    return (
                      <tr key={x.id} className={cx(x.tipo === 'estorno' && 'text-muted')}>
                        <Td className="tabular-nums whitespace-nowrap">{horaBR(x.em)}</Td>
                        <Td mono className="whitespace-nowrap">{x.serial}</Td>
                        <Td>
                          <div className="whitespace-nowrap">
                            {p?.nome} <span className="uppercase text-accent-text">· {p?.atributos.cor}</span>
                          </div>
                          <div className="text-[12px] text-muted font-mono">{p?.sku}</div>
                        </Td>
                        <Td>{x.operador}</Td>
                        <Td className="whitespace-nowrap">{x.dispositivo}</Td>
                        <Td className="capitalize">{x.etapa}</Td>
                        <Td>
                          <Badge tone={tipoTone[x.tipo]} className="capitalize">
                            {x.tipo}
                            {x.quantidade !== 1 && x.quantidade !== -1 && <span className="tabular-nums">· {num(Math.abs(x.quantidade))}</span>}
                          </Badge>
                        </Td>
                        <Td>{x.sincronizado ? <Badge tone="neutral">ok</Badge> : <Badge tone="warn"><CloudOff size={12} /> pendente</Badge>}</Td>
                        <Td right>
                          {x.tipo === 'produzido' && (
                            <Button size="sm" variant="ghost" onClick={() => setEstornar(x)}>
                              <RotateCcw size={14} /> Estornar
                            </Button>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={!!estornar}
        onClose={() => setEstornar(null)}
        title="Estornar apontamento"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEstornar(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (estornar) s.reverseScan(estornar.id)
                setEstornar(null)
              }}
            >
              <RotateCcw size={16} /> Confirmar estorno
            </Button>
          </>
        }
      >
        {estornar && (
          <div className="space-y-3 text-sm">
            <p>O bipe abaixo será removido do produzido de hoje e um registro de estorno ficará no histórico. A baixa de insumos correspondente é revertida.</p>
            <div className="rounded-lg bg-surface-2 p-3 space-y-1">
              <div className="font-mono text-[13px]">{estornar.serial}</div>
              <div>
                {product(estornar.productId)?.nome} <span className="uppercase text-accent-text">· {product(estornar.productId)?.atributos.cor}</span>
              </div>
              <div className="text-muted text-[12px]">
                {horaBR(estornar.em)} · {estornar.operador} · {estornar.dispositivo}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
