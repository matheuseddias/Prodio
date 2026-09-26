// Tamanhos de etiqueta cadastráveis (label_sizes): os tamanhos de fábrica, os limites (os mesmos checks da
// migration 20260926000700), a validação com mensagens para a tela, qual tamanho vale para um perfil e como as
// etiquetas se arrumam em colunas no rolo. O desenho de cada etiqueta está em etiquetaLayout.ts.
import type { DpiImpressora, Id, LabelProfile, LabelSize, OrientacaoEtiqueta } from './tipos'

export const DPIS: DpiImpressora[] = [203, 300, 600]
export const ORIENTACOES: OrientacaoEtiqueta[] = ['normal', 'girada']

/** Limites em mm. Espelham os checks de public.label_sizes; mudar aqui pede migration. */
export const LIMITES_TAMANHO = {
  larguraMin: 10,
  larguraMax: 220,
  alturaMin: 10,
  alturaMax: 300,
  margemMax: 10,
  /** O que sobra depois das margens, em cada direção. */
  conteudoMin: 8,
  colunasMax: 4,
  espacoMax: 20,
  /** Largura total do rolo (colunas × largura + vãos): a maior térmica comum imprime 8 polegadas. */
  roloMax: 220,
  nomeMax: 40,
} as const

/** Impressora térmica de 4 polegadas (a mais comum) imprime até ~104-108 mm de largura. */
export const LARGURA_IMPRESSORA_4POL_MM = 108

export type Preset = '50x30' | '60x40' | '100x50'
export const PRESET_PADRAO: Preset = '60x40'

const preset = (p: Preset, larguraMm: number, alturaMm: number): Omit<LabelSize, 'id'> => ({
  nome: nomeDasMedidas(larguraMm, alturaMm),
  larguraMm,
  alturaMm,
  margemMm: 2,
  dpi: 203,
  orientacao: 'normal',
  colunas: 1,
  espacoColunasMm: 0,
  padrao: p === PRESET_PADRAO,
  preset: p,
})

/** Os três tamanhos que eram fixos na tela de Etiquetas. Toda empresa nasce com eles (e pode editar). */
export const PRESETS_TAMANHO: Omit<LabelSize, 'id'>[] = [preset('50x30', 50, 30), preset('60x40', 60, 40), preset('100x50', 100, 50)]

/** Presets com id estável, para quando a empresa ainda não tem tamanhos gravados (banco sem a tabela, modo memória). */
export const presetsComId = (): LabelSize[] => PRESETS_TAMANHO.map((t) => ({ ...t, id: `preset-${t.preset}` }))

/** "60 × 40 mm" (vírgula decimal quando houver). */
export function nomeDasMedidas(larguraMm: number, alturaMm: number): string {
  const f = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
  return `${f(larguraMm)} × ${f(alturaMm)} mm`
}

/** Largura do rolo: as colunas lado a lado com os vãos entre elas. */
export const larguraDoRoloMm = (t: Pick<LabelSize, 'larguraMm' | 'colunas' | 'espacoColunasMm'>): number =>
  t.colunas * t.larguraMm + Math.max(0, t.colunas - 1) * t.espacoColunasMm

/** Área útil de uma etiqueta, já na direção de leitura (girada troca largura e altura). */
export function areaUtilMm(t: Pick<LabelSize, 'larguraMm' | 'alturaMm' | 'margemMm' | 'orientacao'>): { largura: number; altura: number } {
  const l = Math.max(0, t.larguraMm - 2 * t.margemMm)
  const a = Math.max(0, t.alturaMm - 2 * t.margemMm)
  return t.orientacao === 'girada' ? { largura: a, altura: l } : { largura: l, altura: a }
}

const chaveNome = (nome: string) => nome.trim().toLocaleLowerCase('pt-BR')
const numero = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const mm = (n: number) => `${String(Math.round(n * 100) / 100).replace('.', ',')} mm`

/**
 * O que impede gravar o tamanho, em frases para a tela. Vazio = pode gravar. `outros` são os tamanhos já
 * cadastrados (o nome não se repete, sem diferença de maiúscula).
 */
