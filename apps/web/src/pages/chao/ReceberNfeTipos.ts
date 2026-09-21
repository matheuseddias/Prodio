import type { NfeItem } from '../../domain/types'

export type Conf = 'ok' | 'divergente'
export type Classe = 'entra' | 'nao_entra'

/** Item da nota com o estado de conferência do chão de fábrica. */
export interface ItemConf extends NfeItem {
  conf?: Conf
  qtdRec?: number
  motivo?: string
  foto?: string
  classe?: Classe
}

export interface Resumo {
  entradas: { nome: string; qtd: number; un: string }[]
  ocs: { numero: number; status: 'total' | 'parcial' | 'sem_baixa' }[]
}

export const MOTIVOS = ['Faltou volume', 'Veio a mais', 'Avaria', 'Item trocado', 'Outro']

/** Remove os campos de conferência, devolvendo um NfeItem puro. */
export const limpar = (it: ItemConf): NfeItem => {
  const { nItem, cProd, xProd, ncm, cfop, uCom, qCom, vUnCom, vProd, materialId, fator, qtdConsumo } = it
  return { nItem, cProd, xProd, ncm, cfop, uCom, qCom, vUnCom, vProd, materialId, fator, qtdConsumo }
}
