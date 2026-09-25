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
//
// O ROBÔ (incidente de 25/09/2026). O cartão mostrou "Conectado" e "Último sync há 1 d" por um dia
// inteiro enquanto o cron não gravava nada, e o botão funcionava. `connectors.ultimo_sync` não
// separa os dois: é gravado pelo robô E pelo botão. O worker passou a gravar em `sync_state` só o
// que é do robô — `last_run_at` (início da última tentativa, gravado antes de falar com a
// plataforma) e `last_ok_at` (fim da última que deu certo) — e o botão não escreve lá. Com isso a
// tela separa três casos que antes pareciam iguais: o robô tenta e termina; tenta e morre no meio;
// nem tenta. Contrato e consulta equivalente em docs/deploy.md §9.
import { comoFrase } from '../../data/worker'
import { relativo } from '../../domain/format'
import type { Connector, RoboConector } from '../../domain/types'

/** De quanto em quanto tempo o cron do worker roda (apps/worker/wrangler.toml, [triggers]). */
export const CICLO_CRON_MIN = 5

/**
 * Quantos ciclos sem notícia até a tela parar de pedir paciência e começar a desconfiar do robô.
 * Seis ciclos (meia hora) absorvem uma plataforma lenta e um deploy do worker sem acusar falha à
 * toa, e ainda avisam no mesmo turno de trabalho.
 */
export const CICLOS_ATE_DESCONFIAR = 6

export type TomSituacao = 'ok' | 'info' | 'warn' | 'erro'

/**
 * Quantos ciclos sem tentativa do robô até afirmar que ele não está rodando. O pulso é gravado no
 * começo de toda rodada, então três ciclos (15 min) já não são atraso: é o agendamento parado.
 */
export const CICLOS_SEM_PULSO = 3

/** Quanto uma rodada pode durar antes de a tela concluir que ela morreu no meio. */
export const MINUTOS_RODADA = 2

/**
 * `last_run_at` vem do relógio do worker e `last_ok_at` do relógio do banco. Numa rodada que deu
 * certo em poucos segundos, uma diferença pequena entre os dois relógios não pode virar "morreu".
 */
const FOLGA_RELOGIO_MS = 60_000

/** O que a tela sabe do robô: em dia, lendo agora, morre no meio, parado, ou ainda não passou. */
export type DiagnosticoRobo = 'em_dia' | 'lendo' | 'morre' | 'parado' | 'aguardando'

export interface Situacao {
  tom: TomSituacao
  /** Uma linha, o que está acontecendo. */
  titulo: string
  /** A segunda linha: o motivo que o worker gravou, ou o que fazer a respeito. */
  texto?: string
  /** Presente quando a frase é sobre o robô (lida de `sync_state`), e não sobre a conexão. */
  robo?: DiagnosticoRobo
}

/** Robô com problema: o cartão mostra isto mesmo depois de um clique bem-sucedido no botão. */
export const roboComProblema = (s: Situacao | null): boolean => s?.robo === 'morre' || s?.robo === 'parado'

const ONDE_LOGS = 'no painel da Cloudflare, em Workers & Pages › prodio-worker › Logs'
const ONDE_CRON = 'no painel da Cloudflare, em Workers & Pages › prodio-worker › Settings › Trigger Events'

const SEM_MOTIVO = 'O worker não gravou o motivo. Use "Sincronizar agora" para tentar de novo e ver o erro na hora.'

