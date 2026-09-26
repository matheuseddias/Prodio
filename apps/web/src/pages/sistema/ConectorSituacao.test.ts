// A tela promete duas coisas ao dono da fábrica: nunca esconder um erro que o worker gravou, e
// nunca deixar um "—" no lugar de uma explicação. Estes testes prendem as duas.
import { describe, expect, it } from 'vitest'
import { CAPACIDADES } from '../../data/mapeadoresConectores'
import type { Connector, RoboConector } from '../../domain/types'
import { CICLOS_ATE_DESCONFIAR, CICLOS_SEM_PULSO, CICLO_CRON_MIN, MINUTOS_RODADA, PREFIXO_AVISO_CRON, roboComProblema, situacaoConector } from './ConectorSituacao'

const AGORA = Date.now()
const minAtras = (min: number) => new Date(AGORA - min * 60_000).toISOString()

const conector = (p: Partial<Connector> = {}): Connector => ({
  id: 'c1',
  plataforma: 'baselinker',
  nome: 'Eddias (BaseLinker)',
  status: 'conectado',
  capacidades: CAPACIDADES.baselinker,
  ...p,
})

describe('situação do conector', () => {
  it('recém-conectado diz que o robô roda a cada 5 min, em vez de mostrar "—"', () => {
    const s = situacaoConector(conector(), AGORA)
    expect(s).toMatchObject({ tom: 'info' })
    expect(s?.titulo).toContain('ainda não sincronizou')
    expect(s?.texto).toContain(`${CICLO_CRON_MIN} minutos`)
    expect(s?.texto).toContain('Sincronizar agora')
    // Não promete que "o primeiro ciclo ainda não passou": a tela não sabe quando o conector foi
    // ligado, e um conector ligado ontem sem nenhuma leitura é o robô parado, não paciência.
    expect(s?.texto).not.toContain('primeiro ciclo')
  })

  it('erro do worker aparece com o texto que ele gravou', () => {
    const s = situacaoConector(conector({ status: 'erro', ultimoErro: 'token inválido (BaseLinker respondeu 401)' }), AGORA)
    // O texto do worker vem em minúscula e sem ponto: a tela o apresenta sem reescrevê-lo.
    expect(s).toEqual({ tom: 'erro', titulo: 'A última sincronização falhou', texto: 'Token inválido (BaseLinker respondeu 401).' })
  })

  it('erro sem motivo gravado não vira silêncio: diz o que fazer', () => {
    const s = situacaoConector(conector({ status: 'erro' }), AGORA)
    expect(s?.tom).toBe('erro')
    expect(s?.texto).toContain('Sincronizar agora')
  })

  it('desconectado pelo próprio cron mostra por quê (é o que some hoje)', () => {
    // apps/worker/src/jobs/semCredenciais.ts desativa e grava este texto.
    const s = situacaoConector(conector({ status: 'desconectado', ultimoErro: 'sem credenciais: reconecte em Conectores' }), AGORA)
    expect(s?.tom).toBe('warn')
    expect(s?.texto).toBe('Sem credenciais: reconecte em Conectores.')
  })

  it('conector nunca conectado não inventa aviso nenhum', () => {
    expect(situacaoConector(conector({ status: 'desconectado' }), AGORA)).toBeNull()
  })

  // `ultimo_sync` é gravado tanto pelo cron quanto pelo botão "Sincronizar agora" (o mesmo
  // worker_set_sync_state). Então a tela NÃO pode afirmar, a partir dele, que o robô está rodando
  // sozinho: um cron morto + um clique no botão produz exatamente este estado, e a tela viraria
  // uma máquina de esconder o problema que ela existe para mostrar.
  it('sync recente afirma só o que é verdade: a última leitura deu certo', () => {
    const s = situacaoConector(conector({ ultimoSync: minAtras(3) }), AGORA)
    expect(s?.tom).toBe('ok')
    expect(s?.titulo).toBe('A última leitura deu certo')
    expect(s?.titulo).not.toContain('sozinho')
    // E entrega ao dono o teste que separa "robô vivo" de "só o botão".
    expect(s?.texto).toContain(`${CICLO_CRON_MIN} minutos`)
    expect(s?.texto).toContain('Sincronizar agora')
  })

  it('sem notícia por vários ciclos desconfia do robô, não da plataforma', () => {
    const parado = CICLO_CRON_MIN * CICLOS_ATE_DESCONFIAR + 1
    const s = situacaoConector(conector({ ultimoSync: minAtras(parado) }), AGORA)
    expect(s?.tom).toBe('warn')
    expect(s?.titulo).toContain('Sem sincronizar')
    expect(s?.texto).toContain('robô do worker')
    // O limite é o limite: um minuto antes ainda é normal.
    expect(situacaoConector(conector({ ultimoSync: minAtras(parado - 2) }), AGORA)?.tom).toBe('ok')
  })

  it('falha superada aparece como aviso, não como erro', () => {
    const s = situacaoConector(conector({ ultimoSync: minAtras(2), ultimoErro: 'timeout' }), AGORA)
    expect(s?.tom).toBe('warn')
    expect(s?.texto).toBe('Timeout.')
  })

  it('data torta não derruba a tela nem finge que sincronizou', () => {
    expect(situacaoConector(conector({ ultimoSync: 'não é data' }), AGORA)?.tom).toBe('info')
  })
})

