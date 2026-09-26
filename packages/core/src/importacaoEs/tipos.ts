// Contrato da importação do backup do Eddias Suprimentos (ES) para o Prodio.
// A web importa daqui (por '@prodio/core/importacaoEs'); a RPC public.import_catalog recebe o
// PayloadImportacao e devolve o ResultadoImportacao. Nomes de campo do payload = colunas do banco.
import type { BomCalc } from '../tipos'

export type EntidadeImportacao = 'fornecedor' | 'insumo' | 'produto' | 'apelido' | 'vinculo' | 'ficha'

export const ENTIDADES_IMPORTACAO: readonly EntidadeImportacao[] = [
  'fornecedor',
  'insumo',
  'produto',
  'apelido',
  'vinculo',
  'ficha',
]

export interface PayloadImportacao {
  versao: 1
  origem: 'es'
  fornecedores: FornecedorImport[]
  insumos: InsumoImport[]
  produtos: ProdutoImport[]
  vinculos: VinculoImport[]
  fichas: FichaImport[]
}

export interface FornecedorImport {
  cnpj: string
  nome: string
  regime?: 'simples' | 'normal'
  lead_time_dias?: number
  condicao_pagamento?: number[]
  contato?: string
}

export interface InsumoImport {
  sku: string
  nome: string
  ncm?: string
  unidade_compra: string
  unidade_consumo: string
  fator_conversao: number
  minimo?: number
  custo_referencia?: number
  fornecedor_padrao_cnpj?: string
  lead_time_dias?: number
}

export interface ProdutoImport {
  sku: string
  nome: string
  familia?: string
  atributos: Record<string, string>
  ean?: string
  ncm?: string
  status: 'ativo' | 'inativo'
  peso_kg?: number
  peso_cubado_kg?: number
  custo_manual?: number
  apelidos: string[]
}

export interface VinculoImport {
  fornecedor_cnpj: string
  insumo_sku: string
  codigo_fornecedor?: string
  unidade_compra?: string
  fator?: number
  preco?: number
  aliq_icms?: number
  inteiro?: boolean
}

export interface LinhaFichaImport {
  tipo: 'insumo' | 'produto'
  insumo_sku?: string
  componente_sku?: string
  consumo: number
  unidade: string
  perda_pct: 0
  calc?: BomCalc
}

export interface FichaImport {
  produto_sku: string
  linhas: LinhaFichaImport[]
}

export interface OpcoesImportacaoES {
  nomeArquivo?: string
  hoje?: string
  cnpjManual?: Record<string, string>
  cnpjPorNomeNoProdio?: Record<string, string>
  prefixoPrincipal?: string /* 'ED' */
}

export interface LinhaPlano {
  entidade: EntidadeImportacao
  chave: string
  nome?: string
  situacao: 'ok' | 'aviso' | 'problema'
  mensagens: string[]
}

export type SentidoDepara = 'TM→ED' | 'ED→TM' | 'misto' | 'sem de/para'

export interface ContagemPlano {
  noArquivo: number
  entram: number
  avisos: number
  problemas: number
}

export interface PlanoImportacaoES {
  aceito: boolean
  recusa?: string
  origem: {
    dataArquivo?: string
    idadeDias?: number
    sentidoDepara: SentidoDepara
    ignorado: { secao: string; itens: number }[]
  }
  avisosGerais: string[]
  fornecedoresSemCnpj: { nome: string; insumos: number }[]
  payload: PayloadImportacao
  linhas: LinhaPlano[]
  contagens: Record<EntidadeImportacao, ContagemPlano>
}

export interface ContagemResultado {
  novos: number
  atualizados: number
  iguais: number
  problemas: number
}

export interface LinhaResultado {
  entidade: EntidadeImportacao
  chave: string
  situacao: 'novo' | 'atualizado' | 'problema' | 'aviso'
  campos?: string[]
  mensagem?: string
}

export interface ResultadoImportacao {
  simulacao: boolean
  exemplo: { produtos: number; insumos: number; fornecedores: number }
  contagens: Record<EntidadeImportacao, ContagemResultado>
  linhas: LinhaResultado[]
}

export interface LinhaPrevia {
  entidade: EntidadeImportacao
  chave: string
  nome?: string
  situacao: 'novo' | 'atualizado' | 'igual' | 'problema'
  campos: string[]
  mensagens: string[]
  temAviso: boolean
}

export interface ContagemPrevia extends ContagemResultado {
  avisos: number
}

export interface PreviaImportacao {
  linhas: LinhaPrevia[]
  contagens: Record<EntidadeImportacao, ContagemPrevia>
  bloqueios: string[]
  totalGravacoes: number
  podeGravar: boolean
}
