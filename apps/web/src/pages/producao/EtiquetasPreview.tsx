// Pré-visualização de impressão, agrupada por tipo na ordem em que a fábrica cola: produto, montagem, caixa.
import { Printer, X } from 'lucide-react'
import { num } from '../../domain/format'
import type { LabelKind } from '../../domain/types'
import { Badge, Button, Card } from '../../ui'
import { EtiquetaImpressa } from './EtiquetaImpressa'
import { NOME_TIPO, type ItemPreview, type Tamanho } from './etiquetas'

export interface GrupoPreview {
  tipo: LabelKind
  itens: ItemPreview[]
}

export function EtiquetasPreview({ grupos, tam, onClose }: { grupos: GrupoPreview[]; tam: Tamanho; onClose: () => void }) {
  const total = grupos.reduce((a, g) => a + g.itens.length, 0)
  return (
    <Card
      className="mt-5 print-area print:border-0 print:shadow-none"
      title={
        <span className="no-print">
          Pré-visualização · {num(total)} etiqueta(s) ·{' '}
          <span className="text-muted font-normal">{grupos.map((g) => `${num(g.itens.length)} ${NOME_TIPO[g.tipo].toLowerCase()}`).join(' · ')}</span>
        </span>
      }
      actions={
        <div className="no-print flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={14} /> Fechar
          </Button>
          <Button variant="primary" size="sm" onClick={() => window.print()}>
            <Printer size={14} /> Imprimir
          </Button>
        </div>
      }
    >
      <div className="space-y-4 print:space-y-0">
        {grupos.map((g) => (
          <section key={g.tipo}>
            <div className="no-print mb-2 flex items-center gap-2 text-[13px]">
              <Badge tone={g.tipo === 'produto' ? 'accent' : g.tipo === 'montagem' ? 'info' : 'neutral'}>{NOME_TIPO[g.tipo]}</Badge>
              <span className="text-muted tabular-nums">{num(g.itens.length)} etiqueta(s)</span>
              {g.tipo === 'montagem' && <span className="text-faint">mesmo serial da etiqueta de produto, sufixo -M</span>}
              {g.tipo === 'caixa' && <span className="text-faint">serial próprio por caixa</span>}
            </div>
            <div className="flex flex-wrap gap-2 print:gap-0 bg-surface-2/40 print:bg-white p-3 print:p-0 rounded-lg">
              {g.itens.map((it) => (
                <EtiquetaImpressa key={`${g.tipo}-${it.label.serial}`} label={it.label} p={it.p} perfil={it.perfil} tipo={g.tipo} n={it.n} total={it.total} tam={tam} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Card>
  )
}
