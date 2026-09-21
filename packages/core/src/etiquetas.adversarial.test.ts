// Testes adversariais das etiquetas: SKU com hífen/minúsculas, sequência no limite, prefixo inválido, datas impossíveis.
import { decodeSerial, diaAAMMDD, etiquetasPara, perfilDaFamilia, serial, SEQ_MAX, validarPrefixo } from './etiquetas'
import type { LabelProfile } from './tipos'

describe('serial · SKU', () => {
  it('SKU com hífen e minúsculas é normalizado para maiúsculas e decodifica de volta', () => {
    const s = serial('ES', 'mouse-90x40', '2026-09-21', 12)
    expect(s).toBe('ESMOUSE-90X40' + '260921' + '0012')
    expect(decodeSerial(s, ['ES'])).toEqual({ prefixo: 'ES', sku: 'MOUSE-90X40', dia: '2026-09-21', seq: 12 })
  })
  it('SKU com espaço nas pontas é aceito; com espaço no meio, acento, barra ou vazio é erro', () => {
    expect(serial('ES', '  TM1 ', '2026-09-21', 1)).toBe('ESTM1' + '260921' + '0001')
    for (const sku of ['TM 1', 'TMÇ', 'TM/1', '', '   ', 'TM.1']) expect(() => serial('ES', sku, '2026-09-21', 1), sku).toThrow(/SKU/)
  })
  it('SKU só de dígitos: serial gera, e decodifica com prefixo conhecido', () => {
    const s = serial('ES', '123456', '2026-09-21', 1)
    expect(decodeSerial(s, ['ES'])).toEqual({ prefixo: 'ES', sku: '123456', dia: '2026-09-21', seq: 1 })
    expect(decodeSerial(s)).toBeNull() // sem prefixo conhecido não dá para cortar com segurança
  })
  it('SKU que termina em dígitos não confunde com a data', () => {
    const s = serial('ES', 'TM260921', '2026-09-21', 7)
    expect(decodeSerial(s, ['ES'])).toEqual({ prefixo: 'ES', sku: 'TM260921', dia: '2026-09-21', seq: 7 })
  })
})

describe('serial · sequência', () => {
  it('9999 é o máximo; 10000, 0, negativo, fracionário e NaN são erro', () => {
    expect(serial('ES', 'X', '2026-01-01', SEQ_MAX)).toMatch(/9999$/)
    for (const seq of [10000, 0, -1, 1.5, NaN, Infinity]) expect(() => serial('ES', 'X', '2026-01-01', seq), String(seq)).toThrow(/Sequência/)
  })
})

describe('serial · prefixo', () => {
  it('prefixos inválidos: minúsculas, dígitos, 1 ou 4 letras, vazio, acento, espaço', () => {
    for (const p of ['es', 'E1', 'E', 'ESPE', '', 'ÉS', 'E S', ' ES']) {
      expect(validarPrefixo(p), p).toBe(false)
      expect(() => serial(p, 'X', '2026-01-01', 1), p).toThrow(/Prefixo/)
    }
  })
  it('decodeSerial ignora prefixos inválidos na lista', () => {
    expect(decodeSerial('ESTM0000762609210007', ['es', 'E1', 'ES'])).toEqual({ prefixo: 'ES', sku: 'TM000076', dia: '2026-09-21', seq: 7 })
    expect(decodeSerial('ESTM0000762609210007', ['es'])).toEqual({ prefixo: 'ES', sku: 'TM000076', dia: '2026-09-21', seq: 7 })
  })
  it('prefixo conhecido que engole o SKU inteiro não casa', () => {
    expect(decodeSerial('ESA2609210007', ['ESA', 'ES'])).toEqual({ prefixo: 'ES', sku: 'A', dia: '2026-09-21', seq: 7 })
  })
})

describe('serial · dia', () => {
  it('dia impossível no calendário é erro ao gerar', () => {
    for (const dia of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2027-02-29']) expect(() => serial('ES', 'X', dia, 1), dia).toThrow(/Dia/)
    expect(serial('ES', 'X', '2028-02-29', 1)).toContain('280229')
  })
  it('Date inválida é erro; Date válida usa o fuso local', () => {
    expect(() => diaAAMMDD(new Date('lixo'))).toThrow(/Dia/)
    expect(diaAAMMDD(new Date(2026, 11, 31, 23, 59))).toBe('261231')
  })
  it('decodeSerial rejeita dia impossível no calendário', () => {
    expect(decodeSerial('ESTM0000762602300007', ['ES'])).toBeNull()
    expect(decodeSerial('ESTM0000762604310007', ['ES'])).toBeNull()
    expect(decodeSerial('ESTM0000762802290007', ['ES'])?.dia).toBe('2028-02-29')
  })
  it('lixo comum do leitor: vazio, null, só espaços, com sufixo de Enter', () => {
    expect(decodeSerial('')).toBeNull()
    expect(decodeSerial(null as unknown as string)).toBeNull()
    expect(decodeSerial('   ')).toBeNull()
    expect(decodeSerial('ESTM0000762609210007\n', ['ES'])?.seq).toBe(7)
  })
})

describe('perfis e contagem · casos-limite', () => {
  const perfis: LabelProfile[] = [
    { familia: ' Espelho ', prefixo: 'ES', tipos: ['caixa', 'montagem'], unidadesPorCaixa: 0 },
    { familia: '*', prefixo: 'XX', tipos: ['produto'], unidadesPorCaixa: 1 },
  ]
  it('família com espaços e caixa diferente casa; perfil * do tenant vence o padrão do código', () => {
    expect(perfilDaFamilia(perfis, 'ESPELHO').prefixo).toBe('ES')
    expect(perfilDaFamilia(perfis, 'Cadeira').prefixo).toBe('XX')
    expect(perfilDaFamilia(perfis, undefined as unknown as string).prefixo).toBe('XX')
  })
  it('unidadesPorCaixa 0 vira 1 (uma etiqueta de caixa por peça) e produto é sempre gerado', () => {
    const p = perfilDaFamilia(perfis, 'Espelho')
    expect(p.tipos[0]).toBe('produto')
    expect(etiquetasPara(p, 3)).toEqual({ produto: 3, montagem: 3, caixa: 3 })
  })
  it('peças zero, negativas, fracionárias ou NaN nunca geram contagem negativa ou NaN', () => {
    const p = perfilDaFamilia(perfis, 'Espelho')
    expect(etiquetasPara(p, 0)).toEqual({ produto: 0, montagem: 0, caixa: 0 })
    expect(etiquetasPara(p, -5)).toEqual({ produto: 0, montagem: 0, caixa: 0 })
    expect(etiquetasPara(p, NaN)).toEqual({ produto: 0, montagem: 0, caixa: 0 })
    expect(etiquetasPara({ ...p, unidadesPorCaixa: 6 }, 2.5)).toEqual({ produto: 3, montagem: 3, caixa: 1 })
  })
})
