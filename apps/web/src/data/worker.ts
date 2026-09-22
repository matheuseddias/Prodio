// Cliente HTTP do worker do Prodio (apps/worker).
//
// O worker é o único lugar que guarda credencial de plataforma: a interface nunca fala com
// BaseLinker, Bling ou Tiny direto. Toda rota acionada por usuário exige
// `Authorization: Bearer <access_token da sessão>` e o worker confere, como o próprio usuário
// (anon key + JWT, com RLS valendo), que ele é admin do tenant do conector —
// docs/arquitetura.md, seção 2.5.
//
// Este módulo é genérico de propósito (outras telas vão usá-lo). Ele faz três coisas: monta a URL,
// põe o token da sessão e transforma qualquer falha em frase em português, na mesma pegada de
// ./erros.ts — quem lê é o dono da fábrica, não quem escreveu o worker.
import { clienteSupabase, modoDados, workerUrl } from './supabaseClient'

/**
 * De onde veio a falha. Importa porque só `worker` significa que a plataforma (ou o worker)
 * realmente respondeu: nos outros casos nada foi verificado e o conector não pode mudar de status.
 */
export type CausaErroWorker = 'configuracao' | 'sessao' | 'rede' | 'worker'

export class ErroWorker extends Error {
  readonly causa: CausaErroWorker
  /** Status HTTP quando houve resposta; 0 quando a requisição nem chegou lá. */
  readonly status: number
  constructor(causa: CausaErroWorker, mensagem: string, status = 0) {
    super(mensagem)
    this.name = 'ErroWorker'
    this.causa = causa
    this.status = status
  }
}

/** O endereço do worker está configurado nesta publicação? */
export const workerConfigurado = (): boolean => workerUrl.length > 0

const TIMEOUT_PADRAO_MS = 30_000

const MAQUINAS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Para onde o access_token da sessão pode ir.
 *
 * Toda chamada daqui leva `Authorization: Bearer <access_token do Supabase>` — a chave que abre a
 * conta do usuário no banco. Ela sai do navegador para o endereço que `VITE_WORKER_URL` disser, e
 * esse valor entra no bundle no momento do build do Cloudflare Pages.
 *
 * Esta guarda NÃO protege contra um build malicioso: quem consegue mexer na variável de build já
 * escreve o que quiser dentro do próprio bundle e não precisa do worker para roubar nada. O que
 * ela pega é o caso real: endereço `http://` (o token viajaria em texto claro, legível por
 * qualquer intermediário da rede da fábrica), um valor colado errado no painel, ou o endereço de
 * staging de alguém sobrando na configuração de produção. Falhar antes de montar o cabeçalho
 * garante que o token não sai para um endereço que não passou por esta conferência.
 */
export function baseSegura(base: string): boolean {
  try {
    const u = new URL(base)
    return u.protocol === 'https:' || (u.protocol === 'http:' && MAQUINAS_LOCAIS.has(u.hostname))
  } catch {
    return false
  }
}

const origemAtual = (): string => (typeof window === 'undefined' ? 'esta origem' : window.location.origin)

// (a) O worker nem foi publicado / a variável não chegou ao build do Pages. É o primeiro caso que o
// dono encontra, e nenhuma outra mensagem faz sentido antes desta. Exportada para a tela conferir
// antes de começar um fluxo que depende do worker — assim ela não escreve no banco à toa.
export function exigirWorkerConfigurado(): string {
  if (!workerUrl) {
    throw new ErroWorker(
      'configuracao',
      'O endereço do worker do Prodio não está configurado nesta publicação (VITE_WORKER_URL). ' +
        'Enquanto o worker não estiver publicado e o endereço dele não entrar no build da interface, não dá para salvar credenciais nem testar a conexão com as plataformas.',
    )
  }
  if (!baseSegura(workerUrl)) {
    throw new ErroWorker(
      'configuracao',
      `O endereço configurado para o worker (${workerUrl}) não é um endereço https válido. ` +
        'O Prodio manda o token da sua sessão nessas chamadas e não envia esse token por uma conexão sem criptografia. ' +
        'Corrija VITE_WORKER_URL no painel do Cloudflare Pages (produção e preview) e publique a interface de novo.',
    )
  }
  return workerUrl
}

async function tokenDaSessao(): Promise<string> {
  if (modoDados() === 'memoria') {
    throw new ErroWorker(
      'sessao',
      'O Prodio está rodando com dados de exemplo, sem banco. Configure VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY e entre com sua conta para conectar uma plataforma de verdade.',
    )
  }
  let token: string | undefined
  try {
    const { data } = await clienteSupabase().auth.getSession()
    token = data.session?.access_token ?? undefined
  } catch {
    token = undefined
  }
  if (!token) throw new ErroWorker('sessao', 'Sua sessão expirou. Entre de novo e repita a operação.')
  return token
}

/**
 * Página em https chamando worker em http: o navegador bloqueia por conteúdo misto ANTES de sair
 * da máquina, e o fetch rejeita com o mesmo "Failed to fetch" de rede e de CORS. Só que aqui a
 * mensagem (b) mandaria conferir CORS_ORIGENS e o endereço /health — que abre normalmente digitado
 * na barra. É um caso que não aparece no dev server (localhost é http dos dois lados) e só morde
 * na interface publicada.
 */
