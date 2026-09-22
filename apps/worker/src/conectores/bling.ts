// Adaptador Bling v3. Base https://api.bling.com.br/Api/v3, OAuth authorization_code, header 'enable-jwt: 1'
// obrigatório, access ~6 h, refresh 30 dias rotativo. Limites: 3 req/s e 120k/dia; 429 devolve {limit, period}.
import { ClienteHttp, obterCliente, type FetchFn } from '../http'
import { log } from '../log'
import {
  ErroConector,
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
} from './tipos'

export const URL_BLING = 'https://api.bling.com.br/Api/v3'
export const URL_BLING_TOKEN = 'https://www.bling.com.br/Api/v3/oauth/token'
export const URL_BLING_AUTORIZAR = 'https://www.bling.com.br/Api/v3/oauth/authorize'
export const SOBREPOSICAO_MS = 2 * 3600 * 1000
const INTERVALO_MS = 350 // < 3 req/s
const MAX_PAGINAS = 30
const MARGEM_RENOVACAO_MS = 60_000

export interface AppBling {
  clientId: string
  clientSecret: string
}
export interface CredenciaisBling {
  client_id?: string // sobrescreve o app global quando o tenant usa o próprio app
  client_secret?: string
  access_token?: string
  refresh_token?: string
  expires_at?: number // epoch ms
}
export interface ConfigBling {
  deposito_id?: string | number
  dias_iniciais?: number
}

export const CAPACIDADES_BLING: Capacidades = {
  pedidos: true,
  webhooks: true,
  catalogo: true,
  pushEstoque: true,
  pushCatalogo: false,
  nfeCompra: true,
}

interface RespostaToken {
  access_token: string
  refresh_token: string
  expires_in: number
}

// Troca code/refresh por tokens. Compartilhado com a rota de callback do OAuth.
export async function oauthTokenBling(
  app: AppBling,
  params: Record<string, string>,
  fetchFn: FetchFn = (i, o) => fetch(i, o),
): Promise<CredenciaisBling> {
  const basic = btoa(`${app.clientId}:${app.clientSecret}`)
  const res = await fetchFn(URL_BLING_TOKEN, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'enable-jwt': '1', Accept: '1.0' },
    body: new URLSearchParams(params).toString(),
  })
  const texto = await res.text()
  if (!res.ok) throw new ErroConector('bling', `OAuth Bling falhou (${res.status}): ${texto.slice(0, 200)}`, { status: res.status })
  const t = JSON.parse(texto) as RespostaToken
  return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + numero(t.expires_in) * 1000 }
}

