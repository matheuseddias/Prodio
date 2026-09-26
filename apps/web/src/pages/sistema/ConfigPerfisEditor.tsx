// Editor de perfis de etiqueta por família (tenant.perfisEtiqueta): prefixo do serial, etiquetas geradas por peça,
// unidades por caixa, instrução de montagem e o tamanho da etiqueta. Ao lado do tamanho, a conferência do core:
// o pior caso dos produtos da família (maior SKU, maior nome) cabe inteiro nesse tamanho?
import { conferirTamanho, situacaoDaConferencia, type ProdutoEtiqueta } from '@prodio/core/etiquetaAmostra'
import { tamanhoDoPerfil, tamanhoPadrao } from '@prodio/core/etiquetaTamanhos'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Fragment, useMemo } from 'react'
import type { LabelKind, LabelProfile, LabelSize } from '../../domain/types'
import { CampoNumero, Input, Select, cx } from '../../ui'
import { ORDEM_TIPOS, PREFIXO_RE, TIPOS_ETIQUETA } from './ConfigPerfis'

interface Props {
  value: LabelProfile[]
  onChange: (v: LabelProfile[]) => void
  /** Tamanhos da empresa; vazio = banco sem a tabela (a coluna Tamanho não aparece). */
  tamanhos: LabelSize[]
  produtosPorFamilia: Map<string, ProdutoEtiqueta[]>
}

function Conferencia({ perfil, tamanho, produtos }: { perfil: LabelProfile; tamanho: LabelSize; produtos: ProdutoEtiqueta[] }) {
  const s = useMemo(() => situacaoDaConferencia(conferirTamanho(produtos, perfil, tamanho)), [perfil, tamanho, produtos])
  const titulo = s.textos.length ? s.textos.join('\n') : `O maior SKU e o maior nome da família cabem inteiros em ${tamanho.nome}.`
  if (s.nivel === 'erro')
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-danger" title={titulo}>
        <XCircle size={13} /> não cabe
      </span>
    )
  if (s.nivel === 'aviso')
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-warn" title={titulo}>
        <AlertTriangle size={13} /> abrevia
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ok" title={titulo}>
      <CheckCircle2 size={13} /> cabe
    </span>
  )
}

export default function PerfisEtiquetaEditor({ value, onChange, tamanhos, produtosPorFamilia }: Props) {
  const patch = (familia: string, delta: Partial<LabelProfile>) => onChange(value.map((p) => (p.familia === familia ? { ...p, ...delta } : p)))
  const toggleTipo = (p: LabelProfile, tipo: LabelKind) => {
    if (tipo === 'produto') return
    const tipos = p.tipos.includes(tipo) ? p.tipos.filter((t) => t !== tipo) : [...p.tipos, tipo]
    patch(p.familia, { tipos: ORDEM_TIPOS.filter((t) => tipos.includes(t)), instrucaoMontagem: tipos.includes('montagem') ? p.instrucaoMontagem : undefined })
  }
  const comTamanho = tamanhos.length > 0
  const padrao = comTamanho ? tamanhoPadrao(tamanhos) : undefined
  const colunas = comTamanho ? 5 : 4

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        {/* A instrução de montagem vai numa linha própria, na largura toda, só com Montagem ligada. */}
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
              <th className="px-3 py-2 text-left font-medium">Família</th>
              <th className="px-3 py-2 text-left font-medium">Prefixo</th>
              <th className="px-3 py-2 text-left font-medium">Etiquetas geradas</th>
              <th className="px-3 py-2 text-left font-medium">Un./caixa</th>
              {comTamanho && <th className="px-3 py-2 text-left font-medium">Tamanho</th>}
            </tr>
          </thead>
          <tbody>
            {value.map((p) => {
              const prefixoOk = PREFIXO_RE.test(p.prefixo)
              const temMontagem = p.tipos.includes('montagem')
              return (
                <Fragment key={p.familia}>
                  <tr className="border-t border-border/70 align-top">
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">{p.familia}</td>
                    <td className="px-3 py-2">
                      <Input
                        value={p.prefixo}
                        maxLength={3}
                        aria-invalid={!prefixoOk}
                        aria-label={`Prefixo de ${p.familia}`}
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
                      {/* Campo de texto: com type=number, apagar para digitar "6" gravava 1 e virava "16". */}
                      <CampoNumero
                        value={p.unidadesPorCaixa}
                        onChange={(v) => patch(p.familia, { unidadesPorCaixa: v })}
                        inteiro
                        min={1}
                        aria-label={`Unidades por caixa de ${p.familia}`}
                        className={cx('h-9 w-20', !(p.unidadesPorCaixa >= 1) && 'border-danger')}
                      />
                    </td>
                    {comTamanho && (
                      <td className="px-3 py-2">
                        <Select
                          value={p.tamanhoId && tamanhos.some((t) => t.id === p.tamanhoId) ? p.tamanhoId : ''}
                          onChange={(e) => patch(p.familia, { tamanhoId: e.target.value || null })}
                          aria-label={`Tamanho da etiqueta de ${p.familia}`}
                          className="h-9 w-56"
                        >
                          <option value="">Padrão ({padrao?.nome})</option>
                          {tamanhos.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nome}
                            </option>
                          ))}
                        </Select>
                        <div className="mt-1">
                          <Conferencia perfil={p} tamanho={tamanhoDoPerfil(tamanhos, p)} produtos={produtosPorFamilia.get(p.familia) ?? []} />
                        </div>
                      </td>
                    )}
                  </tr>
                  {temMontagem && (
                    <tr className="align-top">
                      <td className="px-3 pb-2.5 pt-0 text-[12px] text-muted whitespace-nowrap">Instrução</td>
                      <td colSpan={colunas - 1} className="px-3 pb-2.5 pt-0">
                        <Input
                          value={p.instrucaoMontagem ?? ''}
                          maxLength={80}
                          onChange={(e) => patch(p.familia, { instrucaoMontagem: e.target.value })}
                          placeholder="Ex.: Fixar alça a 118 mm da borda"
                          aria-label={`Instrução de montagem de ${p.familia}`}
                          className="h-9"
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {value.length === 0 && (
              <tr className="border-t border-border/70">
                <td colSpan={colunas} className="px-3 py-6 text-center text-[13px] text-muted">
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
        {comTamanho && (
          <li className="text-faint">
            Tamanho: a conferência desenha a etiqueta do maior SKU e do maior nome da família no tamanho escolhido. Passe o mouse para ver o que é abreviado.
          </li>
        )}
      </ul>
    </div>
  )
}
