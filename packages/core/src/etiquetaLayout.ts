// Desenho de uma etiqueta num tamanho (label_sizes): QR ao lado ou acima do texto, lado do QR em pontos inteiros
// da impressora (módulo nítido no dpi dela) e a maior fonte que cabe. Regra: serial, SKU e o cabeçalho (Montagem,
// Caixa · contém N) nunca são cortados; título, nome e instrução podem ser abreviados ou sair, sempre com aviso.
// Quando nem o essencial cabe, `cabe` é false e `erros` diz o que falta. A tela desenha exatamente o que sai daqui
// (EtiquetaImpressa.tsx), com fonte de largura conhecida: as medidas são estimativas conservadoras.
import { areaUtilMm } from './etiquetaTamanhos'
import type { LabelKind, LabelSize } from './tipos'

export const PT_MM = 25.4 / 72
export const ALTURA_LINHA = 1.2
export const FONTE_MIN_PT = 5
export const FONTE_MAX_PT = 14
/** Abaixo disto o texto é difícil de ler a olho: o desenho prefere abreviar a encolher mais. */
export const FONTE_CONFORTO_PT = 6.5
const FONTE_BOA_PT = 9
/** Módulo (quadradinho) do QR: 0,25 mm é o mínimo que leitor e câmera aceitam; 0,6 mm já lê de longe. */
export const MODULO_MIN_MM = 0.25
const MODULO_BOM_MM = 0.6
const MODULO_CONFORTO_MM = 0.33
const PONTOS_MIN_POR_MODULO = 2
const PASSO_FONTE = 0.25
/** Largura média de um caractere monoespaçado (DejaVu Sans Mono, Menlo, SF Mono: 0,60 em), com folga. */
export const LARGURA_MONO_EM = 0.61

export type ChaveLinha = 'cabecalho' | 'titulo' | 'nome' | 'sku' | 'serial' | 'instrucao' | 'contador'
export interface EstiloTexto {
  negrito?: boolean
  mono?: boolean
  caixaAlta?: boolean
}
export interface LinhaConteudo extends EstiloTexto {
  chave: ChaveLinha
  texto: string
  escala: number // em relação à fonte base
  essencial?: boolean // não pode ser cortado nem sair
  maxLinhas: number
  /** Liberado por uma etapa: o texto pode sair abreviado (reticências) nas linhas que tem. */
  podeAbreviar?: boolean
}
export interface ConteudoEtiqueta {
  qr: string
  linhas: LinhaConteudo[]
}
export interface LinhaDesenhada extends LinhaConteudo {
  fontePt: number
  abreviada: boolean // o texto passa das linhas permitidas: sai com reticências
}
export interface LayoutEtiqueta {
  cabe: boolean
  girada: boolean
  disposicao: 'lado' | 'empilhado'
  caixaMm: { largura: number; altura: number } // área útil, na direção de leitura
  qr: { ladoMm: number; versao: number; modulos: number; pontosPorModulo: number; moduloMm: number }
  vaoMm: number // entre o QR e o texto
  textoMm: { largura: number; altura: number; usada: number }
  fontePt: number
  linhas: LinhaDesenhada[]
  avisos: string[]
  erros: string[]
}

// --- QR ------------------------------------------------------------------------------------------------------
// Palavras de dados no nível M (ISO 18004), versões 1 a 15: a mesma escolha do qrcode.react (qrcodegen).
const PALAVRAS_M = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415]
const ALFANUMERICO = /^[0-9A-Z $%*+./:-]*$/

const bytesUtf8 = (t: string): number => [...t].reduce((a, c) => { const cp = c.codePointAt(0) ?? 0; return a + (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4) }, 0)

/** Versão do QR (nível M) para o texto, pelo modo que o qrcodegen escolhe (numérico, alfanumérico ou bytes). */
export function versaoQr(texto: string): number {
  const n = [...texto].length
  for (let v = 1; v <= PALAVRAS_M.length; v++) {
    const bits = /^[0-9]*$/.test(texto)
      ? 4 + (v < 10 ? 10 : 12) + 10 * Math.floor(n / 3) + [0, 4, 7][n % 3]
      : ALFANUMERICO.test(texto)
        ? 4 + (v < 10 ? 9 : 11) + 11 * Math.floor(n / 2) + 6 * (n % 2)
        : 4 + (v < 10 ? 8 : 16) + 8 * bytesUtf8(texto)
    if (bits <= PALAVRAS_M[v - 1] * 8) return v
  }
  return PALAVRAS_M.length + 1 // longe do que um serial alcança; o desenho acusa QR pequeno
}
export const modulosDaVersao = (v: number): number => 17 + 4 * v

