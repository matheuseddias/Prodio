// Componentes compartilhados pelas abas de Configurações.
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { mensagemErro } from '../../data/erros'
import { Button } from '../../ui'

/**
 * Barra de salvar das abas de Configurações.
 *
 * `onSave` pode ser assíncrono, e "Salvo" só aparece quando a promessa resolve; se ela rejeitar, o
 * erro aparece aqui mesmo. Antes o check verde era síncrono: como o store é otimista, ele aparecia
 * igual quando a RPC falhava e igual quando o onSave não persistia nada.
 */
export function SaveBar({ onSave, dirty, aviso }: { onSave: () => void | Promise<void>; dirty: boolean; aviso?: string }) {
  const [ok, setOk] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  const salvar = async () => {
    setSalvando(true)
    setErro(null)
    setOk(false)
    try {
      await onSave()
      if (!vivo.current) return
      setOk(true)
      window.setTimeout(() => vivo.current && setOk(false), 1500)
    } catch (e) {
      if (vivo.current) setErro(mensagemErro(e))
    } finally {
      if (vivo.current) setSalvando(false)
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
      {erro && <span className="mr-auto text-[13px] text-danger">{erro}</span>}
      {aviso && <span className="text-[13px] text-warn">{aviso}</span>}
      {ok && (
        <span className="inline-flex items-center gap-1 text-[13px] text-ok">
          <Check size={14} /> Salvo
        </span>
      )}
      <Button variant="primary" disabled={!dirty || salvando} onClick={() => void salvar()}>
        {salvando ? <Loader2 size={15} className="animate-spin" /> : null}
        {salvando ? 'Salvando…' : 'Salvar alterações'}
      </Button>
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 border-b border-border/70 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-6 sm:items-start">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
