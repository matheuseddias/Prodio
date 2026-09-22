import { classificarCron } from './cron'

describe('classificarCron', () => {
  it('reconhece os crons do wrangler.toml', () => {
    expect(classificarCron('*/5 * * * *')).toEqual({ tipo: 'sync', reconhecida: true })
    expect(classificarCron('0 3 * * *')).toEqual({ tipo: 'auditor', reconhecida: true })
  })

  it('tolera variações conhecidas', () => {
    expect(classificarCron('*/10 * * * *')).toEqual({ tipo: 'sync', reconhecida: true })
    expect(classificarCron('30 2 * * *')).toEqual({ tipo: 'auditor', reconhecida: true })
    // Espaço a mais não é expressão nova.
    expect(classificarCron('  */5   *  * * * ')).toEqual({ tipo: 'sync', reconhecida: true })
  })

  // O ponto da mudança: cron que dispara e não roda job nenhum não deixa sintoma em lugar nenhum —
  // nem no banco, nem na tela. O palpite seguro é o ciclo curto (idempotente), com aviso no log.
  it('expressão desconhecida roda o ciclo curto em vez de ficar em silêncio', () => {
    expect(classificarCron('0 */6 * * *')).toEqual({ tipo: 'sync', reconhecida: false })
    expect(classificarCron('0 * * * *')).toEqual({ tipo: 'sync', reconhecida: false })
    expect(classificarCron('5,35 * * * *')).toEqual({ tipo: 'sync', reconhecida: false })
    expect(classificarCron(undefined)).toEqual({ tipo: 'sync', reconhecida: false })
    expect(classificarCron('lixo')).toEqual({ tipo: 'sync', reconhecida: false })
  })
})
