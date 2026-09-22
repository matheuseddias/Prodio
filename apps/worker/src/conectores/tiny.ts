// Adaptador Tiny (Olist) API v3. OAuth2 authorization_code sobre Keycloak: access ~4 h,
// refresh ~24 h e rotativo (cada renovação invalida o refresh anterior, então o token novo
// PRECISA ser persistido). Sem webhooks na API: pedidos só por polling. Limite prático de
// ~60 req/min por conta, compartilhado entre todos os apps do cliente.
// Todo caminho de endpoint e nome de campo vem de ./tinyMapa — ver o aviso de validação lá.
import { ClienteHttp, obterCliente } from '../http'
import { log } from '../log'
import {
  ErroConector,
  UNSUPPORTED,
  type Capacidades,
  type Conector,
  type Cursor,
  type DeltaEstoque,
  type ItemCatalogo,
  type NfeEncontrada,
  type PedidoNormalizado,
  type ResultadoPush,
  type SaldoHub,
  type Unsupported,
} from './tipos'
import { RECONECTE_TINY, mesclarCredenciaisTiny, oauthTokenTiny, type AppTiny, type CredenciaisTiny } from './tinyAuth'
import {
  MAPA_TINY,
  dataTiny,
  jsonTiny,
  mensagemErroTiny,
  msPedidoTiny,
  normalizarPedidoTiny,
  normalizarProdutoTiny,
  saldoDoEstoqueTiny,
  type EstoqueTiny,
  type PedidoTinyDetalhe,
  type PedidoTinyLista,
  type ProdutoTiny,
  type RespostaLista,
} from './tinyMapa'
import { buscarNfeTiny, type ClienteTiny, type OpcoesChamadaTiny } from './tinyNfe'

export { oauthTokenTiny, type AppTiny, type CredenciaisTiny } from './tinyAuth'

export const SOBREPOSICAO_MS = 2 * 3600 * 1000
const INTERVALO_MS = 1100 // ~55 req/min, abaixo do limite observado por conta
const MAX_PAGINAS = 30
const MARGEM_RENOVACAO_MS = 60_000
const DIAS_NFE_PADRAO = 60
const MAX_BUSCA_DIRETA = 25 // acima disso compensa ler o catálogo inteiro de uma vez
// Tetos por execução: cada detalhe de pedido e cada saldo custa uma chamada a 1,1 s, e o
// cron de pedidos roda de 5 em 5 min. Sem teto, uma primeira carga grande estoura a janela,
// morre no meio e o cursor nunca avança — o conector ficaria parado para sempre.
const MAX_PEDIDOS_POR_RODADA = 150
const MAX_SALDOS_POR_RODADA = 250

export interface ConfigTiny {
  deposito_id?: string | number
  dias_iniciais?: number
  dias_nfe?: number // janela da busca de NF-e de entrada por chave (padrão 60 dias)
  max_pedidos?: number // teto de detalhes de pedido por execução (padrão 150)
  max_produtos?: number // teto de saldos lidos por execução do auditor (padrão 250)
}

// pushCatalogo fica false enquanto o adaptador não enviar produto/ficha ao Tiny,
// mesmo a tela prometendo o recurso (mesma postura do Bling).
export const CAPACIDADES_TINY: Capacidades = {
  pedidos: true,
  webhooks: false,
  catalogo: true,
  pushEstoque: true,
  pushCatalogo: false,
  nfeCompra: true,
}

export class ConectorTiny implements Conector, ClienteTiny {
  plataforma = 'tiny' as const
  capacidades = CAPACIDADES_TINY
  private creds: CredenciaisTiny
  private app: AppTiny
  private config: ConfigTiny
  private cliente: ClienteHttp
  private persistir: (c: CredenciaisTiny) => Promise<void>
  private recarregar?: () => Promise<CredenciaisTiny | null>
  private agora: () => number
  private fuso: string
  private renovando?: Promise<void>
  private idsSku = new Map<string, string>()
  private catalogoCompleto = false

  constructor(opts: {
    connectorId: string
    credenciais: CredenciaisTiny
    app?: Partial<AppTiny>
    config?: ConfigTiny
    fuso?: string
    persistir: (c: CredenciaisTiny) => Promise<void>
    recarregar?: () => Promise<CredenciaisTiny | null>
    cliente?: ClienteHttp
    agora?: () => number
  }) {
    this.creds = { ...opts.credenciais }
    const clientId = opts.credenciais.client_id ?? opts.app?.clientId
    const clientSecret = opts.credenciais.client_secret ?? opts.app?.clientSecret
    if (!clientId || !clientSecret) throw new ErroConector('tiny', 'client_id/client_secret do Tiny ausentes')
    this.app = { clientId, clientSecret }
    this.config = opts.config ?? {}
    this.fuso = opts.fuso ?? 'America/Sao_Paulo'
    this.persistir = opts.persistir
    this.recarregar = opts.recarregar
    this.cliente = opts.cliente ?? obterCliente({ nome: `tiny:${opts.connectorId}`, intervaloMinMs: INTERVALO_MS })
    this.agora = opts.agora ?? Date.now
  }

