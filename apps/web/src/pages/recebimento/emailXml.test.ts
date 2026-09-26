import { describe, expect, it } from 'vitest'
import { DOMINIO_EMAIL_XML, emailXml } from './nfeUtils'

describe('e-mail de XML da empresa', () => {
  it('usa o tenants.slug, que é por onde o worker acha a empresa (não o nome)', () => {
    expect(emailXml({ slug: 'eddias', nome: 'Eddias Home' })).toBe(`xml@eddias.${DOMINIO_EMAIL_XML}`)
  })
  it('sem slug lido (modo antigo), cai no primeiro nome, como antes', () => {
    expect(emailXml({ nome: 'Fábrica Nova Ltda' })).toBe(`xml@fabrica.${DOMINIO_EMAIL_XML}`)
  })
  it('domínio nunca vazio (variável do build vazia não quebra o endereço)', () => {
    expect(DOMINIO_EMAIL_XML).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/)
  })
})
