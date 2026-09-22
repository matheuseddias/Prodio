// OAuth2 do Tiny (Olist): Keycloak do realm "tiny", grant authorization_code e refresh_token.
// Fica fora de tiny.ts porque o adaptador já encosta no limite de 400 linhas do repositório.
//
// O refresh do Tiny é ROTATIVO e vale ~24 h: cada renovação invalida o anterior. Por isso
// nada aqui pode devolver um campo `undefined` que apague credencial já gravada — é o que
// `mesclarCredenciaisTiny` garante.
import type { FetchFn } from '../http'
import { ErroConector, numero } from './tipos'
import { MAPA_TINY, ehErroDeReauth, jsonTiny, mensagemErroTiny } from './tinyMapa'

export interface AppTiny {
  clientId: string
  clientSecret: string
}

export interface CredenciaisTiny {
  // O app do Tiny é privado por seller: o cliente cria o aplicativo na conta dele
  // e cola client_id/client_secret. O app global do env é só fallback.
  client_id?: string
  client_secret?: string
  access_token?: string
  refresh_token?: string
  expires_at?: number // epoch ms
}

interface RespostaTokenTiny {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
}

const VALIDADE_PADRAO_S = 4 * 3600 // o Tiny devolve ~4 h; só entra se a resposta vier sem expires_in

export const RECONECTE_TINY = 'reconecte o Tiny em Sistema › Conectores'

// Mescla só o que veio preenchido. Um `refresh_token` ausente na resposta do Keycloak
// não pode zerar o que está gravado: seria a conexão morta até reautorização manual.
export function mesclarCredenciaisTiny(atuais: CredenciaisTiny, novas: CredenciaisTiny): CredenciaisTiny {
  const saida: CredenciaisTiny = { ...atuais }
  if (novas.access_token) saida.access_token = novas.access_token
  if (novas.refresh_token) saida.refresh_token = novas.refresh_token
  if (novas.expires_at) saida.expires_at = novas.expires_at
  if (novas.client_id) saida.client_id = novas.client_id
  if (novas.client_secret) saida.client_secret = novas.client_secret
  return saida
}

// Troca code/refresh por tokens. Compartilhado com a rota de callback do OAuth.
// Keycloak espera client_id/client_secret no corpo, não em Basic.
export async function oauthTokenTiny(
  app: AppTiny,
  params: Record<string, string>,
  fetchFn: FetchFn = (i, o) => fetch(i, o),
  agora: () => number = Date.now,
): Promise<CredenciaisTiny> {
  const corpo = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...params })
  const res = await fetchFn(MAPA_TINY.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: corpo.toString(),
  })
  const texto = await res.text()
  // Nunca ecoa o corpo cru: só a mensagem de erro conhecida (e o veredito de reauth).
  if (!res.ok) {
    const reauth = ehErroDeReauth(res.status, texto)
    const detalhe = mensagemErroTiny(texto)
    throw new ErroConector(
      'tiny',
      reauth ? `autorização do Tiny expirou (${detalhe}): ${RECONECTE_TINY}` : `OAuth Tiny falhou (${res.status}): ${detalhe}`,
      { status: res.status, codigo: reauth ? 'reauth' : undefined },
    )
  }
  const t = jsonTiny<RespostaTokenTiny>(texto, 'OAuth Tiny')
  if (typeof t.access_token !== 'string' || t.access_token === '') {
    throw new ErroConector('tiny', `OAuth Tiny respondeu sem access_token: ${RECONECTE_TINY}`, { codigo: 'reauth' })
  }
  const vida = numero(t.expires_in) > 0 ? numero(t.expires_in) : VALIDADE_PADRAO_S
  const saida: CredenciaisTiny = { access_token: t.access_token, expires_at: agora() + vida * 1000 }
  if (typeof t.refresh_token === 'string' && t.refresh_token !== '') saida.refresh_token = t.refresh_token
  return saida
}