  // O refresh do Tiny é rotativo e vale ~24 h: sem persistir o novo par, a conexão morre.
  private async renovarToken(): Promise<void> {
    if (this.renovando) return this.renovando
    this.renovando = this.trocarRefresh().finally(() => {
      this.renovando = undefined
    })
    return this.renovando
  }

  private async trocarRefresh(): Promise<void> {
    // Cron e webhook podem renovar quase juntos. Como o refresh é rotativo, quem chega
    // depois queimaria o par que o outro acabou de gravar: relê antes e adota o mais novo.
    const guardadas = this.recarregar ? await this.recarregar().catch(() => null) : null
    if (guardadas?.access_token && (guardadas.expires_at ?? 0) > (this.creds.expires_at ?? 0)) {
      this.creds = mesclarCredenciaisTiny(this.creds, guardadas)
      if ((this.creds.expires_at ?? 0) - MARGEM_RENOVACAO_MS > this.agora()) {
        log('info', 'tiny.tokenDeOutraExecucao', { expiraEm: new Date(this.creds.expires_at ?? 0).toISOString() })
        return
      }
    }
    if (!this.creds.refresh_token) throw new ErroConector('tiny', `sem refresh_token: ${RECONECTE_TINY}`, { codigo: 'reauth' })
    const novas = await oauthTokenTiny(
      this.app,
      { grant_type: 'refresh_token', refresh_token: this.creds.refresh_token },
      (i, o) => this.cliente.requisitar(i, o),
      this.agora,
    )
    this.creds = mesclarCredenciaisTiny(this.creds, novas)
    await this.persistir(this.creds)
    log('info', 'tiny.tokenRenovado', { expiraEm: new Date(this.creds.expires_at ?? 0).toISOString() })
  }

  async requisitar(metodo: string, caminho: string, opts: OpcoesChamadaTiny): Promise<string> {
    if (!this.creds.access_token || (this.creds.expires_at ?? 0) - MARGEM_RENOVACAO_MS < this.agora()) await this.renovarToken()
    const url = new URL(MAPA_TINY.api + caminho)
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
    const executar = () =>
      this.cliente.requisitar(
        url.toString(),
        {
          method: metodo,
          headers: {
            Authorization: `Bearer ${this.creds.access_token}`,
            Accept: 'application/json',
            ...(opts.corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo),
        },
        { repetivel: opts.repetivel !== false },
      )
    let res = await executar()
    if (res.status === 401) {
      await this.renovarToken()
      res = await executar()
      // Token recém-renovado e ainda 401: não adianta tentar de novo no próximo cron.
      if (res.status === 401) throw new ErroConector('tiny', `o Tiny recusou o token renovado: ${RECONECTE_TINY}`, { status: 401, codigo: 'reauth' })
    }
    const texto = await res.text()
    // Nunca ecoa o corpo cru nem a URL: só a mensagem de erro conhecida do Tiny.
    if (!res.ok) throw new ErroConector('tiny', `Tiny ${metodo} ${caminho}: ${res.status} ${mensagemErroTiny(texto)}`, { status: res.status })
    return texto
  }

  async chamar<T>(metodo: string, caminho: string, opts: OpcoesChamadaTiny = {}): Promise<T> {
    return jsonTiny<T>(await this.requisitar(metodo, caminho, opts), `Tiny ${metodo} ${caminho}`)
  }

  // Paginação por limit/offset. Anda pelo tamanho real do lote (se a conta devolver menos
  // que o limite pedido, o offset continua certo) e usa paginacao.total quando vem.
  async listar<T>(
    caminho: string,
    query: Record<string, string>,
    opts: { maxPaginas?: number; parar?: (lote: T[]) => boolean } = {},
  ): Promise<T[]> {
    const limite = MAPA_TINY.limitePagina
    const maxPaginas = opts.maxPaginas ?? MAX_PAGINAS
    const saida: T[] = []
    let deslocamento = 0
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const r = await this.chamar<RespostaLista<T>>('GET', caminho, {
        query: { ...query, [MAPA_TINY.query.limite]: String(limite), [MAPA_TINY.query.deslocamento]: String(deslocamento) },
      })
      const lote = Array.isArray(r.itens) ? r.itens : []
      saida.push(...lote)
      deslocamento += lote.length
      if (lote.length === 0 || opts.parar?.(lote)) break
      // `total` só é usado quando dá para acreditar que conta itens (>= o que já veio):
      // se a conta devolver contagem de páginas, o teste falha e cai no tamanho do lote.
      const total = Number(r.paginacao?.total)
      if (Number.isFinite(total) && total >= deslocamento) {
        if (deslocamento >= total) break
      } else if (lote.length < limite) break
    }
    return saida
  }

