// Adaptador Tiny (Olist) API v3. OAuth2 authorization_code sobre Keycloak: access ~4 h,
// refresh ~24 h e rotativo (cada renovação invalida o refresh anterior, então o token novo
// PRECISA ser persistido). Sem webhooks na API: pedidos só por polling. Limite prático de
// ~60 req/min por conta, compartilhado entre todos os apps do cliente.
// Todo caminho de endpoint e nome de campo vem de ./tinyMapa — ver o aviso de validação lá.
import { ClienteHttp, obterCliente, type FetchFn } from '../http'
import { log } from '../log'
import {
  ErroConector,
  UNSUPPORTED,
  numero,
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
import {
  MAPA_TINY,
  dataTiny,
  extrairXmlTiny,
  itensDaNotaTiny,
  mensagemErroTiny,
  normalizarPedidoTiny,
  normalizarProdutoTiny,
  saldoDoEstoqueTiny,
  soDigitos,
  type EstoqueTiny,
  type NotaTinyDetalhe,
  type NotaTinyLista,
  type PedidoTinyDetalhe,
  type PedidoTinyLista,
  type ProdutoTiny,
  type RespostaLista,
} from './tinyMapa'

export const SOBREPOSICAO_MS = 2 * 3600 * 1000
const INTERVALO_MS = 1100 // ~55 req/min, abaixo do limite observado por conta
const MAX_PAGINAS = 30
const MARGEM_RENOVACAO_MS = 60_000
const DIAS_NFE_PADRAO = 60
const MAX_BUSCA_DIRETA = 25 // acima disso compensa ler o catálogo inteiro de uma vez

export interface AppTiny {
  clientId: string
  clientSecret: string
}
export interface CredenciaisTiny {
  // O app do Tiny é privado por seller: o cliente cria o aplicativo na conta dele
  // e cola client_id/client_secret. O app global do env é só fallback.
  client_id?: string
  client_secret?: string
  access_token?: string
  refresh_token?: string
  expires_at?: number // epoch ms
}
export interface ConfigTiny {
  deposito_id?: string | number
  dias_iniciais?: number
  dias_nfe?: number // janela da busca de NF-e de entrada por chave (padrão 60 dias)
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

interface RespostaTokenTiny {
  access_token: string
  refresh_token: string
  expires_in: number
}

// Troca code/refresh por tokens. Compartilhado com a rota de callback do OAuth.
// Keycloak espera client_id/client_secret no corpo, não em Basic.
export async function oauthTokenTiny(
  app: AppTiny,
  params: Record<string, string>,
  fetchFn: FetchFn = (i, o) => fetch(i, o),
): Promise<CredenciaisTiny> {
  const corpo = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...params })
  const res = await fetchFn(MAPA_TINY.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: corpo.toString(),
  })
  const texto = await res.text()
  if (!res.ok) throw new ErroConector('tiny', `OAuth Tiny falhou (${res.status}): ${mensagemErroTiny(texto)}`, { status: res.status })
  const t = JSON.parse(texto) as RespostaTokenTiny
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + numero(t.expires_in) * 1000 }
}

