// Planejamento pela média de vendas (docs/pesquisa-prazo-de-envio.md, modo 1; docs/melhorias.md itens
// 13, 15b, 16 e 17). Uma regra só para o banco e a tela: o banco agrega os pedidos (RPC demand_summary)
// e estas funções transformam o agregado em demanda por dia de produção, sugestão da Linha de hoje e
// diagnóstico do que ficou de fora. `resumirPedidos` repete em memória o recorte da RPC (modo de
// demonstração e testes); se a regra mudar, muda nos dois (supabase/tests/0019_demanda.test.sql).
import { demandaDerivadaDeComponentes, demandaDiaria, projetadoDoDia } from './projecao'
import type { Bom, Id } from './tipos'
import type { DemandaProduto, DemandaResumo, SaldoHubProduto, SignificadoPedido, SkuSemProduto } from './tipos-demanda'

/** Janela padrão da média de vendas (dias corridos), a mesma de `tenants.dias_demanda`. */
export const JANELA_PADRAO_DIAS = 14
/** Maior janela aceita (a carga inicial do robô traz 90 dias). */
export const JANELA_MAX_DIAS = 90
/**
 * Dias de venda que a sugestão do dia repõe no hub quando o saldo de acabado é conhecido
 * (tenants.dias_cobertura_acabado). 3 é o mínimo de produto da curva A no ES.
 */
export const COBERTURA_ACABADO_PADRAO = 3
/** Quantos SKUs sem produto a lista traz (o total vem em `semProduto`). */
export const LIMITE_SKUS_SEM_PRODUTO = 50

/** Janela válida: inteiro entre 1 e JANELA_MAX_DIAS; o resto vira o padrão. */
export function janelaDaDemanda(dias: number | null | undefined): number {
  const n = Math.floor(Number(dias))
  if (!Number.isFinite(n) || n < 1) return JANELA_PADRAO_DIAS
  return Math.min(n, JANELA_MAX_DIAS)
}

/**
 * O pedido conta na média de vendas? Decisão do fundador de 25/09: todo pedido confirmado conta,
 * inclusive cancelado e enviado (a peça já foi fabricada e o insumo já foi consumido). Só o status
 * mapeado como 'ignorar' fica de fora. Sem significado (status fora do De-Para) conta.
 */
export const contaNaDemanda = (significado: SignificadoPedido | null | undefined): boolean => significado !== 'ignorar'

/**
 * Demanda por DIA DE PRODUÇÃO (item 17): a venda da janela vira mensal (30 dias corridos) e é
 * dividida pelos dias úteis do mês — vende-se 30 dias, produz-se só nos úteis. É o "dia" do ES
 * (vendas ÷ período × 30 × (1 + margem) ÷ dias úteis).
 */
export function demandaPorDiaDeProducao(vendido: number, dias: number, diasUteisMes: number, margem = 0): number {
  return demandaDiaria(vendido, dias, margem, diasUteisMes > 0 ? diasUteisMes : 30)
}

// ---------------------------------------------------------------------------
// Resumo dos pedidos (mesma regra da RPC demand_summary)
// ---------------------------------------------------------------------------
export interface PedidoParaResumo {
  id: string
  confirmadoEm: string | null
  significado?: SignificadoPedido | null
  itens: { sku: string | null; productId?: Id | null; quantidade: number }[]
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN)
const n0 = (v: number): number => (Number.isFinite(v) ? v : 0)

/**
 * Agrega pedidos na janela como a RPC demand_summary: pedido que conta (contaNaDemanda) confirmado
 * desde `agora − dias`. Produto vendido, carteira, pedidos nas últimas 24 h, SKUs sem produto (os que
 * mais vendem primeiro) e a confirmação mais recente de qualquer pedido.
 */
