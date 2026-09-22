// Modelo de sessão de conferência/inventário (estado local; o backend assume depois).
// Compartilhado entre Estoque › Inventário (desktop) e /chao/inventario (celular).
import type { Material } from '../../domain/types'

export const MOTIVOS_DIVERGENCIA = ['Quebra', 'Perda de corte', 'Erro de lançamento', 'Sobra não lançada', 'Outro'] as const
export type MotivoDivergencia = (typeof MOTIVOS_DIVERGENCIA)[number]

/**
 * Locais de contagem da demonstração (modo memória). Fora dela são os locais da empresa: mostrar
 * "Galpão Vila Galvão" para o operador de outra fábrica é dado de outra empresa na tela dele.
 */
export const LOCAIS_CONTAGEM = ['Galpão Vila Galvão · Prateleira A', 'Galpão Vila Galvão · Tecidos', 'Galpão Vila Galvão · Embalagens', 'Galpão Pedro de Souza']

/** Opções de local para uma sessão: os locais da empresa; só a demonstração usa a lista fixa. */
export function locaisDeContagem(locais: { nome: string }[], modo: 'memoria' | 'supabase'): string[] {
  if (modo === 'memoria') return LOCAIS_CONTAGEM
  return locais.map((l) => l.nome)
}

/** Uma linha do modo "por peças": peças inteiras de um tamanho × área/comprimento de cada. */
export interface PecaContada {
  id: string
  rotulo: string
  medida: number // m² ou m por peça
  qtd: number
  livre?: boolean // medida digitada (retalho aproveitável)
}

export interface ItemSessao {
  materialId: string
  modo: 'total' | 'pecas'
  contadoTexto: string
  pecas: PecaContada[]
  motivo?: MotivoDivergencia
  // congelados no fechamento da sessão
  saldoSistema?: number
  contado?: number
  delta?: number
  custoUnit?: number
}

export interface SessaoInventario {
  id: string
  abertaEm: string
  fechadaEm?: string
  local: string
  por: string
  origem: 'celular' | 'desktop'
  status: 'aberta' | 'fechada'
  itens: ItemSessao[]
}

export type ClasseABC = 'A' | 'B' | 'C'
export type RegraABC = Record<ClasseABC, number> // dias entre contagens
export const REGRA_ABC_PADRAO: RegraABC = { A: 7, B: 15, C: 30 }

export const uid = () => Math.random().toString(36).slice(2, 10)
export const r3 = (v: number) => Math.round(v * 1000) / 1000
const MS_DIA = 86_400_000

export const dimensional = (m: Material) => m.unidadeConsumo === 'm2' || m.unidadeConsumo === 'm'
export const unLabel = (u: string) => (u === 'm2' ? 'm²' : u)
export const casasDe = (m: Material) => (m.unidadeConsumo === 'un' ? 0 : 2)

