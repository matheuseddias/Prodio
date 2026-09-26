import { describe, expect, it } from 'vitest'
import { mesclar, numeroDoRascunho } from './index'

// O Tailwind v4 ordena o CSS pelo valor da utilitária: `w-full` sai depois de `w-28`, `h-10` depois
// de `h-9`, `px-5` depois de `px-2`. Quem passa largura, altura, padding ou fonte para um componente
// do kit precisa ver a sua classe no lugar da padrão, não as duas brigando.
describe('mesclar (classes do kit + do chamador)', () => {
  const PADRAO_CAMPO = 'h-10 w-full min-w-0 rounded-lg px-3 text-sm'

  it('sem className devolve o padrão intacto', () => {
    expect(mesclar(PADRAO_CAMPO)).toBe(PADRAO_CAMPO)
    expect(mesclar(PADRAO_CAMPO, '')).toBe(PADRAO_CAMPO)
  })

  it('largura e altura do chamador tiram w-full e h-10 (campo da ficha técnica)', () => {
    const r = mesclar(PADRAO_CAMPO, 'h-9 w-28 text-right tabular-nums').split(' ')
    expect(r).toContain('w-28')
    expect(r).toContain('h-9')
    expect(r).not.toContain('w-full')
    expect(r).not.toContain('h-10')
    // alinhamento não é tamanho de fonte: text-sm fica
    expect(r).toContain('text-sm')
    expect(r).toContain('rounded-lg')
  })

  it('largura com valor arbitrário também vence', () => {
    const r = mesclar(PADRAO_CAMPO, 'w-[130px]').split(' ')
    expect(r).toContain('w-[130px]')
    expect(r).not.toContain('w-full')
  })

  it('variante responsiva convive com o padrão (a media query já vem depois no CSS)', () => {
    const r = mesclar(PADRAO_CAMPO, 'h-9 sm:w-64').split(' ')
    expect(r).toContain('w-full')
    expect(r).toContain('sm:w-64')
    expect(r).not.toContain('h-10')
  })

  it('min-w e max-w não derrubam a largura, só o próprio min/max', () => {
    const r = mesclar(PADRAO_CAMPO, 'max-w-xs min-w-24').split(' ')
    expect(r).toContain('w-full')
    expect(r).toContain('max-w-xs')
    expect(r).toContain('min-w-24')
    expect(r).not.toContain('min-w-0')
  })

  it('padding horizontal e tamanho de fonte do chamador vencem (células de tabela e PIN)', () => {
    const cel = mesclar('py-3 px-3 first:pl-5 last:pr-5 text-sm', 'px-2 text-[13px]').split(' ')
    expect(cel).toContain('px-2')
    expect(cel).not.toContain('px-3')
    expect(cel).toContain('first:pl-5')
    expect(cel).toContain('text-[13px]')
    expect(cel).not.toContain('text-sm')
    const pin = mesclar(PADRAO_CAMPO, 'text-lg tracking-[0.4em]').split(' ')
    expect(pin).toContain('text-lg')
    expect(pin).not.toContain('text-sm')
  })

  it('alinhamento não é confundido com tamanho de fonte nem com cor', () => {
    const r = mesclar('text-sm text-muted', 'text-right').split(' ')
    expect(r).toEqual(expect.arrayContaining(['text-sm', 'text-muted', 'text-right']))
  })

  it('cor de texto do chamador vence a da variante (text-muted sairia depois de text-danger)', () => {
    const r = mesclar('h-10 px-4 text-sm text-muted hover:text-text', 'h-9 text-danger').split(' ')
    expect(r).toContain('text-danger')
    expect(r).not.toContain('text-muted')
    expect(r).toContain('hover:text-text')
    expect(r).toContain('text-sm')
    // tamanho arbitrário é fonte, não cor: a cor da variante fica
    const s = mesclar('h-8 text-sm text-muted', 'text-[13px]').split(' ')
    expect(s).toContain('text-muted')
    expect(s).not.toContain('text-sm')
  })
})

describe('numeroDoRascunho (campo de número pt-BR)', () => {
  it('grava o que foi digitado com vírgula', () => {
    expect(numeroDoRascunho('0,5')).toBe(0.5)
    expect(numeroDoRascunho('12,3456')).toBe(12.3456)
    expect(numeroDoRascunho('100,00', { min: 0, max: 100 })).toBe(100)
  })

  it('não grava meio de digitação que ainda não é número nem valor fora dos limites', () => {
    expect(numeroDoRascunho('')).toBeNull()
    expect(numeroDoRascunho(',')).toBeNull()
    expect(numeroDoRascunho('-1', { min: 0 })).toBeNull()
    expect(numeroDoRascunho('101', { max: 100 })).toBeNull()
    expect(numeroDoRascunho('2,5', { inteiro: true })).toBeNull()
    expect(numeroDoRascunho('3', { inteiro: true })).toBe(3)
  })

  it('vazio só grava quando o campo diz quanto vale vazio (perda % = 0)', () => {
    expect(numeroDoRascunho('  ', { vazio: 0 })).toBe(0)
    expect(numeroDoRascunho('  ')).toBeNull()
  })
})
