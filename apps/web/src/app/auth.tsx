// Autenticação: sessão do Supabase, memberships do usuário, tenant ativo pela claim
// app_metadata.tenant_id e troca de empresa (set_active_tenant + refreshSession).
// No modo memória tudo fica aberto, como nos dados de exemplo.
import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { mensagemErro } from '../data/erros'
import type { ModoDados } from '../data/repo'
import { modoDados, supabase, tenantDoToken } from '../data/supabaseClient'
import * as mock from '../domain/mock'
import type { Member } from '../domain/types'

export interface TenantResumo {
  id: string
  nome: string
  papel: Member['papel']
}
export interface Usuario {
  id: string
  email?: string
  nome: string
  anonimo: boolean
}
export interface Auth {
  modo: ModoDados
  pronto: boolean
  sessao: Session | null
  usuario: Usuario | null
  tenantId: string | null
  papel: string | null
  tenants: TenantResumo[]
  entrarSenha: (email: string, senha: string) => Promise<void>
  entrarLink: (email: string) => Promise<void>
  entrarAnonimo: () => Promise<Session>
  sair: () => Promise<void>
  trocarTenant: (id: string) => Promise<void>
  atualizarSessao: () => Promise<Session | null>
}

const MEMORIA: Auth = {
  modo: 'memoria',
  pronto: true,
  sessao: null,
  usuario: { id: mock.members[0].id, email: mock.members[0].email, nome: mock.members[0].nome, anonimo: false },
  tenantId: mock.tenant.id,
  papel: 'admin',
  tenants: [{ id: mock.tenant.id, nome: mock.tenant.nome, papel: 'admin' }],
  entrarSenha: async () => {},
  entrarLink: async () => {},
  entrarAnonimo: async () => {
    throw new Error('Modo memória não tem sessão.')
  },
  sair: async () => {},
  trocarTenant: async () => {},
  atualizarSessao: async () => null,
}

const Ctx = createContext<Auth>(MEMORIA)
export const useAuth = () => useContext(Ctx)

interface MembershipRow {
  tenant_id: string
  role: Member['papel']
  nome: string | null
  tenants: { nome: string } | { nome: string }[] | null
}

async function lerTenants(userId: string): Promise<TenantResumo[]> {
  if (!supabase) return []
  const res = await supabase.from('memberships').select('tenant_id,role,nome,tenants(nome)').eq('user_id', userId)
  if (res.error) {
    console.warn('[prodio] memberships:', res.error.message)
    return []
  }
  return ((res.data ?? []) as MembershipRow[]).map((m) => {
    const t = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants
    return { id: m.tenant_id, nome: t?.nome ?? 'Empresa', papel: m.role }
  })
}

function usuarioDaSessao(s: Session | null, tenants: TenantResumo[], nomeMembership?: string): Usuario | null {
  if (!s) return null
  const meta = (s.user.user_metadata ?? {}) as Record<string, unknown>
  const nome = nomeMembership || (typeof meta.nome === 'string' && meta.nome) || (typeof meta.full_name === 'string' && meta.full_name) || s.user.email?.split('@')[0] || (tenants.length ? 'Usuário' : 'Aparelho')
  return { id: s.user.id, email: s.user.email ?? undefined, nome, anonimo: !!s.user.is_anonymous }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (modoDados() === 'memoria') return <Ctx.Provider value={MEMORIA}>{children}</Ctx.Provider>
  return <SupabaseAuth>{children}</SupabaseAuth>
}

function SupabaseAuth({ children }: { children: ReactNode }) {
  const sb = supabase!
  const [pronto, setPronto] = useState(false)
  const [sessao, setSessao] = useState<Session | null>(null)
  const [tenantsPorUsuario, setTenants] = useState<{ uid: string | null; lista: TenantResumo[] }>({ uid: null, lista: [] })
  const [nomes, setNomes] = useState<Record<string, string>>({})

  useEffect(() => {
    let vivo = true
    sb.auth.getSession().then(({ data }) => {
      if (!vivo) return
      setSessao(data.session)
      setPronto(true)
    })
    const { data: sub } = sb.auth.onAuthStateChange((_evento, s) => {
      if (!vivo) return
      setSessao(s)
      setPronto(true)
    })
    return () => {
      vivo = false
      sub.subscription.unsubscribe()
    }
  }, [sb])

  // Memberships mudam com o usuário e quando o token é renovado (troca de tenant, pareamento).
  const tokenTenant = useMemo(() => tenantDoToken(sessao?.access_token), [sessao?.access_token])
  useEffect(() => {
    const uid = sessao?.user.id ?? null
    if (!uid) return
    let vivo = true
    lerTenants(uid).then((t) => {
      if (!vivo) return
      setTenants({ uid, lista: t })
      setNomes(Object.fromEntries(t.map((x) => [x.id, x.nome])))
    })
    return () => {
      vivo = false
    }
  }, [sessao?.user.id, tokenTenant.tenantId])
  // Memberships só valem para o usuário que as carregou (evita mostrar empresas de outra sessão).
  const uidAtual = sessao?.user.id
  const tenants = useMemo(() => (tenantsPorUsuario.uid === uidAtual ? tenantsPorUsuario.lista : []), [tenantsPorUsuario, uidAtual])

  const atualizarSessao = useCallback(async () => {
    const { data, error } = await sb.auth.refreshSession()
    if (error) throw new Error(mensagemErro(error))
    setSessao(data.session)
    return data.session
  }, [sb])

  const value = useMemo<Auth>(
    () => ({
      modo: 'supabase',
      pronto,
      sessao,
      usuario: usuarioDaSessao(sessao, tenants, undefined),
      tenantId: tokenTenant.tenantId,
      papel: tokenTenant.papel,
      tenants: tenants.map((t) => ({ ...t, nome: nomes[t.id] ?? t.nome })),
      entrarSenha: async (email, senha) => {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha })
        if (error) throw new Error(mensagemErro(error))
      },
      entrarLink: async (email) => {
        const { error } = await sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/painel`, shouldCreateUser: false } })
        if (error) throw new Error(mensagemErro(error))
      },
      entrarAnonimo: async () => {
        const atual = (await sb.auth.getSession()).data.session
        if (atual) return atual
        const { data, error } = await sb.auth.signInAnonymously()
        if (error || !data.session) throw new Error(mensagemErro(error ?? 'Não foi possível iniciar a sessão do aparelho.'))
        return data.session
      },
      sair: async () => {
        await sb.auth.signOut()
        setSessao(null)
      },
      trocarTenant: async (id) => {
        const { error } = await sb.rpc('set_active_tenant', { p_tenant_id: id })
        if (error) throw new Error(mensagemErro(error))
        await atualizarSessao()
      },
      atualizarSessao,
    }),
    [sb, pronto, sessao, tenants, nomes, tokenTenant, atualizarSessao],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
