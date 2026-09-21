import { Delete, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { operators } from '../../domain/mock'
import { useChaoSession } from '../../app/MobileShell'
import { cx } from '../../ui'
import { beepErro, beepOk } from './feedback'

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const

export default function Pin() {
  const { setOperador, dispositivo } = useChaoSession()
  const nav = useNavigate()
  const [nome, setNome] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const pinRef = useRef('')
  const nomeRef = useRef<string | null>(null)
  useEffect(() => {
    nomeRef.current = nome
  }, [nome])

  const validar = (valor: string) => {
    const n = nomeRef.current
    const op = operators.find((o) => o.pin === valor && (!n || o.nome === n))
    if (op) {
      beepOk()
      setOperador(op.nome)
      nav('/chao/bipe', { replace: true })
      return
    }
    beepErro()
    setShake(true)
    setErro(n ? `PIN incorreto para ${n}` : 'PIN não reconhecido')
    window.setTimeout(() => {
      setShake(false)
      pinRef.current = ''
      setPin('')
    }, 450)
  }

  const tecla = (t: string) => {
    setErro(null)
    let next = pinRef.current
    if (t === 'C') next = ''
    else if (t === '⌫') next = next.slice(0, -1)
    else if (next.length < 4) next = next + t
    pinRef.current = next
    setPin(next)
    if (next.length === 4) validar(next)
  }

  // Teclado físico (leitores/desktop)
  const teclaRef = useRef(tecla)
  useEffect(() => {
    teclaRef.current = tecla
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
          <span className="font-semibold text-teal-300">Prodio</span> · {dispositivo} · Galpão Vila Galvão
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{nome ? `Olá, ${nome}` : 'Quem está bipando?'}</h1>
        <p className="mt-1 text-[15px] text-slate-400">{nome ? 'Digite seu PIN de 4 dígitos' : 'Toque no seu nome ou digite o PIN'}</p>
      </header>

      {/* Atalhos de operador */}
      <div className="mt-5 flex justify-center gap-2 px-5">
        {operators.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => {
              setNome((n) => (n === o.nome ? null : o.nome))
              pinRef.current = ''
              setPin('')
              setErro(null)
            }}
            className={cx(
              'flex h-14 items-center gap-2 rounded-full border px-5 text-[16px] font-medium transition-colors',
              nome === o.nome ? 'border-teal-400 bg-teal-500/15 text-teal-200' : 'border-slate-700 bg-slate-900 text-slate-200 active:bg-slate-800',
            )}
          >
            <User size={18} />
            {o.nome}
          </button>
        ))}
      </div>

      {/* Pontos */}
      <div className="mt-8 flex flex-col items-center gap-3" style={shake ? { animation: 'prodio-shake 0.45s cubic-bezier(.36,.07,.19,.97) both' } : undefined}>
        <div className="flex gap-5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cx('h-5 w-5 rounded-full border-2 transition-colors', i < pin.length ? (shake ? 'border-red-400 bg-red-400' : 'border-teal-300 bg-teal-300') : 'border-slate-600')}
            />
          ))}
        </div>
        <div className={cx('h-5 text-[14px]', erro ? 'text-red-300' : 'text-transparent')}>{erro ?? '.'}</div>
      </div>

      {/* Teclado */}
      <div className="mx-auto mt-4 grid w-full max-w-xs grid-cols-3 gap-3 px-5">
        {TECLAS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => tecla(t)}
            aria-label={t === '⌫' ? 'Apagar' : t === 'C' ? 'Limpar' : t}
            className={cx(
              'flex h-[68px] items-center justify-center rounded-2xl text-2xl font-semibold transition-colors select-none',
              /\d/.test(t) ? 'bg-slate-800 text-slate-100 active:bg-slate-700' : 'bg-slate-900 text-slate-400 active:bg-slate-800',
            )}
          >
            {t === '⌫' ? <Delete size={26} /> : t}
          </button>
        ))}
      </div>

      <div className="mt-auto pb-6 pt-8 text-center">
        <Link to="/painel" className="text-[13px] text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline">
          Voltar ao escritório
        </Link>
      </div>
    </div>
  )
}
