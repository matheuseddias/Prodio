// Guarda de rota: no modo Supabase exige sessão (e não-anônima para o escritório);
// no modo memória tudo fica aberto.
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './auth'

export function TelaCarregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="min-h-full flex items-center justify-center bg-bg p-8 text-sm text-muted" role="status">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent mr-2" />
      {texto}
    </div>
  )
}

export default function RotaProtegida({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const loc = useLocation()
  if (auth.modo === 'memoria') return <>{children}</>
  if (!auth.pronto) return <TelaCarregando texto="Verificando sessão…" />
  if (!auth.sessao) return <Navigate to="/login" replace state={{ de: loc.pathname }} />
  if (auth.usuario?.anonimo) return <Navigate to="/chao" replace />
  return <>{children}</>
}
