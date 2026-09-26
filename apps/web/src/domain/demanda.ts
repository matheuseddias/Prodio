// Lógica de tela da demanda dos pedidos: liga o que está no store às regras do core (planejamento.ts e
// necessidade.ts). Tudo puro, sem React. Usado pela Linha de hoje, pela Necessidade de compra e pelo Painel.
import type { EntradasNecessidade } from '@prodio/core/necessidade'
import { COBERTURA_ACABADO_PADRAO, foraDaDemanda, frescorDaDemanda, sugerirPlanoDoDia, vendasPorProduto, type ForaDaDemanda, type FrescorDemanda, type SugestaoDoDia } from '@prodio/core/planejamento'
import { dataHoraBR, relativo } from './format'
import type { Bom, Connector, DailyPlanLine, DemandaResumo, Label, Material, Product, PurchaseOrder, ScanEvent, Supplier, Tenant } from './types'

/**
 * A interface guarda a perda da linha da ficha em PERCENTUAL (8 = 8%); o core espera FRAÇÃO (0,08).
 * Sem esta conversão, uma perda de 8% viraria 800% na explosão do core.
 */
export function bomsParaCore(boms: Bom[]): Bom[] {
  return boms.filter((b) => b.ativa).map((b) => ({ ...b, linhas: b.linhas.map((l) => ({ ...l, perdaPct: (Number(l.perdaPct) || 0) / 100 })) }))
}

/**
 * Em produção hoje (impresso − bipado) por produto. Quem está no plano usa a linha do plano (a view já
 * soma etiquetas e bipes); quem está fora usa as etiquetas e os bipes de hoje que o store já tem. Na
 * lista de bipes do store o bipe estornado já saiu (scansDoBanco e local.reverseScan tiram o original e
 * deixam só o estorno): conta-se só o 'produzido'.
 */
export function emProducaoHoje(plano: DailyPlanLine[], labels: Label[], scans: ScanEvent[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of labels) if (l.status === 'impressa') out[l.productId] = (out[l.productId] ?? 0) + (Number(l.quantidade) || 0)
  for (const s of scans) if (s.tipo === 'produzido') out[s.productId] = (out[s.productId] ?? 0) - Math.abs(Number(s.quantidade) || 0)
  for (const l of plano) out[l.productId] = l.impresso - l.bipado
  for (const k of Object.keys(out)) out[k] = Math.max(0, out[k])
  return out
}

export interface LinhaSugerida extends SugestaoDoDia {
  /** O produto já tem linha no plano de hoje (a sugestão aparece ao lado, nunca por cima). */
  noPlano: boolean
  projetadoAtual?: number
}

export interface EntradaSugestoes {
  tenant: Pick<Tenant, 'diasUteisMes' | 'margemProjecao' | 'diasCoberturaAcabado'>
  demanda: DemandaResumo
  boms: Bom[]
  products: Product[]
  dailyPlan: DailyPlanLine[]
  labels: Label[]
  scans: ScanEvent[]
}

/** Sugestão do dia (média de vendas) para todo produto ativo com demanda, marcando quem já está no plano. */
export function sugestoesDoDia(e: EntradaSugestoes): LinhaSugerida[] {
  const produtos = new Map(e.products.map((p) => [p.id, p]))
  const plano = new Map(e.dailyPlan.map((l) => [l.productId, l]))
  return sugerirPlanoDoDia({
    demanda: e.demanda,
    boms: bomsParaCore(e.boms),
    // A cobertura aqui é a do ACABADO no hub (tenants.dias_cobertura_acabado), não a de insumo da compra.
    parametros: { diasUteisMes: e.tenant.diasUteisMes, margem: e.tenant.margemProjecao, diasCobertura: e.tenant.diasCoberturaAcabado ?? COBERTURA_ACABADO_PADRAO },
    emProducao: emProducaoHoje(e.dailyPlan, e.labels, e.scans),
    elegivel: (id) => produtos.get(id)?.status === 'ativo',
  }).map((s) => ({ ...s, noPlano: plano.has(s.productId), projetadoAtual: plano.get(s.productId)?.projetado }))
}

/** O que "Aplicar sugestão" grava: produto fora do plano com sugestão acima de zero. */
export function linhasParaAplicar(sugestoes: LinhaSugerida[]): DailyPlanLine[] {
  return sugestoes
    .filter((s) => !s.noPlano && s.sugerido > 0)
    .map((s) => ({ productId: s.productId, demandaDia: Math.round(s.demandaDia * 100) / 100, projetado: s.sugerido, impresso: 0, bipado: 0, carteira: s.carteira, saldoHub: s.saldoHub ?? 0 }))
}

