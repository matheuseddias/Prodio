// POST /connectors/:id/test — o botão "Testar conexão" da tela.
//
// Faz uma chamada barata e somente-leitura à plataforma com a credencial guardada e devolve uma
// frase que prova a conexão para um humano. Nada é escrito na conta do cliente.
//
// Autorização: exatamente a de rotaSetCredentials. Primeiro o pedido é conferido COMO O PRÓPRIO
// USUÁRIO (anon key + JWT dele, então RLS e current_member_role valem: tem de ser admin do tenant
// do conector). Só depois o worker usa o service role, e só para o que é impossível fazer como
// usuário: decifrar a credencial (a chave é do worker) e refletir o status do conector.
// Ver docs/arquitetura.md §2.5.
import type { Env } from '../env'
import { Db, type ConectorRow, type Credenciais } from '../db'
import { criarConector } from '../conectores'
import { ErroConector, type Conector, type Plataforma } from '../conectores/tipos'
import { desativarSeSemCredenciais, ehSemCredenciais } from '../jobs/semCredenciais'
import { log, mensagemErro } from '../log'
import { ErroRota, exigirAdminDoConector, exigirUsuario, json, tratarErro, type ConectorAutorizado, type Usuario } from './util'

const NOMES: Record<string, string> = { baselinker: 'BaseLinker', bling: 'Bling', tiny: 'Tiny', omie: 'Omie', magis5: 'Magis5' }
export const nomeDaPlataforma = (p: string): string => NOMES[p] ?? p

const LIMITE_DETALHE = 180
const resumir = (s: string): string => (s.length > LIMITE_DETALHE ? `${s.slice(0, LIMITE_DETALHE)}…` : s)

// Tamanho a partir do qual um valor de credencial é tratado como segredo. Abaixo disso é config
// curta (um inventory_id "42") e trocar isso por um aviso só deixaria a mensagem confusa.
const MIN_SEGREDO = 8

// Última barreira antes de um texto virar resposta HTTP ou linha de log.
//
// O caminho genérico de mensagemDaFalha repassa e.message, e alguns adaptadores embutem ali um
// pedaço da resposta CRUA da plataforma (oauthTokenBling: `texto.slice(0, 200)`; bling.chamar: o
// corpo quando não é JSON conhecido). Nada garante que um provedor nunca ecoe de volta o que
// recebeu — servidor OAuth devolvendo o client_id no erro é comum, e o secret vai no mesmo corpo.
// Em vez de confiar em cada adaptador, procuramos aqui os valores que ACABAMOS de decifrar: se um
// deles aparece no texto, sai. Roda antes de resumir(), senão a truncagem deixaria meio segredo.
export function redigirSegredos(texto: string, credenciais: Credenciais | null): string {
  if (!texto || !credenciais) return texto
  let saida = texto
  for (const valor of Object.values(credenciais)) {
    if (typeof valor !== 'string' || valor.length < MIN_SEGREDO) continue
    if (saida.includes(valor)) saida = saida.split(valor).join('[credencial oculta]')
  }
  return saida
}

// Erro da plataforma vira instrução em português. Nunca devolve credencial nem pedaço dela: além
// das mensagens já sanitizadas dos adaptadores (ver mensagemErroTiny), o texto passa por
// redigirSegredos com as credenciais deste conector em mãos.
export function mensagemDaFalha(plataforma: string, e: unknown, credenciais: Credenciais | null = null): string {
  const nome = nomeDaPlataforma(plataforma)
  // Sem ErroConector não houve resposta da plataforma: é rede, DNS ou timeout.
  if (!(e instanceof ErroConector)) return `não foi possível falar com o ${nome} agora; confira a conexão e tente de novo em alguns minutos`
  const status = e.status ?? 0
  const codigo = (e.codigo ?? '').toUpperCase()
  const recusouCredencial = status === 401 || status === 403 || codigo === 'REAUTH' || /AUTH|TOKEN|PERMISS/.test(codigo)
  if (recusouCredencial) {
    if (plataforma === 'baselinker') return 'o token foi recusado pelo BaseLinker; gere um novo em Minha conta > API e salve aqui'
    if (plataforma === 'tiny') return 'o Tiny recusou a autorização; use "Conectar o Tiny" para autorizar de novo'
    if (plataforma === 'bling') return 'o Bling recusou a autorização; use "Conectar o Bling" para autorizar de novo'
    return `o ${nome} recusou a credencial; grave a credencial de novo`
  }
  if (status === 429) return `o ${nome} está limitando as chamadas agora; espere um minuto e teste de novo`
  if (status >= 500) return `o ${nome} respondeu com erro no servidor dele (${status}); o problema é do lado da plataforma, tente mais tarde`
  return `o ${nome} recusou a chamada de teste: ${resumir(redigirSegredos(e.message, credenciais))}`
}