export function resumirPedidos(
  pedidos: PedidoParaResumo[],
  opts: { dias?: number; agora: number; hub?: SaldoHubProduto[]; exemplo?: boolean; limiteSkus?: number },
): DemandaResumo {
  const dias = janelaDaDemanda(opts.dias)
  const desde = opts.agora - dias * 86_400_000
  const dia24 = opts.agora - 86_400_000
  const produtos = new Map<Id, DemandaProduto>()
  const semProduto = new Map<string, { unidades: number; pedidos: Set<string> }>()
  let ultimo = NaN
  let contados = 0
  let em24 = 0
  let unidades = 0
  let linhasSem = 0
  let unidadesSem = 0
  for (const p of pedidos) {
    const t = ms(p.confirmadoEm)
    if (!Number.isFinite(t)) continue
    if (!Number.isFinite(ultimo) || t > ultimo) ultimo = t
    if (t < desde || !contaNaDemanda(p.significado)) continue
    contados++
    if (t >= dia24) em24++
    for (const it of p.itens) {
      const q = n0(it.quantidade)
      unidades += q
      if (!it.productId) {
        linhasSem++
        unidadesSem += q
        const sku = it.sku ?? ''
        const s = semProduto.get(sku) ?? { unidades: 0, pedidos: new Set<string>() }
        s.unidades += q
        s.pedidos.add(p.id)
        semProduto.set(sku, s)
        continue
      }
      const atual = produtos.get(it.productId) ?? { productId: it.productId, vendido: 0, carteira: 0 }
      atual.vendido += q
      if (p.significado === 'carteira') atual.carteira += q
      if (!atual.ultimoPedido || ms(atual.ultimoPedido) < t) atual.ultimoPedido = new Date(t).toISOString()
      produtos.set(it.productId, atual)
    }
  }
  const skus: SkuSemProduto[] = [...semProduto.entries()]
    .map(([sku, s]) => ({ sku, unidades: s.unidades, pedidos: s.pedidos.size }))
    .sort((a, b) => b.unidades - a.unidades || a.sku.localeCompare(b.sku))
  return {
    disponivel: true,
    exemplo: !!opts.exemplo,
    dias,
    desde: new Date(desde).toISOString(),
    geradoEm: new Date(opts.agora).toISOString(),
    ultimoPedido: Number.isFinite(ultimo) ? new Date(ultimo).toISOString() : undefined,
    pedidos: contados,
    pedidos24h: em24,
    unidades,
    semProduto: { linhas: linhasSem, unidades: unidadesSem, skus: semProduto.size },
    skusSemProduto: skus.slice(0, opts.limiteSkus ?? LIMITE_SKUS_SEM_PRODUTO),
    produtos: [...produtos.values()].sort((a, b) => b.vendido - a.vendido),
    hub: opts.hub ?? [],
  }
}

/** Resumo vazio: `disponivel: false` quando a leitura falhou (a tela não afirma nada). */
export function demandaVazia(disponivel = true, dias = JANELA_PADRAO_DIAS): DemandaResumo {
  return { disponivel, exemplo: false, dias: janelaDaDemanda(dias), pedidos: 0, pedidos24h: 0, unidades: 0, semProduto: { linhas: 0, unidades: 0, skus: 0 }, skusSemProduto: [], produtos: [], hub: [] }
}

// ---------------------------------------------------------------------------
// Sugestão da Linha de hoje
// ---------------------------------------------------------------------------
export interface ParametrosPlano {
  diasUteisMes: number
  /** Fração sobre a média (0.10). */
  margem: number
  diasCobertura: number
}

export interface EntradaPlanoDoDia {
  demanda: Pick<DemandaResumo, 'dias' | 'produtos' | 'hub'>
  /** Fichas ativas com a perda em FRAÇÃO (a interface guarda em percentual: converta antes). */
  boms: Bom[]
  parametros: ParametrosPlano
  /** Impresso − bipado hoje, por produto. */
  emProducao?: Record<Id, number>
  /** Produto que pode entrar no plano (existe e está ativo). Sem a função, todos podem. */
  elegivel?: (productId: Id) => boolean
}