  private async detalhePedido(id: string | number): Promise<PedidoNormalizado | null> {
    const p = await this.chamar<PedidoTinyDetalhe | null>('GET', MAPA_TINY.rotas.pedido(id))
    if (p && p.id !== undefined) return normalizarPedidoTiny(p, new Date(this.agora()).toISOString())
    // Some sem erro só se o mapa estiver errado: registra para não virar pedido perdido em silêncio.
    log('warn', 'tiny.pedidoSemDetalhe', { pedido: String(id) })
    return null
  }

  // A listagem do Tiny não traz itens: lista os ids alterados e busca o detalhe de cada um.
  async pullOrders(cursor: Cursor | null): Promise<{ pedidos: PedidoNormalizado[]; cursor: Cursor }> {
    const agora = this.agora()
    const dias = this.config.dias_iniciais ?? 3
    const bruto = Number(cursor?.alterado_desde)
    const desde = Number.isFinite(bruto) && bruto > 0 ? Math.min(bruto, agora) : agora - dias * 86400_000
    const lista = await this.listar<PedidoTinyLista>(MAPA_TINY.rotas.pedidos, {
      [MAPA_TINY.query.pedidoAlteradoDesde]: dataTiny(new Date(desde), this.fuso),
    })
    // Páginas podem repetir id (o conjunto muda enquanto se pagina) e a ordem não é garantida:
    // deduplica e põe o mais antigo na frente, para o teto cortar sempre o fim da fila.
    const unicos = [...new Map(lista.filter((p) => p?.id !== undefined).map((p) => [String(p.id), p])).values()]
    unicos.sort((a, b) => (msPedidoTiny(a) ?? Number.MAX_SAFE_INTEGER) - (msPedidoTiny(b) ?? Number.MAX_SAFE_INTEGER))
    const teto = Math.max(1, this.config.max_pedidos ?? MAX_PEDIDOS_POR_RODADA)
    const fatia = unicos.slice(0, teto)
    const pedidos: PedidoNormalizado[] = []
    for (const p of fatia) {
      const detalhe = await this.detalhePedido(p.id)
      if (detalhe) pedidos.push(detalhe)
    }
    const cortou = unicos.length > fatia.length
    const proximo = cortou ? this.cursorParcial(fatia, desde, agora) : agora - SOBREPOSICAO_MS
    if (cortou) log('warn', 'tiny.pullOrders.teto', { alterados: unicos.length, teto, cursor: proximo })
    log('info', 'tiny.pullOrders', { pedidos: pedidos.length, cursor: proximo })
    return { pedidos, cursor: { alterado_desde: proximo } }
  }

  // Com a fila cortada, o cursor só pode andar até o último pedido realmente processado
  // (menos a sobreposição). Sem data na listagem, fica onde estava: repetir é barato, perder não.
  private cursorParcial(processados: PedidoTinyLista[], desde: number, agora: number): number {
    const datas = processados.map(msPedidoTiny).filter((m): m is number => m !== null)
    const ultimo = datas.length ? Math.max(...datas) : null
    const alvo = ultimo === null ? desde : Math.max(desde, ultimo - SOBREPOSICAO_MS)
    return Math.min(alvo, agora - SOBREPOSICAO_MS)
  }

  async pullOrder(externalId: string): Promise<PedidoNormalizado | null> {
    return this.detalhePedido(externalId)
  }

  async pullCatalog(): Promise<ItemCatalogo[]> {
    const produtos = await this.listar<ProdutoTiny>(MAPA_TINY.rotas.produtos, {}, { maxPaginas: 200 })
    const itens: ItemCatalogo[] = []
    for (const p of produtos) {
      const item = normalizarProdutoTiny(p)
      if (item) itens.push(item)
    }
    return itens
  }

  private async carregarCatalogo(): Promise<Map<string, string>> {
    if (this.catalogoCompleto) return this.idsSku
    for (const c of await this.pullCatalog()) this.idsSku.set(c.skuExterno, c.externalId)
    this.catalogoCompleto = true
    return this.idsSku
  }

