import { ClienteHttp, obterCliente } from './http'
import { silenciarLog } from './log'

silenciarLog(true)

const ok = () => new Response('{}', { status: 200 })

describe('obterCliente', () => {
  // No Workers, a promessa de um fetch de uma invocação cancelada pode nunca se resolver. Com o
  // cliente (e a fila dele) guardado no isolate, a execução seguinte encadeava a primeira chamada
  // nessa promessa e ficava presa antes de falar com a plataforma — ciclo de morte silencioso.
  it('fetch pendurado de uma execução não prende a execução seguinte da mesma conta', async () => {
    const nome = `conta-${Math.random()}`
    const pendurado = obterCliente({ nome, intervaloMinMs: 0, fetchFn: () => new Promise<Response>(() => {}), sleep: async () => {} })
    void pendurado.requisitar('https://plataforma/a')
    const seguinte = obterCliente({ nome, intervaloMinMs: 0, fetchFn: async () => ok(), sleep: async () => {} })
    expect(seguinte).not.toBe(pendurado)
    const r = await Promise.race([seguinte.requisitar('https://plataforma/b'), new Promise<'preso'>((res) => setTimeout(() => res('preso'), 200))])
    expect(r).not.toBe('preso')
  })

  it('o espaçamento entre chamadas continua valendo para a conta entre execuções', async () => {
    const nome = `conta-${Math.random()}`
    const esperas: number[] = []
    const opcoes = { nome, intervaloMinMs: 650, fetchFn: async () => ok(), sleep: async (ms: number) => void esperas.push(ms), agora: () => 1_000_000 }
    await obterCliente(opcoes).requisitar('https://plataforma/a')
    await obterCliente(opcoes).requisitar('https://plataforma/b')
    // A segunda execução pegou a vaga seguinte, 650 ms depois da primeira.
    expect(esperas).toEqual([650])
  })
})

describe('prazo por chamada', () => {
  it('plataforma que não responde vira erro em vez de prender a rodada', async () => {
    const cliente = new ClienteHttp({
      nome: 'lenta',
      intervaloMinMs: 0,
      tentativas: 0,
      timeoutMs: 20,
      sleep: async () => {},
      fetchFn: (_url, init) =>
        new Promise<Response>((_res, rejeitar) => {
          init?.signal?.addEventListener('abort', () => rejeitar(init.signal?.reason))
        }),
    })
    await expect(cliente.requisitar('https://plataforma/lenta')).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('sinal de quem chama é respeitado', async () => {
    const vistos: (AbortSignal | null | undefined)[] = []
    const meu = new AbortController().signal
    const cliente = new ClienteHttp({ nome: 'sinal', intervaloMinMs: 0, sleep: async () => {}, fetchFn: async (_u, init) => (vistos.push(init?.signal), ok()) })
    await cliente.requisitar('https://plataforma/x', { signal: meu })
    await cliente.requisitar('https://plataforma/y')
    expect(vistos[0]).toBe(meu)
    expect(vistos[1]).toBeInstanceOf(AbortSignal)
  })
})