export interface SugestaoDoDia {
  productId: Id
  /** Unidades vendidas na janela (venda direta do produto). */
  vendido: number
  /** Venda direta por dia de produção, com a margem. */
  demandaDireta: number
  /**
   * Dos produtos que levam este na ficha (componente fabricado), por dia de produção. SÓ INFORMATIVA: o bipe do pai
   * já baixa o insumo do componente (explode_bom desce na ficha dele); se isto entrasse no plano, o componente seria
   * impresso e bipado à parte e o insumo baixaria duas vezes (docs/melhorias.md 16a). Como no ES, componente
   * fabricado fica fora da projeção do dia; só a venda avulsa dele entra.
   */
  demandaDerivada: number
  /** O produto é componente fabricado de algum produto vendido na janela (demandaDerivada > 0). */
  componente: boolean
  /** O que o plano do dia cobre: a venda direta (demandaDireta). */
  demandaDia: number
  carteira: number
  /** Saldo de acabado no hub; ausente quando não há snapshot. */
  saldoHub?: number
  emProducao: number
  /** 'cobertura': com saldo no hub, repõe até os dias de cobertura. 'dia': sem saldo, a meta é a demanda de um dia. */
  base: 'cobertura' | 'dia'
  /** Unidades sugeridas para hoje (inteiro, arredondado para cima como a meta do ES). */
  sugerido: number
}

const teto = (v: number): number => Math.max(0, Math.ceil(v - 1e-9))

/**
 * Sugestão do dia por produto:
 *  - demanda/dia = venda direta por dia de produção (com margem). A demanda derivada dos pais que levam o
 *    produto na ficha (componente fabricado: pino, base) vem ao lado, só para informar: o bipe do pai já
 *    baixa o insumo do componente, e pôr o componente no plano faria o insumo baixar duas vezes (como no
 *    ES, componente fica fora da projeção do dia). Kit não entra aqui: a Base já divide o kit nos pedidos,
 *    então a venda chega por componente;
 *  - com saldo no hub: max(0, demanda × cobertura − saldo − em produção) (projetadoDoDia);
 *  - sem saldo no hub: a meta do dia, max(0, demanda − em produção). Com o saldo desconhecido, a fórmula
 *    da cobertura pediria a cobertura inteira todo dia, sem nunca convergir.
 * Ordem: maior sugestão primeiro, depois maior demanda.
 */
export function sugerirPlanoDoDia(e: EntradaPlanoDoDia): SugestaoDoDia[] {
  const { diasUteisMes, margem, diasCobertura } = e.parametros
  const vendas = new Map(e.demanda.produtos.map((p) => [p.productId, p]))
  const direta: Record<Id, number> = {}
  for (const p of e.demanda.produtos) {
    const d = demandaPorDiaDeProducao(n0(p.vendido), e.demanda.dias, diasUteisMes, margem)
    if (d > 0) direta[p.productId] = d
  }
  const derivada = demandaDerivadaDeComponentes(direta, e.boms)
  const hub = new Map(e.demanda.hub.map((h) => [h.productId, n0(h.saldo)]))
  const ids = new Set<Id>([...Object.keys(direta), ...Object.keys(derivada)])
  const out: SugestaoDoDia[] = []
  for (const productId of ids) {
    if (e.elegivel && !e.elegivel(productId)) continue
    const demandaDireta = direta[productId] ?? 0
    const demandaDerivada = derivada[productId] ?? 0
    const demandaDia = demandaDireta
    const emProducao = Math.max(0, n0(e.emProducao?.[productId] ?? 0))
    const saldoHub = hub.get(productId)
    const base = saldoHub === undefined ? 'dia' : 'cobertura'
    const bruto = saldoHub === undefined ? demandaDia - emProducao : projetadoDoDia({ demandaDia, diasCobertura, saldoHub, emProducao })
    const v = vendas.get(productId)
    out.push({ productId, vendido: n0(v?.vendido ?? 0), demandaDireta, demandaDerivada, componente: demandaDerivada > 0, demandaDia, carteira: n0(v?.carteira ?? 0), saldoHub, emProducao, base, sugerido: teto(bruto) })
  }
  return out.sort((a, b) => b.sugerido - a.sugerido || b.demandaDia - a.demandaDia || a.productId.localeCompare(b.productId))
}

/** Vendas da janela por produto, a entrada da necessidade de compra (a ficha explode até o insumo). */
export const vendasPorProduto = (demanda: Pick<DemandaResumo, 'produtos'>): Record<Id, number> =>
  Object.fromEntries(demanda.produtos.filter((p) => p.vendido > 0).map((p) => [p.productId, p.vendido]))