// --- Largura de texto -------------------------------------------------------------------------------------------
// Larguras em em de uma sem serifa (Arial/Helvetica/Liberation Sans), arredondadas para cima.
const MAIUSCULAS: Record<string, number> = { I: 0.28, J: 0.51, M: 0.84, W: 0.95 }
const MINUSCULAS: Record<string, number> = { i: 0.23, j: 0.23, l: 0.23, f: 0.29, t: 0.29, r: 0.34, m: 0.84, w: 0.73 }

/** Largura do texto em em (multiplique pelo corpo da fonte). Conservadora: prefere sobrar a cortar. */
export function larguraEm(texto: string, e: EstiloTexto = {}): number {
  const t = e.caixaAlta ? texto.toLocaleUpperCase('pt-BR') : texto
  if (e.mono) return [...t].length * LARGURA_MONO_EM
  let soma = 0
  for (const bruto of t) {
    const c = bruto.normalize('NFD')[0] ?? bruto
    if (c >= 'A' && c <= 'Z') soma += MAIUSCULAS[c] ?? 0.73
    else if (c >= 'a' && c <= 'z') soma += MINUSCULAS[c] ?? 0.57
    else if (c >= '0' && c <= '9') soma += 0.57
    else if (" .,:;·/'|!".includes(c)) soma += 0.29
    else if ('-()[]'.includes(c)) soma += 0.34
    else soma += 0.62
  }
  return soma * (e.negrito ? 1.08 : 1) * 1.04
}

// Largura em em por texto e estilo: o desenho mede as mesmas linhas centenas de vezes (fonte × QR × etapa).
const cacheEm = new Map<string, number>()
function emDaLinha(l: LinhaConteudo): number {
  const chave = `${l.mono ? 1 : 0}${l.negrito ? 1 : 0}${l.caixaAlta ? 1 : 0}${l.texto}`
  let v = cacheEm.get(chave)
  if (v === undefined) {
    if (cacheEm.size > 5000) cacheEm.clear()
    v = larguraEm(l.texto, l)
    cacheEm.set(chave, v)
  }
  return v
}

/** Quantas linhas o texto ocupa numa largura (monoespaçado quebra em qualquer letra; o resto, por palavra). */
function linhasNecessarias(l: LinhaConteudo, pt: number, larguraMm: number): number {
  if (larguraMm <= 0) return Infinity
  if (l.mono) {
    const porLinha = Math.floor(larguraMm / (LARGURA_MONO_EM * pt * PT_MM) + 1e-9)
    return porLinha < 1 ? Infinity : Math.max(1, Math.ceil([...l.texto].length / porLinha))
  }
  const w = emDaLinha(l) * pt * PT_MM
  if (w <= larguraMm + 1e-9) return 1
  return Math.ceil((w * 1.12) / larguraMm) // quebra por palavra desperdiça o fim da linha
}

interface Medida {
  ok: boolean
  altura: number
  linhas: LinhaDesenhada[]
}
function medir(linhas: LinhaConteudo[], larguraMm: number, alturaMm: number, base: number): Medida {
  let altura = 0
  let ok = true
  const out: LinhaDesenhada[] = []
  for (const l of linhas) {
    const pt = base * l.escala
    const precisa = linhasNecessarias(l, pt, larguraMm)
    if ((l.essencial || !l.podeAbreviar) && precisa > l.maxLinhas) ok = false
    altura += Math.min(precisa, l.maxLinhas) * ALTURA_LINHA * pt * PT_MM
    out.push({ ...l, fontePt: arred(pt, 100), maxLinhas: Math.min(precisa, l.maxLinhas), abreviada: precisa > l.maxLinhas })
  }
  return { ok: ok && altura <= alturaMm + 1e-9, altura, linhas: out }
}

/**
 * Maior fonte base (passos de 0,25 pt) em que as linhas cabem na área; null se nem a mínima cabe. Caber é
 * monótono na fonte (fonte menor nunca ocupa mais), então a busca é binária.
 */
