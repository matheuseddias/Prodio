// Constantes compartilhadas pelas abas de Configurações.
import type { Location, Member } from '../../domain/types'

export const uid = () => Math.random().toString(36).slice(2, 10)

export const PAPEL_LABEL: Record<Member['papel'], string> = { admin: 'Admin', compras: 'Compras', producao: 'Produção', leitura: 'Leitura', dispositivo: 'Dispositivo' }
export const PAPEL_TONE: Record<Member['papel'], 'accent' | 'info' | 'ok' | 'neutral' | 'warn'> = { admin: 'accent', compras: 'info', producao: 'ok', leitura: 'neutral', dispositivo: 'warn' }
export const PAPEL_DESC: Record<Member['papel'], string> = {
  admin: 'Tudo, inclusive conectores, cobrança e usuários.',
  compras: 'Insumos, fornecedores, ordens de compra e recebimento de NF-e.',
  producao: 'Linha de hoje, etiquetas, apontamentos e ficha técnica do seu local.',
  leitura: 'Só visualiza relatórios e cadastros (contabilidade, sócio).',
  dispositivo: 'Aparelho do chão de fábrica: só bipa e imprime, sem acesso ao painel.',
}
export const LOCAL_TIPO: Record<Location['tipo'], string> = { fabrica: 'Fábrica', terceiro: 'Terceiro', deposito: 'Depósito' }
