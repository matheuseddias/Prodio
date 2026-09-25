// POST /connectors/:id/sync — o botão "Sincronizar agora" do cartão do conector.
//
// Por que existe: o cron de 5 minutos (wrangler.toml) é o ÚNICO caminho por onde um sync acontece.
// Quem acabava de conectar uma plataforma ficava olhando "Último sync —" e "Pedidos 24h —" sem
// nenhuma forma de saber se o robô já rodou, se vai rodar ou se falhou — e o erro, quando havia,
// só aparecia para quem soubesse rodar `wrangler tail` num terminal. Numa fábrica quem conecta é o
// dono ou o encarregado. Esta rota roda a MESMA sincronização do cron na hora e devolve o
// resultado em uma frase que qualquer pessoa entende.
//
// Autorização: idêntica à de /credentials e /test (exigirUsuario + exigirAdminDoConector). Ver
// docs/arquitetura.md §2.5 — o pedido é conferido COMO O PRÓPRIO USUÁRIO (anon key + JWT dele,
// então RLS e current_member_role valem: tem de ser admin do tenant do conector) e só depois o
// service role entra, e só para o que é impossível fazer como usuário: decifrar a credencial,
// gravar os pedidos (worker_upsert_orders) e marcar o resultado no cartão (connectors).
//
// DECISÃO 1 — CONCORRÊNCIA: o cursor tem um dono só, e é o cron.
//   O cron pode estar sincronizando este conector no exato instante em que o dono aperta o botão,
//   e o dono pode apertar duas vezes. Pedido duplicado não é o risco (o upsert é idempotente por
//   chave única, docs/arquitetura.md §2, regra 6); o risco é o cursor de sync_state andar para
//   trás ou para frente errado, porque as duas execuções leem o mesmo cursor antigo e gravam
//   cursores diferentes — quem gravar por último vence, e se for a execução mais atrasada o
//   cursor pula pedidos que ninguém leu. Isso é perda de dado silenciosa.
//   A cura mais simples é tirar o segundo escritor: a sincronização manual NÃO grava cursor
//   (origem: 'manual'). Ela lê o cursor atual, traz o que houver e grava os pedidos; o cursor
//   fica exatamente onde o cron o deixou. Com um escritor só, não existe corrida para resolver.
//   O preço é a próxima rodada do cron reler a mesma janela — releitura que já acontece de
//   propósito (o BaseLinker volta 2 h no cursor, justamente porque o upsert é idempotente) e que
//   custa uma chamada de API, não um dado errado.
//   A regra foi estendida a sync_state INTEIRO (origem 'manual' em sincronizarConector): o botão
//   também não grava o pulso (last_run_at), nem last_ok_at, nem runs. Ele marca só o cartão
//   (connectors: ultimo_sync, status, ultimo_erro — Db.marcarRodadaManual). sync_state é o diário
//   do robô; se o botão escrevesse nele, um clique com o cron morto faria o robô parecer vivo, e a
//   tela perderia o único jeito de separar "o robô não roda" de "o robô roda e morre".
//
// DECISÃO 2 — TEMPO: responde sempre, e o que passar do prazo continua em segundo plano.
//   A leitura tem o mesmo teto de páginas por rodada do cron (paginas_por_rodada, padrão 2), então
//   o normal é responder em poucos segundos; mas a plataforma pode estar lenta, e um Worker não pode
//   segurar a requisição para sempre. Devolver "comecei, olhe o cartão depois" para todo mundo
//   seria pior do que o problema que esta rota resolve. Então: esperamos o resultado até
//   TEMPO_LIMITE_MS e respondemos com ele. Se estourar, a execução é entregue a ctx.waitUntil
//   (ela termina, grava os pedidos e o cartão sozinha) e o dono recebe 200 com uma frase que diz
//   exatamente isso. Nos dois casos ele sai da tela
//   sabendo o que está acontecendo, que é o critério.
//   A execução é entregue ao ctx.waitUntil ASSIM QUE COMEÇA, não só quando o prazo estoura: sem
//   isso ela vive presa à requisição e o dono fechar a aba no meio cancelaria a leitura — que
//   voltaria como "falha da plataforma" gravada no cartão. Ver o comentário no corpo da rota.
//   A DECISÃO 1 é o que torna isto seguro: como a manual não grava cursor, uma execução de fundo
//   interrompida no meio não avança nada — no pior caso algumas páginas já gravadas (idempotente) e
//   o cron refaz a janela cinco minutos depois.
//
// DECISÃO 3 — DUPLO CLIQUE: o segundo clique entra na execução que já está rodando.
//   Cada requisição é autorizada por conta própria; só a execução é compartilhada, por conector.
//   Não é um lock distribuído (o cron e outro isolate continuam podendo rodar junto — e por isso a
//   DECISÃO 1 existe): é só evitar o caso comum e barato de bater duas vezes na plataforma porque
//   o dono clicou duas vezes.
import type { Env } from '../env'
import { Db, type ConectorRow, type Credenciais } from '../db'
import { criarConector } from '../conectores'
import { mensagemDaFalhaDeSync, nomeDaPlataforma, redigirSegredos } from '../conectores/mensagens'
import { ErroConector, type Conector, type Plataforma } from '../conectores/tipos'
import { desativarSeSemCredenciais, ehSemCredenciais } from '../jobs/semCredenciais'
import { sincronizarConector, type DbSync } from '../jobs/syncPedidos'
import { log, mensagemErro } from '../log'
import { ErroRota, exigirAdminDoConector, exigirUsuario, json, tratarErro, type ConectorAutorizado, type Usuario } from './util'

