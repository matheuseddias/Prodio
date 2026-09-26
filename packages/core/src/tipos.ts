// Tipos de domínio do Prodio (interface apenas; dados em memória por enquanto).

export type Id = string

export interface Tenant {
  id: Id
  nome: string
  cnpj: string
  regime: 'simples' | 'presumido' | 'real'
  creditaImpostos: boolean
  horaVirada: string // "05:00"
  diasUteisMes: number
  margemProjecao: number // 0.10
  diasCobertura: number
  margemAlvoPadrao: number // 0.20, usada na precificação
  exigirProjecaoParaImprimir: boolean
  perfisEtiqueta: LabelProfile[]
}

// Perfil de etiqueta por família: quais etiquetas saem para cada peça.
export interface LabelProfile {
  familia: string
  prefixo: string
  tipos: LabelKind[] // etiquetas geradas por peça
  unidadesPorCaixa: number
  instrucaoMontagem?: string // texto da etiqueta de processo, quando existir
}
export type LabelKind = 'produto' | 'montagem' | 'caixa'

// Canal de venda configurável pelo cliente (precificação).
export interface FaixaFrete {
  ateKg: number
  valor: number
}
export interface Channel {
  id: Id
  nome: string
  preset?: 'mercadolivre' | 'shopee' | 'amazon' | 'tiktok' | 'magalu' | 'loja' | 'atacado'
  ativo: boolean
  comissaoPct: number
  taxaFixa: number
  taxaFixaAbaixoDe?: number // aplica taxa fixa só se preço < valor
  freteVendedor: FaixaFrete[] // custo de envio pago pelo vendedor por faixa de peso
  freteGratisAcimaDe?: number // preço a partir do qual o vendedor paga o frete
  impostoVendaPct: number
  adsPct: number
  parcelamentoPct: number
  outrosPct: number
  observacao?: string
}

export interface Location {
  id: Id
  nome: string
  tipo: 'fabrica' | 'terceiro' | 'deposito'
}

export interface Unit {
  code: string
  nome: string
  tipo: 'unidade' | 'comprimento' | 'area' | 'peso' | 'volume'
}

export interface Product {
  id: Id
  sku: string
  nome: string
  familia: string
  atributos: Record<string, string>
  ean?: string
  ncm?: string
  status: 'ativo' | 'inativo'
  aliases: string[] // SKUs comerciais
  temFicha: boolean
  custoFicha?: number
  pesoKg?: number
  pesoCubadoKg?: number
  precoVenda?: Partial<Record<Id, number>> // preço praticado por canal
}

export interface Material {
  id: Id
  sku: string
  nome: string
  unidadeCompra: string
  unidadeConsumo: string
  fatorConversao: number
  ncm?: string
  minimo: number
  saldo: number
  custoMedio: number
  fornecedorPadraoId?: Id
  leadTimeDias: number
}

export interface Supplier {
  id: Id
  nome: string
  cnpj: string
  regime: 'simples' | 'normal'
  leadTimeDias: number
  condicaoPagamento: number[]
  contato?: string
}

export interface BomLine {
  id: Id
  tipo: 'insumo' | 'produto'
  materialId?: Id
  componentId?: Id
  consumo: number
  unidade: string
  perdaPct: number
}

export interface Bom {
  productId: Id
  versao: number
  ativa: boolean
  linhas: BomLine[]
  atualizadoEm: string
}

export interface DailyPlanLine {
  productId: Id
  demandaDia: number // projeção automática
  projetado: number // editado pela encarregada
  impresso: number
  bipado: number
  carteira: number // pedidos firmes
  saldoHub: number
}

export type LabelStatus = 'reservada' | 'impressa' | 'anulada'
export interface Label {
  serial: string
  productId: Id
  tipo: 'unidade' | 'caixa'
  quantidade: number
  status: LabelStatus
  dia: string
  seq: number
}

export interface ScanEvent {
  id: Id
  serial: string
  productId: Id
  operador: string
  dispositivo: string
  etapa: string
  tipo: 'produzido' | 'estorno' | 'refugo'
  quantidade: number
  em: string
  competencia: string
  sincronizado: boolean
}

// ---------------------------------------------------------------------------
// Histórico dos gráficos (Painel e Produtividade)
// ---------------------------------------------------------------------------
/** Um dia do histórico de produção: o projetado do plano e o bipado daquela competência. */
export interface HistoricoProducaoDia {
  dia: string
  projetado: number
  produzido: number
}

/** Um dia do histórico de vendas: unidades dos pedidos confirmados naquele dia. */
export interface HistoricoVendasDia {
  dia: string
  unidades: number
}

/**
 * Séries históricas dos gráficos. Vêm do banco (v_daily_plan para produção, orders/order_items
 * para vendas) ou, no modo de demonstração sem banco, dos dados de exemplo — e aí `exemplo` é
 * true e a tela tem de dizer isso. Dia sem linha no banco é zero, nunca número inventado.
 * `truncada` marca a série que estourou o limite de linhas da leitura: os dias que sobraram são
 * reais, mas cobrem um período menor do que o pedido.
 */
export interface Historico {
  producao: HistoricoProducaoDia[]
  vendas: HistoricoVendasDia[]
  exemplo: boolean
  truncada: { producao: boolean; vendas: boolean }
}

export type MoveType =
  | 'entrada_nfe'
  | 'entrada_manual'
  | 'baixa_producao'
  | 'ajuste'
  | 'perda'
  | 'estorno'
  | 'saldo_inicial'