export const parseQtd = (t: string): number | undefined => {
  if (t.trim() === '') return undefined
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** Tamanhos padrão de um insumo dimensional: inteira, meia, quarto (só área) e retalho aproveitável. */
export function tamanhosPadrao(m: Material): PecaContada[] {
  const inteira = m.fatorConversao > 0 ? m.fatorConversao : 1
  const area = m.unidadeConsumo === 'm2'
  const rolo = m.unidadeCompra === 'rl'
  const nome = rolo ? 'rolo' : area ? 'chapa' : 'peça'
  const fem = nome === 'chapa' || nome === 'peça'
  const lista: PecaContada[] = [
    { id: 'inteira', rotulo: `${cap(nome)} ${fem ? 'inteira' : 'inteiro'}`, medida: r3(inteira), qtd: 0 },
    { id: 'meia', rotulo: fem ? `Meia ${nome}` : `Meio ${nome}`, medida: r3(inteira / 2), qtd: 0 },
  ]
  if (area) lista.push({ id: 'quarto', rotulo: `Quarto de ${nome}`, medida: r3(inteira / 4), qtd: 0 })
  lista.push(pecaLivre(m))
  return lista
}
export const pecaLivre = (m: Material): PecaContada => ({ id: uid(), rotulo: `Retalho aproveitável (${unLabel(m.unidadeConsumo)})`, medida: 0, qtd: 1, livre: true })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const totalPecas = (pecas: PecaContada[]) => r3(pecas.reduce((s, p) => s + p.medida * p.qtd, 0))

export function novoItem(m: Material): ItemSessao {
  return { materialId: m.id, modo: 'total', contadoTexto: '', pecas: dimensional(m) ? tamanhosPadrao(m) : [] }
}

/** Quantidade contada de um item (undefined = ainda não contado). */
export function contadoDe(item: ItemSessao): number | undefined {
  if (item.contado !== undefined) return item.contado
  if (item.modo === 'pecas') return item.pecas.some((p) => p.qtd > 0 && p.medida > 0) ? totalPecas(item.pecas) : undefined
  return parseQtd(item.contadoTexto)
}

export interface ItemAvaliado {
  item: ItemSessao
  material?: Material
  saldo: number
  custo: number
  contado?: number
  delta?: number
  valor?: number // |delta| × custo
}

export function avaliarItem(item: ItemSessao, materials: Material[]): ItemAvaliado {
  const material = materials.find((m) => m.id === item.materialId)
  const saldo = item.saldoSistema ?? material?.saldo ?? 0
  const custo = item.custoUnit ?? material?.custoMedio ?? 0
  const contado = contadoDe(item)
  const delta = contado === undefined ? undefined : item.delta ?? r3(contado - saldo)
  return { item, material, saldo, custo, contado, delta, valor: delta === undefined ? undefined : Math.abs(delta) * custo }
}

export function resumoSessao(s: SessaoInventario, materials: Material[]) {
  const itens = s.itens.map((it) => avaliarItem(it, materials))
  const contados = itens.filter((i) => i.contado !== undefined)
  const divergentes = contados.filter((i) => i.delta !== 0)
  const semMotivo = divergentes.filter((i) => !i.item.motivo)
  const valorDiverg = divergentes.reduce((t, i) => t + (i.valor ?? 0), 0)
  const base = contados.reduce((t, i) => t + i.saldo * i.custo, 0)
  return {
    itens,
    contados,
    divergentes,
    semMotivo,
    valorDiverg,
    pct: base > 0 ? (valorDiverg / base) * 100 : 0,
    acuracia: contados.length ? (contados.length - divergentes.length) / contados.length : undefined,
    completa: itens.length > 0 && contados.length === itens.length && semMotivo.length === 0,
  }
}

/** Congela saldo/contado/delta/custo de cada item (no fechamento). Itens não contados ficam de fora. */
export function congelarItens(s: SessaoInventario, materials: Material[]): ItemSessao[] {
  return resumoSessao(s, materials)
    .contados.map((i) => ({ ...i.item, saldoSistema: i.saldo, contado: i.contado, delta: i.delta, custoUnit: i.custo }))
}

// ---------- classe ABC e programação ----------

export function classeABC(materials: Material[]): Map<string, ClasseABC> {
  const ord = materials.map((m) => ({ id: m.id, v: Math.max(0, m.saldo * m.custoMedio) })).sort((a, b) => b.v - a.v)
  const total = ord.reduce((s, x) => s + x.v, 0) || 1
  const out = new Map<string, ClasseABC>()
  let acum = 0
  for (const x of ord) {
    out.set(x.id, acum / total < 0.8 ? 'A' : acum / total < 0.95 ? 'B' : 'C')
    acum += x.v
  }
  return out
}

export function ultimaContagem(materialId: string, sessoes: SessaoInventario[]): string | undefined {
  let ultima: string | undefined
  for (const s of sessoes) {
    if (s.status !== 'fechada' || !s.fechadaEm || !s.itens.some((i) => i.materialId === materialId)) continue
    if (!ultima || s.fechadaEm > ultima) ultima = s.fechadaEm
  }
  return ultima
}

export interface LinhaProgramacao {
  m: Material
  classe: ClasseABC
  ultima?: string
  diasDesde?: number
  prazoDias: number
  vencida: boolean
}

export function programacao(materials: Material[], sessoes: SessaoInventario[], regra: RegraABC): LinhaProgramacao[] {
  const abc = classeABC(materials)
  return materials
    .map((m) => {
      const classe = abc.get(m.id) ?? 'C'
      const ultima = ultimaContagem(m.id, sessoes)
      const diasDesde = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / MS_DIA) : undefined
      const prazoDias = regra[classe]
      return { m, classe, ultima, diasDesde, prazoDias, vencida: diasDesde === undefined || diasDesde >= prazoDias }
    })
    .sort((a, b) => Number(b.vencida) - Number(a.vencida) || a.classe.localeCompare(b.classe) || (b.diasDesde ?? 9999) - (a.diasDesde ?? 9999))
}

