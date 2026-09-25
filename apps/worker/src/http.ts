// Cliente HTTP dos conectores: fila por execução (serializa chamadas), intervalo mínimo por conta,
// prazo por chamada, backoff em 429/5xx/erro de rede, log estruturado. Corpos são sempre string,
// então repetir é seguro.
import { log } from './log'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>
export type SleepFn = (ms: number) => Promise<void>

// Opções por chamada (o resto é da conta inteira).
export interface OpcoesChamada {
  repetivel?: boolean // padrão true; false em escrita não idempotente
}

export interface OpcoesCliente {
  nome: string // identifica a conta no log (ex.: "baselinker:<connector_id>")
  intervaloMinMs: number // espaçamento entre chamadas da mesma conta
  tentativas?: number // repetições além da primeira (padrão 3)
  esperaMaxMs?: number // teto do backoff (padrão 15 s)
  // Prazo de cada tentativa (padrão 20 s). Sem prazo, uma plataforma que aceita a conexão e não
  // responde prendia a rodada do cron até o limite da Cloudflare, que a mata sem passar por catch
  // nenhum — nada gravado. Com prazo, vira erro comum: repete, e se não passar o cartão mostra.
  timeoutMs?: number
  // Instante compartilhado entre execuções para espaçar as chamadas da mesma conta (obterCliente).
  relogio?: Relogio
  fetchFn?: FetchFn
  sleep?: SleepFn
  agora?: () => number
}

export class ErroHttp extends Error {
  status: number
  corpo: string
  constructor(status: number, corpo: string, mensagem?: string) {
    super(mensagem ?? `HTTP ${status}`)
    this.name = 'ErroHttp'
    this.status = status
    this.corpo = corpo
  }
}

const dormir: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms))

// Calcula quanto esperar antes de repetir: Retry-After, {period} do Bling ou exponencial com jitter.
export async function calcularEspera(res: Response, tentativa: number, teto: number): Promise<number> {
  const retryAfter = Number(res.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, teto)
  if (res.status === 429) {
    try {
      const corpo = (await res.clone().json()) as { period?: unknown }
      const period = Number(corpo?.period)
      if (Number.isFinite(period) && period > 0) return Math.min(period * 1000, teto)
    } catch {
      // corpo não é JSON; segue para o exponencial
    }
  }
  const base = 500 * 2 ** tentativa
  return Math.min(base + Math.floor(Math.random() * 250), teto)
}

export interface Relogio {
  liberadoEm: number // ms: a próxima chamada da conta não sai antes disto
}

export class ClienteHttp {
  private opts: Required<Pick<OpcoesCliente, 'nome' | 'intervaloMinMs' | 'tentativas' | 'esperaMaxMs' | 'timeoutMs'>> &
    OpcoesCliente
  private fila: Promise<unknown> = Promise.resolve()
  private relogio: Relogio
  chamadas = 0

  constructor(opts: OpcoesCliente) {
    this.opts = { tentativas: 3, esperaMaxMs: 15_000, timeoutMs: 20_000, ...opts }
    this.relogio = opts.relogio ?? { liberadoEm: 0 }
  }

  private get fetchFn(): FetchFn {
    return this.opts.fetchFn ?? ((input, init) => fetch(input, init))
  }
  private get sleep(): SleepFn {
    return this.opts.sleep ?? dormir
  }
  private get agora(): number {
    return (this.opts.agora ?? Date.now)()
  }

  // Enfileira a chamada: uma por vez por conta, com intervalo mínimo entre elas.
  // `repetivel: false` (escrita que não é idempotente, ex.: lançar estoque) só repete em 429,
  // que é recusa garantida: 5xx e queda de rede podem ter sido aplicados do outro lado.
  requisitar(url: string, init: RequestInit = {}, opcoes: OpcoesChamada = {}): Promise<Response> {
    const exec = () => this.executar(url, init, opcoes)
    const p = this.fila.then(exec, exec)
    this.fila = p.catch(() => undefined)
    return p
  }

  // Reserva a vaga ANTES de dormir: duas execuções no mesmo isolate que chegam juntas pegam vagas
  // diferentes em vez de acordarem ao mesmo tempo e saírem em rajada.
  private async aguardarIntervalo(): Promise<void> {
    const agora = this.agora
    const vez = Math.max(agora, this.relogio.liberadoEm)
    this.relogio.liberadoEm = vez + this.opts.intervaloMinMs
    if (vez > agora) await this.sleep(vez - agora)
  }

  private async executar(url: string, init: RequestInit, opcoes: OpcoesChamada = {}): Promise<Response> {
    const max = this.opts.tentativas
    const repetivel = opcoes.repetivel !== false
    for (let tentativa = 0; ; tentativa++) {
      await this.aguardarIntervalo()
      this.chamadas++
      let res: Response
      try {
        res = await this.fetchFn(url, init.signal ? init : { ...init, signal: AbortSignal.timeout(this.opts.timeoutMs) })
      } catch (e) {
        if (!repetivel || tentativa >= max) throw e
        const espera = Math.min(500 * 2 ** tentativa, this.opts.esperaMaxMs)
        log('warn', 'http.rede', { conta: this.opts.nome, url, tentativa, espera, erro: String(e) })
        await this.sleep(espera)
        continue
      }
      const repetir = res.status === 429 || (repetivel && res.status >= 500)
      if (repetir && tentativa < max) {
        const espera = await calcularEspera(res, tentativa, this.opts.esperaMaxMs)
        log('warn', 'http.backoff', { conta: this.opts.nome, url, status: res.status, tentativa, espera })
        await this.sleep(espera)
        continue
      }
      log('debug', 'http.resposta', { conta: this.opts.nome, url, status: res.status, tentativa })
      return res
    }
  }
}

// Um cliente NOVO por adaptador (ou seja, por execução), e só o relógio da conta é compartilhado
// dentro do isolate — cron, botão e webhook do mesmo conector continuam espaçados entre si.
//
// Antes o cliente inteiro era guardado aqui e reaproveitado entre execuções, com a `fila` (uma
// promessa) junto. No Workers isso é uma armadilha de ciclo de morte: quando a Cloudflare cancela
// uma execução no meio de um fetch (fim do prazo do waitUntil, CPU estourada), a promessa daquele
// fetch pertence a uma invocação que não existe mais e pode nunca se resolver. A execução seguinte
// no mesmo isolate encadeava a primeira chamada nela e ficava presa antes de falar com a plataforma
// — morria de novo sem gravar nada, e assim por diante enquanto o isolate vivesse. Número é dado,
// não E/S: pode atravessar execuções sem prender ninguém.
// (developers.cloudflare.com/workers/observability/errors/: "I/O objects ... created in the
// context of one request handler cannot be accessed from a different request's handler".)
const relogios = new Map<string, Relogio>()
export function obterCliente(opts: OpcoesCliente): ClienteHttp {
  let relogio = relogios.get(opts.nome)
  if (!relogio) {
    relogio = { liberadoEm: 0 }
    relogios.set(opts.nome, relogio)
  }
  return new ClienteHttp({ ...opts, relogio })
}
