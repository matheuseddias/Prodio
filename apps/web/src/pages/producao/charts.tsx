// Gráficos SVG inline, sem libs. Cores só via tokens do tema (fill-accent, fill-faint…).
import { num, pct } from '../../domain/format'

const diaCurto = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface BarSerie {
  nome: string
  valores: number[]
  tone: 'accent' | 'faint' | 'info' | 'ok'
}

const fillOf = { accent: 'fill-accent', faint: 'fill-border', info: 'fill-info', ok: 'fill-ok' }
const dotOf = { accent: 'bg-accent', faint: 'bg-border', info: 'bg-info', ok: 'bg-ok' }

/** Barras agrupadas (1 ou 2 séries) com legenda e rótulos de eixo. */
export function GroupedBars({ dias, series, altura = 150 }: { dias: string[]; series: BarSerie[]; altura?: number }) {
  const W = 600
  const H = altura
  const padL = 34
  const padB = 22
  const padT = 8
  const max = Math.max(1, ...series.flatMap((s) => s.valores))
  const step = (W - padL) / dias.length
  const grupo = step * 0.68
  const barW = grupo / series.length
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f))
  // Rótulos de dia: todos até 7 dias; a cada 2 até 14; depois ~8 rótulos no total.
  const cada = Math.max(1, Math.ceil(dias.length / 8))
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={series.map((s) => s.nome).join(' × ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} className="fill-faint tabular-nums">
              {num(t)}
            </text>
          </g>
        ))}
        {dias.map((d, i) => {
          const x0 = padL + i * step + (step - grupo) / 2
          return (
            <g key={d}>
              {series.map((s, si) => {
                const v = s.valores[i] ?? 0
                const h = Math.max(0, y(0) - y(v))
                return (
                  <rect
                    key={s.nome}
                    x={x0 + si * barW + (si > 0 ? 1 : 0)}
                    y={y(v)}
                    width={Math.max(1, barW - 1)}
                    height={h}
                    rx={2}
                    className={fillOf[s.tone]}
                  >
                    <title>{`${diaCurto(d)} · ${s.nome}: ${num(v)}`}</title>
                  </rect>
                )
              })}
              {(dias.length <= 7 || i % cada === cada - 1) && (
                <text x={x0 + grupo / 2} y={H - 6} textAnchor="middle" fontSize={10} className="fill-muted">
                  {diaCurto(d)}
                </text>
              )}
            </g>
          )
        })}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
      </svg>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
          {series.map((s) => (
            <span key={s.nome} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${dotOf[s.tone]}`} />
              {s.nome}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Histograma simples por hora (0–23), com destaque no máximo e, opcionalmente, no gargalo. */
export function HourHistogram({ porHora, altura = 140, gargalo }: { porHora: number[]; altura?: number; gargalo?: number }) {
  const W = 600
  const H = altura
  const padL = 30
  const padB = 20
  const padT = 8
  const max = Math.max(1, ...porHora)
  const step = (W - padL) / 24
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max)
  const pico = porHora.indexOf(max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Bipes por hora">
      {[0, 0.5, 1].map((f) => {
        const t = Math.round(max * f)
        return (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} className="fill-faint tabular-nums">
              {num(t)}
            </text>
          </g>
        )
      })}
      {porHora.map((v, h) => {
        const x = padL + h * step + step * 0.2
        const ehGargalo = gargalo === h
        const ehPico = h === pico && v > 0
        return (
          <g key={h}>
            <rect x={x} y={y(v)} width={step * 0.6} height={Math.max(0, y(0) - y(v))} rx={2} className={ehGargalo ? 'fill-warn' : ehPico ? 'fill-accent' : 'fill-info'} opacity={ehPico || ehGargalo ? 1 : 0.75}>
              <title>{`${String(h).padStart(2, '0')}h: ${num(v)} bipe(s)${ehGargalo ? ' · gargalo' : ehPico ? ' · pico' : ''}`}</title>
            </rect>
            {ehGargalo && (
              <text x={x + step * 0.3} y={y(v) - 4} textAnchor="middle" fontSize={9} className="fill-warn font-medium">
                gargalo
              </text>
            )}
            {h % 3 === 0 && (
              <text x={x + step * 0.3} y={H - 6} textAnchor="middle" fontSize={10} className="fill-muted">
                {String(h).padStart(2, '0')}h
              </text>
            )}
          </g>
        )
      })}
      <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="stroke-border" strokeWidth={1} />
    </svg>
  )
}

/** Linha de aderência (produzido ÷ projetado) ao longo do tempo, com meta em 100%. `null` = dia sem projeção (quebra a linha). */
export function AderenciaLine({ dias, valores, altura = 150 }: { dias: string[]; valores: (number | null)[]; altura?: number }) {
  const W = 600
  const H = altura
  const padL = 38
  const padR = 8
  const padB = 22
  const padT = 10
  const validos = valores.filter((v): v is number => v !== null)
  const max = Math.max(1.1, ...validos.map((v) => Math.ceil(v * 10) / 10))
  const min = Math.min(0.7, ...validos.map((v) => Math.floor(v * 10) / 10))
  const step = (W - padL - padR) / Math.max(1, dias.length)
  const x = (i: number) => padL + i * step + step / 2
  const y = (v: number) => padT + (H - padT - padB) * (1 - (v - min) / (max - min))
  const ticks = [min, 1, max].filter((t, i, a) => a.indexOf(t) === i)
  // Segmentos contínuos: uma polyline por sequência sem null.
  const segmentos: string[] = []
  let atual: string[] = []
  valores.forEach((v, i) => {
    if (v === null) {
      if (atual.length) segmentos.push(atual.join(' '))
      atual = []
    } else atual.push(`${x(i)},${y(v)}`)
  })
  if (atual.length) segmentos.push(atual.join(' '))
  const cada = Math.max(1, Math.ceil(dias.length / 8))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Aderência ao longo do período">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 1 ? 'stroke-ok' : 'stroke-border'} strokeWidth={1} strokeDasharray={t === 1 ? '4 3' : undefined} opacity={t === 1 ? 0.7 : 1} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} className={t === 1 ? 'fill-ok tabular-nums' : 'fill-faint tabular-nums'}>
            {pct(t)}
          </text>
        </g>
      ))}
      {segmentos.map((pts, i) => (
        <polyline key={i} points={pts} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {valores.map((v, i) =>
        v === null ? null : (
          <circle key={dias[i]} cx={x(i)} cy={y(v)} r={dias.length > 30 ? 1.5 : 3} className={v >= 0.95 ? 'fill-ok' : v >= 0.85 ? 'fill-warn' : 'fill-danger'}>
            <title>{`${diaCurto(dias[i])}: ${pct(v)}`}</title>
          </circle>
        ),
      )}
      {dias.map((d, i) =>
        dias.length <= 7 || i % cada === cada - 1 ? (
          <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} className="fill-muted">
            {diaCurto(d)}
          </text>
        ) : null,
      )}
    </svg>
  )
}
