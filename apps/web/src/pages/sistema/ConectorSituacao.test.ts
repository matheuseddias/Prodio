// A tela promete duas coisas ao dono da fábrica: nunca esconder um erro que o worker gravou, e
// nunca deixar um "—" no lugar de uma explicação. Estes testes prendem as duas.
import { describe, expect, it } from 'vitest'
import type { Connector } from '../../domain/types'
import { CICLOS_ATE_DESCONFIAR, CICLO_CRON_MIN, situacaoConector } from './ConectorSituacao'

const AGORA = Date.now()
const minAtras = (min: number) => new Date(AGORA - min * 60_000).toISOString()

const conector = (p: Partial<Connector> = {}): Connector => ({
  id: 'c1',
  plataforma: 'baselinker',
  nome: 'Eddias (BaseLinker)',
  status: 'conectado',
  capacidades: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: true, nfeCompra: false },
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
