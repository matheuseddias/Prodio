// Coletor das linhas do plano (uma por entidade + chave). A situação só piora: ok → aviso → problema.
import { comparar } from './normalizar'
import { ENTIDADES_IMPORTACAO, type EntidadeImportacao, type LinhaPlano } from './tipos'

const PESO = { ok: 0, aviso: 1, problema: 2 } as const

export class Registro {
  private readonly mapa = new Map<string, LinhaPlano>()

  private pegar(entidade: EntidadeImportacao, chave: string, nome?: string): LinhaPlano {
    const k = `${entidade}\u0000${chave}`
    let l = this.mapa.get(k)
    if (!l) {
      l = { entidade, chave, situacao: 'ok', mensagens: [] }
      this.mapa.set(k, l)
    }
    if (nome && !l.nome) l.nome = nome
    return l
  }

  private anotar(situacao: 'aviso' | 'problema', entidade: EntidadeImportacao, chave: string, mensagem: string, nome?: string): void {
    const l = this.pegar(entidade, chave, nome)
    if (PESO[situacao] > PESO[l.situacao]) l.situacao = situacao
    if (!l.mensagens.includes(mensagem)) l.mensagens.push(mensagem)
  }

  /** Item que entra no payload (garante a linha, com o nome para a prévia). */
  ok(entidade: EntidadeImportacao, chave: string, nome?: string): void {
    this.pegar(entidade, chave, nome)
  }

  aviso(entidade: EntidadeImportacao, chave: string, mensagem: string, nome?: string): void {
    this.anotar('aviso', entidade, chave, mensagem, nome)
  }

  problema(entidade: EntidadeImportacao, chave: string, mensagem: string, nome?: string): void {
    this.anotar('problema', entidade, chave, mensagem, nome)
  }

  /** Dá nome a uma linha que já existe (não cria linha nova). */
  nomear(entidade: EntidadeImportacao, chave: string, nome: string): void {
    const l = this.mapa.get(`${entidade}\u0000${chave}`)
    if (l && !l.nome) l.nome = nome
  }

  /** Linhas em ordem estável: entidade (ordem do contrato), depois chave. */
  todas(): LinhaPlano[] {
    const ordem = (e: EntidadeImportacao) => ENTIDADES_IMPORTACAO.indexOf(e)
    return [...this.mapa.values()].sort((a, b) => ordem(a.entidade) - ordem(b.entidade) || comparar(a.chave, b.chave))
  }
}