type DbTeste = Pick<Db, 'getCredentials' | 'setCredentials' | 'marcarStatusConector'>

export interface DepsTeste {
  db?: DbTeste
  autorizar?: (u: Usuario, connectorId: string) => Promise<ConectorAutorizado>
  criar?: (row: ConectorRow, credenciais: Credenciais | null, env: Env, db: DbTeste) => Conector
}

// Linha de conector para a fábrica de adaptadores, montada com o que foi lido COMO O USUÁRIO.
// `tenants` fica nulo: o fuso só serve para filtro de data em pullOrders, que o teste não usa.
function linhaDoConector(c: ConectorAutorizado): ConectorRow {
  return {
    id: c.id,
    tenant_id: c.tenant_id,
    plataforma: c.plataforma as Plataforma,
    nome: c.nome,
    status: c.status as ConectorRow['status'],
    config: (c.config ?? {}) as Record<string, unknown>,
    tenants: null,
  }
}

async function marcarStatus(db: DbTeste, c: ConectorAutorizado, status: 'conectado' | 'erro', erro: string | null): Promise<boolean> {
  try {
    await db.marcarStatusConector(c.id, c.tenant_id, status, erro)
    return true
  } catch (e) {
    log('error', 'conector.teste.status', { connector: c.id, tenant: c.tenant_id, status, erro: mensagemErro(e) })
    return false
  }
}

export async function rotaTestarConector(req: Request, env: Env, connectorId: string, deps: DepsTeste = {}): Promise<Response> {
  try {
    const db = deps.db ?? new Db(env)
    const autorizar = deps.autorizar ?? exigirAdminDoConector
    const criar = deps.criar ?? criarConector
    const u = exigirUsuario(req, env)
    const c = await autorizar(u, connectorId)

    let credenciais: Credenciais | null
    try {
      credenciais = await db.getCredentials(c.id)
    } catch (e) {
      log('error', 'conector.teste.credenciais', { connector: c.id, tenant: c.tenant_id, erro: mensagemErro(e) })
      throw new ErroRota(502, 'não foi possível ler a credencial guardada; tente de novo em instantes')
    }

    let conector: Conector
    try {
      conector = criar(linhaDoConector(c), credenciais, env, db)
    } catch (e) {
      if (ehSemCredenciais(e)) {
        // Mesmo caso do cron: conector ativo sem credencial vira 'desconectado' com texto claro.
        await desativarSeSemCredenciais(c, db, e)
        throw new ErroRota(400, `nenhuma credencial salva para o ${nomeDaPlataforma(c.plataforma)}: preencha e salve antes de testar`)
      }
      if (e instanceof ErroConector) throw new ErroRota(400, `credencial incompleta: ${resumir(redigirSegredos(e.message, credenciais))}; complete em Conectores`)
      throw e
    }
    if (!conector.testarConexao) throw new ErroRota(501, `o teste de conexão ainda não existe para o ${nomeDaPlataforma(c.plataforma)}`)

    let detalhe: string
    try {
      detalhe = redigirSegredos(await conector.testarConexao(), credenciais)
    } catch (e) {
      const mensagem = mensagemDaFalha(c.plataforma, e, credenciais)
      // O log também passa pelo filtro: wrangler tail é lido em reunião e fica no painel da
      // Cloudflare; um token que vaze ali vaza do mesmo jeito.
      log('warn', 'conector.teste.falha', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId, erro: redigirSegredos(mensagemErro(e), credenciais) })
      // O status também reflete a realidade quando dá errado: a tela mostra o mesmo texto.
      await marcarStatus(db, c, 'erro', mensagem)
      return json({ ok: false, erro: mensagem }, 502)
    }

    const gravou = await marcarStatus(db, c, 'conectado', null)
    log('info', 'conector.teste.ok', { connector: c.id, tenant: c.tenant_id, plataforma: c.plataforma, user: u.userId })
    // O teste passou de verdade; se só a gravação do status falhou, quem lê precisa saber.
    return json({ ok: true, detalhe: gravou ? detalhe : `${detalhe} (o status do conector não pôde ser atualizado agora)` })
  } catch (e) {
    return tratarErro(e, 'conector.teste.erro')
  }
}
