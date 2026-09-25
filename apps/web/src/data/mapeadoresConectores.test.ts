// O caminho de `connectors` + `sync_state` + contagem de pedidos até o tipo que o cartão lê.
import { describe, expect, it } from 'vitest'
import { dataHoraBR } from '../domain/format'
import { CAPACIDADES, SEM_CAPACIDADE, connectorDoBanco, cursorLegivel, type ConnectorRow } from './mapeadoresConectores'

const linha: ConnectorRow = { id: 'c1', plataforma: 'baselinker', nome: 'Eddias', status: 'conectado', config: {}, ultimo_sync: '2026-09-25T12:00:00Z', ultimo_erro: null }

describe('conector: o robô (sync_state) chega até a tela', () => {
  it('last_run_at, last_ok_at e runs viram o diário do robô', () => {
    const c = connectorDoBanco(linha, {
      sync: { connector_id: 'c1', cursor: { date_confirmed_from: 1790000000 }, last_run_at: '2026-09-25T12:05:00Z', last_ok_at: '2026-09-25T12:05:07Z', runs: '42' },
    })
    expect(c.robo).toEqual({ ultimaTentativa: '2026-09-25T12:05:00Z', ultimoOk: '2026-09-25T12:05:07Z', rodadas: 42 })
    // O cursor sai de sync_state (não de connectors.config.cursor, que ninguém grava) e em texto.
    expect(c.cursor).toBe(`pedidos confirmados a partir de ${dataHoraBR(new Date(1790000000 * 1000).toISOString())}`)
  })

  it('conector sem linha em sync_state: o robô nunca passou, e isso é diferente de "não sei"', () => {
    expect(connectorDoBanco(linha, { sync: null }).robo).toEqual({ rodadas: 0 })
    expect(connectorDoBanco(linha, { sync: null }).cursor).toBeUndefined()
    // Leitura que falhou: nada a afirmar sobre o robô (a tela volta ao raciocínio antigo).
    expect(connectorDoBanco(linha).robo).toBeUndefined()
  })

  it('config.cursor e config.pedidos_24h não contam mais: ninguém grava esses dois', () => {
    const c = connectorDoBanco({ ...linha, config: { cursor: 'lixo', pedidos_24h: 999 } })
    expect(c.cursor).toBeUndefined()
    expect(c.pedidos24h).toBeUndefined()
    expect(connectorDoBanco(linha, { pedidos24h: 0 }).pedidos24h).toBe(0)
  })

  it('cursor legível para os três formatos do worker', () => {
    expect(cursorLegivel({ alterado_desde: Date.UTC(2026, 8, 24, 15) })).toMatch(/^pedidos alterados a partir de \d{2}\/\d{2}/)
    expect(cursorLegivel({ outra_chave: 1 })).toBe('{"outra_chave":1}')
    expect(cursorLegivel({})).toBeUndefined()
    expect(cursorLegivel(null)).toBeUndefined()
    expect(cursorLegivel('texto')).toBeUndefined()
  })
})

describe('conector: chips', () => {
  it('BaseLinker não promete "Enviar catálogo": nenhum adaptador do worker cria produto', () => {
    expect(connectorDoBanco(linha).capacidades).toMatchObject({ pedidos: true, pushEstoque: true, pushCatalogo: false, nfeCompra: false })
  })

  it('push_estoque desligado apaga o chip; ligado não inventa o que o worker não faz', () => {
    expect(connectorDoBanco({ ...linha, config: { push_estoque: false } }).capacidades.pushEstoque).toBe(false)
    expect(connectorDoBanco({ ...linha, plataforma: 'omie', config: { push_estoque: true } }).capacidades.pushEstoque).toBe(false)
  })

  it('plataforma sem adaptador não promete nada', () => {
    expect(CAPACIDADES.omie).toEqual(SEM_CAPACIDADE)
    expect(CAPACIDADES.magis5).toEqual(SEM_CAPACIDADE)
    expect(connectorDoBanco({ ...linha, plataforma: 'desconhecida' as ConnectorRow['plataforma'] }).capacidades).toEqual(SEM_CAPACIDADE)
  })
})
