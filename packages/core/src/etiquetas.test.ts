import { decodeSerial, diaAAMMDD, etiquetasPara, PERFIL_PADRAO, perfilDaFamilia, serial, validarPrefixo } from './etiquetas'
import type { LabelProfile } from './tipos'

describe('serial', () => {
  it('prefixo + SKU + AAMMDD + 4 dígitos', () => {
    expect(serial('ES', 'TM000076', '2026-09-21', 7)).toBe('ESTM000076' + '260921' + '0007')
    expect(serial('MP', 'ED000001', new Date(2026, 0, 5), 1234)).toBe('MPED000001' + '260105' + '1234')
  })
  it('rejeita prefixo, sequência e dia inválidos', () => {
    expect(() => serial('e', 'X1', '2026-01-01', 1)).toThrow(/Prefixo/)
    expect(() => serial('ES', 'X1', '2026-01-01', 0)).toThrow(/Sequência/)
    expect(() => serial('ES', 'X1', '2026-01-01', 10000)).toThrow(/Sequência/)
    expect(() => serial('ES', 'X1', '21/09/2026', 1)).toThrow(/Dia/)
    expect(() => serial('ES', 'X 1', '2026-01-01', 1)).toThrow(/SKU/)
  })
  it('diaAAMMDD aceita ISO com hora', () => {
    expect(diaAAMMDD('2026-09-21T10:00:00-03:00')).toBe('260921')
  })
})

describe('decodeSerial', () => {
  it('com prefixos conhecidos o corte é exato, inclusive prefixo de 3 letras', () => {
    expect(decodeSerial('ESTM0000762609210007', ['ES', 'MP'])).toEqual({ prefixo: 'ES', sku: 'TM000076', dia: '2026-09-21', seq: 7 })
    expect(decodeSerial('EDDED0000012601051234', ['ED', 'EDD'])).toEqual({ prefixo: 'EDD', sku: 'ED000001', dia: '2026-01-05', seq: 1234 })
  })
  it('sem prefixos conhecidos assume 2 letras; aceita minúsculas e espaços', () => {
    expect(decodeSerial(' estm0000762609210007 ')).toEqual({ prefixo: 'ES', sku: 'TM000076', dia: '2026-09-21', seq: 7 })
  })
  it('ida e volta com serial()', () => {
    const s = serial('PR', 'MOUSE-90X40', '2026-12-31', 9999)
    expect(decodeSerial(s, ['PR'])).toEqual({ prefixo: 'PR', sku: 'MOUSE-90X40', dia: '2026-12-31', seq: 9999 })
  })
  it('devolve null para lixo, data impossível e sequência zero', () => {
    expect(decodeSerial('12345')).toBeNull()
    expect(decodeSerial('ESTM0000762613210007', ['ES'])).toBeNull()
    expect(decodeSerial('ESTM0000762609210000', ['ES'])).toBeNull()
    expect(decodeSerial('ES2609210007', ['ES'])).toBeNull()
  })
})

describe('perfis por família', () => {
  const perfis: LabelProfile[] = [
    { familia: 'Espelho', prefixo: 'ES', tipos: ['produto', 'montagem', 'caixa'], unidadesPorCaixa: 6, instrucaoMontagem: 'Colar disco' },
    { familia: 'Mousepad', prefixo: 'MP', tipos: ['caixa'], unidadesPorCaixa: 10 },
  ]
  it('acha por família ignorando caixa; família sem perfil cai no padrão', () => {
    expect(perfilDaFamilia(perfis, 'espelho').prefixo).toBe('ES')
    const p = perfilDaFamilia(perfis, 'Cadeira')
    expect(p).toEqual({ ...PERFIL_PADRAO, familia: 'Cadeira' })
    expect(perfilDaFamilia([], '').prefixo).toBe(PERFIL_PADRAO.prefixo)
  })
  it('produto é sempre um dos tipos', () => {
    expect(perfilDaFamilia(perfis, 'Mousepad').tipos).toEqual(['produto', 'caixa'])
  })
  it('validarPrefixo: 2 ou 3 letras maiúsculas', () => {
    expect(validarPrefixo('ES')).toBe(true)
    expect(validarPrefixo('ESP')).toBe(true)
    expect(validarPrefixo('E')).toBe(false)
    expect(validarPrefixo('ESPE')).toBe(false)
    expect(validarPrefixo('es')).toBe(false)
    expect(validarPrefixo('E1')).toBe(false)
  })
  it('etiquetasPara conta por tipo e arredonda caixas para cima', () => {
    expect(etiquetasPara(perfis[0], 20)).toEqual({ produto: 20, montagem: 20, caixa: 4 })
    expect(etiquetasPara(PERFIL_PADRAO, 5)).toEqual({ produto: 5, montagem: 0, caixa: 0 })
  })
})