// O robô, lido de sync_state (incidente de 25/09/2026): um dia inteiro de "Conectado" e "Último sync
// há 1 d" com o cron sem gravar nada. `ultimo_sync` é gravado pelo robô E pelo botão; sync_state só
// pelo robô. last_run_at = início da última tentativa; last_ok_at = fim da última que deu certo.
describe('situação do robô (sync_state)', () => {
  const comRobo = (robo: RoboConector, p: Partial<Connector> = {}) => conector({ robo, ...p })
  const limite = CICLO_CRON_MIN * CICLOS_SEM_PULSO

  it('(a) tenta e termina: afirma que sincroniza sozinho, agora que pode', () => {
    // Começou há 3 min e terminou 8 s depois.
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(3), ultimoOk: new Date(AGORA - 3 * 60_000 + 8_000).toISOString(), rodadas: 10 }, { ultimoSync: minAtras(3) }), AGORA)
    expect(s).toMatchObject({ tom: 'ok', robo: 'em_dia', titulo: 'O robô está sincronizando sozinho' })
    expect(s?.texto).toContain('terminou há 3 min')
  })

  it('(a) relógio do worker um pouco à frente do banco não vira "morreu"', () => {
    // Início pelo relógio do worker, fim pelo do banco: o fim pode "parecer" 20 s antes do início.
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(3), ultimoOk: new Date(AGORA - 3 * 60_000 - 20_000).toISOString(), rodadas: 10 }), AGORA)
    expect(s?.robo).toBe('em_dia')
  })

  it('(b) tenta e não termina: diz que morre no meio, que nada se perde e onde ver o motivo', () => {
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(4), ultimoOk: minAtras(60 * 26), rodadas: 3 }, { ultimoSync: minAtras(1) }), AGORA)
    expect(s).toMatchObject({ tom: 'warn', robo: 'morre', titulo: 'O robô começa, mas não termina' })
    expect(s?.texto).toContain('começou há 4 min')
    expect(s?.texto).toContain('a última que terminou bem foi há 1 d')
    expect(s?.texto).toContain('continua de onde esta parou')
    expect(s?.texto).toContain('Cloudflare')
    expect(s?.texto).toContain('Logs')
    // A mesma marca fica quando a rodada falhou com motivo e um clique no botão apagou o motivo do
    // cartão: a frase não pode afirmar só "morreu", e aponta o log dos dois casos.
    expect(s?.texto).toContain('não terminou bem')
    expect(s?.texto).toContain('exceededCpu')
    expect(s?.texto).toContain('sync.falha')
    // Um clique recente no botão (ultimo_sync de 1 min) não esconde nada: o botão não é o robô.
    expect(roboComProblema(s)).toBe(true)
  })

  it('(b) sem nenhuma rodada que tenha terminado bem', () => {
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(3), rodadas: 0 }), AGORA)
    expect(s?.robo).toBe('morre')
    expect(s?.texto).toContain('nenhuma rodada automática terminou bem')
  })

  it('rodada em andamento não é acusada de morrer antes da hora', () => {
    const s = situacaoConector(comRobo({ ultimaTentativa: new Date(AGORA - 30_000).toISOString(), ultimoOk: minAtras(5), rodadas: 10 }), AGORA)
    expect(s).toMatchObject({ tom: 'info', robo: 'lendo' })
    expect(roboComProblema(s)).toBe(false)
    // Passado o tempo de uma rodada, vira "morre".
    const depois = situacaoConector(comRobo({ ultimaTentativa: minAtras(MINUTOS_RODADA + 1), ultimoOk: minAtras(5 + MINUTOS_RODADA + 1), rodadas: 10 }), AGORA)
    expect(depois?.robo).toBe('morre')
  })

  it('(c) tentativa velha: o agendamento não está rodando, mesmo com o botão funcionando', () => {
    // O cenário do incidente: o robô parou, o dono apertou o botão há 1 min e deu certo.
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(60 * 24), ultimoOk: minAtras(60 * 24), rodadas: 40 }, { ultimoSync: minAtras(1) }), AGORA)
    expect(s).toMatchObject({ tom: 'erro', robo: 'parado', titulo: 'O robô não está rodando' })
    expect(s?.texto).toContain('há 1 d')
    expect(s?.texto).toContain('Trigger Events')
    expect(s?.texto).toContain('Sincronizar agora')
    // O motivo do incidente estava no log 'sync.listar' e ninguém sabia onde procurar.
    expect(s?.texto).toContain('sync.listar')
    expect(s?.texto).toContain('cron.falha')
    expect(s?.texto).toContain('Observability')
    expect(roboComProblema(s)).toBe(true)
    // O limite é o limite: dentro dele, uma tentativa que terminou bem ainda é robô em dia.
    const dentro = situacaoConector(comRobo({ ultimaTentativa: minAtras(limite - 1), ultimoOk: minAtras(limite - 1), rodadas: 40 }), AGORA)
    expect(dentro?.robo).toBe('em_dia')
    expect(situacaoConector(comRobo({ ultimaTentativa: minAtras(limite + 1), ultimoOk: minAtras(limite + 1), rodadas: 40 }), AGORA)?.robo).toBe('parado')
  })

  it('(c) nunca tentou, e a leitura que existe é antiga: não é paciência, é robô parado', () => {
    const s = situacaoConector(comRobo({ rodadas: 0 }, { ultimoSync: minAtras(limite + 5) }), AGORA)
    expect(s).toMatchObject({ robo: 'parado', tom: 'erro' })
    expect(s?.texto).toContain('Nenhuma tentativa automática')
  })

  it('nunca tentou e acabou de conectar: pede um ciclo de paciência e diz quando desconfiar', () => {
    const s = situacaoConector(comRobo({ rodadas: 0 }), AGORA)
    expect(s).toMatchObject({ tom: 'info', robo: 'aguardando' })
    expect(s?.texto).toContain(`${CICLO_CRON_MIN} minutos`)
    expect(s?.texto).toContain(`${limite} minutos`)
    expect(roboComProblema(s)).toBe(false)
    // Leitura recente pelo botão logo depois de conectar também é "aguardando".
    expect(situacaoConector(comRobo({ rodadas: 0 }, { ultimoSync: minAtras(2) }), AGORA)?.robo).toBe('aguardando')
  })

  it('erro gravado continua mandando: o motivo vem antes do diagnóstico do robô', () => {
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(2), ultimoOk: minAtras(60), rodadas: 5 }, { status: 'erro', ultimoErro: 'token inválido' }), AGORA)
    expect(s).toMatchObject({ tom: 'erro', titulo: 'A última sincronização falhou', texto: 'Token inválido.' })
    expect(s?.robo).toBeUndefined()
  })

  // O worker grava a falha do envio de estoque no mesmo `ultimo_erro`, com o prefixo "outbox:". A
  // primeira rodada depois do conserto do cron é a primeira vez que o outbox roda em produção.
  it('falha do envio de estoque não é chamada de falha da sincronização de pedidos', () => {
    const s = situacaoConector(comRobo({ ultimaTentativa: minAtras(3), ultimoOk: minAtras(3), rodadas: 9 }, { status: 'erro', ultimoErro: 'outbox: warehouse_id não configurado no conector' }), AGORA)
    expect(s).toMatchObject({ tom: 'erro', titulo: 'O envio de estoque para a plataforma falhou' })
    expect(s?.texto).toContain('Outbox: warehouse_id não configurado no conector.')
    expect(s?.texto).toContain('os pedidos continuam entrando')
    // Sem leitura recente no diário do robô, não se afirma que os pedidos entram.
    const semLeitura = situacaoConector(comRobo({ ultimaTentativa: minAtras(3), ultimoOk: minAtras(60 * 24), rodadas: 9 }, { status: 'erro', ultimoErro: 'outbox: catálogo fora' }), AGORA)
    expect(semLeitura?.titulo).toBe('O envio de estoque para a plataforma falhou')
    expect(semLeitura?.texto).not.toContain('continuam entrando')
    expect(situacaoConector(conector({ status: 'erro', ultimoErro: 'outbox: x' }), AGORA)?.texto).not.toContain('continuam entrando')
  })

  // O cron não conseguiu ler a lista de conectores (apps/worker/src/jobs/avisoListagem.ts). Ele grava
  // só `ultimo_erro`, com o prefixo, e não mexe no status (em 'erro', o estoque produzido deixaria
  // de ser enfileirado). Sem o prefixo, "conectado + erro guardado" viraria "a conexão voltou".
  it('aviso do cron que não lista os conectores: "O robô não está rodando", com o código', () => {
    const aviso = `${PREFIXO_AVISO_CRON} o robô não conseguiu ler a lista de conectores no banco (código PGRST201) e não sincronizou nenhum deles. Até isso ser corrigido, os pedidos só entram pelo botão "Sincronizar agora". O detalhe está nos logs do worker, evento sync.listar`
    const velho = { ultimaTentativa: minAtras(60 * 24), ultimoOk: minAtras(60 * 24), rodadas: 40 }
    for (const status of ['conectado', 'erro'] as const) {
      const s = situacaoConector(comRobo(velho, { status, ultimoErro: aviso, ultimoSync: minAtras(1) }), AGORA)
      expect(s).toMatchObject({ tom: 'erro', robo: 'parado', titulo: 'O robô não está rodando' })
      expect(s?.texto).toMatch(/^O robô não conseguiu ler a lista de conectores/)
      expect(s?.texto).toContain('(código PGRST201)')
      expect(s?.texto).toContain('Sincronizar agora')
      expect(s?.texto).not.toContain(PREFIXO_AVISO_CRON)
      expect(roboComProblema(s)).toBe(true)
    }
    // Sem sync_state lido (modo de demonstração) vale o mesmo, e prefixo sem frase não vira silêncio.
    expect(situacaoConector(conector({ ultimoErro: aviso }), AGORA)?.titulo).toBe('O robô não está rodando')
    expect(situacaoConector(conector({ ultimoErro: 'CRON:' }), AGORA)?.texto).toContain('sync.listar')
    // Conector desconectado não é tocado pelo cron.
    expect(situacaoConector(conector({ status: 'desconectado', ultimoErro: aviso }), AGORA)?.robo).toBeUndefined()
  })

  it('desconectado não ganha diagnóstico de robô (o robô nem olha para ele)', () => {
    expect(situacaoConector(comRobo({ ultimaTentativa: minAtras(60 * 24), rodadas: 1 }, { status: 'desconectado' }), AGORA)).toBeNull()
  })

  it('sem sync_state lido, vale o raciocínio antigo e nada se afirma sobre o robô', () => {
    const s = situacaoConector(conector({ ultimoSync: minAtras(3) }), AGORA)
    expect(s?.titulo).toBe('A última leitura deu certo')
    expect(s?.robo).toBeUndefined()
  })
})
