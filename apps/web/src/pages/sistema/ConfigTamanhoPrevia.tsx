// Pré-visualização de um tamanho em escala real (1 mm da tela ≈ 1 mm da etiqueta), com a etiqueta de pior caso dos
// produtos da empresa (maior SKU, maior nome, maior instrução) e as colunas do rolo. Mostra o que o core decidiu:
// lado do QR em pontos da impressora, fonte, o que foi abreviado e o que não cabe.
import { amostraPiorCaso } from '@prodio/core/etiquetaAmostra'
import { conteudoDaEtiqueta, layoutDaEtiqueta } from '@prodio/core/etiquetaLayout'
import { AlertTriangle, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { num } from '../../domain/format'
import type { LabelKind, LabelProfile, LabelSize, Product } from '../../domain/types'
import { Select, cx } from '../../ui'
import { EtiquetaImpressa } from '../producao/EtiquetaImpressa'
import { produtoParaEtiqueta } from '../producao/etiquetasImpressao'
import { NOME_TIPO, ORDEM_TIPOS } from '../producao/etiquetasUtils'

const mm = (n: number, casas = 1) => `${num(n, casas)} mm`

export default function PreviaTamanho({ tamanho, produtos, perfis }: { tamanho: LabelSize; produtos: Product[]; perfis: LabelProfile[] }) {
  const [tipo, setTipo] = useState<LabelKind>('produto')
  const [zoom, setZoom] = useState(1)
  // Pior caso da empresa inteira: o prefixo mais longo, a maior caixa e a maior instrução dos perfis.
  const perfilAmostra = useMemo(
    () => ({
      prefixo: perfis.reduce((a, p) => (p.prefixo.length > a.length ? p.prefixo : a), '') || 'ET',
      unidadesPorCaixa: Math.max(1, ...perfis.map((p) => p.unidadesPorCaixa || 1)),
      instrucaoMontagem: perfis.reduce<string | undefined>((a, p) => ((p.instrucaoMontagem?.length ?? 0) > (a?.length ?? 0) ? p.instrucaoMontagem : a), undefined) ?? 'Fixar alça a 118 mm da borda',
    }),
    [perfis],
  )
  const amostra = useMemo(() => amostraPiorCaso(produtos.map(produtoParaEtiqueta), perfilAmostra, tipo), [produtos, perfilAmostra, tipo])
  const conteudo = useMemo(() => conteudoDaEtiqueta(amostra), [amostra])
  const layout = useMemo(() => layoutDaEtiqueta(tamanho, conteudo), [tamanho, conteudo])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Tipo de etiqueta na prévia">
          {ORDEM_TIPOS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
              className={cx('h-8 rounded-md px-3 text-[13px]', tipo === t ? 'bg-accent-soft font-medium text-accent-text' : 'text-muted hover:bg-surface-2')}
            >
              {NOME_TIPO[t]}
            </button>
          ))}
        </div>
        <Select value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))} className="h-9 w-auto" aria-label="Escala da prévia">
          <option value="1">Tamanho real</option>
          <option value="2">2× (ampliada)</option>
          <option value="3">3× (ampliada)</option>
        </Select>
      </div>

      <div className="overflow-auto rounded-lg bg-surface-2/60 p-4">
        <div className="w-max" style={{ zoom }}>
          <div className="flex" style={{ columnGap: `${tamanho.espacoColunasMm}mm` }}>
            {Array.from({ length: Math.max(1, tamanho.colunas) }, (_, i) => (
              <EtiquetaImpressa key={i} tamanho={tamanho} layout={layout} conteudo={conteudo} tipo={tipo} />
            ))}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        <div>
          <dt className="text-faint">QR</dt>
          <dd className="tabular-nums">
            {mm(layout.qr.ladoMm)} · {layout.disposicao === 'lado' ? 'ao lado' : 'acima'}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Módulo do QR</dt>
          <dd className="tabular-nums">
            {mm(layout.qr.moduloMm, 2)} = {layout.qr.pontosPorModulo} pontos a {tamanho.dpi} dpi
          </dd>
        </div>
        <div>
          <dt className="text-faint">Texto</dt>
          <dd className="tabular-nums">{num(layout.fontePt, 2)} pt</dd>
        </div>
        <div>
          <dt className="text-faint">Área útil</dt>
          <dd className="tabular-nums">
            {mm(layout.caixaMm.largura)} × {mm(layout.caixaMm.altura)}
          </dd>
        </div>
      </dl>

      {layout.erros.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {layout.erros.map((e) => (
            <li key={e} className="flex items-start gap-1.5">
              <XCircle size={14} className="mt-0.5 shrink-0" /> {e}
            </li>
          ))}
        </ul>
      )}
      {layout.avisos.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
          {layout.avisos.map((a) => (
            <li key={a} className="flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {a}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-faint">
        Pior caso dos seus produtos: SKU {amostra.sku}
        {amostra.detalhe ? ` · ${amostra.detalhe}` : ''}, nome “{amostra.nome}”. Na tela, o tamanho real depende do monitor: confira com uma régua na primeira vez.
      </p>
    </div>
  )
}
