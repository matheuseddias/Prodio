// O que o cartão do conector diz quando não há número para mostrar.
//
// Um sync só acontece de duas formas: o cron do worker, de 5 em 5 minutos (apps/worker/wrangler.toml,
// [triggers] crons), ou o botão "Sincronizar agora". Quem acabou de conectar não via nem um nem
// outro — o cartão mostrava "—" em tudo — e ficava esperando sem saber se ia acontecer alguma coisa.
// Pior: quando o robô falha, o worker grava o motivo em `connectors.ultimo_erro`, e esse texto não
// chegava à tela. O erro existia só para quem soubesse rodar `wrangler tail` num terminal.
//
// Esta é a resposta da tela para "e aí, funcionou?". Função pura, com `agora` injetável para o
// teste; quem desenha o resultado é o ConectorCard.
import { comoFrase } from '../../data/worker'
import { relativo } from '../../domain/format'
import type { Connector } from '../../domain/types'

/** De quanto em quanto tempo o cron do worker roda (apps/worker/wrangler.toml, [triggers]). */
export const CICLO_CRON_MIN = 5

/**
 * Quantos ciclos sem notícia até a tela parar de pedir paciência e começar a desconfiar do robô.
 * Seis ciclos (meia hora) absorvem uma plataforma lenta e um deploy do worker sem acusar falha à
 * toa, e ainda avisam no mesmo turno de trabalho.
 */
export const CICLOS_ATE_DESCONFIAR = 6

export type TomSituacao = 'ok' | 'info' | 'warn' | 'erro'

export interface Situacao {
  tom: TomSituacao
  /** Uma linha, o que está acontecendo. */
  titulo: string
  /** A segunda linha: o motivo que o worker gravou, ou o que fazer a respeito. */
  texto?: string
}

const SEM_MOTIVO = 'O worker não gravou o motivo. Use "Sincronizar agora" para tentar de novo e ver o erro na hora.'

/** Minutos desde `iso`, ou null quando não há data aproveitável. */
function minutosDesde(iso: string | undefined, agora: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.round((agora - t) / 60_000)) : null
}

/**
 * A situação do conector em uma frase, ou null quando não há nada a explicar (conector que nunca
 * foi conectado: o cartão já mostra o botão "Conectar", e o resto seria ruído).
 */
export function situacaoConector(c: Connector, agora: number = Date.now()): Situacao | null {
  // `ultimo_erro` sai do worker em minúscula e sem ponto final, para ser encaixado numa frase
  // maior (apps/worker/src/rotas/testar.ts, mensagemDaFalha). Aqui ele é a frase inteira.
  const erro = c.ultimoErro?.trim() ? comoFrase(c.ultimoErro) : ''

  // Desconectado com motivo é o caso mais traiçoeiro: o cron desativa sozinho um conector sem
  // credencial (apps/worker/src/jobs/semCredenciais.ts) e, sem este texto, o conector simplesmente
  // aparecia "Desconectado" um dia depois de ter sido conectado, sem explicação nenhuma.
  if (c.status === 'desconectado') return erro ? { tom: 'warn', titulo: 'O robô parou de sincronizar este conector', texto: erro } : null

  if (c.status === 'erro') return { tom: 'erro', titulo: 'A última sincronização falhou', texto: erro || SEM_MOTIVO }

  // Conectado e mesmo assim com erro guardado: o worker limpa `ultimo_erro` quando dá certo, então
  // isto é uma falha que já foi superada. Vale dizer, sem alarme.
  if (erro) return { tom: 'warn', titulo: 'Houve uma falha antes, e a conexão voltou', texto: erro }

  const min = minutosDesde(c.ultimoSync, agora)
  if (min === null) {
    // Sem dizer "o primeiro ciclo ainda não passou": a tela não sabe há quanto tempo o conector
    // foi ligado (o banco não manda o created_at para cá), e um conector ligado ontem com
    // `ultimo_sync` vazio é justamente o robô parado — o caso em que pedir paciência é mentira.
    return {
      tom: 'info',
      titulo: 'Conectado, mas ainda não sincronizou',
      texto: `Nenhuma leitura de pedidos chegou até agora. O robô do Prodio busca sozinho a cada ${CICLO_CRON_MIN} minutos: se você acabou de conectar, espere um ciclo; se já faz mais tempo, use "Sincronizar agora" — o motivo da falha, se houver, aparece aqui na hora.`,
    }
  }

  if (min > CICLO_CRON_MIN * CICLOS_ATE_DESCONFIAR) {
    return {
      tom: 'warn',
      titulo: `Sem sincronizar ${relativo(c.ultimoSync!)}`,
      texto: `O robô deveria rodar a cada ${CICLO_CRON_MIN} minutos. Use "Sincronizar agora": se funcionar, o problema é o robô do worker, não a conexão com a plataforma.`,
    }
  }

  // CUIDADO com o que se afirma aqui. `connectors.ultimo_sync` é gravado por QUALQUER
  // sincronização bem-sucedida: a do cron E a do botão "Sincronizar agora" (o worker chama o mesmo
  // worker_set_sync_state nos dois casos). Ou seja: um cron morto + um dono que acabou de apertar
  // o botão produz exatamente este estado, e a frase antiga ("Sincronizando sozinho a cada 5
  // minutos") transformava o botão numa máquina de provar uma autonomia que não existe — o oposto
  // do motivo pelo qual esta tela foi escrita.
  // Então: afirma-se só o que é verdade (a última leitura deu certo) e entrega-se ao dono o teste
  // que separa os dois casos. Se o robô estiver mesmo parado, meia hora depois o ramo de cima
  // ("Sem sincronizar…") cobra a conta sozinho.
  return {
    tom: 'ok',
    titulo: 'A última leitura deu certo',
    texto: `O robô deve repetir sozinho a cada ${CICLO_CRON_MIN} minutos. Se "Último sync" só mudar quando você aperta "Sincronizar agora", quem parou foi o robô.`,
  }
}