export interface StockMove {
  id: Id
  materialId: Id
  tipo: MoveType
  delta: number
  custoUnit?: number
  ref?: string
  motivo?: string
  por: string
  em: string
}

export type PoStatus = 'aberta' | 'parcial' | 'recebida' | 'cancelada'
export interface PurchaseOrderItem {
  id: Id
  materialId: Id
  unidadeCompra: string
  fator: number
  qtd: number
  qtdRecebida: number
  preco: number
  ipiPct: number
}
export interface PurchaseOrder {
  id: Id
  numero: number
  supplierId: Id
  status: PoStatus
  criadaEm: string
  entregaPrevista?: string
  condicaoPagamento: number[]
  itens: PurchaseOrderItem[]
  observacao?: string
}

export type NfeStatus = 'aguardando_xml' | 'pendente' | 'conferida' | 'recebida' | 'ignorada'
export interface NfeItem {
  nItem: number
  cProd: string
  xProd: string
  ncm: string
  cfop: string
  uCom: string
  qCom: number
  vUnCom: number
  vProd: number
  materialId?: Id // De-Para
  fator?: number
  qtdConsumo?: number
}
export interface NfeInbound {
  chave: string
  numero: number
  serie: number
  cnpjEmitente: string
  emitente: string
  supplierId?: Id
  emissao: string
  valorTotal: number
  origem: 'upload' | 'email' | 'erp' | 'dfe' | 'sem_xml'
  status: NfeStatus
  poIds: Id[]
  itens: NfeItem[]
}

export interface Connector {
  id: Id
  plataforma: 'baselinker' | 'bling' | 'tiny' | 'omie' | 'magis5'
  nome: string
  status: 'conectado' | 'erro' | 'desconectado'
  ultimoSync?: string
  /**
   * `connectors.ultimo_erro`: o motivo da última falha, como o worker gravou (cron de 5 min ou
   * teste de conexão). Já vem escrito em português para o dono ler — é o único sintoma que existe
   * de um robô que parou, e sem ele a tela só sabe dizer "—".
   */
  ultimoErro?: string
  /**
   * `sync_state.cursor` em texto para gente ler: de onde o robô continua a leitura. Não é
   * `connectors.config.cursor`, que ninguém grava.
   */
  cursor?: string
  /**
   * Pedidos do conector com `confirmed_at` nas últimas 24 h que já estão no Prodio (contagem em
   * `orders`). Ausente quando a contagem não foi feita, e aí a tela mostra "—" em vez de zero.
   */
  pedidos24h?: number
  outboxPendentes?: number
  /**
   * O que só o ROBÔ do worker (cron de 5 min) grava, lido de `sync_state`. O botão "Sincronizar
   * agora" não escreve lá; `ultimoSync` conta o robô e o botão juntos. Ausente quando a tela não
   * conseguiu ler: aí ela não afirma nada sobre o robô.
   */
  robo?: RoboConector
  capacidades: {
    pedidos: boolean
    webhooks: boolean
    catalogo: boolean
    pushEstoque: boolean
    pushCatalogo: boolean // enviar produtos do Prodio para o ERP/hub
    nfeCompra: boolean
  }
}

/** `sync_state` de um conector. Sem linha no banco, os dois instantes ficam vazios e `rodadas` é 0. */
export interface RoboConector {
  /** `last_run_at`: início da última tentativa do robô, gravado antes de ele falar com a plataforma. */
  ultimaTentativa?: string
  /** `last_ok_at`: fim da última tentativa do robô que terminou bem. */
  ultimoOk?: string
  /** `runs`: tentativas que terminaram, bem ou com falha tratada. Rodada morta no meio não conta. */
  rodadas: number
}

export interface OutboxItem {
  id: Id
  connectorId: Id
  productId: Id
  delta: number
  status: 'pendente' | 'aplicado' | 'erro'
  em: string
  erro?: string
}

export interface Member {
  id: Id
  nome: string
  email?: string
  papel: 'admin' | 'compras' | 'producao' | 'leitura' | 'dispositivo'
  localId?: Id
  ultimoAcesso?: string
}

export interface Device {
  id: Id
  nome: string
  localId: Id
  registradoEm: string
  ultimoBipe?: string
  pendentesOffline: number
}

export interface Operator {
  id: Id
  nome: string
  pin: string
}

export interface Notification {
  id: Id
  tipo: 'minimo' | 'oc_atrasada' | 'nfe' | 'conector' | 'cadastro'
  texto: string
  em: string
  lida: boolean
}

// ---------------------------------------------------------------------------
// Ficha técnica: calculadora de consumo por partes (bom_lines.calc)
// ---------------------------------------------------------------------------
export type BomCalcTipo = 'area' | 'rolo' | 'comprimento' | 'peso' | 'unidade'
export interface BomCalcParte {
  nome?: string // rótulo da peça (ex.: "Tampo"), só para leitura
  qtd?: number // quantas peças iguais (padrão 1)
  largCm?: number // area e rolo
  altCm?: number // area e rolo
  compCm?: number // comprimento
  pesoG?: number // peso
  un?: number // unidade
}
export interface BomCalc {
  tipo: BomCalcTipo
  partes: BomCalcParte[]
  larguraRoloM?: number // obrigatória para tipo 'rolo'
  perda?: { tipo: 'pct' | 'fixa'; valor: number } // pct em fração (0.05 = 5%)
}

// Tipos da NF-e parseada ficam em arquivo próprio (limite de 400 linhas); continuam expostos por aqui.
export * from './tipos-nfe'

export type Regime = Tenant['regime']
