import { X, Search, Inbox } from 'lucide-react'
import { useEffect, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-14 px-6 text-base' }[size]
  const variants = {
    primary: 'bg-accent text-white hover:bg-accent-strong dark:text-slate-900',
    secondary: 'bg-surface border border-border text-text hover:bg-surface-2',
    ghost: 'text-muted hover:bg-surface-2 hover:text-text',
    danger: 'bg-danger-soft text-danger hover:brightness-95',
  }[variant]
  return (
    <button className={cx(base, sizes, variants, className)} {...rest}>
      {children}
    </button>
  )
}

export function Card({ className, children, title, actions, padded = true }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={cx('bg-surface border border-border rounded-[var(--radius-card)] shadow-[var(--shadow-card)]', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && (title || actions ? 'px-5 pb-5' : 'p-5'))}>{children}</div>
    </section>
  )
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
    accent: 'bg-accent-soft text-accent-text',
  }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap', tones, className)}>{children}</span>
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  const color = tone && tone !== 'neutral' ? { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', info: 'text-info', accent: 'text-accent-text' }[tone] : ''
  return (
    <div className="bg-surface border border-border rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
        <span className="truncate">{label}</span>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums tracking-tight', color)}>{value}</div>
      {hint && <div className="mt-1 text-[12px] text-muted">{hint}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: string; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        {breadcrumb && <div className="text-[12px] text-muted mb-1">{breadcrumb}</div>}
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent',
        className,
      )}
      {...rest}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx('h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent', className)}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="block text-[13px] font-medium text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-faint mt-1">{hint}</span>}
    </label>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  )
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto -mx-5', className)}>
      <table className="w-full text-sm min-w-[640px]">{children}</table>
    </div>
  )
}
export function Th({ children, className, right }: { children?: ReactNode; className?: string; right?: boolean }) {
  return <th className={cx('text-[12px] font-medium text-muted uppercase tracking-wide px-5 py-2.5 border-b border-border', right ? 'text-right' : 'text-left', className)}>{children}</th>
}
export function Td({ children, className, right, mono }: { children?: ReactNode; className?: string; right?: boolean; mono?: boolean }) {
  return <td className={cx('px-5 py-3 border-b border-border/70 align-middle', right && 'text-right tabular-nums', mono && 'font-mono text-[13px]', className)}>{children}</td>
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="text-faint mb-3">{icon ?? <Inbox size={28} />}</div>
      <div className="font-medium">{title}</div>
      {description && <div className="text-sm text-muted mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size]
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cx('relative w-full bg-surface border border-border rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col', w)}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-text rounded-md p-1" aria-label="Fechar">
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">{footer}</footer>}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          className={cx(
            'px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors',
            value === it.id ? 'border-accent text-text font-medium' : 'border-transparent text-muted hover:text-text',
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-1.5 text-[11px] rounded-full bg-surface-2 px-1.5 py-0.5 text-muted">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Progress({ value, max, tone = 'accent' }: { value: number; max: number; tone?: Tone }) {
  const p = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const color = { neutral: 'bg-faint', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', info: 'bg-info', accent: 'bg-accent' }[tone]
  return (
    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${p}%` }} />
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-mono text-muted">{children}</kbd>
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2">
      <span className={cx('relative h-6 w-11 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  )
}
