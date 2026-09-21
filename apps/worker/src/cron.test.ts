import { classificarCron } from './cron'

describe('classificarCron', () => {
  it('reconhece os crons do wrangler.toml', () => {
    expect(classificarCron('*/5 * * * *')).toBe('sync')
    expect(classificarCron('0 3 * * *')).toBe('auditor')
  })
  it('tolera variações e rejeita o resto', () => {
    expect(classificarCron('*/10 * * * *')).toBe('sync')
    expect(classificarCron('30 2 * * *')).toBe('auditor')
    expect(classificarCron(undefined)).toBe('desconhecido')
    expect(classificarCron('0 */6 * * *')).toBe('desconhecido')
    expect(classificarCron('lixo')).toBe('desconhecido')
  })
})
