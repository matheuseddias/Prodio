// Etiquetas: serial = prefixo + SKU + AAMMDD + sequência de 4 dígitos; perfis por família.
import type { LabelProfile } from './tipos'

export const PERFIL_PADRAO: LabelProfile = { familia: '*', prefixo: 'PR', tipos: ['produto'], unidadesPorCaixa: 1 }

const RE_PREFIXO = /^[A-Z]{2,3}$/
export const validarPrefixo = (prefixo: string): boolean => RE_PREFIXO.test(prefixo)

export const SEQ_MAX = 9999

// O trio ano/mês/dia existe no calendário? (rejeita 30/02, 31/04, 29/02 fora de bissexto)
const diaExiste = (ano: number, mes: number, dia: number): boolean => {
  const d = new Date(Date.UTC(ano, mes - 1, dia))
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

// Dia AAAA-MM-DD (ou Date, no fuso local) → AAMMDD. Dia inexistente no calendário é erro.
export function diaAAMMDD(dia: string | Date): string {
  if (dia instanceof Date) {
    if (Number.isNaN(dia.getTime())) throw new Error('Dia inválido para etiqueta: Date inválida')
    const aa = String(dia.getFullYear()).slice(2)
    const mm = String(dia.getMonth() + 1).padStart(2, '0')
    const dd = String(dia.getDate()).padStart(2, '0')
    return aa + mm + dd
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dia ?? ''))
  if (!m || !diaExiste(Number(m[1]), Number(m[2]), Number(m[3]))) throw new Error(`Dia inválido para etiqueta: ${dia}`)
  return m[1].slice(2) + m[2] + m[3]
}

export function serial(prefixo: string, sku: string, dia: string | Date, seq: number): string {
  if (!validarPrefixo(prefixo)) throw new Error(`Prefixo inválido: ${prefixo} (2 ou 3 letras maiúsculas)`)
  const skuLimpo = String(sku || '').trim().toUpperCase()
  if (!/^[A-Z0-9-]+$/.test(skuLimpo)) throw new Error(`SKU inválido para etiqueta: ${sku}`)
  if (!Number.isInteger(seq) || seq < 1 || seq > SEQ_MAX) throw new Error(`Sequência fora de 1..${SEQ_MAX}: ${seq}`)
  return prefixo + skuLimpo + diaAAMMDD(dia) + String(seq).padStart(4, '0')
}

export interface SerialDecodificado {
  prefixo: string
  sku: string
  dia: string // AAAA-MM-DD
  seq: number
}

// Decodifica um serial. Com a lista de prefixos conhecidos o corte é exato (maior prefixo que casa);
// sem ela, assume prefixo de 2 letras quando o SKU também começa com letras.
export function decodeSerial(valor: string, prefixos: string[] = []): SerialDecodificado | null {
  const s = String(valor || '').trim().toUpperCase()
  const m = /^([A-Z0-9-]+?)(\d{2})(\d{2})(\d{2})(\d{4})$/.exec(s)
  if (!m) return null
  const corpo = m[1]
  if (!diaExiste(2000 + Number(m[2]), Number(m[3]), Number(m[4]))) return null
  const seq = Number(m[5])
  if (seq < 1) return null
  const dia = `20${m[2]}-${m[3]}-${m[4]}`
  const conhecidos = [...prefixos].filter(validarPrefixo).sort((a, b) => b.length - a.length)
  const achado = conhecidos.find((p) => corpo.startsWith(p) && corpo.length > p.length)
  if (achado) return { prefixo: achado, sku: corpo.slice(achado.length), dia, seq }
  const letras = /^[A-Z]+/.exec(corpo)?.[0] ?? ''
  if (letras.length < 3 || corpo.length <= 2) return null
  return { prefixo: corpo.slice(0, 2), sku: corpo.slice(2), dia, seq }
}

// Perfil de etiqueta da família (case-insensitive); sem perfil cadastrado cai no padrão com a família pedida.
export function perfilDaFamilia(perfis: LabelProfile[], familia: string): LabelProfile {
  const alvo = String(familia || '').trim().toLowerCase()
  const achado = perfis.find((p) => p.familia.trim().toLowerCase() === alvo) ?? perfis.find((p) => p.familia === '*')
  if (achado) return { ...achado, tipos: achado.tipos.includes('produto') ? achado.tipos : ['produto', ...achado.tipos] }
  return { ...PERFIL_PADRAO, familia: familia || PERFIL_PADRAO.familia }
}

// Quantas etiquetas saem para uma quantidade de peças, por tipo. Peças são inteiras e nunca negativas.
export function etiquetasPara(perfil: LabelProfile, pecasPedidas: number): Record<LabelProfile['tipos'][number], number> {
  const pecas = Number.isFinite(pecasPedidas) ? Math.max(0, Math.ceil(pecasPedidas)) : 0
  const porCaixa = perfil.unidadesPorCaixa > 0 ? perfil.unidadesPorCaixa : 1
  return {
    produto: perfil.tipos.includes('produto') ? pecas : 0,
    montagem: perfil.tipos.includes('montagem') ? pecas : 0,
    caixa: perfil.tipos.includes('caixa') ? Math.ceil(pecas / porCaixa) : 0,
  }
}
