import { AlertTriangle, Bell, Building2, Check, ChevronDown, LogOut, Menu, Moon, RefreshCw, ScanLine, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { relativo } from '../domain/format'
import { useStore } from '../domain/store'
import { Badge, Button, cx } from '../ui'
import { useAuth } from './auth'
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

/** Seletor de empresa: lista as memberships do usuário e troca o tenant ativo. */
function SeletorEmpresa() {
  const { tenant, tenants, modo } = useStore()
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [trocando, setTrocando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const ativo = auth.tenantId ?? tenant.id
  const lista = tenants.length ? tenants : [{ id: tenant.id, nome: tenant.nome, papel: 'admin' as const }]
  const trocar = async (id: string) => {
    if (id === ativo || modo === 'memoria') return setOpen(false)
    setTrocando(id)
    setErro(null)
    try {
      await auth.trocarTenant(id)
      setOpen(false)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setTrocando(null)
    }
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="relative px-3 pb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-2"
      >
        <span className="truncate">
          <span className="block text-[11px] text-muted">Empresa</span>
          <span className="block font-medium truncate">{tenant.nome || lista.find((t) => t.id === ativo)?.nome || '—'}</span>
        </span>
        <ChevronDown size={16} className="text-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <ul role="listbox" className="absolute left-3 right-3 z-40 mt-1 rounded-lg border border-border bg-surface shadow-xl overflow-hidden">
            {lista.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={t.id === ativo}
                  disabled={trocando !== null}
                  onClick={() => void trocar(t.id)}
                  className={cx('w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2', t.id === ativo && 'bg-accent-soft/40')}
                >
                  <Building2 size={15} className="text-faint shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{t.nome}</span>
                    <span className="block text-[11px] text-muted capitalize">{t.papel}</span>
                  </span>
                  {t.id === ativo ? <Check size={15} className="text-accent-text" /> : trocando === t.id ? <RefreshCw size={14} className="animate-spin text-muted" /> : null}
                </button>
              </li>
            ))}
            {erro && <li className="px-3 py-2 text-[12px] text-danger">{erro}</li>}
          </ul>
        </>
      )}
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="h-14 flex items-center px-3">
        <Logo />
      </div>
      <SeletorEmpresa />
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
                      cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors', isActive ? 'bg-accent-soft text-accent-text font-medium' : 'text-muted hover:bg-surface-2 hover:text-text')
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
              {notifications.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nenhum aviso.</li>}
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

function Usuario() {
  const auth = useAuth()
  const { members, modo } = useStore()
  const nav = useNavigate()
  const nome = auth.usuario?.nome ?? members[0]?.nome ?? 'Usuário'
  const papel = auth.papel ?? members[0]?.papel ?? ''
  const iniciais = nome
    .split(' ')
    .map((x) => x[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const sair = async () => {
    await auth.sair()
    nav('/login', { replace: true })
  }
  return (
    <div className="ml-1 flex items-center gap-2 pl-2 border-l border-border">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-accent-text text-[12px] font-semibold">{iniciais || '?'}</span>
      <span className="hidden sm:block text-sm leading-tight">
        <span className="block font-medium">{nome}</span>
        <span className="block text-[11px] text-muted capitalize">{papel}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={() => void sair()} aria-label="Sair" title={modo === 'memoria' ? 'Sair (modo de demonstração)' : 'Sair'}>
        <LogOut size={16} />
      </Button>
    </div>
  )
}

function TelaEstado({ loading, erro, onRetry }: { loading: boolean; erro: string | null; onRetry: () => void }) {
  return (
    <div className="flex-1 grid place-items-center p-8">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted" role="status">
          <RefreshCw size={16} className="animate-spin" /> Carregando dados da empresa…
        </div>
      ) : (
        <div className="max-w-md text-center space-y-3">
          <AlertTriangle size={28} className="mx-auto text-warn" />
          <div className="font-medium">Não foi possível carregar os dados</div>
          <div className="text-sm text-muted">{erro}</div>
          <Button variant="primary" onClick={onRetry}>
            <RefreshCw size={14} /> Tentar de novo
          </Button>
        </div>
      )}
    </div>
  )
}

function AvisoAcao() {
  const { erroAcao, limparErro } = useStore()
  useEffect(() => {
    if (!erroAcao) return
    const id = window.setTimeout(limparErro, 8000)
    return () => window.clearTimeout(id)
  }, [erroAcao, limparErro])
  if (!erroAcao) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 max-w-[92vw] no-print" role="alert">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-xl">
        <AlertTriangle size={16} className="text-danger shrink-0" />
        <span className="min-w-0">{erroAcao}</span>
        <button onClick={limparErro} className="text-muted hover:text-text" aria-label="Fechar aviso">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

export default function AppShell() {
  const [open, setOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const loc = useLocation()
  const { loading, erro, recarregar } = useStore()
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
          <Usuario />
        </header>
        {loading || erro ? (
          <TelaEstado loading={loading} erro={erro} onRetry={() => void recarregar()} />
        ) : (
          <main key={loc.pathname} className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 py-5 sm:py-6">
              <Outlet />
            </div>
          </main>
        )}
        <AvisoAcao />
      </div>
    </div>
  )
}
