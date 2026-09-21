import type { Channel, Product } from './types'

export interface ResultadoPreco {
  preco: number
  comissao: number
  taxaFixa: number
  frete: number
  imposto: number
  ads: number
  parcelamento: number
  outros: number
  custo: number
  lucro: number
  margem: number // sobre o preço
}

export const pesoFaturavel = (p: Product) => Math.max(p.pesoKg ?? 0, p.pesoCubadoKg ?? 0)

export function freteDoCanal(canal: Channel, preco: number, pesoKg: number): number {
  if (!canal.freteVendedor.length) return 0
  if (canal.freteGratisAcimaDe !== undefined && preco < canal.freteGratisAcimaDe) return 0
  const faixa = canal.freteVendedor.find((f) => pesoKg <= f.ateKg) ?? canal.freteVendedor[canal.freteVendedor.length - 1]
  return faixa.valor
}

// Decompõe um preço de venda em custos do canal e lucro.
export function avaliarPreco(canal: Channel, preco: number, custo: number, pesoKg: number): ResultadoPreco {
  const comissao = preco * (canal.comissaoPct / 100)
  const taxaFixa = canal.taxaFixaAbaixoDe !== undefined ? (preco < canal.taxaFixaAbaixoDe ? canal.taxaFixa : 0) : canal.taxaFixa
  const frete = freteDoCanal(canal, preco, pesoKg)
  const imposto = preco * (canal.impostoVendaPct / 100)
  const ads = preco * (canal.adsPct / 100)
  const parcelamento = preco * (canal.parcelamentoPct / 100)
  const outros = preco * (canal.outrosPct / 100)
  const lucro = preco - comissao - taxaFixa - frete - imposto - ads - parcelamento - outros - custo
  return { preco, comissao, taxaFixa, frete, imposto, ads, parcelamento, outros, custo, lucro, margem: preco > 0 ? lucro / preco : 0 }
}

// Preço mínimo para atingir a margem alvo (sobre o preço). Iterativo porque frete e taxa fixa dependem de faixas.
export function precoParaMargem(canal: Channel, custo: number, pesoKg: number, margemAlvo: number): ResultadoPreco {
  const pctVar = (canal.comissaoPct + canal.impostoVendaPct + canal.adsPct + canal.parcelamentoPct + canal.outrosPct) / 100
  let preco = custo / Math.max(0.01, 1 - pctVar - margemAlvo)
  for (let i = 0; i < 12; i++) {
    const fixos = (canal.taxaFixaAbaixoDe !== undefined ? (preco < canal.taxaFixaAbaixoDe ? canal.taxaFixa : 0) : canal.taxaFixa) + freteDoCanal(canal, preco, pesoKg)
    const novo = (custo + fixos) / Math.max(0.01, 1 - pctVar - margemAlvo)
    if (Math.abs(novo - preco) < 0.005) {
      preco = novo
      break
    }
    preco = novo
  }
  preco = Math.ceil(preco * 10) / 10 - 0.01 // termina em ,x9
  return avaliarPreco(canal, preco, custo, pesoKg)
}

export const PRESETS: { preset: NonNullable<Channel['preset']>; nome: string; base: Omit<Channel, 'id' | 'nome' | 'preset' | 'ativo'> }[] = [
  { preset: 'mercadolivre', nome: 'Mercado Livre', base: { comissaoPct: 12, taxaFixa: 6, taxaFixaAbaixoDe: 79, freteVendedor: [{ ateKg: 0.3, valor: 0 }, { ateKg: 0.5, valor: 21.9 }, { ateKg: 1, valor: 23.9 }, { ateKg: 2, valor: 25.9 }, { ateKg: 5, valor: 33.9 }, { ateKg: 9, valor: 51.9 }], freteGratisAcimaDe: 79, impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 0, outrosPct: 0, observacao: 'Confira a tabela vigente de comissões e Custo dos Envios.' } },
  { preset: 'shopee', nome: 'Shopee', base: { comissaoPct: 20, taxaFixa: 4, freteVendedor: [], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 0, outrosPct: 0, observacao: 'Comissão inclui o programa de frete grátis.' } },
  { preset: 'amazon', nome: 'Amazon', base: { comissaoPct: 15, taxaFixa: 0, freteVendedor: [{ ateKg: 0.5, valor: 14.9 }, { ateKg: 1, valor: 17.9 }, { ateKg: 2, valor: 21.9 }, { ateKg: 5, valor: 29.9 }], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 0, outrosPct: 0, observacao: 'Tarifa FBA por peso faturável.' } },
  { preset: 'tiktok', nome: 'TikTok Shop', base: { comissaoPct: 8, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 0, outrosPct: 0 } },
  { preset: 'magalu', nome: 'Magalu', base: { comissaoPct: 16, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 0, outrosPct: 0 } },
  { preset: 'loja', nome: 'Loja própria', base: { comissaoPct: 0, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 3.5, outrosPct: 0, observacao: 'Gateway de pagamento em parcelamento.' } },
  { preset: 'atacado', nome: 'Atacado', base: { comissaoPct: 0, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 0, outrosPct: 0 } },
]
