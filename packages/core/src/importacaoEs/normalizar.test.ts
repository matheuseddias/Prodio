import { arred, bytesUtf8, dataDoNome, diasEntre, documentoValido, gtinValido, ncm, num, prazo, sku, texto, unidade } from './normalizar'

describe('num (tolerante como o do ES)', () => {
  it.each([
    [10, 10],
    ['10', 10],
    ['0,176', 0.176],
    ['1.234,56', 1234.56],
    ['0.3', 0.3],
    ['R$ 5,50', 5.5],
    ['12%', 12],
    [' 7 ', 7],
  ])('%j → %d', (x, v) => expect(num(x)).toBe(v))
  it.each([null, undefined, '', '   ', 'abc', NaN, Infinity, {}, [], true])('%j conta como ausente', (x) => expect(num(x)).toBeUndefined())
  it('texto enorme não vira número', () => expect(num('9'.repeat(500))).toBeUndefined())
})

describe('arred (escala da coluna)', () => {
  it('arredonda sem erro de ponto flutuante', () => {
    expect(arred(1.005, 2)).toBe(1.01)
    expect(arred(0.05816375, 4)).toBe(0.0582)
    expect(arred(7.704, 6)).toBe(7.704)
    expect(arred(0.1 + 0.2, 6)).toBe(0.3)
    expect(Object.is(arred(-0.00001, 4), 0)).toBe(true)
  })
})

describe('texto e sku', () => {
  it('limpa espaços e limita tamanho', () => {
    expect(texto('  Vidraçaria   Exemplo \n Ltda ')).toBe('Vidraçaria Exemplo Ltda')
    expect(texto('x'.repeat(300))?.length).toBe(200)
    expect(texto('   ')).toBeUndefined()
    expect(texto({ a: 1 })).toBeUndefined()
  })
  it('não parte emoji ao cortar e troca o que o jsonb recusa (nulo, surrogate solto) por espaço', () => {
    expect(texto(`${'a'.repeat(9)}🪞b`, 10)).toBe('a'.repeat(9))
    expect(texto(`${'a'.repeat(8)}🪞b`, 10)).toBe(`${'a'.repeat(8)}🪞`)
    expect(texto('a\u0000b')).toBe('a b')
    expect(texto(JSON.parse('"x\\ud83dy\\udc00z"') as string)).toBe('x y z')
    expect(texto('Espelho 🪞 redondo')).toBe('Espelho 🪞 redondo')
  })
  it('bytes UTF-8 como o octet_length do banco', () => {
    expect(bytesUtf8('abc')).toBe(3)
    expect(bytesUtf8('ção')).toBe(5)
    expect(bytesUtf8('🪞')).toBe(4)
  })
  it('SKU em maiúsculas e sem espaços', () => {
    expect(sku(' ed 900001 ')).toBe('ED900001')
    expect(sku('')).toBeUndefined()
    expect(sku(null)).toBeUndefined()
  })
})

describe('unidade: texto livre do ES → 8 códigos do Prodio', () => {
  it.each([
    ['Un', 'un'], ['UND', 'un'], ['unid.', 'un'], ['Unidade', 'un'], ['pç', 'un'], ['Peça', 'un'], ['PCS', 'un'], ['par', 'un'], ['JG', 'un'], ['jogo', 'un'],
    ['CX', 'cx'], ['Caixa', 'cx'], ['RL', 'rl'], ['rolo', 'rl'], ['CT', 'ct'], ['Cento', 'ct'],
    ['M', 'm'], ['MT', 'm'], ['mts', 'm'], ['Metros', 'm'], ['metro linear', 'm'],
    ['m2', 'm2'], ['m²', 'm2'], ['M²', 'm2'], ['mq', 'm2'], ['metro quadrado', 'm2'],
    ['KG', 'kg'], ['kilo', 'kg'], ['Quilo', 'kg'], ['g', 'g'], ['GR', 'g'], ['gramas', 'g'],
  ])('%s → %s', (x, c) => expect(unidade(x)?.codigo).toBe(c))
  it.each([['CH', 'chapa'], ['Chapa', 'chapa'], ['FD', 'fardo'], ['Fardo', 'fardo'], ['PCT', 'pacote'], ['MIL', 'milheiro'], ['Milheiro', 'milheiro']])(
    'embalagem %s vira un com aviso',
    (x, emb) => {
      const u = unidade(x)
      expect(u).toMatchObject({ codigo: 'un', embalagem: emb })
      expect(u?.aviso).toContain(x)
    },
  )
  it('"ml" é lido como metro linear, com aviso', () => expect(unidade('ml')).toMatchObject({ codigo: 'm', aviso: expect.stringContaining('metro linear') }))
  it.each(['litro', 'L', 'galão', '', null, 3])('%j não é reconhecida', (x) => expect(unidade(x)).toBeUndefined())
})

describe('documentos e códigos', () => {
  it('CNPJ e CPF com dígito verificador', () => {
    expect(documentoValido('11222333000181')).toBe(true)
    expect(documentoValido('12345678000195')).toBe(true)
    expect(documentoValido('98765432000198')).toBe(true)
    expect(documentoValido('11222333000182')).toBe(false)
    expect(documentoValido('00000000000000')).toBe(false)
    expect(documentoValido('52998224725')).toBe(true) // CPF
    expect(documentoValido('52998224724')).toBe(false)
    expect(documentoValido('123')).toBe(false)
  })
  it('GTIN-8/12/13/14', () => {
    expect(gtinValido('2000000000015')).toBe(true)
    expect(gtinValido('7898676460951')).toBe(true)
    expect(gtinValido('7898676460952')).toBe(false)
    expect(gtinValido('96385074')).toBe(true) // GTIN-8
    expect(gtinValido('12345')).toBe(false)
    expect(gtinValido('0000000000000')).toBe(false)
  })
  it('NCM: 8 dígitos formatados; outro formato vira aviso; vazio some', () => {
    expect(ncm('70099100')).toEqual({ valor: '7009.91.00' })
    expect(ncm('7009.91.00')).toEqual({ valor: '7009.91.00' })
    expect(ncm(70099100)).toEqual({ valor: '7009.91.00' })
    expect(ncm('7009.91')).toMatchObject({ aviso: expect.stringContaining('7009.91') })
    expect(ncm('')).toEqual({})
  })
  it('prazo → condição de pagamento', () => {
    expect(prazo('28-35-42')).toEqual({ valor: [28, 35, 42] })
    expect(prazo('30/60')).toEqual({ valor: [30, 60] })
    expect(prazo('30, 60 ; 90')).toEqual({ valor: [30, 60, 90] })
    expect(prazo('30dd 60dd')).toEqual({ valor: [30, 60] })
    expect(prazo('')).toEqual({ valor: [0] })
    expect(prazo('à vista')).toEqual({ valor: [0] })
    expect(prazo(30)).toEqual({ valor: [30] })
    expect(prazo('combinar')).toMatchObject({ aviso: expect.stringContaining('combinar') })
    expect(prazo('400')).toMatchObject({ aviso: expect.any(String) })
    expect(prazo(undefined)).toEqual({})
  })
  it('data do backup pelo nome do arquivo', () => {
    expect(dataDoNome('backup-suprimentos-20260924-1810.json')).toBe('2026-09-24')
    expect(dataDoNome('backup (1).json')).toBeUndefined()
    expect(dataDoNome('backup-20261399.json')).toBeUndefined()
    expect(diasEntre('2026-09-24', '2026-09-26')).toBe(2)
  })
})
