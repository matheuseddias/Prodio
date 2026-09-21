import { PRESETS } from '@prodio/core'
import { brl, num } from '../../domain/format'
import type { Channel, Product } from '../../domain/types'
import type { Tone } from '../../ui'

// Helpers e componentes pequenos compartilhados pelas abas de precificação.

export const uid = () => Math.random().toString(36).slice(2, 10)

/** "1.234,56" | "1234.56" | "1234,5" → number (NaN se inválido) */
export function parseNumBR(raw: string): number {
  const s = raw.trim()
  if (!s) return NaN
  let t = s
  if (s.includes(',')) t = s.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN
  return Number(t)
}

export const toneMargem = (margem: number, alvo: number): Tone => (margem < 0 ? 'danger' : margem < alvo ? 'warn' : 'ok')

export const pctBR = (v: number, casas = 1) => `${num(v * 100, casas)}%`

export const nomePreset = (preset?: Channel['preset']) => (preset ? (PRESETS.find((p) => p.preset === preset)?.nome ?? preset) : 'Do zero')

export const produtoCusto = (p: Product, custoVivo: number | undefined) => custoVivo ?? p.custoFicha

export const labelProduto = (p: Product) => `${p.nome}${p.atributos.cor ? ` · ${p.atributos.cor}` : ''}${p.atributos.tamanho ? ` · ${p.atributos.tamanho}` : ''}`

/** Resumo curto das taxas de um canal, para cards e listas. */
export function resumoTaxas(c: Channel): string[] {
  const out: string[] = []
  if (c.comissaoPct) out.push(`Comissão ${num(c.comissaoPct, 1)}%`)
  if (c.taxaFixa) out.push(`Taxa fixa ${brl(c.taxaFixa)}${c.taxaFixaAbaixoDe !== undefined ? ` (abaixo de ${brl(c.taxaFixaAbaixoDe)})` : ''}`)
  if (c.freteVendedor.length) {
    const max = c.freteVendedor[c.freteVendedor.length - 1]
    out.push(`Frete até ${brl(max.valor)} (${c.freteVendedor.length} faixas)${c.freteGratisAcimaDe !== undefined ? ` a partir de ${brl(c.freteGratisAcimaDe)}` : ''}`)
  }
  if (c.impostoVendaPct) out.push(`Imposto ${num(c.impostoVendaPct, 1)}%`)
  if (c.adsPct) out.push(`Ads ${num(c.adsPct, 1)}%`)
  if (c.parcelamentoPct) out.push(`Parcelamento ${num(c.parcelamentoPct, 1)}%`)
  if (c.outrosPct) out.push(`Outros ${num(c.outrosPct, 1)}%`)
  return out.length ? out : ['Sem taxas configuradas']
}

export const pctVariavel = (c: Channel) => (c.comissaoPct + c.impostoVendaPct + c.adsPct + c.parcelamentoPct + c.outrosPct) / 100

export function baixarCsv(nomeArquivo: string, linhas: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? num(v, 2) : v
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const conteudo = '﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n')
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  a.click()
  URL.revokeObjectURL(url)
}

export const COMPONENTES: { key: 'comissao' | 'taxaFixa' | 'frete' | 'imposto' | 'ads' | 'parcelamento' | 'outros' | 'custo' | 'lucro'; label: string; cor: string }[] = [
  { key: 'custo', label: 'Custo', cor: 'bg-faint' },
  { key: 'comissao', label: 'Comissão', cor: 'bg-info' },
  { key: 'taxaFixa', label: 'Taxa fixa', cor: 'bg-info/70' },
  { key: 'frete', label: 'Frete', cor: 'bg-warn' },
  { key: 'imposto', label: 'Imposto', cor: 'bg-danger/70' },
  { key: 'ads', label: 'Ads', cor: 'bg-accent/60' },
  { key: 'parcelamento', label: 'Parcelamento', cor: 'bg-accent/40' },
  { key: 'outros', label: 'Outros', cor: 'bg-muted' },
  { key: 'lucro', label: 'Lucro', cor: 'bg-ok' },
]
