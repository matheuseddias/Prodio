// Uma etiqueta física no tamanho cadastrado (label_sizes), desenhada exatamente como o core calculou
// (layoutDaEtiqueta): QR no lado em pontos inteiros da impressora, fonte e linhas que cabem. Sempre branca com
// texto preto (vai para a térmica), em milímetros reais. Serial e SKU nunca quebram fora do previsto nem cortam;
// título, nome e instrução saem com reticências quando o desenho mandou abreviar.
import { ALTURA_LINHA, type ConteudoEtiqueta, type LayoutEtiqueta, type LinhaDesenhada } from '@prodio/core/etiquetaLayout'
import { QRCodeSVG } from 'qrcode.react'
import type { CSSProperties } from 'react'
import type { LabelSize } from '../../domain/types'

// Fontes com a largura que o core supõe (Arial/Liberation Sans e monoespaçadas de 0,6 em).
const FONTE = "Arial, 'Liberation Sans', Helvetica, sans-serif"
const FONTE_MONO = "'DejaVu Sans Mono', 'Liberation Mono', Menlo, Consolas, 'Courier New', monospace"

interface Props {
  tamanho: Pick<LabelSize, 'larguraMm' | 'alturaMm' | 'margemMm'>
  layout: LayoutEtiqueta
  /** Textos desta etiqueta (serial e contagem mudam de uma para outra; o desenho é o mesmo). */
  conteudo: ConteudoEtiqueta
  /** Contorno tracejado na tela (some na impressão). */
  contorno?: boolean
  tipo?: string
}

function estiloLinha(l: LinhaDesenhada): CSSProperties {
  const base: CSSProperties = {
    fontSize: `${l.fontePt}pt`,
    lineHeight: ALTURA_LINHA,
    fontFamily: l.mono ? FONTE_MONO : FONTE,
    fontWeight: l.negrito ? 700 : 400,
    textTransform: l.caixaAlta ? 'uppercase' : undefined,
    letterSpacing: l.caixaAlta ? '0.01em' : undefined,
  }
  if (l.maxLinhas <= 1) return { ...base, whiteSpace: 'nowrap', overflow: l.essencial ? 'visible' : 'hidden', textOverflow: 'ellipsis' }
  // Mais de uma linha: monoespaçado quebra em qualquer letra (serial, SKU); o resto por palavra, com teto de linhas.
  return {
    ...base,
    overflowWrap: 'anywhere',
    wordBreak: l.mono ? 'break-all' : undefined,
    display: '-webkit-box',
    WebkitLineClamp: l.maxLinhas,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }
}

export function EtiquetaImpressa({ tamanho, layout, conteudo, contorno = true, tipo }: Props) {
  const m = tamanho.margemMm
  const { largura: cw, altura: ch } = layout.caixaMm
  const lado = layout.disposicao === 'lado'
  const textos = new Map(conteudo.linhas.map((l) => [l.chave, l.texto]))
  const area: CSSProperties = {
    position: 'absolute',
    left: `${m}mm`,
    top: `${m}mm`,
    width: `${cw}mm`,
    height: `${ch}mm`,
    display: 'flex',
    flexDirection: lado ? 'row' : 'column',
    alignItems: lado ? 'center' : 'stretch',
    gap: `${layout.vaoMm}mm`,
    // Girada: o conteúdo é desenhado na direção de leitura e virado 90° dentro da etiqueta.
    ...(layout.girada ? { transformOrigin: 'top left', transform: `translateX(${ch}mm) rotate(90deg)` } : {}),
  }
  return (
    <div
      className={`etiqueta relative box-border shrink-0 overflow-hidden bg-white text-black ${contorno ? 'outline outline-1 outline-dashed outline-offset-0 outline-border print:outline-0' : ''}`}
      style={{ width: `${tamanho.larguraMm}mm`, height: `${tamanho.alturaMm}mm` }}
      data-tipo={tipo}
      data-cabe={layout.cabe ? 'sim' : 'nao'}
    >
      <div style={area}>
        <QRCodeSVG
          value={conteudo.qr}
          level="M"
          marginSize={0}
          size={layout.qr.modulos * 4}
          style={{ width: `${layout.qr.ladoMm}mm`, height: `${layout.qr.ladoMm}mm`, flexShrink: 0, alignSelf: lado ? undefined : 'center' }}
        />
        <div style={{ width: `${layout.textoMm.largura}mm`, minWidth: 0 }}>
          {layout.linhas.map((l) => (
            <div key={l.chave} style={estiloLinha(l)} data-linha={l.chave}>
              {textos.get(l.chave) ?? l.texto}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
