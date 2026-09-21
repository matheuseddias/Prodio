import { CalendarClock, ClipboardList, Play, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, dataBR, num, relativo } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, Input, Table, Td, Th, cx } from '../../ui'
import EstoqueInventarioSessao from './EstoqueInventarioSessao'
import {
  REGRA_ABC_PADRAO,
  programacao,
  resumoSessao,
  semanasAcimaDe95,
  serieAcuracia,
  sessoesExemplo,
  sugestoes,
  type ClasseABC,
  type RegraABC,
  type SessaoInventario,
} from './inventarioSessoes'

export default function EstoqueInventario() {
  const { materials, addStockMove } = useStore()
  const [sessoes, setSessoes] = useState<SessaoInventario[]>(() => sessoesExemplo(materials))
  const [regra, setRegra] = useState<RegraABC>(REGRA_ABC_PADRAO)
  const [abertaId, setAbertaId] = useState<string | null>(null)
  const [novaComIds, setNovaComIds] = useState<string[] | null>(null)

  const prog = useMemo(() => programacao(materials, sessoes, regra), [materials, sessoes, regra])
  const venceHoje = prog.filter((l) => l.vencida)
  const sug = useMemo(() => sugestoes(materials, sessoes, regra), [materials, sessoes, regra])

  const salvar = (s: SessaoInventario) => setSessoes((lista) => (lista.some((x) => x.id === s.id) ? lista.map((x) => (x.id === s.id ? s : x)) : [s, ...lista]))

  const fechar = (s: SessaoInventario) => {
    for (const it of s.itens) {
      if (!it.delta) continue
      addStockMove({ materialId: it.materialId, tipo: 'ajuste', delta: it.delta, custoUnit: it.custoUnit, motivo: `Inventário · ${it.motivo ?? 'Outro'}`, ref: `Sessão ${dataBR(s.abertaEm)} · ${s.local}`, por: s.por })
    }
    salvar(s)
    setAbertaId(null)
    setNovaComIds(null)
  }

  const sessaoAberta = abertaId ? sessoes.find((s) => s.id === abertaId) : undefined
  const ordenadas = useMemo(() => [...sessoes].sort((a, b) => Number(b.status === 'aberta') - Number(a.status === 'aberta') || b.abertaEm.localeCompare(a.abertaEm)), [sessoes])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Contagem por sessão, no celular ou aqui; só o que divergir vira ajuste. Sobras aproveitáveis contam como estoque, quebra e caco não.
      </p>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px] items-start">
        <div className="space-y-4 min-w-0">
          <Card
            title="Sessões"
            actions={
              <Button size="sm" variant="primary" onClick={() => setNovaComIds([])}>
                <ClipboardList size={14} /> Nova sessão
              </Button>
            }
          >
            {ordenadas.length === 0 ? (
              <EmptyState title="Nenhuma sessão" description="Abra uma sessão para contar uma prateleira, uma família ou o que vence hoje." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Local</Th>
                    <Th>Quem</Th>
                    <Th right>Contados</Th>
                    <Th right>Divergência</Th>
                    <Th>Status</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((s) => {
                    const r = resumoSessao(s, materials)
                    const aberta = s.status === 'aberta'
                    return (
                      <tr key={s.id} className={cx(aberta && 'bg-accent-soft/20')}>
                        <Td className="whitespace-nowrap">
                          <div>{dataBR(s.abertaEm)}</div>
                          <div className="text-[12px] text-muted">{aberta ? `aberta ${relativo(s.abertaEm)}` : `fechada ${relativo(s.fechadaEm ?? s.abertaEm)}`}</div>
                        </Td>
                        <Td>
                          <div>{s.local}</div>
                          <div className="text-[12px] text-muted">{s.origem === 'celular' ? 'pelo celular' : 'no desktop'}</div>
                        </Td>
                        <Td className="text-muted">{s.por}</Td>
                        <Td right className="tabular-nums">
                          {aberta ? `${r.contados.length} de ${s.itens.length}` : num(s.itens.length)}
                        </Td>
                        <Td right className="tabular-nums">
                          {r.contados.length === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <>
                              <div className={cx('font-medium', r.valorDiverg > 0 ? 'text-warn' : 'text-ok')}>{brl(r.valorDiverg)}</div>
                              <div className="text-[12px] text-muted">{num(r.pct, 1)}% · {r.divergentes.length} div.</div>
                            </>
                          )}
                        </Td>
                        <Td><Badge tone={aberta ? 'accent' : 'neutral'}>{aberta ? 'Aberta' : 'Fechada'}</Badge></Td>
                        <Td right>
                          <Button size="sm" variant={aberta ? 'primary' : 'ghost'} onClick={() => setAbertaId(s.id)}>
                            {aberta ? <><Play size={13} /> Retomar</> : 'Ver'}
                          </Button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card
            title="Programação de contagem"
            actions={
              venceHoje.length > 0 && (
                <Button size="sm" onClick={() => setNovaComIds(venceHoje.map((l) => l.m.id))}>
                  <ClipboardList size={14} /> Contar o que vence
                </Button>
              )
            }
          >
            <div className="grid grid-cols-3 gap-3 mb-4">
              {(['A', 'B', 'C'] as ClasseABC[]).map((c) => (
                <label key={c} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between text-[12px] text-muted">
                    <span>Classe {c}</span>
                    <span className="tabular-nums">{prog.filter((l) => l.classe === c).length} insumos</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[13px] text-muted">a cada</span>
                    <Input inputMode="numeric" value={regra[c]} onChange={(e) => setRegra((r) => ({ ...r, [c]: Math.max(1, Number(e.target.value) || 1) }))} className="h-9 w-16 text-right tabular-nums" />
                    <span className="text-[13px] text-muted">dias</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="text-[12px] text-faint mb-3">Classe pelo valor em estoque (saldo × custo médio): A até 80% do valor, B até 95%, C o resto.</div>

            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <CalendarClock size={15} className="text-warn" /> Vence hoje
              <Badge tone={venceHoje.length ? 'warn' : 'ok'}>{venceHoje.length}</Badge>
            </div>
            {venceHoje.length === 0 ? (
              <div className="text-sm text-muted">Nada vencido. A próxima contagem entra sozinha quando o prazo da classe passar.</div>
            ) : (
              <ul className="divide-y divide-border">
                {venceHoje.map((l) => (
                  <li key={l.m.id} className="flex items-center gap-3 py-2 text-sm">
                    <Badge tone={l.classe === 'A' ? 'danger' : l.classe === 'B' ? 'warn' : 'neutral'}>{l.classe}</Badge>
                    <span className="min-w-0 flex-1 truncate">{l.m.nome}</span>
                    <span className="text-[12px] text-muted tabular-nums shrink-0">{l.ultima ? `última há ${l.diasDesde} d · prazo ${l.prazoDias} d` : 'nunca contado'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Acuracia sessoes={sessoes} />
      </div>

      {(sessaoAberta || novaComIds) && (
        <EstoqueInventarioSessao
          key={sessaoAberta?.id ?? 'nova'}
          sessao={sessaoAberta}
          idsIniciais={novaComIds ?? []}
          sugestoes={sug}
          onSalvar={(s) => { salvar(s); setAbertaId(s.id); setNovaComIds(null) }}
          onFechar={fechar}
          onClose={() => { setAbertaId(null); setNovaComIds(null) }}
        />
      )}
    </div>
  )
}

function Acuracia({ sessoes }: { sessoes: SessaoInventario[] }) {
  const serie = useMemo(() => serieAcuracia(sessoes), [sessoes])
  const ultimas = serie.slice(-5)
  const fechadas = sessoes.filter((s) => s.status === 'fechada')
  const itens = fechadas.flatMap((s) => s.itens)
  const geral = itens.length ? (itens.filter((i) => (i.delta ?? 0) === 0).length / itens.length) * 100 : undefined

  const semanasOk = useMemo(() => semanasAcimaDe95(serie), [serie])

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Target size={16} className="text-faint" /> Acurácia</span>}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={cx('text-3xl font-semibold tabular-nums tracking-tight', geral === undefined ? 'text-faint' : geral >= 95 ? 'text-ok' : geral >= 85 ? 'text-warn' : 'text-danger')}>
            {geral === undefined ? '—' : `${num(geral, 0)}%`}
          </div>
          <div className="text-[12px] text-muted">itens sem divergência · {fechadas.length} sessões fechadas</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">{semanasOk}<span className="text-muted text-sm font-normal"> / 4</span></div>
          <div className="text-[12px] text-muted">semanas ≥ 95%</div>
        </div>
      </div>
      <GraficoAcuracia pontos={ultimas} />
      <ul className="mt-2 space-y-1">
        {ultimas.map((p) => (
          <li key={p.id} className="flex items-center justify-between text-[12px] text-muted tabular-nums">
            <span>{dataBR(p.em)}</span>
            <span className={cx('font-medium', p.pct >= 95 ? 'text-ok' : p.pct >= 85 ? 'text-warn' : 'text-danger')}>{num(p.pct, 0)}%</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] text-muted leading-relaxed">
        O modo «por saldo» da necessidade de compra é liberado com 4 semanas acima de 95%.
      </p>
    </Card>
  )
}

function GraficoAcuracia({ pontos }: { pontos: { pct: number }[] }) {
  const W = 300, H = 80, P = 8
  const y = (v: number) => H - P - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * P)
  const x = (i: number) => (pontos.length <= 1 ? W / 2 : P + (i / (pontos.length - 1)) * (W - 2 * P))
  const d = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full h-20" role="img" aria-label="Evolução da acurácia por sessão">
      <line x1={P} x2={W - P} y1={y(95)} y2={y(95)} className="stroke-ok/60" strokeDasharray="3 3" strokeWidth={1} />
      <text x={W - P} y={y(95) - 3} textAnchor="end" className="fill-muted" fontSize={9}>meta 95%</text>
      {pontos.length > 1 && <path d={d} fill="none" className="stroke-accent" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
      {pontos.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.pct)} r={3} className={p.pct >= 95 ? 'fill-ok' : p.pct >= 85 ? 'fill-warn' : 'fill-danger'} />
      ))}
      {pontos.length === 0 && <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-faint" fontSize={11}>Feche uma sessão para começar a medir.</text>}
    </svg>
  )
}