/** Sugestões para uma nova sessão. */
export function sugestoes(materials: Material[], sessoes: SessaoInventario[], regra: RegraABC) {
  const venceHoje = programacao(materials, sessoes, regra).filter((l) => l.vencida).map((l) => l.m.id)
  const abaixoMinimo = materials.filter((m) => m.saldo < m.minimo).sort((a, b) => a.saldo / a.minimo - b.saldo / b.minimo).map((m) => m.id)
  const maisCaros = [...materials].sort((a, b) => b.saldo * b.custoMedio - a.saldo * a.custoMedio).slice(0, 5).map((m) => m.id)
  return { venceHoje, abaixoMinimo, maisCaros }
}

/** Acurácia (% itens sem divergência) sessão a sessão, da mais antiga para a mais recente. */
export function serieAcuracia(sessoes: SessaoInventario[]) {
  return sessoes
    .filter((s) => s.status === 'fechada' && s.fechadaEm && s.itens.length > 0)
    .sort((a, b) => a.fechadaEm!.localeCompare(b.fechadaEm!))
    .map((s) => ({ id: s.id, em: s.fechadaEm!, pct: (s.itens.filter((i) => (i.delta ?? 0) === 0).length / s.itens.length) * 100 }))
}

/** Semanas seguidas (até a atual, máx. 4) em que toda sessão fechada ficou ≥ 95%. */
export function semanasAcimaDe95(serie: { em: string; pct: number }[], max = 4) {
  const MS_SEMANA = 7 * MS_DIA
  let n = 0
  for (let w = 0; w < max; w++) {
    const fim = Date.now() - w * MS_SEMANA
    const ini = fim - MS_SEMANA
    const daSemana = serie.filter((p) => {
      const t = new Date(p.em).getTime()
      return t > ini && t <= fim
    })
    if (daSemana.length === 0 || daSemana.some((p) => p.pct < 95)) break
    n++
  }
  return n
}

// ---------- sessões de exemplo ----------
//
// SÓ para o modo memória (demonstração sem banco). Com banco de verdade as telas começam vazias:
// semear com estas sessões mostrava contagens de outra empresa ("Thiago", "Encarregada") como se
// fossem do galpão do cliente, e a Acurácia era calculada em cima delas.

const diasAtras = (n: number, h = 7, min = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(h, min, 0, 0)
  return d.toISOString()
}
const fechado = (materialId: string, saldo: number, contado: number, custo: number, motivo?: MotivoDivergencia): ItemSessao => ({
  materialId,
  modo: 'total',
  contadoTexto: String(contado),
  pecas: [],
  motivo,
  saldoSistema: saldo,
  contado,
  delta: r3(contado - saldo),
  custoUnit: custo,
})

export function sessoesExemplo(materials: Material[]): SessaoInventario[] {
  const mat = (id: string) => materials.find((m) => m.id === id)
  const aberto = (id: string, contadoTexto = ''): ItemSessao => {
    const m = mat(id)
    return m ? { ...novoItem(m), contadoTexto } : { materialId: id, modo: 'total', contadoTexto, pecas: [] }
  }
  return [
    {
      id: 'inv-3',
      abertaEm: diasAtras(0, 7, 10),
      local: 'Galpão Pedro de Souza',
      por: 'Thiago',
      origem: 'celular',
      status: 'aberta',
      itens: [aberto('m6', '138'), aberto('m7'), aberto('m11')],
    },
    {
      id: 'inv-2',
      abertaEm: diasAtras(2, 7),
      fechadaEm: diasAtras(2, 17, 20),
      local: 'Galpão Vila Galvão · Prateleira A',
      por: 'Encarregada',
      origem: 'celular',
      status: 'fechada',
      itens: [
        fechado('m1', 59, 61.4, 33.43, 'Sobra não lançada'),
        fechado('m5', 875, 875, 2.54),
        fechado('m8', 1210, 1210, 1.07),
        fechado('m9', 540, 540, 0.52),
        fechado('m10', 6400, 6400, 0.1),
        fechado('m11', 1900, 1900, 0.02),
      ],
    },
    {
      id: 'inv-1',
      abertaEm: diasAtras(9, 8),
      fechadaEm: diasAtras(9, 16, 5),
      local: 'Galpão Vila Galvão · Tecidos',
      por: 'Lucas',
      origem: 'desktop',
      status: 'fechada',
      itens: [
        fechado('m2', 26.6, 25.4, 29.53, 'Perda de corte'),
        fechado('m3', 122, 122, 22.07),
        fechado('m4', 57.7, 57.7, 22.07),
        fechado('m12', 260, 260, 8.28),
        fechado('m13', 6.2, 6.2, 51.31),
      ],
    },
  ]
}
