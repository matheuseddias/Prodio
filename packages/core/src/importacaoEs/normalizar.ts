// Normalização dos valores do backup do ES: números tolerantes, textos, unidades, CNPJ, EAN, NCM e prazo.
// Tudo puro e determinístico: reimportar o mesmo arquivo tem de gerar o mesmo payload, byte a byte.

/** Chaves que nunca viram propriedade de objeto nosso (protótipo). */
export const CHAVE_PROIBIDA = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Número tolerante, equivalente ao `num` do ES: aceita número ou texto com vírgula ou ponto
 * ("0,176", "1.234,56", "10", "R$ 5"). null, "", NaN, infinito e texto sem número contam como ausente.
 */
export function num(x: unknown): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined
  if (typeof x !== 'string') return undefined
  let s = x.trim()
  if (!s || s.length > 40) return undefined
  s = s.replace(/[R$%\s]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.test(s)) return undefined
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : undefined
}

/** Valor presente mas que não é número (ex.: "abc", {}): diferente de ausente. */
export function naoNumerico(x: unknown): boolean {
  if (x === null || x === undefined) return false
  if (typeof x === 'string' && x.trim() === '') return false
  return num(x) === undefined
}

/** Arredonda para a escala da coluna (numeric(14,4) → 4, numeric(14,6) → 6, numeric(8,5) → 5). */
export function arred(v: number, casas: number): number {
  const r = Number(Math.round(Number(`${v}e${casas}`)) + `e-${casas}`)
  return Object.is(r, -0) ? 0 : r
}

/** Corta em até `max` unidades UTF-16 sem partir um par de surrogate (emoji cortado ao meio vira surrogate solto). */
function cortar(s: string, max: number): string {
  if (s.length <= max) return s
  const ultimo = s.charCodeAt(max - 1)
  return s.slice(0, ultimo >= 0xd800 && ultimo <= 0xdbff ? max - 1 : max)
}

/**
 * Troca por espaço o que o jsonb do Postgres recusa (e que derrubaria o payload INTEIRO na RPC): caractere
 * nulo (\u0000) e surrogate solto — o JSON.parse aceita os dois e o JSON.stringify os devolve como escape.
 * Os outros caracteres de controle vão junto (tab e quebra de linha já viravam espaço).
 */
function semInvalidos(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i] + s[i + 1]
        i++
      } else out += ' '
    } else out += (c >= 0xdc00 && c <= 0xdfff) || c < 0x20 || c === 0x7f ? ' ' : s[i]
  }
  return out
}

/** Texto limpo: trim, espaços colapsados, tamanho limitado. Vazio ou não-texto conta como ausente. */
export function texto(x: unknown, max = 200): string | undefined {
  if (typeof x === 'number' && Number.isFinite(x)) x = String(x)
  if (typeof x !== 'string') return undefined
  const s = semInvalidos(cortar(x, max * 4)).replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  return s.length > max ? cortar(s, max).trim() : s
}

