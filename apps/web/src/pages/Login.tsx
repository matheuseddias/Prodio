import { AlertTriangle, ArrowRight, CheckCircle2, Mail, ScanLine } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/auth'
import { Button, Field, Input } from '../ui'

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation()
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [porLink, setPorLink] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const destino = (loc.state as { de?: string } | null)?.de || '/painel'

  // Já autenticado (ou voltou do link mágico): segue para o painel.
  useEffect(() => {
    if (auth.modo === 'supabase' && auth.sessao && !auth.usuario?.anonimo) nav(destino, { replace: true })
  }, [auth.modo, auth.sessao, auth.usuario?.anonimo, nav, destino])

  const entrar = async (e: FormEvent) => {
    e.preventDefault()
    setErro(null)
    setAviso(null)
    if (auth.modo === 'memoria') {
      nav('/painel')
      return
    }
    setOcupado(true)
    try {
      if (porLink) {
        await auth.entrarLink(email)
        setAviso(`Enviamos um link de acesso para ${email.trim()}. Abra o e-mail neste aparelho.`)
      } else {
        await auth.entrarSenha(email, senha)
        nav(destino, { replace: true })
      }
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="min-h-full flex flex-col bg-bg">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-teal-300 text-xl font-bold dark:bg-teal-300 dark:text-slate-900">P</span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Prodio</h1>
            <p className="mt-1 text-sm text-muted">Produção scan-first para a sua fábrica</p>
          </div>

          <form onSubmit={(e) => void entrar(e)} className="bg-surface border border-border rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 space-y-4">
            {auth.modo === 'memoria' && (
              <div className="rounded-lg bg-accent-soft/40 px-3 py-2 text-[12px] text-accent-text">Modo de demonstração: sem Supabase configurado, o botão entra direto com dados de exemplo.</div>
            )}
            <Field label="E-mail">
              <Input type="email" autoComplete="email" placeholder="voce@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} required={auth.modo === 'supabase'} />
            </Field>
            {!porLink && (
              <Field label="Senha">
                <Input type="password" autoComplete="current-password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} required={auth.modo === 'supabase'} />
              </Field>
            )}
            {erro && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger" role="alert">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {erro}
              </div>
            )}
            {aviso && (
              <div className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-[13px] text-ok" role="status">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {aviso}
              </div>
            )}
            <Button type="submit" variant="primary" className="w-full" disabled={ocupado}>
              {porLink ? (
                <>
                  <Mail size={16} /> {ocupado ? 'Enviando…' : 'Enviar link de acesso'}
                </>
              ) : (
                <>
                  {ocupado ? 'Entrando…' : 'Entrar'} <ArrowRight size={16} />
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={() => {
                setPorLink((v) => !v)
                setErro(null)
                setAviso(null)
              }}
              className="block w-full text-center text-[13px] text-accent-text hover:underline"
            >
              {porLink ? 'Entrar com senha' : 'Entrar com link por e-mail'}
            </button>
          </form>

          <p className="mt-6 text-center text-[12px] text-faint">Ao entrar você concorda com os termos de uso e a política de privacidade.</p>
        </div>
      </div>

      <footer className="border-t border-border bg-surface px-4 py-4">
        <div className="mx-auto max-w-sm flex items-center justify-between gap-3 text-sm">
          <span className="text-muted">Operador da linha?</span>
          <Link to="/chao" className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 dark:bg-teal-300 dark:text-slate-900">
            <ScanLine size={16} /> Modo chão de fábrica
          </Link>
        </div>
      </footer>
    </div>
  )
}
