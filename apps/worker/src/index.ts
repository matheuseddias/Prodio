// Ponto de entrada do worker: roteador simples, despacho de cron, health e handler de e-mail.
import type { Env } from './env'
import { Db } from './db'
import { classificarCron } from './cron'
import { email } from './email'
import { syncPedidos } from './jobs/syncPedidos'
import { aplicarOutbox } from './jobs/aplicarOutbox'
import { auditor } from './jobs/auditor'
import { log, mensagemErro } from './log'
import { rotaOauthCallback, rotaOauthStart, rotaSetCredentials } from './rotas/credenciais'
import { rotaNfeXml } from './rotas/nfe'
import { rotaWebhookBling } from './rotas/webhooks'
import { erro, json } from './rotas/util'

export type { Env } from './env'

const UUID = '[0-9a-f-]{36}'
const ROTAS: { metodo: string; padrao: RegExp; handler: (req: Request, env: Env, ctx: ExecutionContext, params: string[]) => Promise<Response> }[] = [
  { metodo: 'GET', padrao: /^\/health$/, handler: async () => json({ ok: true, servico: 'prodio-worker' }) },
  { metodo: 'POST', padrao: new RegExp(`^/webhooks/bling/(${UUID})$`), handler: (req, env, ctx, [id]) => rotaWebhookBling(req, env, ctx, id) },
  { metodo: 'POST', padrao: /^\/nfe\/xml$/, handler: (req, env) => rotaNfeXml(req, env) },
  { metodo: 'POST', padrao: new RegExp(`^/connectors/(${UUID})/credentials$`), handler: (req, env, _ctx, [id]) => rotaSetCredentials(req, env, id) },
  { metodo: 'POST', padrao: new RegExp(`^/connectors/(${UUID})/bling/oauth/start$`), handler: (req, env, _ctx, [id]) => rotaOauthStart(req, env, id) },
  { metodo: 'GET', padrao: /^\/connectors\/bling\/oauth\/callback$/, handler: (req, env) => rotaOauthCallback(req, env) },
]

export function resolverRota(metodo: string, caminho: string): { handler: (typeof ROTAS)[number]['handler']; params: string[] } | null {
  for (const r of ROTAS) {
    if (r.metodo !== metodo) continue
    const m = r.padrao.exec(caminho)
    if (m) return { handler: r.handler, params: m.slice(1) }
  }
  return null
}

export async function rodarCron(expressao: string | undefined, env: Env): Promise<void> {
  const tipo = classificarCron(expressao)
  const db = new Db(env)
  log('info', 'cron.inicio', { cron: expressao, tipo })
  if (tipo === 'sync') {
    await syncPedidos(env, db)
    await aplicarOutbox(env, db)
  } else if (tipo === 'auditor') {
    await auditor(env, db)
  } else {
    log('warn', 'cron.desconhecido', { cron: expressao })
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const rota = resolverRota(request.method, url.pathname)
    if (!rota) return erro(404, 'rota não encontrada')
    try {
      return await rota.handler(request, env, ctx, rota.params)
    } catch (e) {
      log('error', 'rota.falha', { metodo: request.method, caminho: url.pathname, erro: mensagemErro(e) })
      return erro(500, 'erro interno')
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(rodarCron(controller.cron, env).catch((e) => log('error', 'cron.falha', { cron: controller.cron, erro: mensagemErro(e) })))
  },
  email,
} satisfies ExportedHandler<Env>
