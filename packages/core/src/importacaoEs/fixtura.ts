// Apoio dos testes da importação do ES: o backup sintético (dados inventados, e-mails em .invalid) e atalhos.
// Nunca use aqui um backup real: o arquivo do fundador não passa pelo repositório.
import bruto from '../fixtures/backup-es-sintetico.json?raw'
import { planejarImportacaoES } from '../importacaoEs'
import type { OpcoesImportacaoES, PlanoImportacaoES } from './tipos'

// O backup do ES é JSON solto; nos testes ele é manipulado livremente.
// oxlint-disable-next-line typescript/no-explicit-any
export type BackupBruto = Record<string, any>

export const NOME_ARQUIVO = 'backup-suprimentos-20260924-1810.json'
export const HOJE = '2026-09-26'

/** Cópia nova do backup sintético (pode mutar à vontade). */
export const backupSintetico = (): BackupBruto => JSON.parse(bruto) as BackupBruto

/** Planeja o backup sintético, opcionalmente mutado antes. */
export function planejar(mutar?: (b: BackupBruto) => void, opcoes: OpcoesImportacaoES = {}): PlanoImportacaoES {
  const b = backupSintetico()
  mutar?.(b)
  return planejarImportacaoES(b, { nomeArquivo: NOME_ARQUIVO, hoje: HOJE, ...opcoes })
}

/**
 * JSON com um item por linha: cada chave do topo na sua linha e, dentro de listas e objetos, um item por linha.
 * Mantém os fixtures (backup sintético e payload do snapshot) abaixo do limite de 400 linhas por arquivo.
 */
export function jsonUmItemPorLinha(valor: unknown): string {
  const v = JSON.parse(JSON.stringify(valor)) as Record<string, unknown>
  const j = (x: unknown) => JSON.stringify(x)
  const bloco = (x: unknown): string => {
    const itens = Array.isArray(x) ? x.map(j) : x && typeof x === 'object' ? Object.entries(x).map(([k, e]) => `${j(k)}: ${j(e)}`) : null
    if (!itens) return j(x)
    const [abre, fecha] = Array.isArray(x) ? ['[', ']'] : ['{', '}']
    return itens.length ? `${abre}\n${itens.map((i) => `    ${i}`).join(',\n')}\n  ${fecha}` : `${abre}${fecha}`
  }
  return `{\n${Object.entries(v).map(([k, x]) => `  ${j(k)}: ${bloco(x)}`).join(',\n')}\n}\n`
}

export const linhasDe = (p: PlanoImportacaoES, entidade: string, chave: string) => p.linhas.filter((l) => l.entidade === entidade && l.chave === chave)
export const mensagensDe = (p: PlanoImportacaoES, entidade: string, chave: string) => linhasDe(p, entidade, chave).flatMap((l) => l.mensagens)
export const situacaoDe = (p: PlanoImportacaoES, entidade: string, chave: string) => linhasDe(p, entidade, chave)[0]?.situacao
