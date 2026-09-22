// Envio de XML de NF-e para o worker (POST /nfe/xml).
//
// O parser de NF-e mora no worker (packages/core/nfeXml), e é ele quem grava `nfe_inbound` — como
// o próprio usuário (anon key + JWT, RLS e assert_member valendo) — e guarda o arquivo no Storage
// com o service role. A interface nunca parseia o XML nem escreve a nota: manda o arquivo e recarrega
// a fatia `nfes` com o que voltou. Ver apps/worker/src/rotas/nfe.ts e docs/arquitetura.md, seção 5.
import { chamarWorker } from './worker'

/** Teto do worker (apps/worker/src/rotas/nfe.ts): acima disso ele responde 413. */
export const MAX_XML_BYTES = 2 * 1024 * 1024

export interface RespostaNfeXml {
  ok: true
  nfe_id: string | null
  chave: string
  numero: number
  serie: number
  itens: number
  status: string
  avisos?: string[]
}

/**
 * Manda o arquivo ao worker e devolve o que ele parseou. Prazo maior que o padrão porque há
 * upload de arquivo no meio.
 */
export function enviarXmlNfe(arquivo: File, tenantId?: string | null): Promise<RespostaNfeXml> {
  if (arquivo.size > MAX_XML_BYTES) throw new Error('O XML tem mais de 2 MB — o worker não aceita arquivos desse tamanho.')
  const form = new FormData()
  form.append('xml', arquivo, arquivo.name)
  if (tenantId) form.append('tenant_id', tenantId)
  return chamarWorker<RespostaNfeXml>('/nfe/xml', { corpo: form, timeoutMs: 60_000 })
}

/** Frase curta de sucesso para a tela: o que entrou e quantos itens. */
export const resumoXmlEnviado = (r: RespostaNfeXml): string =>
  `NF-e ${r.numero}/${r.serie} registrada com ${r.itens} ${r.itens === 1 ? 'item' : 'itens'}.`
