// scheduled() tem de DEVOLVER a promessa do trabalho (incidente de 25/09/2026): com
// ctx.waitUntil + retorno imediato, a Cloudflare corta o trabalho 30 s depois do fim da invocação,
// e o corte não passa por catch nenhum — o robô morria sem gravar nada no banco.
import worker, { executarCron } from './index'
import type { Env } from './env'
import { silenciarLog } from './log'

silenciarLog(true)

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', CREDENTIALS_KEY: 'chave' } as Env
const controlador = (cron: string) => ({ cron, scheduledTime: Date.now(), type: 'scheduled', noRetry() {} }) as unknown as ScheduledController
// Chamado como o runtime chama: sempre com o ctx, mesmo que o handler não o declare.
const agendado = (worker as ExportedHandler<Env>).scheduled!

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  silenciarLog(true)
})

describe('executarCron', () => {
  it('só devolve quando o trabalho termina', async () => {
    let liberar: () => void = () => {}
    const trabalho = new Promise<void>((r) => {
      liberar = r
    })
    let terminou = false
    const p = executarCron('*/5 * * * *', env, () => trabalho).then(() => {
      terminou = true
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(terminou).toBe(false)
    liberar()
    await p
    expect(terminou).toBe(true)
  })

  it('erro do trabalho é capturado e logado, não vira rejeição', async () => {
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    silenciarLog(false)
    await expect(executarCron('*/5 * * * *', env, async () => {
      throw new Error('supabase fora do ar')
    })).resolves.toBeUndefined()
    const linha = JSON.parse(String(erros.mock.calls[0][0])) as Record<string, unknown>
    expect(linha).toMatchObject({ nivel: 'error', evento: 'cron.falha', cron: '*/5 * * * *', erro: 'supabase fora do ar' })
  })
})

describe('handler scheduled()', () => {
  it('segura a invocação até o trabalho acabar, sem ctx.waitUntil', async () => {
    // O fetch global responde só quando o teste mandar: é o banco (listarConectoresAtivos).
    const respostas: Array<() => void> = []
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      urls.push(String(url instanceof Request ? url.url : url))
      return new Promise<Response>((resolver) => {
        respostas.push(() => resolver(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })))
      })
    }))
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }
    let terminou = false
    const p = Promise.resolve(agendado(controlador('*/5 * * * *'), env, ctx as unknown as ExecutionContext)).then(() => {
      terminou = true
    })

    await vi.waitFor(() => expect(respostas).toHaveLength(1))
    expect(urls[0]).toContain('/rest/v1/connectors')
    expect(terminou).toBe(false) // o handler ainda está esperando o banco
    respostas.shift()!() // sync: nenhum conector
    await vi.waitFor(() => expect(respostas).toHaveLength(1))
    expect(terminou).toBe(false) // agora esperando a listagem do outbox
    respostas.shift()!()
    await p
    expect(terminou).toBe(true)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it('falha antes de chegar ao banco termina a invocação sem rejeitar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} }
    // Sem SUPABASE_URL o cliente do Supabase nem é criado.
    await expect(Promise.resolve(agendado(controlador('*/5 * * * *'), {} as Env, ctx as unknown as ExecutionContext))).resolves.toBeUndefined()
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })
})
