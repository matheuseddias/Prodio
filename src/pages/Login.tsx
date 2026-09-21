import { ArrowRight, Mail, ScanLine } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '../ui'

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [porLink, setPorLink] = useState(false)

  const entrar = (e: FormEvent) => {
    e.preventDefault()
    nav('/painel')
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

          <form onSubmit={entrar} className="bg-surface border border-border rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-6 space-y-4">
            <Field label="E-mail">
              <Input type="email" autoComplete="email" placeholder="voce@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            {!porLink && (
              <Field label="Senha">
                <Input type="password" autoComplete="current-password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} required />
              </Field>
            )}
            <Button type="submit" variant="primary" className="w-full">
              {porLink ? (
                <>
                  <Mail size={16} /> Enviar link de acesso
                </>
              ) : (
                <>
                  Entrar <ArrowRight size={16} />
                </>
              )}
            </Button>
            <button type="button" onClick={() => setPorLink((v) => !v)} className="block w-full text-center text-[13px] text-accent-text hover:underline">
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
