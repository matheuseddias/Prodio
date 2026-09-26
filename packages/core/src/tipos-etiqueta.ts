// Tipos de etiqueta: perfil por família e tamanhos cadastrados pela empresa (label_profiles, label_sizes). Em arquivo
// próprio pelo limite de 400 linhas de tipos.ts, que os reexporta.
import type { Id } from './tipos'

// Perfil de etiqueta por família: quais etiquetas saem para cada peça.
export interface LabelProfile {
  familia: string
  prefixo: string
  tipos: LabelKind[] // etiquetas geradas por peça
  unidadesPorCaixa: number
  instrucaoMontagem?: string // texto da etiqueta de processo, quando existir
  /**
   * Tamanho de etiqueta do perfil (label_sizes). `null` = o tamanho padrão da empresa. Ausente = o banco ainda
   * não tem a coluna (migration 20260926000700 pendente): a leitura não traz e a gravação não manda.
   */
  tamanhoId?: Id | null
}
export type LabelKind = 'produto' | 'montagem' | 'caixa'

// Tamanho de etiqueta cadastrado pela empresa (label_sizes). Medidas em mm, como a etiqueta sai da impressora:
// largura atravessa o rolo, altura vai no sentido em que o papel avança.
export type DpiImpressora = 203 | 300 | 600
export type OrientacaoEtiqueta = 'normal' | 'girada' // girada: o conteúdo sai a 90° (etiqueta estreita lida deitada)
export interface LabelSize {
  id: Id
  nome: string
  larguraMm: number
  alturaMm: number
  margemMm: number // área que a impressão não usa, nos quatro lados
  dpi: DpiImpressora
  orientacao: OrientacaoEtiqueta
  colunas: number // etiquetas lado a lado no mesmo rolo (1 a 4)
  espacoColunasMm: number // vão entre as colunas
  padrao: boolean // tamanho de quem não escolheu um (um por empresa)
  preset?: string // '50x30' | '60x40' | '100x50': nasceu de um tamanho de fábrica (continua editável)
}