export class ConectorTiny implements Conector {
  plataforma = 'tiny' as const
  capacidades = CAPACIDADES_TINY
  private creds: CredenciaisTiny
  private app: AppTiny
  private config: ConfigTiny
  private cliente: ClienteHttp
  private persistir: (c: CredenciaisTiny) => Promise<void>
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
    this.cliente = opts.cliente ?? obterCliente({ nome: `tiny:${opts.connectorId}`, intervaloMinMs: INTERVALO_MS })
    this.agora = opts.agora ?? Date.now
  }

  // O refresh do Tiny é rotativo e vale ~24 h: sem persistir o novo par, a conexão morre.
  private async renovarToken(): Promise<void> {
    if (this.renovando) return this.renovando
    this.renovando = (async () => {
      if (!this.creds.refresh_token) throw new ErroConector('tiny', 'sem refresh_token: reconecte o Tiny', { codigo: 'reauth' })
      const novas = await oauthTokenTiny(this.app, { grant_type: 'refresh_token', refresh_token: this.creds.refresh_token }, (i, o) => this.cliente.requisitar(i, o))
      this.creds = { ...this.creds, ...novas }
      await this.persistir(this.creds)
      log('info', 'tiny.tokenRenovado', { expiraEm: new Date(novas.expires_at ?? 0).toISOString() })
    })().finally(() => {
      this.renovando = undefined
    })
    return this.renovando
  }

  private async requisitar(metodo: string, caminho: string, opts: { query?: Record<string, string>; corpo?: unknown }): Promise<string> {
    if (!this.creds.access_token || (this.creds.expires_at ?? 0) - MARGEM_RENOVACAO_MS < this.agora()) await this.renovarToken()
    const url = new URL(MAPA_TINY.api + caminho)
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
    const executar = () =>
      this.cliente.requisitar(url.toString(), {
        method: metodo,
        headers: {
          Authorization: `Bearer ${this.creds.access_token}`,
          Accept: 'application/json',
          ...(opts.corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: opts.corpo === undefined ? undefined : JSON.stringify(opts.corpo),
      })
    let res = await executar()
    if (res.status === 401) {
      await this.renovarToken()
      res = await executar()
    }
    const texto = await res.text()
    // Nunca ecoa o corpo cru nem a URL: só a mensagem de erro conhecida do Tiny.
    if (!res.ok) throw new ErroConector('tiny', `Tiny ${metodo} ${caminho}: ${res.status} ${mensagemErroTiny(texto)}`, { status: res.status })
    return texto
  }

  async chamar<T>(metodo: string, caminho: string, opts: { query?: Record<string, string>; corpo?: unknown } = {}): Promise<T> {
    const texto = await this.requisitar(metodo, caminho, opts)
    return (texto ? (JSON.parse(texto) as T) : ({} as T))
  }

  private async listar<T>(caminho: string, query: Record<string, string>, maxPaginas = MAX_PAGINAS): Promise<T[]> {
    const limite = MAPA_TINY.limitePagina
    const saida: T[] = []
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      const r = await this.chamar<RespostaLista<T>>('GET', caminho, {
        query: { ...query, [MAPA_TINY.query.limite]: String(limite), [MAPA_TINY.query.deslocamento]: String(pagina * limite) },
      })
      const lote = r.itens ?? []
      saida.push(...lote)
      if (lote.length < limite) break
    }
    return saida
  }

  private async detalhePedido(id: string | number): Promise<PedidoNormalizado | null> {
    const p = await this.chamar<PedidoTinyDetalhe | null>('GET', MAPA_TINY.rotas.pedido(id))
    return p && p.id !== undefined ? normalizarPedidoTiny(p, new Date(this.agora()).toISOString()) : null
  }

  // A listagem do Tiny não traz itens: lista os ids alterados e busca o detalhe de cada um.
  async pullOrders(cursor: Cursor | null): Promise<{ pedidos: PedidoNormalizado[]; cursor: Cursor }> {
    const agora = this.agora()
    const dias = this.config.dias_iniciais ?? 3
    const bruto = Number(cursor?.alterado_desde)
    const desde = Number.isFinite(bruto) && bruto > 0 ? bruto : agora - dias * 86400_000
    const lista = await this.listar<PedidoTinyLista>(MAPA_TINY.rotas.pedidos, {
      [MAPA_TINY.query.pedidoAlteradoDesde]: dataTiny(new Date(desde), this.fuso),
    })
    const pedidos: PedidoNormalizado[] = []
    for (const p of lista) {
      const detalhe = await this.detalhePedido(p.id)
      if (detalhe) pedidos.push(detalhe)
    }
    const proximo = agora - SOBREPOSICAO_MS
    log('info', 'tiny.pullOrders', { pedidos: pedidos.length, cursor: proximo })
    return { pedidos, cursor: { alterado_desde: proximo } }
  }

  async pullOrder(externalId: string): Promise<PedidoNormalizado | null> {
    return this.detalhePedido(externalId)
  }

  async pullCatalog(): Promise<ItemCatalogo[]> {
    const produtos = await this.listar<ProdutoTiny>(MAPA_TINY.rotas.produtos, {}, 200)
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
    const lista = skus ?? [...ids.keys()]
    const saldos: SaldoHub[] = []
    for (const sku of lista) {
      const id = ids.get(sku)
      if (!id) continue // SKU que não existe no Tiny não é divergência de saldo
      const e = await this.chamar<EstoqueTiny>('GET', MAPA_TINY.rotas.estoque(id))
      saldos.push({ sku, externalId: id, saldo: saldoDoEstoqueTiny(e, this.config.deposito_id) })
    }
    return saldos
  }

  // POST /estoque/{id} é por delta (E entra, S sai), então não precisa ler antes.
  // Para na primeira falha e devolve o que já aplicou: o freio é do job.
  async pushFinishedStock(deltas: DeltaEstoque[], opts: { dryRun: boolean }): Promise<ResultadoPush[]> {
    const resultados: ResultadoPush[] = []
    if (deltas.length === 0) return resultados
    const ids = await this.idsPorSku(deltas.map((d) => d.sku))
    for (const d of deltas) {
      const id = ids.get(d.sku)
      if (!id) {
        resultados.push({ sku: d.sku, ok: false, erro: 'SKU não encontrado no Tiny' })
        break
      }
      if (d.delta === 0) {
        resultados.push({ sku: d.sku, ok: true })
        continue
      }
      if (opts.dryRun) {
        log('info', 'tiny.push.dryRun', { sku: d.sku, delta: d.delta })
        resultados.push({ sku: d.sku, ok: true, dryRun: true })
        continue
      }
      try {
        await this.chamar('POST', MAPA_TINY.rotas.estoque(id), {
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

  // A listagem de notas do Tiny não filtra por chave de acesso: varre as notas de
  // entrada da janela configurada e casa pela chave (só dígitos).
  async findInboundNfe(chave: string): Promise<NfeEncontrada | null> {
    const alvo = soDigitos(chave)
    if (alvo.length !== 44) return null
    const agora = this.agora()
    const dias = this.config.dias_nfe ?? DIAS_NFE_PADRAO
    const notas = await this.listar<NotaTinyLista>(MAPA_TINY.rotas.notas, {
      [MAPA_TINY.query.notaTipo]: MAPA_TINY.valores.notaEntrada,
      [MAPA_TINY.query.notaDataInicial]: dataTiny(new Date(agora - dias * 86400_000), this.fuso),
      [MAPA_TINY.query.notaDataFinal]: dataTiny(new Date(agora), this.fuso),
    })
    const achada = notas.find((n) => soDigitos(n.chaveAcesso) === alvo)
    if (!achada) return null
    const n = await this.chamar<NotaTinyDetalhe>('GET', MAPA_TINY.rotas.nota(achada.id))
    return {
      externalId: String(achada.id),
      chave: alvo,
      numero: numero(n.numero ?? achada.numero),
      serie: numero(n.serie ?? achada.serie),
      emitente: n.fornecedor?.nome ?? n.contato?.nome ?? n.cliente?.nome,
      xml: await this.xmlDaNota(achada.id),
      itens: itensDaNotaTiny(n),
      raw: n,
    }
  }

  private async xmlDaNota(id: string | number): Promise<string | undefined> {
    try {
      return extrairXmlTiny(await this.requisitar('GET', MAPA_TINY.rotas.notaXml(id), {}))
    } catch (e) {
      // Sem XML a NF-e ainda serve (itens vêm do detalhe): não derruba a busca.
      log('warn', 'tiny.nfe.semXml', { nota: String(id), erro: e instanceof Error ? e.message : String(e) })
      return undefined
    }
  }

  // A API v3 do Tiny não expõe webhooks (só a interface avisa por e-mail/URL legada).
  async verifyWebhook(): Promise<Unsupported> {
    return UNSUPPORTED
  }
}
