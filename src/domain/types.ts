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
  cursor?: string
  pedidos24h?: number
  outboxPendentes?: number
  capacidades: {
    pedidos: boolean
    webhooks: boolean
    catalogo: boolean
    pushEstoque: boolean
    nfeCompra: boolean
  }
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
