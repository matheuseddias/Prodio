// Ponto de entrada do worker: roteador simples, despacho de cron, health e handler de e-mail.
import type { Env } from './env'
import { Db } from './db'
import { classificarCron } from './cron'
import { email } from './email'
import { syncPedidos } from './jobs/syncPedidos'
import { aplicarOutbox } from './jobs/aplicarOutbox'
import { auditor } from './jobs/auditor'
import { log, mensagemErro } from './log'
import { rotaOauthCallback, rotaOauthIr, rotaOauthStart, rotaSetCredentials, type PlataformaOauth } from './rotas/credenciais'
import { rotaNfeXml } from './rotas/nfe'
import { rotaSincronizarConector } from './rotas/sincronizar'
import { rotaTestarConector } from './rotas/testar'
import { rotaWebhookBling } from './rotas/webhooks'
import { erro, json } from './rotas/util'
import { comCors, lerOrigensPermitidas, origemPermitida, respostaPreflight } from './cors'

export type { Env } from './env'

const UUID = '[0-9a-f-]{36}'
// 404 do ROTEADOR (caminho que este worker não conhece), diferente do 404 de um handler
// ("conector não encontrado neste tenant"). Como a tela mostra o texto que o worker escreve, este
// aqui precisa dizer a causa de verdade: quase sempre é interface nova contra worker antigo.
const ROTA_DESCONHECIDA = 'esta rota não existe neste worker; se a interface foi publicada depois dele, publique o worker de novo'
const ROTAS: { metodo: string; padrao: RegExp; handler: (req: Request, env: Env, ctx: ExecutionContext, params: string[]) => Promise<Response> }[] = [
  // /health é aberto de propósito: não tem credencial nem dado de tenant, e um monitor externo
  // precisa lê-lo do navegador. É a única rota com Allow-Origin "*".
  { metodo: 'GET', padrao: /^\/health$/, handler: async () => json({ ok: true, servico: 'prodio-worker' }, 200, { 'Access-Control-Allow-Origin': '*' }) },
  { metodo: 'POST', padrao: new RegExp(`^/webhooks/bling/(${UUID})$`), handler: (req, env, ctx, [id]) => rotaWebhookBling(req, env, ctx, id) },
  { metodo: 'POST', padrao: /^\/nfe\/xml$/, handler: (req, env) => rotaNfeXml(req, env) },
  { metodo: 'POST', padrao: new RegExp(`^/connectors/(${UUID})/credentials$`), handler: (req, env, _ctx, [id]) => rotaSetCredentials(req, env, id) },
  { metodo: 'POST', padrao: new RegExp(`^/connectors/(${UUID})/test$`), handler: (req, env, _ctx, [id]) => rotaTestarConector(req, env, id) },
  // Sincronização manual do cartão do conector. Recebe o ctx porque pode devolver a resposta
  // antes de a leitura terminar e deixar o resto rodando em waitUntil (ver rotas/sincronizar.ts).
  { metodo: 'POST', padrao: new RegExp(`^/connectors/(${UUID})/sync$`), handler: (req, env, ctx, [id]) => rotaSincronizarConector(req, env, ctx, id) },
  { metodo: 'POST', padrao: new RegExp(`^/connectors/(${UUID})/(bling|tiny)/oauth/start$`), handler: (req, env, _ctx, [id, p]) => rotaOauthStart(req, env, id, p as PlataformaOauth) },
  // /oauth/go e /oauth/callback são navegações da janela de autorização, não fetch da interface:
  // não têm JWT. Quem autoriza as duas é o state assinado, e o cookie de vínculo que a primeira
  // grava é o que amarra a volta ao navegador que começou (ver rotas/oauthVinculo.ts).
  { metodo: 'GET', padrao: /^\/connectors\/(bling|tiny)\/oauth\/go$/, handler: (req, env, _ctx, [p]) => rotaOauthIr(req, env, p as PlataformaOauth) },
  { metodo: 'GET', padrao: /^\/connectors\/(bling|tiny)\/oauth\/callback$/, handler: (req, env, _ctx, [p]) => rotaOauthCallback(req, env, p as PlataformaOauth) },
]

export function resolverRota(metodo: string, caminho: string): { handler: (typeof ROTAS)[number]['handler']; params: string[] } | null {
  for (const r of ROTAS) {
    if (r.metodo !== metodo) continue
    const m = r.padrao.exec(caminho)
    if (m) return { handler: r.handler, params: m.slice(1) }
  }
  return null
}

// Métodos que o caminho aceita, para o Access-Control-Allow-Methods do preflight.
export function metodosDaRota(caminho: string): string[] {
  return [...new Set(ROTAS.filter((r) => r.padrao.test(caminho)).map((r) => r.metodo))]
}

export async function rodarCron(expressao: string | undefined, env: Env): Promise<void> {
  const { tipo, reconhecida } = classificarCron(expressao)
  const db = new Db(env)
  // Expressão que ninguém reconhece NÃO vira "não faz nada": ver o comentário de cron.ts. Roda o
  // ciclo curto, que é idempotente, e deixa o aviso alto no log para quem for publicar.
  if (!reconhecida) log('warn', 'cron.desconhecido', { cron: expressao, rodando: tipo })
  log('info', 'cron.inicio', { cron: expressao, tipo })
  if (tipo === 'auditor') {
    await auditor(env, db)
    return
  }
  await syncPedidos(env, db)
  await aplicarOutbox(env, db)
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    // Origem exata quando está na lista, senão null. Webhook e cron não mandam Origin e seguem
    // sem nenhum cabeçalho de CORS — máquina não precisa.
    const origem = origemPermitida(request.headers.get('Origin'), lerOrigensPermitidas(env.CORS_ORIGENS))
    // Preflight de caminho DESCONHECIDO também é liberado, de propósito. Preflight que não volta
    // 2xx com CORS vira "CORS preflight did not succeed" no navegador, a requisição real nunca sai
    // e a tela cai na mensagem de rede/CORS — mandando o dono conferir CORS_ORIGENS quando o
    // problema é worker desatualizado. Liberando o OPTIONS, a requisição real sai e volta o 404
    // com o texto que explica a causa. Não expõe nada: OPTIONS não roda handler nenhum.
    if (request.method === 'OPTIONS') return respostaPreflight(origem, metodosDaRota(url.pathname))
    const rota = resolverRota(request.method, url.pathname)
    if (!rota) return comCors(erro(404, ROTA_DESCONHECIDA), origem)
    try {
      return comCors(await rota.handler(request, env, ctx, rota.params), origem)
    } catch (e) {
      log('error', 'rota.falha', { metodo: request.method, caminho: url.pathname, erro: mensagemErro(e) })
      // Erro também leva CORS: sem isso o navegador esconde o 500 atrás de uma queixa de CORS.
      return comCors(erro(500, 'erro interno'), origem)
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(rodarCron(controller.cron, env).catch((e) => log('error', 'cron.falha', { cron: controller.cron, erro: mensagemErro(e) })))
  },
  email,
} satisfies ExportedHandler<Env>