function maiorFonte(linhas: LinhaConteudo[], larguraMm: number, alturaMm: number): (Medida & { fonte: number }) | null {
  const passos = Math.round((FONTE_MAX_PT - FONTE_MIN_PT) / PASSO_FONTE)
  const fonte = (i: number) => FONTE_MIN_PT + i * PASSO_FONTE
  let achado: (Medida & { fonte: number }) | null = null
  let lo = 0
  let hi = passos
  while (lo <= hi) {
    const meio = (lo + hi) >> 1
    const m = medir(linhas, larguraMm, alturaMm, fonte(meio))
    if (m.ok) {
      achado = { ...m, fonte: fonte(meio) }
      lo = meio + 1
    } else hi = meio - 1
  }
  return achado
}

// --- Etapas: o que se abre mão, nesta ordem, quando o conteúdo não cabe confortável ------------------------------
type Etapa = (ls: LinhaConteudo[]) => LinhaConteudo[]
const limitar = (chave: ChaveLinha, n: number): Etapa => (ls) => ls.map((l) => (l.chave === chave ? { ...l, maxLinhas: Math.min(l.maxLinhas, n), podeAbreviar: true } : l))
const tirar = (chave: ChaveLinha): Etapa => (ls) => ls.filter((l) => l.chave !== chave)
const quebrar = (chaves: ChaveLinha[]): Etapa => (ls) => ls.map((l) => (chaves.includes(l.chave) ? { ...l, maxLinhas: Math.max(l.maxLinhas, 2) } : l))
// Antes de qualquer etapa tudo tem de caber inteiro; cada etapa libera um corte a mais.
const ETAPAS: Etapa[] = [
  limitar('nome', 1),
  limitar('titulo', 1),
  limitar('instrucao', 2),
  tirar('contador'),
  limitar('instrucao', 1),
  tirar('nome'),
  quebrar(['serial', 'sku']),
  tirar('titulo'),
]

const arred = (n: number, f = 100) => Math.round(n * f) / f
const mmBR = (n: number) => `${String(arred(n, 10)).replace('.', ',')} mm`
const ptBR = (n: number) => `${String(arred(n, 100)).replace('.', ',')} pt`

interface Candidato extends Medida {
  fonte: number
  disposicao: 'lado' | 'empilhado'
  pontos: number
  ladoQr: number
  moduloMm: number
  vao: number
  texto: { largura: number; altura: number }
  nota: number
}

/** Desenha a etiqueta: escolhe disposição, QR e fonte. Puro e determinístico. */
export function layoutDaEtiqueta(tamanho: Pick<LabelSize, 'larguraMm' | 'alturaMm' | 'margemMm' | 'orientacao' | 'dpi'>, conteudo: ConteudoEtiqueta): LayoutEtiqueta {
  const caixa = areaUtilMm(tamanho)
  const versao = versaoQr(conteudo.qr)
  const modulos = modulosDaVersao(versao)
  const mmPorPonto = 25.4 / tamanho.dpi
  const pontosMin = Math.max(PONTOS_MIN_POR_MODULO, Math.ceil(MODULO_MIN_MM / mmPorPonto - 1e-9))
  const pontosMax = Math.floor(Math.min(caixa.largura, caixa.altura) / (modulos * mmPorPonto))
  const menorLado = Math.max(1e-9, Math.min(caixa.largura, caixa.altura))
  // Horizontal favorece o QR ao lado; alta e estreita, o QR em cima. As duas são tentadas.
  const disposicoes: ('lado' | 'empilhado')[] = caixa.largura >= caixa.altura * 0.9 ? ['lado', 'empilhado'] : ['empilhado', 'lado']

  const candidatos = (linhas: LinhaConteudo[]): Candidato[] => {
    const out: Candidato[] = []
    for (const disposicao of disposicoes) {
      for (let pontos = pontosMax; pontos >= pontosMin; pontos--) {
        const moduloMm = pontos * mmPorPonto
        const ladoQr = modulos * moduloMm
        const vao = Math.max(1, 2 * moduloMm)
        const texto = disposicao === 'lado' ? { largura: caixa.largura - ladoQr - vao, altura: caixa.altura } : { largura: caixa.largura, altura: caixa.altura - ladoQr - vao }
        if (texto.largura <= 0 || texto.altura <= 0) continue
        const m = maiorFonte(linhas, texto.largura, texto.altura)
        if (!m) continue
        const nota = Math.min(moduloMm / MODULO_BOM_MM, 1) + Math.min(m.fonte / FONTE_BOA_PT, 1) + (0.1 * ladoQr) / menorLado
        out.push({ ...m, disposicao, pontos, ladoQr, moduloMm, vao, texto, nota })
      }
    }
    return out
  }
  const melhor = (cs: Candidato[]) => cs.reduce<Candidato | null>((a, c) => (!a || c.nota > a.nota + 1e-9 ? c : a), null)

  // Etapas cumulativas: vence a primeira em que fonte e QR ficam confortáveis (fonte ≥ 6,5 pt, módulo ≥ 0,33 mm);
  // sem conforto em nenhuma, a primeira em que o essencial cabe.
  let linhas = conteudo.linhas
  let escolhido: Candidato | null = null
  let reserva: Candidato | null = null
  const vistas = new Set<string>()
  for (let e = 0; e <= ETAPAS.length && !escolhido; e++) {
    if (e > 0) linhas = ETAPAS[e - 1](linhas)
    const chave = JSON.stringify(linhas.map((l) => [l.chave, l.maxLinhas, !!l.podeAbreviar]))
    if (vistas.has(chave)) continue
    vistas.add(chave)
    const cs = candidatos(linhas)
    escolhido = melhor(cs.filter((c) => c.fonte >= FONTE_CONFORTO_PT && c.moduloMm >= MODULO_CONFORTO_MM - 1e-9))
    reserva ??= melhor(cs)
  }
  const c = escolhido ?? reserva
  if (c) return montar(tamanho, caixa, versao, modulos, conteudo, c)
  return semEspaco(tamanho, caixa, versao, modulos, linhas, pontosMin * mmPorPonto)
}