function conteudoMisto(base: string): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'https:' && base.startsWith('http://')
}

// (b) Falha de rede e bloqueio de CORS são indistinguíveis no navegador: o fetch rejeita igual nos
// dois casos, de propósito, para não contar a um site de fora se o servidor existe. Então a
// mensagem não escolhe uma das duas — diz o que conferir em cada uma.
function erroDeRede(base: string, e: unknown): ErroWorker {
  if ((e as { name?: string })?.name === 'AbortError') {
    return new ErroWorker('rede', `O worker (${base}) não respondeu a tempo. Tente de novo em alguns instantes; se persistir, veja os logs do worker.`)
  }
  if (conteudoMisto(base)) {
    return new ErroWorker(
      'configuracao',
      `O endereço do worker está configurado como ${base} (http), mas o Prodio está sendo servido por https. ` +
        'O navegador bloqueia essa chamada por conteúdo misto e nem chega a tentar. Corrija VITE_WORKER_URL para https e publique a interface de novo.',
    )
  }
  return new ErroWorker(
    'rede',
    `Não foi possível falar com o worker em ${base}. O navegador não diz qual das duas causas é: ou o worker está fora do ar (ou sem rede), ` +
      `ou ele recusou a origem ${origemAtual()}. Confira se ${base}/health abre no navegador e se essa origem está na lista CORS_ORIGENS do worker.`,
  )
}

const POR_STATUS: Record<number, string> = {
  401: 'Sua sessão expirou. Entre de novo e repita a operação.',
  403: 'Só o administrador da empresa mexe em conectores.',
  404: 'O worker não conhece esta rota. Provavelmente está rodando uma versão antiga: publique o worker de novo.',
  413: 'O arquivo enviado é grande demais para o worker.',
}

function mensagemPorStatus(status: number): string {
  if (POR_STATUS[status]) return POR_STATUS[status]
  if (status >= 500) return `O worker respondeu com erro ${status}. Veja os logs do worker (wrangler tail) e tente de novo.`
  return `O worker recusou a chamada (HTTP ${status}).`
}

/**
 * Deixa a frase do worker apresentável sem reescrevê-la: ela já vem escrita para humano.
 * Vale para o `erro` e para o `detalhe` de sucesso — as duas saem do worker em minúscula, para
 * serem encaixadas numa frase maior, e as duas acabam sozinhas numa caixa na tela.
 */
export function comoFrase(texto: string): string {
  const t = texto.trim()
  if (!t) return t
  const inicio = t[0].toUpperCase() + t.slice(1)
  return /[.!?…]$/.test(inicio) ? inicio : `${inicio}.`
}

export interface OpcoesWorker {
  metodo?: 'GET' | 'POST'
  /**
   * Corpo da requisição. Ausente quando a rota não recebe nada; `FormData` quando a rota espera
   * arquivo (multipart — o navegador põe o boundary no Content-Type, por isso ele não é definido
   * aqui); qualquer outro valor vai como JSON.
   */
  corpo?: unknown
  timeoutMs?: number
}

/** Cabeçalho e corpo do fetch conforme o tipo de `corpo`. */
function corpoDaRequisicao(corpo: unknown): { headers: Record<string, string>; body: BodyInit | undefined } {
  if (corpo === undefined) return { headers: {}, body: undefined }
  if (typeof FormData !== 'undefined' && corpo instanceof FormData) return { headers: {}, body: corpo }
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
}

/**
 * Chama uma rota do worker e devolve o JSON já verificado.
 *
 * Contrato do worker: sucesso vem `{ ok: true, … }`; falha vem `{ ok: false, erro }` com status
 * HTTP adequado. (c) Quando o worker manda `erro`, é esse texto que aparece na tela — ele já foi
 * escrito para o usuário (ver apps/worker/src/rotas/testar.ts).
 */
export async function chamarWorker<T>(caminho: string, opcoes: OpcoesWorker = {}): Promise<T> {
  const base = exigirWorkerConfigurado()
  const token = await tokenDaSessao()
  const controle = new AbortController()
  const prazo = setTimeout(() => controle.abort(), opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS)

  let res: Response
  const envio = corpoDaRequisicao(opcoes.corpo)
  try {
    res = await fetch(`${base}${caminho}`, {
      method: opcoes.metodo ?? 'POST',
      headers: { Authorization: `Bearer ${token}`, ...envio.headers },
      body: envio.body,
      signal: controle.signal,
    })
  } catch (e) {
    throw erroDeRede(base, e)
  } finally {
    clearTimeout(prazo)
  }

  const texto = await res.text().catch(() => '')
  let dados: unknown = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }
  const corpo = (dados ?? {}) as { ok?: boolean; erro?: unknown }

  if (!res.ok || corpo.ok === false) {
    const doWorker = typeof corpo.erro === 'string' ? comoFrase(corpo.erro) : ''
    throw new ErroWorker('worker', doWorker || mensagemPorStatus(res.status), res.status)
  }
  if (dados === null || typeof dados !== 'object') {
    throw new ErroWorker('worker', 'O worker respondeu num formato inesperado. Confira se o endereço configurado é mesmo o do worker do Prodio.', res.status)
  }
  return dados as T
}
