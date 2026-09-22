// Fábrica de adaptadores a partir da linha de connectors e das credenciais decifradas.
import type { Env } from '../env'
import type { ConectorRow, Credenciais, Db } from '../db'
import { ConectorBaseLinker, type ConfigBaseLinker, type CredenciaisBaseLinker } from './baselinker'
import { ConectorBling, type ConfigBling, type CredenciaisBling } from './bling'
import { ConectorTiny, type ConfigTiny, type CredenciaisTiny } from './tiny'
import { ErroConector, type Conector } from './tipos'

export interface ConfigComum {
  push_estoque?: boolean
  dry_run?: boolean
  modo_estoque?: string
  intervalo_min?: number
}

export function criarConector(row: ConectorRow, credenciais: Credenciais | null, env: Env, db: Pick<Db, 'getCredentials' | 'setCredentials'>): Conector {
  const config = (row.config ?? {}) as ConfigComum & ConfigBaseLinker & ConfigBling & ConfigTiny
  if (!credenciais) throw new ErroConector(row.plataforma, 'conector sem credenciais')
  switch (row.plataforma) {
    case 'baselinker':
      return new ConectorBaseLinker({ connectorId: row.id, credenciais: credenciais as unknown as CredenciaisBaseLinker, config })
    case 'bling':
      return new ConectorBling({
        connectorId: row.id,
        credenciais: credenciais as CredenciaisBling,
        app: { clientId: env.BLING_CLIENT_ID, clientSecret: env.BLING_CLIENT_SECRET },
        config,
        fuso: row.tenants?.fuso,
        persistir: (c) => db.setCredentials(row.tenant_id, row.id, c as unknown as Credenciais),
      })
    case 'tiny':
      return new ConectorTiny({
        connectorId: row.id,
        credenciais: credenciais as CredenciaisTiny,
        app: { clientId: env.TINY_CLIENT_ID, clientSecret: env.TINY_CLIENT_SECRET },
        config,
        fuso: row.tenants?.fuso,
        persistir: (c) => db.setCredentials(row.tenant_id, row.id, c as unknown as Credenciais),
        // O refresh do Tiny é rotativo: reler antes de renovar evita queimar o par que
        // outra execução do cron acabou de gravar.
        recarregar: async () => (await db.getCredentials(row.id)) as CredenciaisTiny | null,
      })
    default:
      throw new ErroConector(row.plataforma, `plataforma ${row.plataforma} ainda sem adaptador`)
  }
}

// Carrega credenciais e monta o adaptador. Erro aqui é do conector, não do sistema.
export async function montarConector(row: ConectorRow, env: Env, db: Pick<Db, 'getCredentials' | 'setCredentials'>): Promise<Conector> {
  const creds = await db.getCredentials(row.id)
  return criarConector(row, creds, env, db)
}
