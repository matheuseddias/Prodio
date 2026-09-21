// NF-e modelo 55: chave de acesso e classificação por CFOP. Puro, sem dependências:
// roda no navegador (bipe da chave na doca) e no worker. O parser do XML vive em nfeXml.ts,
// que depende de fast-xml-parser e só é usado no servidor.
import type { NfeClassificacao } from './tipos'

// ---------------------------------------------------------------------------
// Chave de acesso (44 dígitos): cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) DV(1)
// ---------------------------------------------------------------------------
export const somenteDigitos = (s: string): string => String(s || '').replace(/\D/g, '')

// Dígito verificador módulo 11 com pesos 2..9 da direita para a esquerda.
export function dvChaveNfe(base43: string): number {
  const d = somenteDigitos(base43)
  if (d.length !== 43) throw new Error('Base da chave deve ter 43 dígitos')
  let peso = 2
  let soma = 0
  for (let i = d.length - 1; i >= 0; i--) {
    soma += Number(d[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function validarChaveNfe(chave: string): boolean {
  const d = somenteDigitos(chave)
  if (d.length !== 44) return false
  return dvChaveNfe(d.slice(0, 43)) === Number(d[43])
}

export interface ChaveDecomposta {
  cUF: string
  aamm: string
  cnpj: string
  modelo: string
  serie: number
  numero: number
  tpEmis: string
  cNF: string
  dv: number
  valida: boolean
}

export function decomporChave(chave: string): ChaveDecomposta {
  const d = somenteDigitos(chave)
  if (d.length !== 44) throw new Error(`Chave deve ter 44 dígitos (recebeu ${d.length})`)
  return {
    cUF: d.slice(0, 2),
    aamm: d.slice(2, 6),
    cnpj: d.slice(6, 20),
    modelo: d.slice(20, 22),
    serie: Number(d.slice(22, 25)),
    numero: Number(d.slice(25, 34)),
    tpEmis: d.slice(34, 35),
    cNF: d.slice(35, 43),
    dv: Number(d.slice(43, 44)),
    valida: validarChaveNfe(d),
  }
}

// ---------------------------------------------------------------------------
// Classificação por CFOP do emitente (5xxx dentro do estado, 6xxx fora, 7xxx exterior)
// ---------------------------------------------------------------------------
const equivalentes = (cfops5: string[]) => new Set(cfops5.flatMap((c) => [c, '6' + c.slice(1)]))
export const CFOPS_COMPRA = equivalentes(['5101', '5102', '5401', '5403', '5405', '5122', '5124'])
CFOPS_COMPRA.add('6404') // venda com ST já retido (equivalente interestadual do 5405)
export const CFOPS_MANUAL = equivalentes(['5901', '5902', '5910', '5915', '5916', '5202', '5949', '5125'])

// 'compra' entra no estoque como compra; 'manual' precisa de decisão humana (remessa, devolução,
// bonificação, industrialização por encomenda); 'ignorar' é nota de entrada do próprio tenant (1xxx/2xxx/3xxx).
export function classificarCfop(cfopEmitente: string, finNFe: string = '1', tpNF: string = '1'): NfeClassificacao {
  const cfop = somenteDigitos(cfopEmitente)
  if (cfop.length !== 4) return 'manual'
  if (cfop[0] === '1' || cfop[0] === '2' || cfop[0] === '3') return 'ignorar'
  if (String(tpNF).trim() === '0') return 'manual'
  if (String(finNFe).trim() !== '1') return 'manual' // complementar, ajuste ou devolução
  if (CFOPS_COMPRA.has(cfop)) return 'compra'
  return 'manual'
}
