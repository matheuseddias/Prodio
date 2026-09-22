// Conector ativo sem nenhuma credencial gravada não pode virar erro eterno.
//
// O seed cria o conector do BaseLinker com status 'conectado' e sem credencial (credencial é
// cifrada com a chave do worker, não dá para semear). Sem este tratamento, o cron de 5 minutos
// pegaria essa linha para sempre: montarConector lança "conector sem credenciais", o job grava
// ultimo_erro e nada muda na rodada seguinte — ruído infinito no log e um erro na tela que o dono
// não consegue entender.
//
// A cura é marcar 'desconectado' com um texto que diz o que fazer. Como listarConectoresAtivos só
// olha 'conectado' e 'erro', o conector sai do cron até alguém salvar a credencial (a rota de
// credenciais e o callback do OAuth reativam).
//
// Isto vale SÓ para a ausência total de credencial, que nunca se resolve sozinha. Falha de rede e
// token expirado são outra história: continuam caindo no caminho normal de erro, que repete na
// próxima rodada — rede volta, e o refresh do token é justamente o que o adaptador tenta fazer.
import type { Db } from '../db'
import { SEM_CREDENCIAIS } from '../conectores'
import { ErroConector } from '../conectores/tipos'
import { log, mensagemErro } from '../log'

export const MSG_SEM_CREDENCIAIS = 'sem credenciais: reconecte em Conectores'

export function ehSemCredenciais(e: unknown): boolean {
  return e instanceof ErroConector && e.codigo === SEM_CREDENCIAIS
}

// Devolve true quando o erro era falta de credencial e o conector foi desativado — o job então
// não deve gravar o erro como falha de sincronização.
export async function desativarSeSemCredenciais(row: { id: string; tenant_id: string; plataforma: string }, db: Pick<Db, 'marcarStatusConector'>, e: unknown): Promise<boolean> {
  if (!ehSemCredenciais(e)) return false
  try {
    await db.marcarStatusConector(row.id, row.tenant_id, 'desconectado', MSG_SEM_CREDENCIAIS)
    log('warn', 'conector.semCredenciais', { connector: row.id, tenant: row.tenant_id, plataforma: row.plataforma })
  } catch (e2) {
    // Se nem desativar deu certo, ainda assim não adianta tratar como falha de sync: o próximo
    // ciclo tenta desativar de novo.
    log('error', 'conector.semCredenciais.desativar', { connector: row.id, erro: mensagemErro(e2) })
  }
  return true
}
