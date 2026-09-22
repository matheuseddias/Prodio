// O furo que estes testes fecham: sem vínculo com o navegador, quem é admin de QUALQUER tenant
// pedia /oauth/start no próprio conector, mandava a URL para a vítima e recebia no conector dele o
// token da conta Bling/Tiny da vítima. Ver o cabeçalho de ./oauthVinculo.ts.
import { hmacSha256Hex } from '../conectores/bling'
import { COOKIE_VINCULO, VALIDADE_STATE_MS, assinarState, cabecalhoCookie, chaveDeState, lerCookieVinculo, novoNonce, verificarState, vinculoConfere } from './oauthVinculo'

const CHAVE = 'chave-derivada-de-teste'
const CONECTOR = '0f9d2c3e-1111-4222-8333-444455556666'
const USUARIO = 'aa11bb22-cc33-4d44-8e55-ff6677889900'

const comCookie = (valor: string) => new Request('https://worker.prodio.app/connectors/tiny/oauth/callback', { headers: { Cookie: valor } })

describe('chave do state', () => {
  it('é derivada da CREDENTIALS_KEY, não é a própria', async () => {
    const derivada = await chaveDeState('mestra')
    expect(derivada).not.toBe('mestra')
    expect(derivada).toHaveLength(64)
    // Rótulo diferente daria chave diferente: é a separação de domínio que queremos.
    expect(derivada).not.toBe(await hmacSha256Hex('mestra', 'outro.rotulo'))
  })
})

describe('state assinado', () => {
  it('leva conector, usuário e nonce, e só volta com a chave certa', async () => {
    const nonce = novoNonce()
    const s = await assinarState({ connectorId: CONECTOR, userId: USUARIO, nonce }, CHAVE, 1000)
    expect(await verificarState(s, CHAVE, 2000)).toMatchObject({ connectorId: CONECTOR, userId: USUARIO, nonce })
    expect(await verificarState(s, 'outra-chave', 2000)).toBeNull()
  })

  it('expira', async () => {
    const s = await assinarState({ connectorId: CONECTOR, userId: USUARIO, nonce: novoNonce() }, CHAVE, 1000)
    expect(await verificarState(s, CHAVE, 1000 + VALIDADE_STATE_MS - 1)).not.toBeNull()
    expect(await verificarState(s, CHAVE, 1000 + VALIDADE_STATE_MS + 1)).toBeNull()
  })

  it('não dá para trocar o conector, o nonce nem a validade sem refazer a assinatura', async () => {
    const nonce = novoNonce()
    const s = await assinarState({ connectorId: CONECTOR, userId: USUARIO, nonce }, CHAVE, 1000)
    const [corpo, mac] = s.split('.')
    const adulterar = (mudanca: (d: Record<string, unknown>) => void) => {
      const d = JSON.parse(atob(corpo.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(corpo.length / 4) * 4, '='))) as Record<string, unknown>
      mudanca(d)
      return `${btoa(JSON.stringify(d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${mac}`
    }
    expect(await verificarState(adulterar((d) => (d.c = 'outro-conector')), CHAVE, 2000)).toBeNull()
    expect(await verificarState(adulterar((d) => (d.n = novoNonce())), CHAVE, 2000)).toBeNull()
    expect(await verificarState(adulterar((d) => (d.exp = 9e15)), CHAVE, 2000)).toBeNull()
  })

  it('lixo, formato errado e validade não numérica caem fora', async () => {
    expect(await verificarState('', CHAVE)).toBeNull()
    expect(await verificarState('so-uma-parte', CHAVE)).toBeNull()
    expect(await verificarState('a.b.c', CHAVE)).toBeNull()
    // exp: "NaN" passaria num `Number(exp) < agora`, que é falso para NaN. Aqui o teste é `> agora`.
    const corpo = btoa(JSON.stringify({ c: CONECTOR, u: USUARIO, n: 'abc', exp: 'depois' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verificarState(`${corpo}.${await hmacSha256Hex(CHAVE, corpo)}`, CHAVE, 1)).toBeNull()
  })

  it('cada início de conexão tem um nonce diferente', () => {
    const n = new Set(Array.from({ length: 50 }, () => novoNonce()))
    expect(n.size).toBe(50)
    expect([...n][0]).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('cookie de vínculo', () => {
  it('é HttpOnly, Secure, SameSite=Lax e limitado a /connectors', () => {
    const c = cabecalhoCookie('nonce123')
    expect(c).toContain(`${COOKIE_VINCULO}=nonce123`)
    expect(c).toContain('HttpOnly')
    expect(c).toContain('Secure')
    // Lax e não Strict: a volta da plataforma é navegação de topo vinda de outro site, e Strict
    // seguraria o cookie justamente aí.
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/connectors')
  })

  it('apagar manda Max-Age=0', () => {
    expect(cabecalhoCookie(null)).toContain('Max-Age=0')
  })

  it('lê o valor no meio de outros cookies', () => {
    expect(lerCookieVinculo(comCookie(`outro=1; ${COOKIE_VINCULO}=abc; mais=2`))).toBe('abc')
    expect(lerCookieVinculo(comCookie('outro=1'))).toBeNull()
    expect(lerCookieVinculo(comCookie(`${COOKIE_VINCULO}=`))).toBeNull()
    // Nome parecido não vale: um cookie de outro site não entra por semelhança.
    expect(lerCookieVinculo(comCookie(`x_${COOKIE_VINCULO}=abc`))).toBeNull()
  })

  it('confere só quando bate exatamente', () => {
    expect(vinculoConfere(comCookie(`${COOKIE_VINCULO}=abc123`), 'abc123')).toBe(true)
    expect(vinculoConfere(comCookie(`${COOKIE_VINCULO}=abc124`), 'abc123')).toBe(false)
    expect(vinculoConfere(comCookie(`${COOKIE_VINCULO}=abc`), 'abc123')).toBe(false)
    // Sem cookie nenhum é o caso do ataque: o link chegou de fora, o navegador nunca passou pelo /go.
    expect(vinculoConfere(new Request('https://worker.prodio.app/connectors/tiny/oauth/callback'), 'abc123')).toBe(false)
  })
})
