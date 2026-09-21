import { AlertTriangle, Ban, CheckCircle2, CloudOff, Repeat, Shuffle, Undo2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useChaoSession } from '../../app/MobileShell'
import { horaBR, num } from '../../domain/format'
import { useLookups, useStore, type ScanResult } from '../../domain/store'
import { cx } from '../../ui'
import { beepAviso, beepErro, beepOk } from './feedback'
import Scanner from './Scanner'

const FORMATOS = ['qr_code', 'code_128']

type Painel = { serial: string; result: ScanResult; bipadoHoje?: number; projetado?: number }

export default function Bipe() {
  const { operador, dispositivo, online } = useChaoSession()
  const store = useStore()
  const { product } = useLookups()
  const [painel, setPainel] = useState<Painel | null>(null)
  const [filaOffline, setFilaOffline] = useState<string[]>([])
  const [armado, setArmado] = useState<string | null>(null)
  const timer = useRef(0)

  // Limpa fila fictícia quando volta a rede
  useEffect(() => {
    if (online && filaOffline.length) {
      const id = window.setTimeout(() => setFilaOffline([]), 800)
      return () => window.clearTimeout(id)
    }
  }, [online, filaOffline.length])

  // Estorno por toque duplo: desarma sozinho
  useEffect(() => {
    if (!armado) return
    const id = window.setTimeout(() => setArmado(null), 3000)
    return () => window.clearTimeout(id)
  }, [armado])

  const linha = useMemo(() => {
    const ativas = store.dailyPlan.filter((l) => l.projetado > 0 || l.bipado > 0)
    const bipado = ativas.reduce((a, l) => a + l.bipado, 0)
    const projetado = ativas.reduce((a, l) => a + l.projetado, 0)
    return { ativas, bipado, projetado }
  }, [store.dailyPlan])

  const ultimos = useMemo(
    () =>
      store.scans
        .filter((s) => s.tipo === 'produzido')
        .slice()
        .sort((a, b) => b.em.localeCompare(a.em))
        .slice(0, 10),
    [store.scans],
  )

  if (!operador) return <Navigate to="/chao" replace />

  const ler = (serialRaw: string) => {
    const serial = serialRaw.trim().toUpperCase()
    if (!serial) return
    const result = store.registerScan(serial, operador, dispositivo)
    let bipadoHoje: number | undefined
    let projetado: number | undefined
    if (result.ok) {
      const plano = store.dailyPlan.find((l) => l.productId === result.product.id)
      if (plano) {
        bipadoHoje = plano.bipado + result.scan.quantidade
        projetado = plano.projetado
      }
    }
    setPainel({ serial, result, bipadoHoje, projetado })
    if (result.ok) {
      beepOk()
      if (!online) setFilaOffline((f) => [...f, serial])
    } else if (result.motivo === 'desconhecida') beepAviso()
    else beepErro()
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPainel(null), 2000)
  }

  const simular = () => {
    const bipados = new Set(store.scans.filter((s) => s.tipo === 'produzido').map((s) => s.serial))
    const livres = store.labels.filter((l) => l.status === 'impressa' && !bipados.has(l.serial))
    if (!livres.length) return ler('SEM-ETIQUETA-LIVRE')
    ler(livres[Math.floor(Math.random() * livres.length)].serial)
  }
  const simularRepetido = () => {
    const feitos = store.scans.filter((s) => s.tipo === 'produzido')
    if (!feitos.length) return
    ler(feitos[Math.floor(Math.random() * feitos.length)].serial)
  }

  const estornar = (id: string) => {
    if (armado === id) {
      store.reverseScan(id)
      setArmado(null)
      beepAviso()
    } else setArmado(id)
  }

  const pctLinha = linha.projetado ? Math.min(100, Math.round((linha.bipado / linha.projetado) * 100)) : 0

  return (
    <div className="relative px-4 pb-6">
      {/* Linha de hoje */}
      <section className="pt-1">
        <div className="flex items-end justify-between">
          <div className="text-[13px] font-medium uppercase tracking-wide text-slate-400">Linha de hoje</div>
          <div className="text-[15px] tabular-nums">
            <span className="text-xl font-semibold text-teal-300">{num(linha.bipado)}</span>
            <span className="text-slate-400"> / {num(linha.projetado)}</span>
          </div>
        </div>
        <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-teal-400 transition-all" style={{ width: `${pctLinha}%` }} />
        </div>
        <div className="mt-2 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {linha.ativas.map((l) => {
            const p = product(l.productId)
            if (!p) return null
            const completo = l.bipado >= l.projetado && l.projetado > 0
            return (
              <span
                key={l.productId}
                className={cx(
                  'shrink-0 rounded-full border px-3 py-1.5 text-[13px] tabular-nums',
                  completo ? 'border-teal-500/50 bg-teal-500/10 text-teal-200' : 'border-slate-700 bg-slate-900 text-slate-300',
                )}
              >
                <span className="font-mono">{p.sku}</span>
                <span className="text-slate-500"> · {p.atributos.cor ?? ''} </span>
                <span className="font-semibold">
                  {l.bipado}/{l.projetado}
                </span>
              </span>
            )
          })}
        </div>
      </section>

      {/* Offline */}
      {!online && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[14px] text-amber-200">
          <CloudOff size={18} />
          Sem rede · <strong>{filaOffline.length}</strong> pendente{filaOffline.length === 1 ? '' : 's'} offline — os bipes ficam guardados neste aparelho.
        </div>
      )}

      {/* Leitor */}
      <section className="mt-4">
        <Scanner formats={FORMATOS} onRead={ler} placeholder="Serial da etiqueta…" hint="Leitor Bluetooth: aponte e dispare, o Enter confirma." />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={simular} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 text-[15px] font-medium text-slate-200 active:bg-slate-800">
            <Shuffle size={18} /> Simular bipe
          </button>
          <button type="button" onClick={simularRepetido} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 text-[15px] font-medium text-slate-200 active:bg-slate-800">
            <Repeat size={18} /> Simular repetido
          </button>
        </div>
      </section>

      {/* Últimos bipes */}
      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-medium uppercase tracking-wide text-slate-400">Últimos bipes</h2>
          <span className="text-[12px] text-slate-500">{operador} · {dispositivo}</span>
        </div>
        {ultimos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-[14px] text-slate-500">Nenhum bipe ainda hoje.</div>
        ) : (
          <ul className="space-y-2">
            {ultimos.map((s) => {
              const p = product(s.productId)
              const arm = armado === s.id
              return (
                <li key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                  <div className="w-12 shrink-0 text-[13px] tabular-nums text-slate-400">{horaBR(s.em)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">
                      {p?.nome ?? '—'} <span className="text-slate-400">· {p?.atributos.cor}</span>
                    </div>
                    <div className="truncate font-mono text-[12px] text-slate-500">…{s.serial.slice(-10)} · {s.operador}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => estornar(s.id)}
                    className={cx(
                      'flex h-12 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                      arm ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-300 active:bg-slate-700',
                    )}
                  >
                    <Undo2 size={16} />
                    {arm ? 'Confirmar' : 'Estornar'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Painel de resultado */}
      {painel && <ResultadoPainel painel={painel} onClose={() => setPainel(null)} />}
    </div>
  )
}

function ResultadoPainel({ painel, onClose }: { painel: Painel; onClose: () => void }) {
  const r = painel.result
  const produto = r.product
  const cfg = r.ok
    ? { bg: 'bg-emerald-600', titulo: 'SUCESSO', Icon: CheckCircle2 }
    : r.motivo === 'ja_bipado'
      ? { bg: 'bg-red-600', titulo: 'JÁ BIPADO', Icon: XCircle }
      : r.motivo === 'anulada'
        ? { bg: 'bg-red-700', titulo: 'ETIQUETA ANULADA', Icon: Ban }
        : { bg: 'bg-amber-500', titulo: 'DESCONHECIDA', Icon: AlertTriangle }
  return (
    <div className={cx('fixed inset-x-0 top-12 z-40 mx-3 rounded-2xl p-5 text-white shadow-2xl', cfg.bg)} role="status" onClick={onClose}>
      <div className="flex items-center gap-3">
        <cfg.Icon size={44} strokeWidth={2.5} />
        <div className="text-3xl font-black tracking-tight">{cfg.titulo}</div>
      </div>
      {produto ? (
        <div className="mt-3">
          <div className="text-2xl font-semibold leading-tight">{produto.nome}</div>
          <div className="mt-1 text-xl font-bold uppercase tracking-wide">{produto.atributos.cor ?? '—'}</div>
          <div className="mt-1 font-mono text-[15px] opacity-90">{produto.sku}</div>
          {r.ok && painel.bipadoHoje !== undefined && (
            <div className="mt-2 text-[17px] font-medium opacity-95">
              {num(painel.bipadoHoje)} de {num(painel.projetado ?? 0)} hoje
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <div className="text-[17px] font-medium">Etiqueta não cadastrada neste Prodio.</div>
          <div className="mt-1 font-mono text-[14px] opacity-90 break-all">{painel.serial}</div>
        </div>
      )}
    </div>
  )
}