export function validarTamanho(t: Omit<LabelSize, 'id' | 'padrao'> & { id?: Id }, outros: Pick<LabelSize, 'id' | 'nome'>[] = []): string[] {
  const L = LIMITES_TAMANHO
  const erros: string[] = []
  const nome = String(t.nome ?? '').trim()
  if (!nome) erros.push('Dê um nome ao tamanho.')
  else if (nome.length > L.nomeMax) erros.push(`Nome com até ${L.nomeMax} letras.`)
  else if (outros.some((o) => o.id !== t.id && chaveNome(o.nome) === chaveNome(nome))) erros.push(`Já existe um tamanho chamado "${nome}".`)
  const larguraOk = numero(t.larguraMm) && t.larguraMm >= L.larguraMin && t.larguraMm <= L.larguraMax
  const alturaOk = numero(t.alturaMm) && t.alturaMm >= L.alturaMin && t.alturaMm <= L.alturaMax
  if (!larguraOk) erros.push(`Largura entre ${L.larguraMin} e ${L.larguraMax} mm.`)
  if (!alturaOk) erros.push(`Altura entre ${L.alturaMin} e ${L.alturaMax} mm.`)
  if (!numero(t.margemMm) || t.margemMm < 0 || t.margemMm > L.margemMax) erros.push(`Margem entre 0 e ${L.margemMax} mm.`)
  else if (larguraOk && alturaOk && Math.min(t.larguraMm, t.alturaMm) - 2 * t.margemMm < L.conteudoMin) {
    erros.push(`Com margem de ${mm(t.margemMm)} sobram menos de ${L.conteudoMin} mm para imprimir: diminua a margem.`)
  }
  if (!DPIS.includes(t.dpi)) erros.push('Resolução da impressora: 203, 300 ou 600 dpi.')
  if (!ORIENTACOES.includes(t.orientacao)) erros.push('Orientação inválida.')
  if (!Number.isInteger(t.colunas) || t.colunas < 1 || t.colunas > L.colunasMax) erros.push(`De 1 a ${L.colunasMax} etiquetas lado a lado.`)
  if (!numero(t.espacoColunasMm) || t.espacoColunasMm < 0 || t.espacoColunasMm > L.espacoMax) erros.push(`Vão entre colunas de 0 a ${L.espacoMax} mm.`)
  else if (larguraOk && Number.isInteger(t.colunas) && t.colunas >= 1 && t.colunas <= L.colunasMax && larguraDoRoloMm(t) > L.roloMax) {
    erros.push(`O rolo passaria de ${L.roloMax} mm de largura (${mm(larguraDoRoloMm(t))}): menos colunas ou etiqueta mais estreita.`)
  }
  return erros
}

/** Avisos que não impedem gravar: a impressora comum não alcança, margem apertada. */
export function avisosDoTamanho(t: Omit<LabelSize, 'id' | 'padrao'>): string[] {
  const avisos: string[] = []
  const rolo = larguraDoRoloMm(t)
  if (rolo > LARGURA_IMPRESSORA_4POL_MM) avisos.push(`O rolo tem ${mm(rolo)}: impressora de 4 polegadas imprime até ~${LARGURA_IMPRESSORA_4POL_MM} mm.`)
  if (t.margemMm < 1) avisos.push('Margem abaixo de 1 mm: a impressora pode cortar a borda e o QR fica colado no corte.')
  return avisos
}

/** Arredonda para 0,1 mm (o que a tela aceita) sem sair do número. */
export const arredondarMm = (n: number): number => Math.round(n * 10) / 10

/** O tamanho padrão da lista: o marcado, senão o preset 60 × 40, senão o primeiro; sem lista, o preset de fábrica. */
export function tamanhoPadrao(tamanhos: LabelSize[]): LabelSize {
  return tamanhos.find((t) => t.padrao) ?? tamanhos.find((t) => t.preset === PRESET_PADRAO) ?? tamanhos[0] ?? presetsComId().find((t) => t.padrao)!
}

/**
 * Tamanho que vale para um perfil: o escolhido nele (se ainda existe), senão o padrão da empresa. Sem nenhum
 * tamanho gravado, os presets de fábrica.
 */
export function tamanhoDoPerfil(tamanhos: LabelSize[], perfil?: Pick<LabelProfile, 'tamanhoId'> | null): LabelSize {
  const lista = tamanhos.length ? tamanhos : presetsComId()
  const escolhido = perfil?.tamanhoId ? lista.find((t) => t.id === perfil.tamanhoId) : undefined
  return escolhido ?? tamanhoPadrao(lista)
}

/** Etiquetas em linhas de `colunas` (a última pode sair incompleta): cada linha é uma "página" da térmica. */
export function emLinhas<T>(itens: T[], colunas: number): T[][] {
  const n = Math.max(1, Math.floor(colunas) || 1)
  const out: T[][] = []
  for (let i = 0; i < itens.length; i += n) out.push(itens.slice(i, i + n))
  return out
}

/** Quantas linhas do rolo (páginas) e quantas etiquetas em branco sobram na última. */
export function consumoDoRolo(qtd: number, colunas: number): { linhas: number; sobra: number } {
  const n = Math.max(1, Math.floor(colunas) || 1)
  const q = Math.max(0, Math.floor(qtd) || 0)
  const linhas = Math.ceil(q / n)
  return { linhas, sobra: linhas * n - q }
}