/** Tamanho em bytes UTF-8 (o que o octet_length do banco mede). */
export function bytesUtf8(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** Forma de comparar nomes e unidades: minúsculas, sem acento, sem pontos, espaços colapsados. */
export function chaveNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** SKU do Prodio: maiúsculas, sem espaços. Formato aceito pelo banco: ^[A-Z0-9][A-Z0-9._/-]{0,39}$ */
export const SKU_VALIDO = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/
export function sku(x: unknown): string | undefined {
  if (typeof x === 'number' && Number.isInteger(x) && x >= 0) x = String(x)
  if (typeof x !== 'string') return undefined
  const s = x.slice(0, 200).replace(/\s+/g, '').toUpperCase()
  return s || undefined
}

// ---------------------------------------------------------------------------
// Unidades: o ES tem texto livre; o Prodio conhece 8 códigos (units do tenant).
// ---------------------------------------------------------------------------
export type CodigoUnidade = 'un' | 'm' | 'm2' | 'kg' | 'g' | 'cx' | 'rl' | 'ct'
export const UNIDADES_PRODIO: readonly CodigoUnidade[] = ['un', 'm', 'm2', 'kg', 'g', 'cx', 'rl', 'ct']

const MAPA_UNIDADES: Record<string, CodigoUnidade> = Object.assign(Object.create(null), {
  un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un', u: 'un', pc: 'un', peca: 'un', pecas: 'un', pcs: 'un', par: 'un', jg: 'un', jogo: 'un',
  cx: 'cx', caixa: 'cx',
  rl: 'rl', rolo: 'rl',
  ct: 'ct', cento: 'ct',
  m: 'm', mt: 'm', mts: 'm', metro: 'm', metros: 'm', ml: 'm', 'metro linear': 'm',
  m2: 'm2', 'm²': 'm2', mq: 'm2', 'metro quadrado': 'm2',
  kg: 'kg', kilo: 'kg', quilo: 'kg',
  g: 'g', gr: 'g', grama: 'g', gramas: 'g',
})
// Embalagens de compra: viram un com o fator do ES (convenção do seed: chapa comprada em un, consumo em m2).
const EMBALAGENS: Record<string, string> = Object.assign(Object.create(null), {
  ch: 'chapa', chapa: 'chapa', fd: 'fardo', fardo: 'fardo', pct: 'pacote', pacote: 'pacote', mi: 'milheiro', mil: 'milheiro', milheiro: 'milheiro',
})

export interface UnidadeLida {
  codigo: CodigoUnidade
  /** A unidade do ES era uma embalagem (chapa, fardo, pacote, milheiro) lida como un. */
  embalagem?: string
  aviso?: string
}

/** Unidade do ES → código do Prodio. undefined quando a unidade não é reconhecida (problema). */
export function unidade(x: unknown): UnidadeLida | undefined {
  const bruto = texto(x, 30)
  if (!bruto) return undefined
  const k = chaveNome(bruto)
  const direto = MAPA_UNIDADES[k]
  if (direto) {
    if (k === 'ml') return { codigo: 'm', aviso: `unidade "${bruto}" lida como metro linear (m)` }
    return { codigo: direto }
  }
  const emb = EMBALAGENS[k]
  if (emb) return { codigo: 'un', embalagem: emb, aviso: `unidade de compra "${bruto}" (${emb}) gravada como un` }
  return undefined
}

// ---------------------------------------------------------------------------
// Documentos e códigos
// ---------------------------------------------------------------------------
export const digitos = (x: unknown): string => {
  if (typeof x === 'number' && Number.isFinite(x)) return Number.isInteger(x) ? BigInt(x).toString() : ''
  return typeof x === 'string' ? x.slice(0, 60).replace(/\D/g, '') : ''
}

function dvMod11(base: string, pesos: number[]): number {
  const soma = [...base].reduce((a, c, i) => a + Number(c) * pesos[i], 0)
  const r = soma % 11
  return r < 2 ? 0 : 11 - r
}

/** CNPJ (14) ou CPF (11) só dígitos, com dígito verificador válido. */
export function documentoValido(d: string): boolean {
  if (/^(\d)\1*$/.test(d)) return false
  if (d.length === 14) {
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const d1 = dvMod11(d.slice(0, 12), p1)
    const d2 = dvMod11(d.slice(0, 12) + d1, [6, ...p1])
    return d.endsWith(`${d1}${d2}`)
  }
  if (d.length === 11) {
    const calc = (n: number) => {
      const soma = d.slice(0, n).split('').reduce((a, c, i) => a + Number(c) * (n + 1 - i), 0)
      const r = (soma * 10) % 11
      return r === 10 ? 0 : r
    }
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10])
  }
  return false
}

/** GTIN-8/12/13/14 com dígito verificador (módulo 10). */
export function gtinValido(d: string): boolean {
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return false
  const corpo = d.slice(0, -1)
  const soma = [...corpo].reverse().reduce((a, c, i) => a + Number(c) * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (soma % 10)) % 10 === Number(d[d.length - 1])
}

/** NCM: 8 dígitos viram "NNNN.NN.NN". Vazio → ausente sem aviso; outro formato → ausente com aviso. */
export function ncm(x: unknown): { valor?: string; aviso?: string } {
  const bruto = typeof x === 'number' ? String(x) : texto(x, 30)
  if (!bruto) return {}
  const d = digitos(bruto)
  if (d.length === 8 && /^[\d.\s-]+$/.test(bruto)) return { valor: `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` }
  return { aviso: `NCM "${bruto}" fora do formato de 8 dígitos; não enviado` }
}

/** Prazo do ES ("28-35-42", "30/60", "" = à vista) → condicao_pagamento int[]. */
export function prazo(x: unknown): { valor?: number[]; aviso?: string } {
  if (x === undefined || x === null) return {}
  if (typeof x === 'number') x = String(x)
  if (typeof x !== 'string') return {}
  const s = x.slice(0, 200).trim()
  if (!s || /^(a|à) ?vista$/i.test(s)) return { valor: [0] }
  const dias: number[] = []
  for (const parte of s.split(/[-/,;\s]+/)) {
    const t = parte.replace(/(dd|d|dias)$/i, '')
    if (!/^\d{1,3}$/.test(t)) continue
    const n = Number(t)
    if (n <= 365 && dias.length < 24) dias.push(n)
  }
  if (!dias.length) return { aviso: `prazo "${s.slice(0, 40)}" sem dias reconhecíveis; não enviado` }
  return { valor: dias }
}

/** Data AAAA-MM-DD a partir do nome do backup (backup-suprimentos-AAAAMMDD-HHMM.json). */
export function dataDoNome(nome: string | undefined): string | undefined {
  const m = nome?.match(/(20\d{2})(\d{2})(\d{2})(?:[-_](\d{2})(\d{2}))?/)
  if (!m) return undefined
  const [, a, mes, d] = m
  if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return undefined
  return `${a}-${mes}-${d}`
}

/** Dias inteiros entre duas datas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number | undefined {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`)
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return undefined
  return Math.round((tb - ta) / 86400000)
}

/** Ordenação estável e independente de locale do ambiente. */
export const comparar = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
