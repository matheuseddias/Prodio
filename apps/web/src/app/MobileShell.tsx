import { ClipboardCheck, ScanLine, Truck, LogOut, WifiOff } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { cx } from '../ui'

interface Session {
  operador: string | null
  dispositivo: string
  setOperador: (n: string | null) => void
  online: boolean
}
const Ctx = createContext<Session>({ operador: null, dispositivo: 'Celular linha 1', setOperador: () => {}, online: true })
export const useChaoSession = () => useContext(Ctx)

export function ChaoProvider({ children }: { children: ReactNode }) {
  const [operador, setOperador] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('prodio.operador')
    } catch {
      return null
    }
  })
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
  return <Ctx.Provider value={{ operador, dispositivo: 'Celular linha 1', setOperador: set, online }}>{children}</Ctx.Provider>
}

const TABS = [
  { to: '/chao/bipe', label: 'Bipar', icon: ScanLine },
  { to: '/chao/receber', label: 'Receber', icon: Truck },
  { to: '/chao/inventario', label: 'Contar', icon: ClipboardCheck },
]

export default function MobileShell() {
  const { operador, setOperador, online, dispositivo } = useChaoSession()
  const nav = useNavigate()
  useEffect(() => {
    if (!operador) nav('/chao', { replace: true })
  }, [operador, nav])
  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="flex items-center justify-between px-4 h-12 shrink-0">
        <div className="text-sm">
          <span className="text-slate-400">{dispositivo} · </span>
          <span className="font-medium">{operador ?? '—'}</span>
        </div>
        <div className="flex items-center gap-3">
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
      <main className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </main>
      <nav className="shrink-0 grid grid-cols-3 border-t border-slate-800 bg-slate-900" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => cx('flex flex-col items-center justify-center gap-1 py-2.5 text-[12px]', isActive ? 'text-teal-300' : 'text-slate-400')}
          >
            <t.icon size={22} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