function montar(t: Pick<LabelSize, 'orientacao'>, caixa: { largura: number; altura: number }, versao: number, modulos: number, conteudo: ConteudoEtiqueta, c: Candidato): LayoutEtiqueta {
  const avisos: string[] = []
  const tem = (k: ChaveLinha) => c.linhas.find((l) => l.chave === k)
  const NOMES: Partial<Record<ChaveLinha, string>> = { titulo: 'a cor/família', nome: 'o nome do produto', contador: 'a contagem (n/total)', instrucao: 'a instrução de montagem' }
  for (const l of conteudo.linhas) {
    const d = tem(l.chave)
    if (!d) avisos.push(`Sem ${NOMES[l.chave] ?? l.chave}: não coube.`)
    else if (d.abreviada) avisos.push(l.chave === 'instrucao' ? `Instrução de montagem cortada em ${d.maxLinhas} linha(s).` : `${l.chave === 'nome' ? 'Nome do produto' : 'Cor/família'} abreviado.`)
    else if (l.essencial && d.maxLinhas > 1 && (l.chave === 'serial' || l.chave === 'sku')) avisos.push(`${l.chave === 'serial' ? 'Serial' : 'SKU'} em ${d.maxLinhas} linhas.`)
  }
  if (c.moduloMm < MODULO_CONFORTO_MM) avisos.push(`QR pequeno (módulo de ${String(arred(c.moduloMm, 100)).replace('.', ',')} mm): leitor de celular pode demorar.`)
  if (c.fonte < FONTE_CONFORTO_PT) avisos.push(`Texto pequeno (${ptBR(c.fonte)}): difícil de ler a olho.`)
  return {
    cabe: true,
    girada: t.orientacao === 'girada',
    disposicao: c.disposicao,
    caixaMm: { largura: arred(caixa.largura), altura: arred(caixa.altura) },
    qr: { ladoMm: arred(c.ladoQr, 1000), versao, modulos, pontosPorModulo: c.pontos, moduloMm: arred(c.moduloMm, 1000) },
    vaoMm: arred(c.vao),
    textoMm: { largura: arred(c.texto.largura), altura: arred(c.texto.altura), usada: arred(c.altura) },
    fontePt: c.fonte,
    linhas: c.linhas,
    avisos,
    erros: [],
  }
}