/** Demanda em dia? Só olha conector ligado que lê pedidos; `null` quando a demanda nem foi lida. */
export function frescorDaTela(demanda: DemandaResumo, connectors: Connector[], agora = Date.now()): FrescorDemanda | null {
  if (!demanda.disponivel) return null
  const robos = connectors.filter((c) => c.status !== 'desconectado' && c.capacidades.pedidos).map((c) => ({ ultimoOk: c.robo?.ultimoOk, lido: c.robo !== undefined }))
  return frescorDaDemanda({ ultimoPedido: demanda.ultimoPedido, robos, agora })
}

export interface AvisoDemanda {
  tom: 'warn' | 'danger' | 'info'
  titulo: string
  texto: string
}

/** Aviso para o topo das telas que usam a demanda. `null`: nada a dizer. */
export function avisoDaDemanda(demanda: DemandaResumo, frescor: FrescorDemanda | null): AvisoDemanda | null {
  if (!demanda.disponivel) {
    return { tom: 'danger', titulo: 'Não consegui ler a demanda dos pedidos', texto: 'As sugestões e a necessidade de compra ficam vazias até a leitura voltar. Recarregue a página; se continuar, avise o suporte (a função demand_summary do banco não respondeu).' }
  }
  if (!frescor || !frescor.desatualizada) return null
  const lidoAte = demanda.ultimoPedido ? `${dataHoraBR(demanda.ultimoPedido)} (${relativo(demanda.ultimoPedido)})` : ''
  switch (frescor.situacao) {
    case 'sem_conector':
      return { tom: 'info', titulo: 'Nenhum hub de pedidos ligado', texto: 'A média de vendas não se atualiza sozinha. Ligue a Base (ou outro hub) em Conectores.' }
    case 'robo_parado':
      return {
        tom: 'danger',
        titulo: 'Demanda desatualizada: o robô de pedidos está parado',
        texto: `${frescor.ultimoOk ? `Última leitura bem-sucedida ${relativo(frescor.ultimoOk)} (${dataHoraBR(frescor.ultimoOk)}).` : 'O robô ainda não terminou nenhuma leitura.'} Pedidos novos não entram na média até ele voltar; veja o cartão do conector.`,
      }
    case 'sem_pedidos':
      return { tom: 'warn', titulo: 'Nenhum pedido lido ainda', texto: 'O robô ainda não gravou pedido nenhum. Na carga inicial ele lê 200 pedidos a cada 5 minutos, do mais antigo para o mais novo.' }
    case 'carga_atrasada':
      return {
        tom: 'warn',
        titulo: `Demanda desatualizada: o último pedido lido é de ${lidoAte}`,
        texto: 'Se o robô está na carga inicial, ele ainda não chegou nos dias recentes (lê 200 pedidos a cada 5 minutos, do mais antigo para o mais novo): a média destes dias fica baixa até ele alcançar hoje. Se a carga já terminou, o hub parou de mandar pedidos.',
      }
    default:
      return null
  }
}

/** O que ficou de fora da demanda, pelo cadastro do store (produto ativo e com ficha). */
export function foraDaTela(demanda: DemandaResumo, products: Product[]): ForaDaDemanda {
  const produtos = new Map(products.map((p) => [p.id, p]))
  return foraDaDemanda(demanda, { ativo: (id) => produtos.get(id)?.status === 'ativo', temFicha: (id) => !!produtos.get(id)?.temFicha })
}

export type ModoCompra = 'metrica' | 'saldo'

/**
 * Entrada do core (necessidadeDeCompra) para a tela de Necessidade, pela venda dos pedidos na janela:
 *  - 'metrica' (métrica do mês): compra para cobrir 30 dias de consumo, menos saldo e trânsito;
 *  - 'saldo': compra para cobrir o lead time do insumo + os dias de cobertura da empresa.
 * Nos dois, "comprar até" guarda os dias de cobertura da empresa como segurança.
 */
export function entradaNecessidade(p: {
  modo: ModoCompra
  hoje: string
  demanda: DemandaResumo
  tenant: Pick<Tenant, 'margemProjecao' | 'diasCobertura'>
  boms: Bom[]
  materials: Material[]
  suppliers: Supplier[]
  purchaseOrders: PurchaseOrder[]
}): EntradasNecessidade {
  const seguranca = Math.max(0, p.tenant.diasCobertura || 0)
  return {
    modo: 'por_saldo',
    hoje: p.hoje,
    demandaProdutos: vendasPorProduto(p.demanda),
    periodoDias: p.demanda.dias,
    margem: p.tenant.margemProjecao,
    boms: bomsParaCore(p.boms),
    materiais: p.materials,
    fornecedores: p.suppliers,
    ocs: p.purchaseOrders,
    parametros: p.modo === 'metrica' ? { diasCobertura: 30, diasSeguranca: seguranca, coberturaMaisLead: false } : { diasCobertura: seguranca, diasSeguranca: seguranca, coberturaMaisLead: true },
  }
}
