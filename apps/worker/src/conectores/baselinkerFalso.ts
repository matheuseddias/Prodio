// BaseLinker de mentira, SÓ PARA TESTES (nada do worker importa este arquivo, então ele não entra
// no bundle). Responde getOrders como a API documenta: até 100 pedidos confirmados com
// date_confirmed >= date_confirmed_from (e order_id >= id_from, quando vier), em ordem crescente de
// date_confirmed e, no mesmo segundo, de order_id. Serve para provar, contra uma conta que se
// comporta como a de verdade, que o cursor em pedaços não pula pedido.
import { ClienteHttp } from '../http'
import { ConectorBaseLinker, LIMITE_PEDIDOS, URL_BASELINKER, type ConfigBaseLinker } from './baselinker'

export interface PedidoBLFalso {
  order_id: number
  date_confirmed: number // unix s
  visivel_em?: number // unix s: antes disto o pedido ainda não existe na conta (padrão: sempre existiu)
}

export interface BaseLinkerFalso {
  pedidos: PedidoBLFalso[] // o teste pode acrescentar pedidos entre uma rodada e outra
  agoraS: number // relógio da conta e do adaptador, em segundos
  consultas: number[] // date_confirmed_from de cada getOrders, em ordem
  falharNa?: number // a N-ésima chamada de getOrders (contando desde o começo) responde ERROR
  ignorarIdFrom?: boolean // simula uma API que ignora id_from (o adaptador tem de perceber e não ficar preso)
  idsFrom: (number | undefined)[] // id_from de cada getOrders, em ordem
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
  conector(config?: ConfigBaseLinker): ConectorBaseLinker
}

const resposta = (dados: Record<string, unknown>) => new Response(JSON.stringify(dados), { status: 200, headers: { 'Content-Type': 'application/json' } })

export function baseLinkerFalso(pedidos: PedidoBLFalso[] = [], agoraS = 1_800_000_000): BaseLinkerFalso {
  const bl: BaseLinkerFalso = {
    pedidos,
    agoraS,
    consultas: [],
    idsFrom: [],
    fetchFn: async (url, init) => {
      if (url !== URL_BASELINKER) throw new Error(`url inesperada: ${url}`)
      const corpo = new URLSearchParams(String(init?.body))
      const metodo = corpo.get('method')
      if (metodo !== 'getOrders') throw new Error(`método inesperado: ${metodo}`)
      const parametros = JSON.parse(corpo.get('parameters') ?? '{}') as Record<string, unknown>
      if (parametros.get_unconfirmed_orders !== false) throw new Error('o Prodio só lê pedido confirmado')
      const desde = Number(parametros.date_confirmed_from)
      const idFrom = parametros.id_from === undefined ? undefined : Number(parametros.id_from)
      bl.consultas.push(desde)
      bl.idsFrom.push(idFrom)
      // ERROR da plataforma não é repetido pelo cliente HTTP: é o jeito mais simples de matar a
      // rodada exatamente nesta página.
      if (bl.falharNa === bl.consultas.length) return resposta({ status: 'ERROR', error_code: 'MORTA', error_message: 'execução morta (simulada)' })
      const orders = bl.pedidos
        .filter((p) => (p.visivel_em ?? 0) <= bl.agoraS && p.date_confirmed >= desde && (bl.ignorarIdFrom || idFrom === undefined || p.order_id >= idFrom))
        .sort((a, b) => a.date_confirmed - b.date_confirmed || a.order_id - b.order_id)
        .slice(0, LIMITE_PEDIDOS)
        .map((p) => ({ order_id: p.order_id, order_status_id: 7, date_confirmed: p.date_confirmed, products: [{ sku: 'CAM-01', quantity: 1, price_brutto: '10' }] }))
      return resposta({ status: 'SUCCESS', orders })
    },
    conector: (config = {}) =>
      new ConectorBaseLinker({
        connectorId: 'c-bl',
        credenciais: { token: 'tok' },
        config,
        cliente: new ClienteHttp({ nome: 'bl-falso', intervaloMinMs: 0, fetchFn: bl.fetchFn, sleep: async () => {}, agora: () => bl.agoraS * 1000 }),
        agora: () => bl.agoraS * 1000,
      }),
  }
  return bl
}
