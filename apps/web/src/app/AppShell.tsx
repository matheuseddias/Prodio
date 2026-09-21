import { Bell, ChevronDown, Menu, Moon, ScanLine, Sun, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { useStore } from '../domain/store'
import { relativo } from '../domain/format'
import { Badge, Button, cx } from '../ui'
import { NAV } from './nav'
import { useTheme } from './theme'

function Logo() {
  return (
    <Link to="/painel" className="flex items-center gap-2.5 px-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-teal-300 font-bold dark:bg-teal-300 dark:text-slate-900">P</span>
      <span className="font-semibold tracking-tight">Prodio</span>
    </Link>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { tenant } = useStore()
  return (
    <div className="flex h-full flex-col">
      <div className="h-14 flex items-center px-3">
        <Logo />
      </div>
      <div className="px-3 pb-3">
        <button className="w-full flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2">
          <span className="truncate">
            <span className="block text-[11px] text-muted">Empresa</span>
            <span className="block font-medium truncate">{tenant.nome}</span>
          </span>
          <ChevronDown size={16} className="text-faint" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
        {NAV.map((g, i) => (
          <div key={i}>
            {g.label && <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                        isActive ? 'bg-accent-soft text-accent-text font-medium' : 'text-muted hover:bg-surface-2 hover:text-text',
                      )
                    }
                  >
                    <it.icon size={17} />
                    <span className="truncate">{it.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <Link to="/chao" className="flex items-center gap-2.5 rounded-lg bg-slate-900 px-3 py-2.5 text-sm text-white hover:bg-slate-800 dark:bg-teal-300 dark:text-slate-900">
          <ScanLine size={17} />
          <span>Abrir modo chão de fábrica</span>
        </Link>
      </div>
    </div>
  )
}

function Notifications() {
  const { notifications, markNotification } = useStore()
  const [open, setOpen] = useState(false)
  const naoLidas = notifications.filter((n) => !n.lida).length
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Notificações">
        <Bell size={18} />
        {naoLidas > 0 && <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{naoLidas}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[360px] max-w-[90vw] rounded-xl border border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="font-medium text-sm">Avisos</span>
              <span className="text-[12px] text-muted">{naoLidas} não lidos</span>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id} className={cx('px-4 py-3 border-b border-border/60 text-sm', !n.lida && 'bg-accent-soft/30')}>
                  <div className="flex items-start gap-2">
                    <Badge tone={n.tipo === 'minimo' ? 'warn' : n.tipo === 'oc_atrasada' ? 'danger' : n.tipo === 'conector' ? 'danger' : 'info'}>
                      {{ minimo: 'Mínimo', oc_atrasada: 'OC', nfe: 'NF-e', conector: 'Conector', cadastro: 'Cadastro' }[n.tipo]}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div>{n.texto}</div>
                      <div className="text-[12px] text-muted mt-0.5">{relativo(n.em)}</div>
                    </div>
                    {!n.lida && (
                      <button onClick={() => markNotification(n.id)} className="text-[12px] text-accent-text hover:underline shrink-0">
                        ok
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

export default function AppShell() {
  const [open, setOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const loc = useLocation()
  const { members } = useStore()
  const me = members[0]
  return (
    <div className="h-full flex bg-bg">
      <aside className="hidden lg:block w-[248px] shrink-0 border-r border-border bg-surface">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[280px] bg-surface border-r border-border shadow-xl">
            <button className="absolute right-3 top-3 text-muted" onClick={() => setOpen(false)} aria-label="Fechar menu">
              <X size={18} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 flex items-center gap-2 border-b border-border bg-surface px-4 no-print">
          <button className="lg:hidden rounded-lg p-2 text-muted hover:bg-surface-2" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu size={18} />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Alternar tema">
            {document.documentElement.classList.contains('dark') ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Notifications />
          <div className="ml-1 flex items-center gap-2 pl-2 border-l border-border">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent-text text-[12px] font-semibold">
              {me.nome
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="hidden sm:block text-sm leading-tight">
              <span className="block font-medium">{me.nome}</span>
              <span className="block text-[11px] text-muted capitalize">{me.papel}</span>
            </span>
          </div>
        </header>
        <main key={loc.pathname} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 py-5 sm:py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
