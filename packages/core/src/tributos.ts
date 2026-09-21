// Tabela de tributos com vigência e regimes que creditam.
// Os VALORES vêm sempre destacados no XML da NF-e; aqui só se decide se o valor vira crédito
// para o comprador na data da nota. Nunca alíquota fixa.
import type { Regime } from './tipos'

export type TributoCodigo = 'ICMS' | 'ICMSST' | 'IPI' | 'PIS' | 'COFINS' | 'CBS' | 'IBS'

export interface Tributo {
  codigo: TributoCodigo
  nome: string
  vigenciaInicio?: string // AAAA-MM-DD inclusive
  vigenciaFim?: string // AAAA-MM-DD inclusive
  creditaPara: Regime[] // regimes do comprador que aproveitam crédito
  transicao?: boolean // valor destacado pode ser parcial (reforma tributária)
  observacao?: string
}

// Reforma tributária (LC 214/2025): PIS/COFINS extintos em 31/12/2026, substituídos pela CBS em 01/01/2027;
// IBS em transição a partir de 2026 (alíquota de teste) até substituir ICMS/ISS em 2033;
// IPI zerado a partir de 2027 fora da Zona Franca de Manaus.
export const TRIBUTOS: Tributo[] = [
  { codigo: 'ICMS', nome: 'ICMS', vigenciaFim: '2032-12-31', creditaPara: ['presumido', 'real'], transicao: true },
  { codigo: 'ICMSST', nome: 'ICMS-ST', vigenciaFim: '2032-12-31', creditaPara: [], observacao: 'Substituição tributária: não gera crédito; entra no custo.' },
  { codigo: 'IPI', nome: 'IPI', vigenciaFim: '2026-12-31', creditaPara: ['real'], observacao: 'Zerado a partir de 2027 fora da ZFM.' },
  { codigo: 'PIS', nome: 'PIS', vigenciaFim: '2026-12-31', creditaPara: ['real'] },
  { codigo: 'COFINS', nome: 'COFINS', vigenciaFim: '2026-12-31', creditaPara: ['real'] },
  { codigo: 'CBS', nome: 'CBS', vigenciaInicio: '2027-01-01', creditaPara: ['presumido', 'real'], observacao: 'Não cumulativa: quem está no regime regular credita o valor destacado.' },
  { codigo: 'IBS', nome: 'IBS', vigenciaInicio: '2026-01-01', creditaPara: ['presumido', 'real'], transicao: true },
]

export const tributo = (codigo: TributoCodigo): Tributo => TRIBUTOS.find((t) => t.codigo === codigo)!

export interface OpcoesVigencia {
  zfm?: boolean // comprador na Zona Franca de Manaus: IPI segue vigente após 2027
}

// Data de competência válida: AAAA-MM-DD (aceita ISO com hora) e existente no calendário.
export function dataValida(data: string | undefined | null): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(String(data ?? ''))
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

// O tributo está vigente na data (AAAA-MM-DD ou ISO com hora)? Data inválida nunca está vigente.
export function tributoVigente(codigo: TributoCodigo, data: string, opcoes: OpcoesVigencia = {}): boolean {
  if (!dataValida(data)) return false
  const t = tributo(codigo)
  const dia = data.slice(0, 10)
  if (t.vigenciaInicio && dia < t.vigenciaInicio) return false
  if (t.vigenciaFim && dia > t.vigenciaFim) return codigo === 'IPI' ? !!opcoes.zfm : false
  return true
}

// O comprador neste regime credita este tributo nesta data?
export function creditaTributo(codigo: TributoCodigo, regime: Regime, data: string, opcoes: OpcoesVigencia = {}): boolean {
  if (regime === 'simples') return false
  return tributoVigente(codigo, data, opcoes) && tributo(codigo).creditaPara.includes(regime)
}