// ---------------------------------------------------------------------------
// O que ficou de fora e se a demanda está em dia
// ---------------------------------------------------------------------------
export interface ProdutoFora {
  productId: Id
  vendido: number
}

export interface ForaDaDemanda {
  /** SKUs sem produto nem apelido no Prodio: não viram demanda de nada. */
  skusSemProduto: SkuSemProduto[]
  semProduto: DemandaResumo['semProduto']
  /** Vendidos sem ficha técnica ativa: entram na produção, mas não na compra de insumo. */
  semFicha: ProdutoFora[]
  /** Vendidos com produto inativo ou excluído no Prodio: ficam fora da sugestão do dia. */
  inativos: ProdutoFora[]
}

export function foraDaDemanda(
  demanda: Pick<DemandaResumo, 'produtos' | 'skusSemProduto' | 'semProduto'>,
  catalogo: { ativo: (productId: Id) => boolean; temFicha: (productId: Id) => boolean },
): ForaDaDemanda {
  const semFicha: ProdutoFora[] = []
  const inativos: ProdutoFora[] = []
  for (const p of demanda.produtos) {
    if (!(p.vendido > 0)) continue
    if (!catalogo.ativo(p.productId)) inativos.push({ productId: p.productId, vendido: p.vendido })
    else if (!catalogo.temFicha(p.productId)) semFicha.push({ productId: p.productId, vendido: p.vendido })
  }
  const ordem = (a: ProdutoFora, b: ProdutoFora) => b.vendido - a.vendido
  return { skusSemProduto: demanda.skusSemProduto, semProduto: demanda.semProduto, semFicha: semFicha.sort(ordem), inativos: inativos.sort(ordem) }
}

export type SituacaoDemanda = 'em_dia' | 'sem_conector' | 'robo_parado' | 'sem_pedidos' | 'carga_atrasada'

export interface FrescorDemanda {
  situacao: SituacaoDemanda
  desatualizada: boolean
  ultimoPedido?: string
  /** Último fim de rodada bem-sucedida do robô, entre os conectores ativos (ISO). */
  ultimoOk?: string
}

/** Robô sem rodada boa há mais que isto está parado (o cron roda a cada 5 min). */
export const ROBO_PARADO_HORAS = 1
/** Último pedido lido mais velho que isto: a carga ainda não chegou nos dias recentes (ou o hub parou de receber). */
export const PEDIDO_ANTIGO_HORAS = 24

/**
 * A demanda está em dia? Em ordem: nenhum conector de pedidos ativo; robô sem rodada boa há mais de
 * 1 h (rodada de conector que a tela não conseguiu ler não conta nem a favor nem contra); nenhum
 * pedido gravado; último pedido lido com mais de 24 h (carga inicial ainda andando, ou o hub parou).
 */
export function frescorDaDemanda(e: { ultimoPedido?: string; robos: { ultimoOk?: string; lido: boolean }[]; agora: number }): FrescorDemanda {
  const oks = e.robos.filter((r) => r.lido).map((r) => ms(r.ultimoOk)).filter(Number.isFinite)
  const ultimoOk = oks.length ? new Date(Math.max(...oks)).toISOString() : undefined
  const base = { ultimoPedido: e.ultimoPedido, ultimoOk }
  if (e.robos.length === 0) return { ...base, situacao: 'sem_conector', desatualizada: true }
  const algumLido = e.robos.some((r) => r.lido)
  if (algumLido && (!ultimoOk || e.agora - ms(ultimoOk) > ROBO_PARADO_HORAS * 3_600_000)) return { ...base, situacao: 'robo_parado', desatualizada: true }
  const t = ms(e.ultimoPedido)
  if (!Number.isFinite(t)) return { ...base, situacao: 'sem_pedidos', desatualizada: true }
  if (e.agora - t > PEDIDO_ANTIGO_HORAS * 3_600_000) return { ...base, situacao: 'carga_atrasada', desatualizada: true }
  return { ...base, situacao: 'em_dia', desatualizada: false }
}