// Nem o essencial cabe: desenha com o mínimo (QR legível menor, fonte mínima) e explica o que falta.
function semEspaco(t: Pick<LabelSize, 'orientacao' | 'dpi'>, caixa: { largura: number; altura: number }, versao: number, modulos: number, linhas: LinhaConteudo[], moduloMin: number): LayoutEtiqueta {
  const erros: string[] = []
  const ladoQr = modulos * moduloMin
  const vao = Math.max(1, 2 * moduloMin)
  const disposicao = caixa.largura >= caixa.altura * 0.9 ? 'lado' : 'empilhado'
  if (ladoQr > Math.min(caixa.largura, caixa.altura)) erros.push(`O menor QR legível (${mmBR(ladoQr)} a ${t.dpi} dpi) não cabe na área útil (${mmBR(caixa.largura)} × ${mmBR(caixa.altura)}).`)
  const texto = disposicao === 'lado' ? { largura: Math.max(0, caixa.largura - ladoQr - vao), altura: caixa.altura } : { largura: caixa.largura, altura: Math.max(0, caixa.altura - ladoQr - vao) }
  const m = medir(linhas, texto.largura, texto.altura, FONTE_MIN_PT)
  for (const l of m.linhas) {
    if (!l.essencial || !l.abreviada) continue
    const precisa = larguraEm(l.texto, l) * l.fontePt * PT_MM
    const nome = l.chave === 'serial' ? 'O serial' : l.chave === 'sku' ? 'O SKU' : 'O cabeçalho'
    erros.push(`${nome} (${[...l.texto].length} caracteres) precisa de ${mmBR(precisa / l.maxLinhas)} de largura por linha e só há ${mmBR(texto.largura)}.`)
  }
  if (m.altura > texto.altura + 1e-9) erros.push(`O texto precisa de ${mmBR(m.altura)} de altura e só há ${mmBR(texto.altura)}.`)
  if (!erros.length) erros.push('O conteúdo não cabe neste tamanho.')
  return {
    cabe: false,
    girada: t.orientacao === 'girada',
    disposicao,
    caixaMm: { largura: arred(caixa.largura), altura: arred(caixa.altura) },
    qr: { ladoMm: arred(ladoQr, 1000), versao, modulos, pontosPorModulo: Math.round(moduloMin / (25.4 / t.dpi)), moduloMm: arred(moduloMin, 1000) },
    vaoMm: arred(vao),
    textoMm: { largura: arred(texto.largura), altura: arred(texto.altura), usada: arred(m.altura) },
    fontePt: FONTE_MIN_PT,
    linhas: m.linhas,
    avisos: [],
    erros: [...erros, 'Aumente a etiqueta ou diminua a margem.'],
  }
}

// --- Conteúdo -----------------------------------------------------------------------------------------------
/** O que vai numa etiqueta (produto, montagem ou caixa). Mesmo conteúdo que a etiqueta tinha antes dos tamanhos. */
export interface DadosEtiqueta {
  tipo: LabelKind
  serial: string
  sku: string
  nome: string
  titulo: string // cor do produto, ou a família
  detalhe?: string // atributo tamanho (P, 60 cm…)
  quantidade?: number // caixa: unidades que ela contém
  prefixo?: string
  instrucao?: string // montagem
  n?: number
  total?: number
}

export function conteudoDaEtiqueta(d: DadosEtiqueta): ConteudoEtiqueta {
  const linhas: LinhaConteudo[] = []
  if (d.tipo === 'montagem') linhas.push({ chave: 'cabecalho', texto: 'Montagem', escala: 1, negrito: true, caixaAlta: true, essencial: true, maxLinhas: 1 })
  if (d.tipo === 'caixa') linhas.push({ chave: 'cabecalho', texto: `Caixa · contém ${d.quantidade ?? 1} un`, escala: 1, negrito: true, caixaAlta: true, essencial: true, maxLinhas: 2 })
  if (d.titulo.trim()) linhas.push({ chave: 'titulo', texto: d.titulo.trim(), escala: 1.15, negrito: true, caixaAlta: true, maxLinhas: 1 })
  if (d.tipo !== 'montagem' && d.nome.trim()) linhas.push({ chave: 'nome', texto: d.nome.trim(), escala: 1, maxLinhas: 2 })
  linhas.push({ chave: 'sku', texto: d.detalhe?.trim() ? `${d.sku} · ${d.detalhe.trim()}` : d.sku, escala: 0.85, mono: true, essencial: true, maxLinhas: 1 })
  linhas.push({ chave: 'serial', texto: d.tipo === 'montagem' ? `${d.serial}-M` : d.serial, escala: 0.9, mono: true, essencial: true, maxLinhas: 1 })
  if (d.tipo === 'montagem' && d.instrucao?.trim()) linhas.push({ chave: 'instrucao', texto: d.instrucao.trim(), escala: 0.85, maxLinhas: 3 })
  if (d.n && d.total) linhas.push({ chave: 'contador', texto: `${d.n}/${d.total}${d.tipo === 'caixa' && d.prefixo ? ` · ${d.prefixo}` : ''}`, escala: 0.85, maxLinhas: 1 })
  return { qr: d.serial, linhas }
}