// Quanto esta chamada espera pelo resultado antes de responder "continua em segundo plano".
export const TEMPO_LIMITE_MS = 20_000

// O que a rota usa do banco (service role, sempre depois da autorização como usuário).
export type DbSincronizar = DbSync & Pick<Db, 'getCredentials' | 'setCredentials' | 'marcarStatusConector'>

// O ctx do Worker, reduzido ao que precisamos — o teste passa um espião.
export interface ContextoFundo {
  waitUntil(promessa: Promise<unknown>): void
}

export interface RespostaSync {
  status: number
  corpo: { ok: true; pedidos: number; detalhe: string } | { ok: false; erro: string }
}

export interface DepsSync {
  db?: DbSincronizar
  autorizar?: (u: Usuario, connectorId: string) => Promise<ConectorAutorizado>
  criar?: (row: ConectorRow, credenciais: Credenciais | null, env: Env, db: DbSincronizar) => Conector
  sincronizar?: typeof sincronizarConector
  lerTenant?: (u: Usuario, tenantId: string) => Promise<{ slug: string; fuso: string } | null>
  tempoLimiteMs?: number
}

// Sucesso com zero pedidos é o caso MAIS COMUM de quem acabou de conectar, e não é erro: a conta
// respondeu, só não havia nada novo desde a última leitura. Se a frase não disser isso com todas
// as letras, o dono conclui que quebrou e vai mexer na credencial que estava boa.
// `emDia = false`: a leitura parou no teto de páginas e há mais pedidos na fila. Dizer isso evita o
// dono procurar o pedido de hoje, não achar e concluir que a integração perde pedido.
export function detalheSucesso(plataforma: string, pedidos: number, emDia = true): string {
  const nome = nomeDaPlataforma(plataforma)
  if (pedidos <= 0) return `a conta do ${nome} respondeu, nenhum pedido novo desde a última leitura`
  const base = pedidos === 1 ? `1 pedido lido do ${nome} e gravado no Prodio` : `${pedidos} pedidos lidos do ${nome} e gravados no Prodio`
  if (emDia) return base
  return `${base}; ainda há pedidos mais novos na fila, e o robô do Prodio continua a leitura sozinho, algumas páginas a cada 5 minutos, até ficar em dia`
}

export function detalheEmAndamento(plataforma: string): string {
  // Não prometa que o cartão se atualiza sozinho: a tela relê `connectors` uma vez, logo depois
  // desta resposta, e nessa hora a leitura ainda não terminou. Quem termina é o waitUntil, e a
  // única forma de ver o resultado é reler a página. Dizer "aparece em instantes" e não aparecer é
  // exatamente o tipo de mentira que esta rota existe para acabar.
  return `a leitura no ${nomeDaPlataforma(plataforma)} está demorando mais que o normal e continua rodando aqui no servidor; ela termina sozinha, é só recarregar a página daqui a pouco para ver o resultado no cartão`
}

// Linha de conector para a fábrica de adaptadores, montada com o que foi lido COMO O USUÁRIO.
function linhaDoConector(c: ConectorAutorizado, tenants: { slug: string; fuso: string } | null): ConectorRow {
  return {
    id: c.id,
    tenant_id: c.tenant_id,
    plataforma: c.plataforma as Plataforma,
    nome: c.nome,
    status: c.status as ConectorRow['status'],
    config: (c.config ?? {}) as Record<string, unknown>,
    tenants,
  }
}

