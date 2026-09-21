import { Delete, Link2, RefreshCw, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth'
import { useChaoSession } from '../../app/MobileShell'
import { aparelhoRegistrado, entrarComPin, parearAparelho } from '../../data/chaoAuth'
import { supabase } from '../../data/supabaseClient'
import { operators as operadoresExemplo } from '../../domain/mock'
import { useStore } from '../../domain/store'
import { cx } from '../../ui'
import { beepErro, beepOk } from './feedback'

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const
type Fase = 'iniciando' | 'parear' | 'pin'

export default function Pin() {
  const { setOperador, dispositivo, setDispositivo } = useChaoSession()
  const auth = useAuth()
  const store = useStore()
  const nav = useNavigate()
  const supa = auth.modo === 'supabase'
  const [fase, setFase] = useState<Fase>(supa ? 'iniciando' : 'pin')
  const [nome, setNome] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const operadores = supa ? store.operators : operadoresExemplo
  const local = store.locations[0]?.nome ?? 'Galpão Vila Galvão'

  const pinRef = useRef('')
  const nomeRef = useRef<string | null>(null)
  useEffect(() => {
    nomeRef.current = nome
  }, [nome])

  // Supabase: sessão anônima do aparelho e verificação do pareamento.
  useEffect(() => {
    if (!supa || !auth.pronto || !supabase) return
    let vivo = true
    ;(async () => {
      try {
        const sessao = auth.sessao ?? (await auth.entrarAnonimo())
        const ap = await aparelhoRegistrado(supabase, sessao.user.id)
        if (!vivo) return
        if (ap) {
          setDispositivo(ap.nome)
          setFase('pin')
        } else setFase('parear')
      } catch (e) {
        if (vivo) {
          setErro((e as Error).message)
          setFase('parear')
        }
      }
    })()
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supa, auth.pronto, auth.sessao?.user.id])

  const falhaPin = (msg: string) => {
    beepErro()
    setShake(true)
    setErro(msg)
    window.setTimeout(() => {
      setShake(false)
      pinRef.current = ''
      setPin('')
    }, 450)
  }

  const validar = async (valor: string) => {
    const n = nomeRef.current
    if (!supa || !supabase) {
      const op = operadoresExemplo.find((o) => o.pin === valor && (!n || o.nome === n))
      if (op) {
        beepOk()
        setOperador(op.nome)
        nav('/chao/bipe', { replace: true })
        return
      }
      return falhaPin(n ? `PIN incorreto para ${n}` : 'PIN não reconhecido')
    }
    setOcupado(true)
    try {
      const op = await entrarComPin(supabase, valor)
      if (n && op.nome !== n) return falhaPin(`Este PIN é de ${op.nome}, não de ${n}`)
      beepOk()
      setOperador(op.nome)
      nav('/chao/bipe', { replace: true })
    } catch (e) {
      falhaPin((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const tecla = (t: string) => {
    if (fase !== 'pin' || ocupado) return
    setErro(null)
    let next = pinRef.current
    if (t === 'C') next = ''
    else if (t === '⌫') next = next.slice(0, -1)
    else if (next.length < 4) next = next + t
    pinRef.current = next
    setPin(next)
    if (next.length === 4) void validar(next)
  }

  const parear = async () => {
    if (!supabase || codigo.trim().length < 4) return
    setOcupado(true)
    setErro(null)
    try {
      await parearAparelho(supabase, codigo)
      await auth.atualizarSessao()
      const s = await supabase.auth.getSession()
      const ap = s.data.session ? await aparelhoRegistrado(supabase, s.data.session.user.id) : null
      if (ap) setDispositivo(ap.nome)
      beepOk()
      setFase('pin')
    } catch (e) {
      beepErro()
      setErro((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  // Teclado físico (leitores/desktop)
  const teclaRef = useRef(tecla)
  useEffect(() => {
    teclaRef.current = tecla
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
      if (/^\d$/.test(e.key)) teclaRef.current(e.key)
      else if (e.key === 'Backspace') teclaRef.current('⌫')
      else if (e.key === 'Escape') teclaRef.current('C')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-950 text-slate-100" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <style>{`@keyframes prodio-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}`}</style>
      <header className="px-5 pt-6 text-center">
        <div className="text-[13px] text-slate-400">
          <span className="font-semibold text-teal-300">Prodio</span> · {dispositivo} · {local}
        </div>
        {fase === 'parear' ? (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">Parear este aparelho</h1>
            <p className="mt-1 text-[15px] text-slate-400">Digite o código gerado em Configurações › Dispositivos.</p>
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{fase === 'iniciando' ? 'Preparando o aparelho…' : nome ? `Olá, ${nome}` : 'Quem está bipando?'}</h1>
            <p className="mt-1 text-[15px] text-slate-400">{fase === 'iniciando' ? 'Verificando o pareamento' : nome ? 'Digite seu PIN de 4 dígitos' : 'Toque no seu nome ou digite o PIN'}</p>
          </>
        )}
      </header>

      {fase === 'iniciando' && (
        <div className="mt-16 flex justify-center text-slate-400" role="status">
          <RefreshCw size={28} className="animate-spin" />
        </div>
      )}

      {fase === 'parear' && (
        <div className="mx-auto mt-8 w-full max-w-xs space-y-3 px-5">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            onKeyDown={(e) => e.key === 'Enter' && void parear()}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="CÓDIGO"
            aria-label="Código de pareamento"
            className="h-16 w-full rounded-2xl border border-slate-700 bg-slate-900 text-center font-mono text-2xl tracking-[0.3em] text-slate-100 placeholder:text-slate-600 focus:border-teal-400 focus:outline-none"
          />
          <button type="button" onClick={() => void parear()} disabled={ocupado || codigo.length < 4} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-teal-500 text-[16px] font-semibold text-slate-950 active:bg-teal-400 disabled:opacity-40">
            <Link2 size={18} /> {ocupado ? 'Pareando…' : 'Parear'}
          </button>
          {erro && <div className="text-center text-[14px] text-red-300">{erro}</div>}
        </div>
      )}

      {fase === 'pin' && (
        <>
          <div className="mt-5 flex flex-wrap justify-center gap-2 px-5">
            {operadores.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setNome((n) => (n === o.nome ? null : o.nome))
                  pinRef.current = ''
                  setPin('')
                  setErro(null)
                }}
                className={cx('flex h-14 items-center gap-2 rounded-full border px-5 text-[16px] font-medium transition-colors', nome === o.nome ? 'border-teal-400 bg-teal-500/15 text-teal-200' : 'border-slate-700 bg-slate-900 text-slate-200 active:bg-slate-800')}
              >
                <User size={18} />
                {o.nome}
              </button>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3" style={shake ? { animation: 'prodio-shake 0.45s cubic-bezier(.36,.07,.19,.97) both' } : undefined}>
            <div className="flex gap-5">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={cx('h-5 w-5 rounded-full border-2 transition-colors', i < pin.length ? (shake ? 'border-red-400 bg-red-400' : 'border-teal-300 bg-teal-300') : 'border-slate-600')} />
              ))}
            </div>
            <div className={cx('h-5 text-[14px]', erro ? 'text-red-300' : 'text-transparent')}>{erro ?? (ocupado ? 'Conferindo…' : '.')}</div>
          </div>

          <div className="mx-auto mt-4 grid w-full max-w-xs grid-cols-3 gap-3 px-5">
            {TECLAS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => tecla(t)}
                aria-label={t === '⌫' ? 'Apagar' : t === 'C' ? 'Limpar' : t}
                className={cx('flex h-[68px] items-center justify-center rounded-2xl text-2xl font-semibold transition-colors select-none', /\d/.test(t) ? 'bg-slate-800 text-slate-100 active:bg-slate-700' : 'bg-slate-900 text-slate-400 active:bg-slate-800')}
              >
                {t === '⌫' ? <Delete size={26} /> : t}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-auto pb-6 pt-8 text-center">
        <Link to="/painel" className="text-[13px] text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline">
          Voltar ao escritório
        </Link>
      </div>
    </div>
  )
}
