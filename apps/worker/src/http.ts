// Cliente HTTP dos conectores: fila por conta (serializa chamadas e respeita intervalo mínimo),
// backoff em 429/5xx/erro de rede, log estruturado. Corpos são sempre string, então repetir é seguro.
import { log } from './log'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>
export type SleepFn = (ms: number) => Promise<void>

export interface OpcoesCliente {
  nome: string // identifica a conta no log (ex.: "baselinker:<connector_id>")
  intervaloMinMs: number // espaçamento entre chamadas da mesma conta
  tentativas?: number // repetições além da primeira (padrão 3)
  esperaMaxMs?: number // teto do backoff (padrão 15 s)
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

export class ClienteHttp {
  private opts: Required<Pick<OpcoesCliente, 'nome' | 'intervaloMinMs' | 'tentativas' | 'esperaMaxMs'>> &
    OpcoesCliente
  private fila: Promise<unknown> = Promise.resolve()
  private liberadoEm = 0
  chamadas = 0

  constructor(opts: OpcoesCliente) {
    this.opts = { tentativas: 3, esperaMaxMs: 15_000, ...opts }
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
  requisitar(url: string, init: RequestInit = {}): Promise<Response> {
    const exec = () => this.executar(url, init)
    const p = this.fila.then(exec, exec)
    this.fila = p.catch(() => undefined)
    return p
  }

  private async aguardarIntervalo(): Promise<void> {
    const espera = this.liberadoEm - this.agora
    if (espera > 0) await this.sleep(espera)
    this.liberadoEm = this.agora + this.opts.intervaloMinMs
  }

  private async executar(url: string, init: RequestInit): Promise<Response> {
    const max = this.opts.tentativas
    for (let tentativa = 0; ; tentativa++) {
      await this.aguardarIntervalo()
      this.chamadas++
      let res: Response
      try {
        res = await this.fetchFn(url, init)
      } catch (e) {
        if (tentativa >= max) throw e
        const espera = Math.min(500 * 2 ** tentativa, this.opts.esperaMaxMs)
        log('warn', 'http.rede', { conta: this.opts.nome, url, tentativa, espera, erro: String(e) })
        await this.sleep(espera)
        continue
      }
      const repetir = res.status === 429 || res.status >= 500
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

// Filas compartilhadas por conta dentro do isolate: cron e webhook do mesmo conector não se atropelam.
const filas = new Map<string, ClienteHttp>()
export function obterCliente(opts: OpcoesCliente): ClienteHttp {
  const existente = filas.get(opts.nome)
  if (existente) return existente
  const novo = new ClienteHttp(opts)
  filas.set(opts.nome, novo)
  return novo
}
