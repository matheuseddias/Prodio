// Editor de perfis de etiqueta por família (tenant.perfisEtiqueta).
import type { LabelKind, LabelProfile } from '../../domain/types'
import { Input, cx } from '../../ui'
import { ORDEM_TIPOS, PREFIXO_RE, TIPOS_ETIQUETA } from './ConfigPerfis'

export default function PerfisEtiquetaEditor({ value, onChange }: { value: LabelProfile[]; onChange: (v: LabelProfile[]) => void }) {
  const patch = (familia: string, delta: Partial<LabelProfile>) => onChange(value.map((p) => (p.familia === familia ? { ...p, ...delta } : p)))
  const toggleTipo = (p: LabelProfile, tipo: LabelKind) => {
    if (tipo === 'produto') return
    const tipos = p.tipos.includes(tipo) ? p.tipos.filter((t) => t !== tipo) : [...p.tipos, tipo]
    patch(p.familia, { tipos: ORDEM_TIPOS.filter((t) => tipos.includes(t)), instrucaoMontagem: tipos.includes('montagem') ? p.instrucaoMontagem : undefined })
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 text-left font-medium">Família</th>
              <th className="px-3 py-2 text-left font-medium">Prefixo</th>
              <th className="px-3 py-2 text-left font-medium">Etiquetas geradas</th>
              <th className="px-3 py-2 text-left font-medium">Un./caixa</th>
              <th className="px-3 py-2 text-left font-medium">Instrução de montagem</th>
            </tr>
          </thead>
          <tbody>
            {value.map((p) => {
              const prefixoOk = PREFIXO_RE.test(p.prefixo)
              const temMontagem = p.tipos.includes('montagem')
              return (
                <tr key={p.familia} className="border-t border-border/70 align-top">
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap">{p.familia}</td>
                  <td className="px-3 py-2">
                    <Input
                      value={p.prefixo}
                      maxLength={3}
                      aria-invalid={!prefixoOk}
                      onChange={(e) => patch(p.familia, { prefixo: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })}
                      className={cx('h-9 w-20 font-mono uppercase', !prefixoOk && 'border-danger focus:ring-danger/40 focus:border-danger')}
                      placeholder="EH"
                    />
                    {!prefixoOk && <div className="mt-1 text-[11px] text-danger">2 a 3 letras</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {TIPOS_ETIQUETA.map((t) => {
                        const on = p.tipos.includes(t.id)
                        const fixo = t.id === 'produto'
                        return (
                          <button
                            key={t.id}
                            type="button"
                            aria-pressed={on}
                            disabled={fixo}
                            title={fixo ? 'Sempre gerada' : t.desc}
                            onClick={() => toggleTipo(p, t.id)}
                            className={cx(
                              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors',
                              on ? 'border-accent bg-accent-soft text-accent-text font-medium' : 'border-border text-muted hover:bg-surface-2',
                              fixo && 'cursor-default',
                            )}
                          >
                            <t.icon size={13} /> {t.label}
                          </button>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min={1}
                      value={p.unidadesPorCaixa}
                      onChange={(e) => patch(p.familia, { unidadesPorCaixa: Math.max(1, Math.round(Number(e.target.value) || 0)) })}
                      className={cx('h-9 w-20', !(p.unidadesPorCaixa >= 1) && 'border-danger')}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {temMontagem ? (
                      <Input
                        value={p.instrucaoMontagem ?? ''}
                        maxLength={80}
                        onChange={(e) => patch(p.familia, { instrucaoMontagem: e.target.value })}
                        placeholder="Ex.: Fixar alça a 118 mm da borda"
                        className="h-9 min-w-[220px]"
                      />
                    ) : (
                      <span className="inline-flex h-9 items-center text-[12px] text-faint">Só com Montagem</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {value.length === 0 && (
              <tr className="border-t border-border/70">
                <td colSpan={5} className="px-3 py-6 text-center text-[13px] text-muted">
                  Nenhuma família cadastrada. Os perfis aparecem conforme os produtos são criados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ul className="space-y-1 text-[12px] text-muted">
        {TIPOS_ETIQUETA.map((t) => (
          <li key={t.id} className="flex items-start gap-1.5">
            <t.icon size={13} className="mt-0.5 shrink-0 text-faint" />
            <span>
              <strong className="font-medium text-text">{t.label}</strong> — {t.desc}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
