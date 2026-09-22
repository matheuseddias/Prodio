// Erro técnico vira frase que o dono da fábrica entende — e sem credencial dentro.
//
// Isto nasceu dentro de rotas/testar.ts, quando só o botão "Testar conexão" mostrava erro na tela.
// Hoje são TRÊS caminhos que escrevem o mesmo tipo de texto, e os três acabam na tela:
//   1. POST /connectors/:id/test  → resposta HTTP + connectors.ultimo_erro
//   2. POST /connectors/:id/sync  → resposta HTTP + connectors.ultimo_erro
//   3. o cron de 5 minutos (jobs/syncPedidos.ts) → connectors.ultimo_erro
//
// O caso 3 é o que mudou de natureza: enquanto o cartão do conector não mostrava `ultimo_erro`,
// aquele texto era só log e podia ser a mensagem crua do adaptador. Agora o cartão MOSTRA (ver
// apps/web/src/pages/sistema/ConectorSituacao.ts) e `connectors` é legível por QUALQUER membro do
// tenant — policy `connectors_select` é `for select to authenticated using (tenant_id = …)`, o que
// inclui a sessão anônima do tablet do chão de fábrica. Mensagem crua ali é, ao mesmo tempo,
// interface ruim e vazamento em potencial: `oauthTokenBling` repassa `texto.slice(0, 200)` do corpo
// de resposta do provedor, e servidor OAuth que ecoa de volta o que recebeu é comum.
//
// Por isso o texto do cron passa pelo MESMO funil das rotas: mensagemDaFalha + redigirSegredos.
import { ErroConector, type Plataforma } from './tipos'

const NOMES: Record<string, string> = { baselinker: 'BaseLinker', bling: 'Bling', tiny: 'Tiny', omie: 'Omie', magis5: 'Magis5' }
export const nomeDaPlataforma = (p: string): string => NOMES[p] ?? p

const LIMITE_DETALHE = 180
export const resumir = (s: string): string => (s.length > LIMITE_DETALHE ? `${s.slice(0, LIMITE_DETALHE)}…` : s)

// Tamanho a partir do qual um valor de credencial é tratado como segredo. Abaixo disso é config
// curta (um inventory_id "42") e trocar isso por um aviso só deixaria a mensagem confusa.
const MIN_SEGREDO = 8

// Última barreira antes de um texto virar resposta HTTP, linha de log ou `connectors.ultimo_erro`.
//
// O caminho genérico de mensagemDaFalha repassa e.message, e alguns adaptadores embutem ali um
// pedaço da resposta CRUA da plataforma (oauthTokenBling: `texto.slice(0, 200)`; bling.chamar: o
// corpo quando não é JSON conhecido). Nada garante que um provedor nunca ecoe de volta o que
// recebeu — servidor OAuth devolvendo o client_id no erro é comum, e o secret vai no mesmo corpo.
// Em vez de confiar em cada adaptador, procuramos aqui os valores que ACABAMOS de decifrar: se um
// deles aparece no texto, sai. Roda antes de resumir(), senão a truncagem deixaria meio segredo.
export function redigirSegredos(texto: string, credenciais: Record<string, unknown> | null): string {
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
//
// `acao` é o que estávamos tentando fazer, para a frase genérica sair certa em cada rota ("recusou
// a chamada de teste" no teste, "recusou a leitura de pedidos" na sincronização). O resto das
// mensagens não muda: credencial recusada, limite de chamadas e erro 5xx querem dizer a mesma
// coisa e pedem a mesma providência, venham de onde vierem.
export function mensagemDaFalha(plataforma: string, e: unknown, credenciais: Record<string, unknown> | null = null, acao = 'a chamada de teste'): string {
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
  if (status === 429) return `o ${nome} está limitando as chamadas agora; espere um minuto e tente de novo`
  if (status >= 500) return `o ${nome} respondeu com erro no servidor dele (${status}); o problema é do lado da plataforma, tente mais tarde`
  return `o ${nome} recusou ${acao}: ${resumir(redigirSegredos(e.message, credenciais))}`
}

// Falha de banco tem nome próprio (db.ts, classe ErroBanco). Reconhecemos pelo `name` em vez de
// importar a classe de propósito: db.ts arrasta o cliente do Supabase, e este módulo é usado
// dentro dos adaptadores.
const ehErroDeBanco = (e: unknown): boolean => e instanceof Error && e.name === 'ErroBanco'

// A mesma coisa, para quem sincroniza pedidos (o cron e o botão "Sincronizar agora").
//
// A diferença em relação a mensagemDaFalha é uma só, e importa: sincronizar não é só falar com a
// plataforma — é ler `sync_state`, gravar os pedidos e marcar a rodada. Quando quebra do lado do
// banco, dizer "não foi possível falar com o BaseLinker; confira a conexão" manda o dono mexer na
// credencial que estava boa. Aqui isso vira uma frase que diz de quem é o problema.
export function mensagemDaFalhaDeSync(plataforma: Plataforma | string, e: unknown, credenciais: Record<string, unknown> | null = null): string {
  if (ehErroDeBanco(e)) {
    return `o ${nomeDaPlataforma(plataforma)} respondeu, mas o Prodio não conseguiu gravar o resultado da leitura; é um problema interno nosso, não da sua conta na plataforma`
  }
  return mensagemDaFalha(plataforma, e, credenciais, 'a leitura de pedidos')
}
