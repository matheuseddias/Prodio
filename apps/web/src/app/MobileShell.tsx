import { ClipboardCheck, ScanLine, Truck, LogOut, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { dispositivoLembrado, lembrarDispositivo } from '../data/chaoAuth'
import { useStore } from '../domain/store'
import { cx } from '../ui'
import { useAuth } from './auth'

interface Session {
  operador: string | null
  dispositivo: string
  setOperador: (n: string | null) => void
  setDispositivo: (n: string) => void
  online: boolean
}
const Ctx = createContext<Session>({ operador: null, dispositivo: 'Celular linha 1', setOperador: () => {}, setDispositivo: () => {}, online: true })
export const useChaoSession = () => useContext(Ctx)

export function ChaoProvider({ children }: { children: ReactNode }) {
  const [operador, setOperador] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('prodio.operador')
    } catch {
      return null
    }
  })
  const [dispositivo, setDispositivoState] = useState(() => dispositivoLembrado())
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const set = (n: string | null) => {
    setOperador(n)
    try {
      if (n) sessionStorage.setItem('prodio.operador', n)
      else sessionStorage.removeItem('prodio.operador')
    } catch {
      /* ignore */
    }
  }
  const setDispositivo = (n: string) => {
    setDispositivoState(n)
    lembrarDispositivo(n)
  }
  return <Ctx.Provider value={{ operador, dispositivo, setOperador: set, setDispositivo, online }}>{children}</Ctx.Provider>
}

const TABS = [
  { to: '/chao/bipe', label: 'Bipar', icon: ScanLine },
  { to: '/chao/receber', label: 'Receber', icon: Truck },
  { to: '/chao/inventario', label: 'Contar', icon: ClipboardCheck },
]

function EstadoDados() {
  const { loading, erro, recarregar } = useStore()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-8 text-[15px] text-slate-400" role="status">
        <RefreshCw size={18} className="animate-spin" /> Carregando…
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <AlertTriangle size={32} className="text-amber-300" />
      <div className="text-[16px] font-medium">Não foi possível carregar</div>
      <div className="text-[14px] text-slate-400">{erro}</div>
      <button type="button" onClick={() => void recarregar()} className="mt-2 flex h-14 items-center gap-2 rounded-xl bg-teal-500 px-6 text-[15px] font-semibold text-slate-950 active:bg-teal-400">
        <RefreshCw size={18} /> Tentar de novo
      </button>
    </div>
  )
}

export default function MobileShell() {
  const { operador, setOperador, online, dispositivo } = useChaoSession()
  const { loading, erro, modo, pendentesBipes } = useStore()
  const auth = useAuth()
  const nav = useNavigate()
  const semSessao = modo === 'supabase' && auth.pronto && !auth.sessao
  useEffect(() => {
    if (!operador || semSessao) nav('/chao', { replace: true })
  }, [operador, semSessao, nav])
  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between px-4 h-12 shrink-0">
        <div className="text-sm">
          <span className="text-slate-400">{dispositivo} · </span>
          <span className="font-medium">{operador ?? '—'}</span>
        </div>
        <div className="flex items-center gap-3">
          {pendentesBipes > 0 && <span className="text-[12px] text-amber-300">{pendentesBipes} pendente{pendentesBipes === 1 ? '' : 's'}</span>}
          {!online && (
            <span className="flex items-center gap-1 text-[12px] text-amber-300">
              <WifiOff size={14} /> offline
            </span>
          )}
          <button onClick={() => setOperador(null)} className="text-slate-400 hover:text-white" aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-y-auto">{loading || erro ? <EstadoDados /> : <Outlet />}</main>
      <nav className="shrink-0 grid grid-cols-3 border-t border-slate-800 bg-slate-900" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => cx('flex flex-col items-center justify-center gap-1 py-2.5 text-[12px]', isActive ? 'text-teal-300' : 'text-slate-400')}>
            <t.icon size={22} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