  // De-para SKU → id do produto. Para poucos SKUs (o lote do outbox) busca um a um por código,
  // que sai bem mais barato que varrer o catálogo inteiro a 1,1 s por página.
  private async idsPorSku(skus?: string[]): Promise<Map<string, string>> {
    if (!skus || skus.length > MAX_BUSCA_DIRETA || this.catalogoCompleto) return this.carregarCatalogo()
    for (const sku of new Set(skus)) {
      if (this.idsSku.has(sku)) continue
      const r = await this.chamar<RespostaLista<ProdutoTiny>>('GET', MAPA_TINY.rotas.produtos, {
        query: { [MAPA_TINY.query.produtoCodigo]: sku, [MAPA_TINY.query.limite]: '1' },
      })
      for (const bruto of r.itens ?? []) {
        const p = normalizarProdutoTiny(bruto)
        if (p && p.skuExterno === sku) this.idsSku.set(p.skuExterno, p.externalId)
      }
    }
    return this.idsSku
  }

  async pullFinishedStock(skus?: string[]): Promise<SaldoHub[]> {
    const ids = await this.idsPorSku(skus)
    const alvos = skus ?? [...ids.keys()]
    const teto = Math.max(1, this.config.max_produtos ?? MAX_SALDOS_POR_RODADA)
    const lista = alvos.slice(0, teto)
    if (alvos.length > lista.length) log('warn', 'tiny.estoque.teto', { produtos: alvos.length, teto })
    const saldos: SaldoHub[] = []
    for (const sku of lista) {
      const id = ids.get(sku)
      if (!id) continue // SKU que não existe no Tiny não é divergência de saldo
      const e = await this.chamar<EstoqueTiny>('GET', MAPA_TINY.rotas.estoque(id))
      const saldo = saldoDoEstoqueTiny(e, this.config.deposito_id)
      if (saldo === null) {
        log('warn', 'tiny.estoque.semSaldo', { sku, produto: id })
        continue // resposta sem saldo: melhor não auditar do que auditar contra zero inventado
      }
      saldos.push({ sku, externalId: id, saldo })
    }
    return saldos
  }

  // POST /estoque/{id} é por delta (E entra, S sai), então não precisa ler antes.
  // Para na primeira falha e devolve o que já aplicou: o freio é do job.
  async pushFinishedStock(deltas: DeltaEstoque[], opts: { dryRun: boolean }): Promise<ResultadoPush[]> {
    const resultados: ResultadoPush[] = []
    if (deltas.length === 0) return resultados
    // Delta zero não gasta chamada nem exige o produto no Tiny: resolve antes do de-para.
    const comDelta = deltas.filter((d) => d.delta !== 0)
    const ids = comDelta.length ? await this.idsPorSku(comDelta.map((d) => d.sku)) : new Map<string, string>()
    for (const d of deltas) {
      if (d.delta === 0) {
        resultados.push({ sku: d.sku, ok: true })
        continue
      }
      const id = ids.get(d.sku)
      if (!id) {
        resultados.push({ sku: d.sku, ok: false, erro: 'SKU não encontrado no Tiny' })
        break
      }
      if (opts.dryRun) {
        log('info', 'tiny.push.dryRun', { sku: d.sku, delta: d.delta })
        resultados.push({ sku: d.sku, ok: true, dryRun: true })
        continue
      }
      try {
        await this.chamar('POST', MAPA_TINY.rotas.estoque(id), {
          // Movimento de estoque não é idempotente: 5xx ou queda de rede podem ter sido
          // aplicados do outro lado, então esta chamada não é repetida automaticamente.
          repetivel: false,
          corpo: {
            [MAPA_TINY.camposEstoque.tipo]: d.delta > 0 ? MAPA_TINY.valores.estoqueEntrada : MAPA_TINY.valores.estoqueSaida,
            [MAPA_TINY.camposEstoque.quantidade]: Math.abs(d.delta),
            [MAPA_TINY.camposEstoque.observacoes]: 'Prodio: apontamento de produção',
            // Sem depósito configurado, o Tiny lança no depósito padrão da conta.
            ...(this.config.deposito_id ? { [MAPA_TINY.camposEstoque.deposito]: { id: Number(this.config.deposito_id) } } : {}),
          },
        })
        resultados.push({ sku: d.sku, ok: true })
      } catch (e) {
        resultados.push({ sku: d.sku, ok: false, erro: e instanceof Error ? e.message : String(e) })
        break
      }
    }
    return resultados
  }

  // A v3 não filtra nota por chave: a varredura da janela está em ./tinyNfe.
  async findInboundNfe(chave: string): Promise<NfeEncontrada | null> {
    return buscarNfeTiny(this, chave, { agora: this.agora(), fuso: this.fuso, dias: this.config.dias_nfe ?? DIAS_NFE_PADRAO })
  }

  // A API v3 do Tiny não expõe webhooks (só a interface avisa por e-mail/URL legada).
  async verifyWebhook(): Promise<Unsupported> {
    return UNSUPPORTED
  }
}
