// Aba "Produtividade" dos Apontamentos: aderência da projeção, gargalo por hora e quem produz, só com bipes.
import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dataBR, diaProducao, num, pct } from '../../domain/format'
import { comHoje, semProducao, ultimosDias } from '../../domain/historico'
import { useStore } from '../../domain/store'
import { Card, EmptyState, Stat, cx } from '../../ui'
import { AderenciaLine, GroupedBars, HourHistogram } from './charts'
import { Fechamentos, TabelaOperadores, TabelaSkus } from './ProdutividadeTabelas'
import { HORAS_TURNO, PERIODOS, aderenciaDe, bipesDoDia, gargaloDe, porHoraDe, porOperador, porSku, resumoPeriodo, toneAderencia, type Periodo } from './produtividadeUtils'

const diaCurto = (iso: string) => dataBR(iso + 'T12:00:00').slice(0, 5)

export function Produtividade() {
  const s = useStore()
  const hoje = diaProducao(s.tenant.horaVirada)
  const [periodo, setPeriodo] = useState<Periodo>(14)

  const bipesHoje = useMemo(() => bipesDoDia(s.scans, hoje), [s.scans, hoje])
  const produzidoHoje = bipesHoje.reduce((a, x) => a + x.quantidade, 0)
  const projetadoHoje = s.dailyPlan.reduce((a, l) => a + l.projetado, 0)

  // Histórico: dias anteriores vêm do banco (v_daily_plan); hoje vem do store, que já tem os bipes
  // da fila offline. Empresa sem histórico fica com a série zerada e a tela diz isso.
  const historico = useMemo(
    () => ultimosDias(comHoje(s.historico.producao, hoje, { projetado: projetadoHoje, produzido: produzidoHoje }), periodo),
    [s.historico.producao, hoje, periodo, projetadoHoje, produzidoHoje],
  )
  const vazio = semProducao(historico)
  const resumo = useMemo(() => resumoPeriodo(historico), [historico])

  const porHora = useMemo(() => porHoraDe(bipesHoje), [bipesHoje])
  const gargalo = useMemo(() => gargaloDe(porHora), [porHora])
  const horasComBipe = porHora.filter((v) => v > 0).length
  const pecasHoraHoje = horasComBipe ? produzidoHoje / horasComBipe : 0

  const operadores = useMemo(() => porOperador(bipesHoje, resumo.produzido), [bipesHoje, resumo.produzido])
  const skus = useMemo(() => porSku(bipesHoje, s.dailyPlan), [bipesHoje, s.dailyPlan])

  const diasUteis = historico.filter((d) => d.projetado > 0)
  const aderenciaSerie = historico.map((d) => (d.projetado > 0 ? aderenciaDe(d) : null))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted">
          <span className="font-medium text-text">Por que existe:</span> medir a aderência da projeção, achar o gargalo por hora e reconhecer quem produz, sem ninguém apontar nada além do bipe.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {s.historico.exemplo && (
            <span className="text-[12px] text-faint inline-flex items-center gap-1" title="Modo de demonstração, sem banco: os dias anteriores a hoje são um padrão semanal de exemplo.">
              <Info size={12} /> histórico de exemplo
            </span>
          )}
          {s.historico.truncada.producao && (
            <span className="text-[12px] text-warn inline-flex items-center gap-1" title="A leitura do histórico bateu no limite de linhas: o período foi encurtado para não mostrar dia pela metade.">
              <Info size={12} /> período encurtado
            </span>
          )}
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={periodo === p}
                onClick={() => setPeriodo(p)}
                className={cx('h-8 rounded-md px-3 text-sm tabular-nums transition-colors', periodo === p ? 'bg-surface shadow-[var(--shadow-card)] font-medium' : 'text-muted hover:text-text')}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Aderência média"
          value={vazio ? '—' : pct(resumo.aderencia)}
          tone={vazio ? undefined : toneAderencia(resumo.aderencia)}
          hint={vazio ? 'ainda sem histórico' : `${num(resumo.produzido)} de ${num(resumo.projetado)} peças em ${resumo.diasUteis} dias úteis`}
        />
        <Stat label="Melhor dia" value={resumo.melhor ? pct(aderenciaDe(resumo.melhor)) : '—'} tone={resumo.melhor ? 'ok' : undefined} hint={resumo.melhor ? `${diaCurto(resumo.melhor.dia)} · ${num(resumo.melhor.produzido)} de ${num(resumo.melhor.projetado)}` : 'ainda sem histórico'} />
        <Stat label="Pior dia" value={resumo.pior ? pct(aderenciaDe(resumo.pior)) : '—'} tone={resumo.pior ? toneAderencia(aderenciaDe(resumo.pior)) : undefined} hint={resumo.pior ? `${diaCurto(resumo.pior.dia)} · ${num(resumo.pior.produzido)} de ${num(resumo.pior.projetado)}` : 'ainda sem histórico'} />
        <Stat
          label="Peças por hora trabalhada"
          value={vazio ? '—' : num(resumo.pecasHora, 1)}
          tone={vazio ? undefined : 'accent'}
          hint={vazio ? `turno de ${HORAS_TURNO} h` : `turno de ${HORAS_TURNO} h · hoje ${num(pecasHoraHoje, 1)}/h em ${horasComBipe} h com bipe`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2" title="Projetado × Produzido" actions={<span className="text-[13px] text-muted">últimos {periodo} dias</span>}>
          {vazio ? (
            <EmptyState title="Ainda sem histórico" description="Nada projetado nem bipado nestes dias. Assim que a linha definir a projeção e bipar, o gráfico aparece aqui." />
          ) : (
            <GroupedBars
              dias={historico.map((d) => d.dia)}
              series={[
                { nome: 'Projetado', valores: historico.map((d) => d.projetado), tone: 'faint' },
                { nome: 'Produzido', valores: historico.map((d) => d.produzido), tone: 'accent' },
              ]}
              altura={170}
            />
          )}
        </Card>
        <Card title="Aderência no período" actions={<span className="text-[13px] text-muted">produzido ÷ projetado</span>}>
          {diasUteis.length === 0 ? <EmptyState title={vazio ? 'Ainda sem histórico' : 'Sem dias úteis no período'} /> : <AderenciaLine dias={historico.map((d) => d.dia)} valores={aderenciaSerie} altura={170} />}
        </Card>
      </div>

      <Card
        title="Peças por hora do dia"
        actions={
          gargalo !== undefined ? (
            <span className="text-[13px] text-muted">
              gargalo às <span className="font-medium text-warn tabular-nums">{String(gargalo).padStart(2, '0')}h</span> · {num(porHora[gargalo])} peça(s) no meio do turno
            </span>
          ) : (
            <span className="text-[13px] text-muted">bipes de hoje</span>
          )
        }
      >
        {porHora.every((v) => v === 0) ? (
          <EmptyState title="Ainda sem bipes hoje" />
        ) : (
          <>
            <HourHistogram porHora={porHora} gargalo={gargalo} />
            <p className="mt-2 text-[12px] text-faint">Gargalo é a hora de menor volume entre a primeira e a última hora com bipes: costuma ser troca de insumo, refeição ou máquina parada.</p>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <TabelaOperadores linhas={operadores} periodo={periodo} />
        <TabelaSkus linhas={skus} />
      </div>

      <Fechamentos historico={historico} periodo={periodo} />
    </div>
  )
}
