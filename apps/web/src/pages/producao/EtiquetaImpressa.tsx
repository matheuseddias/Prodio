// Uma etiqueta física (produto, montagem ou caixa). Sempre branca com texto preto: vai para a impressora térmica.
import { QRCodeSVG } from 'qrcode.react'
import type { Label, LabelKind, LabelProfile, Product } from '../../domain/types'
import { TAMANHOS, type Tamanho } from './etiquetasUtils'

interface Props {
  label: Label
  p: Product
  perfil: LabelProfile
  tipo: LabelKind
  n: number
  total: number
  tam: Tamanho
}

export function EtiquetaImpressa({ label, p, perfil, tipo, n, total, tam }: Props) {
  const t = TAMANHOS[tam]
  const serialTexto = tipo === 'montagem' ? `${label.serial}-M` : label.serial
  return (
    <div
      className="etiqueta box-border flex items-center gap-2 border border-dashed border-border bg-white text-black p-[2mm] overflow-hidden print:border-0"
      style={{ width: `${t.w}mm`, height: `${t.h}mm`, fontSize: `${t.fonte}pt` }}
      data-tipo={tipo}
    >
      <QRCodeSVG value={label.serial} size={t.qr * 3.78} level="M" style={{ width: `${t.qr}mm`, height: `${t.qr}mm`, flexShrink: 0 }} />
      <div className="min-w-0 flex-1 leading-tight">
        {tipo === 'montagem' && <div className="font-bold uppercase tracking-wide">Montagem</div>}
        {tipo === 'caixa' && <div className="font-bold uppercase tracking-wide">Caixa · contém {label.quantidade} un</div>}
        <div className="font-bold uppercase truncate" style={{ fontSize: '1.15em' }}>
          {p.atributos.cor ?? p.familia}
        </div>
        {tipo !== 'montagem' && <div className="truncate">{p.nome}</div>}
        <div className="font-mono opacity-80" style={{ fontSize: '0.85em' }}>
          {p.sku}
          {p.atributos.tamanho && ` · ${p.atributos.tamanho}`}
        </div>
        <div className="font-mono mt-0.5" style={{ fontSize: '0.9em' }}>
          {serialTexto}
        </div>
        {tipo === 'montagem' && perfil.instrucaoMontagem && (
          <div className="mt-0.5 leading-snug" style={{ fontSize: '0.85em' }}>
            {perfil.instrucaoMontagem}
          </div>
        )}
        <div className="tabular-nums opacity-80" style={{ fontSize: '0.85em' }}>
          {n}/{total}
          {tipo === 'caixa' && ` · ${perfil.prefixo}`}
        </div>
      </div>
    </div>
  )
}