// O fuso do tenant entra no filtro de data do Bling e do Tiny (ver pullOrders dos dois). É leitura
// que o próprio usuário pode fazer (policy tenants_select exige membership), então é lida como ele,
// não com service role. Se falhar, o adaptador cai no padrão America/Sao_Paulo: atrasar o sync por
// causa do fuso seria pior do que a diferença de fuso.
async function lerTenantDoUsuario(u: Usuario, tenantId: string): Promise<{ slug: string; fuso: string } | null> {
  const r = await u.sb.from('tenants').select('slug, fuso').eq('id', tenantId).maybeSingle()
  if (r.error) {
    log('warn', 'conector.sync.tenant', { tenant: tenantId, user: u.userId, erro: r.error.message })
    return null
  }
  return (r.data as { slug: string; fuso: string } | null) ?? null
}

// Prazo desta chamada. Cancelar importa: um timer pendurado segura o isolate à toa depois de a
// resposta já ter saído.
function esperar(ms: number): { promessa: Promise<'tempo'>; cancelar: () => void } {
  let parar = (): void => {}
  const promessa = new Promise<'tempo'>((resolver) => {
    const id = setTimeout(() => resolver('tempo'), ms)
    parar = () => clearTimeout(id)
  })
  return { promessa, cancelar: () => parar() }
}

// DECISÃO 3. Best-effort e por isolate; o `finally` devolve a chave mesmo se a execução falhar.
const emAndamento = new Map<string, { promessa: Promise<RespostaSync>; em: number }>()

// Depois disto, uma execução registrada não segura mais ninguém. O `finally` já limpa o caso
// normal (inclusive falha), mas ele depende de a promessa TERMINAR — e ClienteHttp não põe prazo
// no fetch. Uma leitura que nunca termina deixaria a chave no mapa para sempre e todo clique
// seguinte entraria numa execução morta: "Sincronizando…" eterno, sem jeito de sair, até o isolate
// ser reciclado. A janela é maior que TEMPO_LIMITE_MS de propósito: enquanto a primeira chamada
// ainda pode responder, juntar é o comportamento certo.
export const JANELA_JUNTAR_MS = 60_000

export function juntarSeJaRoda(connectorId: string, iniciar: () => Promise<RespostaSync>, agora: () => number = Date.now): { promessa: Promise<RespostaSync>; jaRodava: boolean } {
  const atual = emAndamento.get(connectorId)
  if (atual && agora() - atual.em < JANELA_JUNTAR_MS) return { promessa: atual.promessa, jaRodava: true }
  const registro: { promessa: Promise<RespostaSync>; em: number } = {
    em: agora(),
    // Preenchido logo abaixo: o `finally` só roda depois, quando a execução termina.
    promessa: undefined as unknown as Promise<RespostaSync>,
  }
  registro.promessa = iniciar().finally(() => {
    if (emAndamento.get(connectorId) === registro) emAndamento.delete(connectorId)
  })
  emAndamento.set(connectorId, registro)
  return { promessa: registro.promessa, jaRodava: false }
}

