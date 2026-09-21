import { Check, Copy, FileKey, KeyRound, Loader2, Mail, ScanSearch } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, Field, Input, Toggle, cx } from '../../ui'
import { emailXml } from '../recebimento/nfeUtils'
import { Nota } from './ConectorCard'

type Provedor = 'focus' | 'nfeio'

const PROVEDORES: { id: Provedor; nome: string; modo: string; desc: string; icone: ReactNode; campos: { k: string; label: string; tipo?: 'password' | 'file'; hint?: string }[] }[] = [
  {
    id: 'focus',
    nome: 'Focus NFe',
    modo: 'Certificado A1 do cliente',
    desc: 'Consulta as NF-e destinadas ao seu CNPJ na SEFAZ (DF-e) com o certificado A1 da empresa. Traz o XML completo, inclusive de notas que nunca chegaram por e-mail.',
    icone: <FileKey size={18} />,
    campos: [
      { k: 'token', label: 'Token da conta Focus', hint: 'Painel Focus NFe → Integrações → Tokens.' },
      { k: 'pfx', label: 'Certificado A1 (.pfx)', tipo: 'file', hint: 'Fica guardado criptografado; só o provedor lê.' },
      { k: 'senha', label: 'Senha do certificado', tipo: 'password' },
    ],
  },
  {
    id: 'nfeio',
    nome: 'NFE.io',
    modo: 'Consulta por chave, sem certificado',
    desc: 'Consulta paga por chave de acesso: não precisa de certificado, cobra por consulta e devolve o XML quando a nota está autorizada.',
    icone: <KeyRound size={18} />,
    campos: [{ k: 'apiKey', label: 'API key', hint: 'Painel NFE.io → Contas → Chaves de API.' }],
  },
]

/** Cartão "Consulta de NF-e por chave": provedor usado quando a chave bipada não está no Prodio. */
export function ConectorNfeProvedor() {
  const { tenant } = useStore()
  const email = emailXml(tenant.nome)
  const [ativo, setAtivo] = useState<Provedor | null>(null)
  const [aberto, setAberto] = useState<Provedor | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [teste, setTeste] = useState<Record<string, 'idle' | 'testando' | 'ok' | 'falhou'>>({})
  const [copiado, setCopiado] = useState(false)

  const set = (k: string, v: string) => setCampos((s) => ({ ...s, [k]: v }))
  const testar = (p: Provedor) => {
    setTeste((t) => ({ ...t, [p]: 'testando' }))
    window.setTimeout(() => {
      const prov = PROVEDORES.find((x) => x.id === p)!
      const ok = prov.campos.every((c) => (campos[c.k] ?? '').trim().length > 0)
      setTeste((t) => ({ ...t, [p]: ok ? 'ok' : 'falhou' }))
    }, 1200)
  }
  const ligar = (p: Provedor, on: boolean) => {
    setAtivo(on ? p : ativo === p ? null : ativo)
    if (on) setAberto(p)
  }
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const provAtivo = PROVEDORES.find((p) => p.id === ativo)

  return (
    <Card
      title="Consulta de NF-e por chave"
      actions={provAtivo ? <Badge tone="ok">{provAtivo.nome} ativo</Badge> : <Badge tone="neutral">sem provedor</Badge>}
    >
      <p className="text-sm text-muted">
        Quando a chave bipada no recebimento não está no Prodio, o provedor busca o XML na hora. Sem provedor, o bipe só encontra notas que já chegaram por e-mail, upload ou ERP.
      </p>

      <div className="mt-4 space-y-3">
        {PROVEDORES.map((p) => {
          const on = ativo === p.id
          const t = teste[p.id] ?? 'idle'
          return (
            <div key={p.id} className={cx('rounded-lg border p-4 transition-colors', on ? 'border-accent bg-accent-soft/30' : 'border-border')}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', on ? 'bg-accent text-white dark:text-slate-900' : 'bg-surface-2 text-muted')}>{p.icone}</span>
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {p.nome} <span className="font-normal text-muted">· {p.modo}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">{p.desc}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {on && (
                    <Button size="sm" variant="ghost" onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                      {aberto === p.id ? 'Ocultar' : 'Credenciais'}
                    </Button>
                  )}
                  <Toggle checked={on} onChange={(v) => ligar(p.id, v)} label={on ? 'Ativo' : 'Inativo'} />
                </div>
              </div>

              {on && aberto === p.id && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {p.campos.map((c) => (
                      <Field key={c.k} label={c.label} hint={c.hint}>
                        {c.tipo === 'file' ? (
                          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2">
                            <FileKey size={14} className="text-muted" />
                            <span className={cx('truncate', !campos[c.k] && 'text-faint')}>{campos[c.k] || 'Escolher arquivo .pfx'}</span>
                            <input type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => set(c.k, e.target.files?.[0]?.name ?? '')} />
                          </label>
                        ) : (
                          <Input type={c.tipo ?? 'text'} value={campos[c.k] ?? ''} onChange={(e) => set(c.k, e.target.value)} className="font-mono" />
                        )}
                      </Field>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button size="sm" onClick={() => testar(p.id)} disabled={t === 'testando'}>
                      {t === 'testando' ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                      {t === 'testando' ? 'Consultando…' : 'Testar'}
                    </Button>
                    {t === 'ok' && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-ok">
                        <Check size={14} /> Consulta de teste devolveu a NF-e 48211 em 0,8 s.
                      </span>
                    )}
                    {t === 'falhou' && <span className="text-[13px] text-danger">Preencha as credenciais antes de testar.</span>}
                  </div>
                  {p.id === 'nfeio' && <Nota tone="warn">Cada consulta é cobrada pelo provedor. O Prodio só consulta quando a chave bipada não existe e ninguém compartilhou o XML.</Nota>}
                </div>
              )}
            </div>
          )
        })}

        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-info-soft text-info">
              <Mail size={18} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold">
                XML por e-mail <Badge tone="ok">sempre ativo</Badge>
              </div>
              <p className="mt-0.5 text-[13px] text-muted">Fornecedor ou contador mandam o XML para este endereço e a nota aparece em segundos. Não depende de provedor.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px]">{email}</code>
            <Button size="sm" onClick={copiar}>
              {copiado ? <Check size={14} /> : <Copy size={14} />}
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