// Formata para o filtro de data do Bling ("AAAA-MM-DD HH:mm:ss") no fuso do tenant.
export function formatarDataBling(d: Date, fuso = 'America/Sao_Paulo'): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`
}

export async function hmacSha256Hex(chave: string, corpo: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(corpo))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Comparação de segredo sem vazar por tempo. Usada na assinatura do webhook e no state do OAuth.
export const igualConstante = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

interface PedidoBling {
  id: number
  numero?: number | string
  data?: string
  total?: number | string
  situacao?: { id?: number | string; valor?: number | string }
  itens?: { codigo?: string; descricao?: string; quantidade?: number | string; valor?: number | string; produto?: { id?: number } }[]
}

export function normalizarPedidoBling(p: PedidoBling, agoraIso: string): PedidoNormalizado {
  return {
    externalId: String(p.id),
    status: String(p.situacao?.id ?? p.situacao?.valor ?? ''),
    confirmedAt: p.data ? new Date(`${p.data}T00:00:00-03:00`).toISOString() : null,
    updatedAt: agoraIso,
    total: numero(p.total),
    itens: (p.itens ?? []).map((it) => ({
      skuExterno: String(it.codigo ?? '').trim(),
      quantidade: numero(it.quantidade),
      preco: numero(it.valor),
      nome: it.descricao,
      produtoExternoId: it.produto?.id === undefined ? undefined : String(it.produto.id),
    })),
    raw: p,
  }
}

export class ConectorBling implements Conector {
  plataforma = 'bling' as const
  capacidades = CAPACIDADES_BLING
  private creds: CredenciaisBling
  private app: AppBling
  private config: ConfigBling
  private cliente: ClienteHttp
  private persistir: (c: CredenciaisBling) => Promise<void>
  private agora: () => number
  private fuso: string
  private renovando?: Promise<void>

  constructor(opts: {
    connectorId: string
    credenciais: CredenciaisBling
    app?: Partial<AppBling>
    config?: ConfigBling
    fuso?: string
    persistir: (c: CredenciaisBling) => Promise<void>
    cliente?: ClienteHttp
    agora?: () => number
  }) {
    this.creds = { ...opts.credenciais }
    const clientId = opts.credenciais.client_id ?? opts.app?.clientId
    const clientSecret = opts.credenciais.client_secret ?? opts.app?.clientSecret
    if (!clientId || !clientSecret) throw new ErroConector('bling', 'client_id/client_secret do Bling ausentes')
    this.app = { clientId, clientSecret }
    this.config = opts.config ?? {}
    this.fuso = opts.fuso ?? 'America/Sao_Paulo'
    this.persistir = opts.persistir
    this.cliente = opts.cliente ?? obterCliente({ nome: `bling:${opts.connectorId}`, intervaloMinMs: INTERVALO_MS })
    this.agora = opts.agora ?? Date.now
  }

  private async renovarToken(): Promise<void> {
    if (this.renovando) return this.renovando
    this.renovando = (async () => {
      if (!this.creds.refresh_token) throw new ErroConector('bling', 'sem refresh_token: reconecte o Bling', { codigo: 'reauth' })
      const novas = await oauthTokenBling(this.app, { grant_type: 'refresh_token', refresh_token: this.creds.refresh_token }, (i, o) => this.cliente.requisitar(i, o))
      this.creds = { ...this.creds, ...novas }
      await this.persistir(this.creds)
      log('info', 'bling.tokenRenovado', { expiraEm: new Date(novas.expires_at ?? 0).toISOString() })
    })().finally(() => {
      this.renovando = undefined
    })
    return this.renovando
  }

  async chamar<T>(metodo: string, caminho: string, opts: { query?: Record<string, string | string[]>; corpo?: unknown } = {}): Promise<T> {
    if (!this.creds.access_token || (this.creds.expires_at ?? 0) - MARGEM_RENOVACAO_MS < this.agora()) await this.renovarToken()
    const url = new URL(URL_BLING + caminho)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
      else url.searchParams.set(k, v)
    }
    const executar = () =>
      this.cliente.requisitar(url.toString(), {
        method: metodo,
        headers: { Authorization: `Bearer ${this.creds.access_token}`, 'enable-jwt': '1', Accept: 'application/json', ...(opts.corpo ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.corpo ? JSON.stringify(opts.corpo) : undefined,
      })
    let res = await executar()
    if (res.status === 401) {
      await this.renovarToken()
      res = await executar()
    }
    const texto = await res.text()
    if (!res.ok) {
      let msg = texto.slice(0, 300)
      try {
        const j = JSON.parse(texto) as { error?: { message?: string; description?: string } }
        msg = j.error?.description ?? j.error?.message ?? msg
      } catch {
        // texto cru mesmo
      }
      throw new ErroConector('bling', `Bling ${metodo} ${caminho}: ${res.status} ${msg}`, { status: res.status })
    }
    return (texto ? JSON.parse(texto) : {}) as T
  }

  private async detalhePedido(id: number | string): Promise<PedidoNormalizado | null> {
    const r = await this.chamar<{ data?: PedidoBling }>('GET', `/pedidos/vendas/${id}`)
    return r.data ? normalizarPedidoBling(r.data, new Date(this.agora()).toISOString()) : null
  }

  // Lista por dataAlteracao (sem itens) e busca cada pedido para ter os itens (codigo = SKU).
  async pullOrders(cursor: Cursor | null): Promise<{ pedidos: PedidoNormalizado[]; cursor: Cursor }> {
    const agora = this.agora()
    const dias = this.config.dias_iniciais ?? 3
    const desdeMs = Number(cursor?.alterado_desde ?? agora - dias * 86400_000)
    const inicial = formatarDataBling(new Date(Number.isFinite(desdeMs) ? desdeMs : agora - dias * 86400_000), this.fuso)
    const final = formatarDataBling(new Date(agora), this.fuso)
    const ids: number[] = []
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const r = await this.chamar<{ data?: PedidoBling[] }>('GET', '/pedidos/vendas', {
        query: { dataAlteracaoInicial: inicial, dataAlteracaoFinal: final, pagina: String(pagina), limite: '100' },
      })
      const lote = r.data ?? []
      ids.push(...lote.map((p) => p.id))
      if (lote.length < 100) break
    }
    const pedidos: PedidoNormalizado[] = []
    for (const id of ids) {
      const p = await this.detalhePedido(id)
      if (p) pedidos.push(p)
    }
    const proximo = agora - SOBREPOSICAO_MS
    log('info', 'bling.pullOrders', { pedidos: pedidos.length, cursor: proximo })
    return { pedidos, cursor: { alterado_desde: proximo } }
  }

  async pullOrder(externalId: string): Promise<PedidoNormalizado | null> {
    return this.detalhePedido(externalId)
  }

  async pullCatalog(): Promise<ItemCatalogo[]> {
    const itens: ItemCatalogo[] = []
    for (let pagina = 1; pagina <= 200; pagina++) {
      const r = await this.chamar<{ data?: { id: number; codigo?: string; nome?: string; gtin?: string }[] }>('GET', '/produtos', {
        query: { pagina: String(pagina), limite: '100' },
      })
      const lote = r.data ?? []
      for (const p of lote) {
        const sku = String(p.codigo ?? '').trim()
        if (sku) itens.push({ externalId: String(p.id), skuExterno: sku, nome: String(p.nome ?? ''), ean: p.gtin || undefined })
      }
      if (lote.length < 100) break
    }
    return itens
  }

  // id do produto por SKU: GET /produtos?codigos[]=... em lotes.
  private async idsPorSku(skus: string[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>()
    for (let i = 0; i < skus.length; i += 50) {
      const lote = skus.slice(i, i + 50)
      const r = await this.chamar<{ data?: { id: number; codigo?: string }[] }>('GET', '/produtos', { query: { 'codigos[]': lote, limite: '100' } })
      for (const p of r.data ?? []) if (p.codigo) mapa.set(String(p.codigo).trim(), String(p.id))
    }
    return mapa
  }

  async pullFinishedStock(skus?: string[]): Promise<SaldoHub[]> {
    const lista = skus ?? (await this.pullCatalog()).map((c) => c.skuExterno)
    const ids = await this.idsPorSku(lista)
    const porId = new Map([...ids.entries()].map(([sku, id]) => [id, sku]))
    const saldos: SaldoHub[] = []
    const todos = [...porId.keys()]
    for (let i = 0; i < todos.length; i += 50) {
      const r = await this.chamar<{ data?: { produto?: { id: number }; saldoFisicoTotal?: number; depositos?: { id: number; saldoFisico?: number }[] }[] }>(
        'GET', '/estoques/saldos', { query: { 'idsProdutos[]': todos.slice(i, i + 50) } })
      for (const s of r.data ?? []) {
        const id = String(s.produto?.id ?? '')
        const sku = porId.get(id)
        if (!sku) continue
        const dep = this.config.deposito_id ? s.depositos?.find((d) => String(d.id) === String(this.config.deposito_id)) : undefined
        saldos.push({ sku, externalId: id, saldo: numero(dep ? dep.saldoFisico : s.saldoFisicoTotal) })
      }
    }
    return saldos
  }

  // POST /estoques é por delta (E entrada, S saída), então não precisa ler antes.
  async pushFinishedStock(deltas: DeltaEstoque[], opts: { dryRun: boolean }): Promise<ResultadoPush[]> {
    const resultados: ResultadoPush[] = []
    if (deltas.length === 0) return resultados
    if (!this.config.deposito_id) throw new ErroConector('bling', 'deposito_id não configurado no conector')
    const ids = await this.idsPorSku(deltas.map((d) => d.sku))
    for (const d of deltas) {
      const id = ids.get(d.sku)
      if (!id) {
        resultados.push({ sku: d.sku, ok: false, erro: 'SKU não encontrado no Bling' })
        break
      }
      if (d.delta === 0) {
        resultados.push({ sku: d.sku, ok: true })
        continue
      }
      if (opts.dryRun) {
        log('info', 'bling.push.dryRun', { sku: d.sku, delta: d.delta })
        resultados.push({ sku: d.sku, ok: true, dryRun: true })
        continue
      }
      try {
        await this.chamar('POST', '/estoques', {
          corpo: { produto: { id: Number(id) }, deposito: { id: Number(this.config.deposito_id) }, operacao: d.delta > 0 ? 'E' : 'S', quantidade: Math.abs(d.delta), observacoes: 'Prodio: apontamento de produção' },
        })
        resultados.push({ sku: d.sku, ok: true })
      } catch (e) {
        resultados.push({ sku: d.sku, ok: false, erro: e instanceof Error ? e.message : String(e) })
        break
      }
    }
    return resultados
  }

  // Teste de conexão: uma página de um produto só. Renova o token se precisar e não escreve nada.
  async testarConexao(): Promise<string> {
    const r = await this.chamar<{ data?: { id: number; codigo?: string; nome?: string }[] }>('GET', '/produtos', { query: { pagina: '1', limite: '1' } })
    const amostra = r.data ?? []
    if (amostra.length === 0) return 'o Bling aceitou o token, mas o catálogo desta conta está vazio'
    return `conectado ao Bling: o catálogo respondeu (primeiro produto "${amostra[0].nome ?? amostra[0].codigo ?? amostra[0].id}")`
  }

  async findInboundNfe(chave: string): Promise<NfeEncontrada | null> {
    const lista = await this.chamar<{ data?: { id: number }[] }>('GET', '/nfe', { query: { tipo: '0', chaveAcesso: chave } })
    const id = lista.data?.[0]?.id
    if (!id) return null
    const r = await this.chamar<{ data?: Record<string, unknown> }>('GET', `/nfe/${id}`)
    const n = r.data ?? {}
    const contato = n.contato as { nome?: string } | undefined
    const itens = ((n.itens as Record<string, unknown>[] | undefined) ?? []).map((it) => ({
      codigo: String(it.codigo ?? ''), descricao: String(it.descricao ?? ''), quantidade: numero(it.quantidade), valor: numero(it.valor),
    }))
    return { externalId: String(id), chave, numero: numero(n.numero), serie: numero(n.serie), emitente: contato?.nome, xml: typeof n.xml === 'string' ? n.xml : undefined, itens, raw: n }
  }

  // X-Bling-Signature-256 = 'sha256=' + HMAC-SHA256(corpo cru, client_secret)
  async verifyWebhook(req: Request, corpo: string): Promise<boolean> {
    const cabecalho = req.headers.get('X-Bling-Signature-256') ?? ''
    const esperado = 'sha256=' + (await hmacSha256Hex(this.app.clientSecret, corpo))
    return igualConstante(cabecalho.trim().toLowerCase(), esperado)
  }
}