/** Instante de `iso` em ms, ou null quando não há data aproveitável. */
function instante(iso: string | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/** Minutos desde `iso`, ou null quando não há data aproveitável. */
function minutosDesde(iso: string | undefined, agora: number): number | null {
  const t = instante(iso)
  return t === null ? null : Math.max(0, Math.round((agora - t) / 60_000))
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

  if (c.status === 'erro') {
    if (/^outbox:/i.test(c.ultimoErro?.trim() ?? '')) return situacaoDoOutbox(c, erro, agora)
    return { tom: 'erro', titulo: 'A última sincronização falhou', texto: erro || SEM_MOTIVO }
  }

  // Conectado e mesmo assim com erro guardado: o worker limpa `ultimo_erro` quando dá certo, então
  // isto é uma falha que já foi superada. Vale dizer, sem alarme.
  if (erro) return { tom: 'warn', titulo: 'Houve uma falha antes, e a conexão voltou', texto: erro }

  // Com `sync_state` lido, quem responde é o robô. Sem ele (modo de demonstração, ou leitura que
  // falhou), vale o raciocínio antigo, que só conta com `ultimo_sync`.
  if (c.robo) return situacaoDoRobo(c, c.robo, agora)

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

  // CUIDADO com o que se afirma aqui (este ramo só vale sem `sync_state`). `connectors.ultimo_sync`
  // é gravado por QUALQUER sincronização bem-sucedida: a do cron E a do botão "Sincronizar agora".
  // Ou seja: um cron morto + um dono que acabou de apertar
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

/**
 * O robô, a partir de `sync_state`. Só chega aqui conector conectado e sem erro gravado: falha
 * tratada já virou status 'erro' com o motivo, e isso aparece antes.
 */
function situacaoDoRobo(c: Connector, robo: RoboConector, agora: number): Situacao {
  const limite = CICLO_CRON_MIN * CICLOS_SEM_PULSO
  const tentou = instante(robo.ultimaTentativa)
  const ok = instante(robo.ultimoOk)

  if (tentou === null) {
    // Nenhuma tentativa registrada. Pode ser um conector que acabou de ser ligado; mas se já houve
    // leitura bem-sucedida (do botão) há mais de 15 minutos, o robô teve tempo e não veio.
    const desdeLeitura = minutosDesde(c.ultimoSync, agora)
    if (desdeLeitura !== null && desdeLeitura > limite) {
      return {
        tom: 'erro',
        robo: 'parado',
        titulo: 'O robô não está rodando',
        texto: `Nenhuma tentativa automática ficou registrada até agora, e a última leitura (${relativo(c.ultimoSync!)}) não foi dele. ${semRobo()}`,
      }
    }
    return {
      tom: 'info',
      robo: 'aguardando',
      titulo: 'Conectado, o robô ainda não passou',
      texto: `Nenhuma tentativa automática foi registrada até agora. O robô do Prodio passa a cada ${CICLO_CRON_MIN} minutos: se você acabou de conectar, espere um ciclo. Se já faz mais de ${limite} minutos, o agendamento do worker não está disparando: confira ${ONDE_CRON}. "Sincronizar agora" lê na hora.`,
    }
  }

  if (agora - tentou > limite * 60_000) {
    return {
      tom: 'erro',
      robo: 'parado',
      titulo: 'O robô não está rodando',
      texto: `A última tentativa automática começou ${relativo(robo.ultimaTentativa!)}, e ele deveria tentar a cada ${CICLO_CRON_MIN} minutos. ${semRobo()}`,
    }
  }

  // A última tentativa começou depois do último sucesso: ou está rodando agora, ou morreu no meio.
  const tentouDepoisDoOk = ok === null || tentou - ok > FOLGA_RELOGIO_MS
  if (!tentouDepoisDoOk) {
    return {
      tom: 'ok',
      robo: 'em_dia',
      titulo: 'O robô está sincronizando sozinho',
      texto: `A última rodada automática terminou ${relativo(robo.ultimoOk!)}. Ele repete a cada ${CICLO_CRON_MIN} minutos.`,
    }
  }

  const anterior = ok === null ? 'nenhuma rodada automática terminou bem até agora' : `a última que terminou bem foi ${relativo(robo.ultimoOk!)}`
  if (agora - tentou < MINUTOS_RODADA * 60_000) {
    return {
      tom: 'info',
      robo: 'lendo',
      titulo: 'O robô está lendo agora',
      texto: `A rodada começou ${relativo(robo.ultimaTentativa!)}; ${anterior}. Recarregue a página em alguns minutos para ver se ela terminou.`,
    }
  }

  return {
    tom: 'warn',
    robo: 'morre',
    titulo: 'O robô começa, mas não termina',
    texto:
      `A última tentativa automática começou ${relativo(robo.ultimaTentativa!)} e não terminou bem; ${anterior}. ` +
      `Nada se perde: cada página que ela terminou de ler já está gravada, e a próxima rodada, em até ${CICLO_CRON_MIN} minutos, continua de onde esta parou. ` +
      // Não diz só "morre": a mesma marca fica quando a rodada falhou com motivo e um clique bem-sucedido
      // no botão apagou esse motivo do cartão. Os três nomes cobrem os dois casos.
      `Para ver o motivo, abra os logs do worker ${ONDE_LOGS} e procure exceededCpu (limite de CPU do plano da Cloudflare), sync.falha ou cron.falha.`,
  }
}

/**
 * Falha do envio de estoque. O worker grava `outbox: …` em `ultimo_erro` e põe o conector em 'erro'
 * (apps/worker/src/jobs/aplicarOutbox.ts), o mesmo campo da falha de leitura de pedidos. Chamar isso
 * de "a última sincronização falhou" fazia o dono concluir que os pedidos pararam de entrar — e o
 * envio roda DEPOIS da leitura, na mesma rodada, então o mais comum é a leitura ter dado certo.
 * Só se afirma que os pedidos seguem entrando quando o diário do robô mostra isso.
 */
function situacaoDoOutbox(c: Connector, erro: string, agora: number): Situacao {
  const ok = instante(c.robo?.ultimoOk)
  const pedidosEmDia = ok !== null && agora - ok <= CICLO_CRON_MIN * CICLOS_SEM_PULSO * 60_000
  return {
    tom: 'erro',
    titulo: 'O envio de estoque para a plataforma falhou',
    texto:
      `${erro} Isto é o envio do saldo produzido (Outbox), não a leitura de pedidos` +
      (pedidosEmDia ? `: os pedidos continuam entrando, e a última leitura automática terminou ${relativo(c.robo!.ultimoOk!)}.` : '.'),
  }
}

/** O que fazer quando o robô nem tenta. */
function semRobo(): string {
  return (
    `O agendamento do worker não está disparando, ou o worker cai antes de chegar a este conector. Enquanto isso, pedidos só entram pelo botão "Sincronizar agora". ` +
    `Confira se o cron dispara ${ONDE_CRON}, e procure cron.inicio na aba Logs do mesmo worker.`
  )
}
