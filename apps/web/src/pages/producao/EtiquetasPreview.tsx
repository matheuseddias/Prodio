// Pré-visualização de impressão em tamanho real, agrupada por tamanho de etiqueta (um rolo por grupo) e, dentro
// dele, na ordem em que a fábrica cola: produto, montagem, caixa. Cada linha do rolo é uma página da térmica.
import { nomeDasMedidas } from '@prodio/core/etiquetaTamanhos'
import { AlertTriangle, Printer, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { num } from '../../domain/format'
import type { LabelKind, LabelSize } from '../../domain/types'
import { Badge, Button, Card } from '../../ui'
import { EtiquetaImpressa } from './EtiquetaImpressa'
import { cssDeImpressao, montarImpressao } from './etiquetasImpressao'
import { NOME_TIPO, ORDEM_TIPOS, type ItemPreview } from './etiquetasUtils'

export interface GrupoPreview {
  tipo: LabelKind
  itens: ItemPreview[]
}

interface Props {
  grupos: GrupoPreview[]
  tamanhos: LabelSize[]
  /** Um tamanho para a impressão toda; sem ele, o do perfil de cada família. */
  tamanhoForcado: string | null
  onClose: () => void
}

export function EtiquetasPreview({ grupos, tamanhos, tamanhoForcado, onClose }: Props) {
  const porTamanho = useMemo(() => montarImpressao(grupos, tamanhos, tamanhoForcado), [grupos, tamanhos, tamanhoForcado])
  const [so, setSo] = useState<number | null>(null)
  const total = porTamanho.reduce((a, g) => a + g.etiquetas.length, 0)
  const naoCabem = porTamanho.reduce((a, g) => a + g.naoCabem, 0)
  const imprimir = (grupo: number | null) => {
    flushSync(() => setSo(grupo))
    window.print()
    setSo(null)
  }
  return (
    <Card
      className="mt-5 print-area print:border-0 print:shadow-none"
      title={
        <span className="no-print">
          Pré-visualização · {num(total)} etiqueta(s) · <span className="text-muted font-normal">{porTamanho.length === 1 ? porTamanho[0].tamanho.nome : `${porTamanho.length} tamanhos`}</span>
        </span>
      }
      actions={
        <div className="no-print flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} /> Fechar
          </Button>
          <Button variant="primary" size="sm" onClick={() => imprimir(null)}>
            <Printer size={14} /> {porTamanho.length > 1 ? 'Imprimir tudo' : 'Imprimir'}
          </Button>
        </div>
      }
    >
      <style>{cssDeImpressao(porTamanho, so)}</style>
      {(porTamanho.length > 1 || naoCabem > 0) && (
        <div className="no-print mb-3 space-y-1.5 text-[13px]">
          {porTamanho.length > 1 && (
            <p className="text-muted">Esta impressão tem {porTamanho.length} tamanhos: troque o rolo entre eles ou imprima um tamanho por vez.</p>
          )}
          {naoCabem > 0 && (
            <p className="flex items-center gap-1.5 text-danger">
              <AlertTriangle size={14} /> {num(naoCabem)} etiqueta(s) não cabem no tamanho escolhido e sairiam cortadas. Ajuste o tamanho em Configurações › Etiquetas.
            </p>
          )}
        </div>
      )}
      <div className="space-y-5 print:space-y-0">
        {porTamanho.map((g, i) => (
          <section key={g.tamanho.id} className="grupo-etq" data-grupo={i}>
            <div className="no-print mb-2 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-medium">{g.tamanho.nome}</span>
              <span className="text-faint">
                {[g.tamanho.nome === nomeDasMedidas(g.tamanho.larguraMm, g.tamanho.alturaMm) ? '' : nomeDasMedidas(g.tamanho.larguraMm, g.tamanho.alturaMm), `${g.tamanho.dpi} dpi`, g.tamanho.colunas > 1 ? `${g.tamanho.colunas} colunas` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {ORDEM_TIPOS.filter((t) => g.porTipo[t]).map((t) => (
                <Badge key={t} tone={t === 'produto' ? 'accent' : t === 'montagem' ? 'info' : 'neutral'}>
                  {num(g.porTipo[t] ?? 0)} {NOME_TIPO[t].toLowerCase()}
                </Badge>
              ))}
              {g.sobra > 0 && <span className="text-faint">{g.sobra} em branco na última linha</span>}
              {porTamanho.length > 1 && (
                <Button size="sm" className="ml-auto" onClick={() => imprimir(i)}>
                  <Printer size={14} /> Imprimir só este tamanho
                </Button>
              )}
            </div>
            {g.erros.length > 0 && <p className="no-print mb-2 text-[12px] text-danger">{g.erros[0]}</p>}
            {g.avisos.length > 0 && (
              <ul className="no-print mb-2 space-y-0.5 text-[12px] text-muted">
                {g.avisos.map((a) => (
                  <li key={a.texto}>
                    {a.texto} <span className="text-faint">({num(a.etiquetas)})</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto rounded-lg bg-surface-2/40 p-3 print:overflow-visible print:bg-white print:p-0">
              {/* Na tela as linhas do rolo se arrumam lado a lado; na impressão cada uma é uma página. */}
              <div className="flex flex-wrap gap-[3mm] print:block">
                {g.linhas.map((linha, k) => (
                  <div key={k} className="linha-etq flex" style={{ columnGap: `${g.tamanho.espacoColunasMm}mm` }}>
                    {linha.map((e) => (
                      <EtiquetaImpressa key={e.chave} tamanho={g.tamanho} layout={e.layout} conteudo={e.conteudo} tipo={e.tipo} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </Card>
  )
}