export async function rotaSincronizarConector(req: Request, env: Env, ctx: ContextoFundo, connectorId: string, deps: DepsSync = {}): Promise<Response> {
  try {
    const db = deps.db ?? new Db(env)
    const autorizar = deps.autorizar ?? exigirAdminDoConector
    const criar = deps.criar ?? criarConector
    const sincronizar = deps.sincronizar ?? sincronizarConector
    const lerTenant = deps.lerTenant ?? lerTenantDoUsuario
    const tempoLimite = deps.tempoLimiteMs ?? TEMPO_LIMITE_MS

    const u = exigirUsuario(req, env)
    // Aparelho anônimo do chão de fábrica não sincroniza conector: quem barra é exigirAdminDoConector.
    const c = await autorizar(u, connectorId)

    let credenciais: Credenciais | null
    try {
      credenciais = await db.getCredentials(c.id)
    } catch (e) {
      log('error', 'conector.sync.credenciais', { connector: c.id, tenant: c.tenant_id, erro: mensagemErro(e) })
      throw new ErroRota(502, 'não foi possível ler a credencial guardada; tente de novo em instantes')
    }

    const linha = linhaDoConector(c, await lerTenant(u, c.tenant_id))
    let conector: Conector
    try {
      conector = criar(linha, credenciais, env, db)
    } catch (e) {
      if (ehSemCredenciais(e)) {
        // Mesmo caso do cron e do teste: conector ativo sem credencial vira 'desconectado'.
        await desativarSeSemCredenciais(c, db, e)
        throw new ErroRota(400, `nenhuma credencial salva para o ${nomeDaPlataforma(c.plataforma)}: salve a credencial antes de sincronizar`)
      }
      if (e instanceof ErroConector) throw new ErroRota(400, `credencial incompleta: ${redigirSegredos(e.message, credenciais).slice(0, 180)}; complete em Conectores`)
      throw e
    }
    if (!conector.capacidades.pedidos) throw new ErroRota(501, `o ${nomeDaPlataforma(c.plataforma)} ainda não traz pedidos para o Prodio`)

    // Nunca rejeita: qualquer falha vira RespostaSync, porque esta promessa é também a que vai
    // para ctx.waitUntil e a que um segundo clique recebe.
    const executar = async (): Promise<RespostaSync> => {
      try {
        // DECISÃO 1: origem 'manual'. O cursor, e sync_state inteiro, são do cron.
        const r = await sincronizar(linha, db, async () => conector, { origem: 'manual' })
        log('info', 'conector.sync.ok', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId, pedidos: r.pedidos, emDia: r.emDia })
        return { status: 200, corpo: { ok: true, pedidos: r.pedidos, detalhe: detalheSucesso(c.plataforma, r.pedidos, r.emDia) } }
      } catch (e) {
        if (await desativarSeSemCredenciais(c, db, e)) {
          return { status: 400, corpo: { ok: false, erro: `nenhuma credencial salva para o ${nomeDaPlataforma(c.plataforma)}: salve a credencial antes de sincronizar` } }
        }
        // mensagemDaFalhaDeSync e não mensagemDaFalha: sincronizar também lê sync_state e grava
        // pedidos, então a falha pode ser do banco. Mandar "confira a conexão com o BaseLinker"
        // nesse caso faria o dono mexer numa credencial que está boa.
        const mensagem = mensagemDaFalhaDeSync(c.plataforma, e, credenciais)
        // O log também passa pelo filtro de segredos: wrangler tail fica no painel da Cloudflare.
        log('warn', 'conector.sync.falha', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId, erro: redigirSegredos(mensagemErro(e), credenciais) })
        try {
          // Marca a falha no cartão (status 'erro' + o texto), sem tocar em sync_state (DECISÃO 1).
          // Aqui o texto é o mesmo que o dono acabou de ler na tela, não a mensagem crua do adaptador.
          await db.marcarRodadaManual(c.id, c.tenant_id, false, mensagem)
        } catch (e2) {
          log('error', 'conector.sync.gravarErro', { connector: c.id, erro: mensagemErro(e2) })
        }
        return { status: 502, corpo: { ok: false, erro: mensagem } }
      }
    }

    const { promessa, jaRodava } = juntarSeJaRoda(c.id, executar)
    if (jaRodava) log('info', 'conector.sync.juntou', { connector: c.id, tenant: c.tenant_id, user: u.userId })

    // waitUntil AQUI, antes de esperar pelo resultado — e não só quando o prazo estoura.
    //
    // Sem isto, a execução vive presa à requisição: se o dono fecha a aba (ou perde o 4G da
    // fábrica) aos 3 s, o Workers cancela a invocação e com ela o fetch para a plataforma no meio
    // da paginação. A promessa então rejeita, `executar` trata como falha da plataforma e grava
    // `status = 'erro'` + ultimo_erro no cartão — um erro que não existiu, causado por fechar a
    // aba, e que o dono vai ler como "a conexão com o BaseLinker quebrou".
    // Segurando a execução no waitUntil desde o começo, fechar a aba só descarta a RESPOSTA: a
    // leitura termina, grava os pedidos e marca a rodada de verdade. Nada fica pela metade —
    // DECISÃO 1 garante que uma execução de fundo não mexe no cursor.
    ctx.waitUntil(promessa)

    const prazo = esperar(tempoLimite)
    const resultado = await Promise.race([promessa, prazo.promessa])
    prazo.cancelar()
    if (resultado === 'tempo') {
      // DECISÃO 2: a execução continua viva depois da resposta e termina de gravar sozinha.
      log('info', 'conector.sync.fundo', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId, msLimite: tempoLimite })
      return json({ ok: true, pedidos: 0, detalhe: detalheEmAndamento(c.plataforma) })
    }
    return json(resultado.corpo, resultado.status)
  } catch (e) {
    return tratarErro(e, 'conector.sync.erro')
  }
}
