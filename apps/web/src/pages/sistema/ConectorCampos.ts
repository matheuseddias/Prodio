// O que cada plataforma pede na hora de conectar, e para onde cada valor vai.
//
// `credencial` sai do navegador uma vez e vai cifrada para o banco pelo worker
// (POST /connectors/:id/credentials). `config` é dado de endereçamento, não segredo, e fica em
// `connectors.config` pela RPC upsert_connector — ver o cabeçalho de apps/web/src/data/conectores.ts.
import type { Plataforma } from './ConectorMeta'

export interface CampoConector {
  chave: string
  label: string
  destino: 'credencial' | 'config'
  obrigatorio?: boolean
  secreto?: boolean
  hint?: string
  placeholder?: string
  /** Sufixo do rótulo quando o campo não é obrigatório (padrão: "opcional"). */
  aviso?: string
  /** Campo curto entra em par na mesma linha. */
  curto?: boolean
}

/**
 * Plataformas que o worker realmente sabe conversar hoje (apps/worker/src/conectores/index.ts).
 * Omie e Magis5 ainda não têm adaptador: a tela diz isso em vez de guardar uma credencial que
 * ninguém usaria e marcar um conector que nunca vai sincronizar.
 */
export const TEM_ADAPTADOR: Record<Plataforma, boolean> = { baselinker: true, bling: true, tiny: true, omie: false, magis5: false }

/** Plataformas em que o segredo vem de um consentimento OAuth, não de um token colado. */
export const OAUTH = ['bling', 'tiny'] as const
export const ehOauth = (p: Plataforma): p is (typeof OAUTH)[number] => (OAUTH as readonly string[]).includes(p)

export const CAMPOS: Record<Plataforma, CampoConector[]> = {
  baselinker: [
    { chave: 'token', label: 'Token da API', destino: 'credencial', obrigatorio: true, placeholder: 'Cole o token da conta', hint: 'Enviado como X-BLToken. Sai daqui direto para o worker e fica cifrado no banco.' },
    { chave: 'inventory_id', label: 'Inventário (ID)', destino: 'config', curto: true, hint: 'Vazio usa o inventário padrão da conta. O teste mostra os ids disponíveis.' },
    {
      chave: 'warehouse_id',
      label: 'Depósito (warehouse_id)',
      destino: 'config',
      curto: true,
      placeholder: 'bl_1234',
      aviso: 'necessário para enviar estoque',
      hint: 'Sem ele o Prodio não consegue enviar o estoque produzido para o BaseLinker.',
    },
  ],
  // Bling: o app é do Prodio (client_id/secret ficam nas variáveis do worker). O cliente só autoriza.
  bling: [],
  tiny: [
    { chave: 'client_id', label: 'client_id', destino: 'credencial', obrigatorio: true, curto: true },
    { chave: 'client_secret', label: 'client_secret', destino: 'credencial', obrigatorio: true, secreto: true, curto: true },
  ],
  omie: [
    { chave: 'app_key', label: 'app_key', destino: 'credencial', obrigatorio: true, curto: true },
    { chave: 'app_secret', label: 'app_secret', destino: 'credencial', obrigatorio: true, secreto: true, curto: true },
  ],
  magis5: [{ chave: 'token', label: 'Chave de API', destino: 'credencial', obrigatorio: true }],
}

/** Só o que foi preenchido, separado pelo destino: credencial vai ao worker, config vai à RPC. */
export function separar(plataforma: Plataforma, valores: Record<string, string>, destino: CampoConector['destino']): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const campo of CAMPOS[plataforma]) {
    if (campo.destino !== destino) continue
    const v = (valores[campo.chave] ?? '').trim()
    if (v) saida[campo.chave] = v
  }
  return saida
}

export const faltaObrigatorio = (plataforma: Plataforma, valores: Record<string, string>): boolean =>
  CAMPOS[plataforma].some((c) => c.obrigatorio && !(valores[c.chave] ?? '').trim())
