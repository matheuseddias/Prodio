// ---------------------------------------------------------------------------
// MAPA DA API DO TINY (Olist) v3 — ÚNICO lugar do adaptador com caminho de
// endpoint, nome de parâmetro de query, nome de campo de payload e valor de
// enum. `tiny.ts` nunca escreve um caminho ou um nome de campo na mão: tudo sai
// de MAPA_TINY ou das interfaces deste arquivo.
//
// ATENÇÃO — VALIDAR ANTES DE USAR EM PRODUÇÃO
// A rede desta máquina não alcança tiny.com.br nem o portal de documentação,
// então nada aqui foi exercitado contra uma conta real. O que foi conferido
// contra o swagger da v3 e integrações abertas (ver README do worker):
//   base https://api.tiny.com.br/public-api/v3; Keycloak realm "tiny";
//   GET /pedidos?dataAtualizacao=AAAA-MM-DD&limit&offset (só data pura: com
//     hora a v3 responde 400) e envelope {itens, paginacao};
//   GET /pedidos/{id} com itens[].produto.{id,sku,descricao}, quantidade,
//     valorUnitario, valorTotalPedido, valorTotalProdutos, situacao;
//   GET /produtos?codigo=<sku>&limit&offset (SKU volta em "sku");
//   GET /estoque/{id} com saldo, reservado e depositos[].{id,nome,saldo};
//   POST /estoque/{id} com {tipo:'E'|'S'|'B', quantidade, deposito:{id}};
//   GET /notas?dataInicial&dataFinal e GET /notas/{id} com chaveAcesso,
//     tipo (E/S), numero, serie, dataEmissao.
// Continua por confirmar: o filtro `tipo` na LISTAGEM de notas, se a listagem
// devolve `chaveAcesso` (o detalhe devolve) e o formato de /notas/{id}/xml.
// Se algo estiver errado, o conserto é neste arquivo e só nele.
// ---------------------------------------------------------------------------
import { ErroConector, numero, type ItemCatalogo, type PedidoNormalizado } from './tipos'

export const MAPA_TINY = {
  // Base da API v3. Há relatos de `https://erp.tiny.com.br/public-api/v3` como
  // espelho; se a conta do cliente responder 404 em tudo, é o primeiro suspeito.
  api: 'https://api.tiny.com.br/public-api/v3',
  // OAuth2 do Tiny é um Keycloak (realm "tiny").
  token: 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token',
  autorizar: 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth',
  rotas: {
    pedidos: '/pedidos',
    pedido: (id: string | number) => `/pedidos/${encodeURIComponent(String(id))}`,
    produtos: '/produtos',
    // Saldo e lançamento de estoque são o mesmo caminho: GET lê, POST movimenta.
    estoque: (idProduto: string | number) => `/estoque/${encodeURIComponent(String(idProduto))}`,
    notas: '/notas',
    nota: (id: string | number) => `/notas/${encodeURIComponent(String(id))}`,
    notaXml: (id: string | number) => `/notas/${encodeURIComponent(String(id))}/xml`,
  },
  query: {
    limite: 'limit',
    deslocamento: 'offset',
    // Filtro incremental de pedidos: data (AAAA-MM-DD) a partir da qual o pedido mudou.
    pedidoAlteradoDesde: 'dataAtualizacao',
    produtoCodigo: 'codigo', // SKU no Tiny
    notaTipo: 'tipo',
    notaDataInicial: 'dataInicial',
    notaDataFinal: 'dataFinal',
  },
  valores: {
    notaEntrada: 'E', // tipo da nota: E = entrada (compra), S = saída
    estoqueEntrada: 'E', // POST /estoque: E soma, S subtrai, B define o saldo
    estoqueSaida: 'S',
  },
  // Campos do corpo do POST /estoque/{idProduto}.
  camposEstoque: { tipo: 'tipo', quantidade: 'quantidade', deposito: 'deposito', observacoes: 'observacoes' },
  limitePagina: 100,
} as const

// Envelope das listagens paginadas: { itens: [...], paginacao: { limit, offset, total } }.
export interface RespostaLista<T> {
  itens?: T[]
  paginacao?: { limit?: number; offset?: number; total?: number }
}

export interface ItemPedidoTiny {
  quantidade?: number | string
  valorUnitario?: number | string
  valor?: number | string // algumas respostas trazem "valor" no lugar de "valorUnitario"
  codigo?: string // SKU solto no item
  descricao?: string
  produto?: { id?: number | string; sku?: string; codigo?: string; descricao?: string }
}

export interface PedidoTinyLista {
  id: number | string
  numeroPedido?: number | string
  situacao?: number | string
  dataAtualizacao?: string
  dataAlteracao?: string
}

export interface PedidoTinyDetalhe extends PedidoTinyLista {
  data?: string // AAAA-MM-DD da emissão
  valorTotalPedido?: number | string
  valorTotalProdutos?: number | string
  itens?: ItemPedidoTiny[]
}

export interface ProdutoTiny {
  id: number | string
  sku?: string
  codigo?: string // v2/algumas respostas chamam o SKU de "codigo"
  descricao?: string
  nome?: string
  gtin?: string
}

export interface DepositoTiny {
  id?: number | string
  nome?: string
  saldo?: number | string
  // Algumas respostas aninham o depósito: { deposito: { id, nome, saldo } }.
  deposito?: { id?: number | string; nome?: string; saldo?: number | string }
}

export interface EstoqueTiny {
  id?: number | string
  codigo?: string
  saldo?: number | string // saldo físico
  reservado?: number | string
  disponivel?: number | string // saldo − reservado
  depositos?: DepositoTiny[]
}

export interface NotaTinyLista {
  id: number | string
  tipo?: string
  numero?: number | string
  serie?: number | string
  chaveAcesso?: string
  dataEmissao?: string
}

export interface NotaTinyDetalhe extends NotaTinyLista {
  cliente?: { nome?: string; cpfCnpj?: string }
  fornecedor?: { nome?: string; cpfCnpj?: string }
  contato?: { nome?: string; cpfCnpj?: string }
  itens?: ItemPedidoTiny[]
}

// ---------------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------------

// Data no formato que os filtros do Tiny esperam (AAAA-MM-DD), no fuso do tenant.
export function dataTiny(d: Date, fuso = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

// O Tiny devolve ora "2026-09-20", ora ISO completo. Data pura vira meia-noite de Brasília.
export function isoTiny(v: unknown): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  const texto = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00-03:00` : v
  const d = new Date(texto)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '')

// Momento da última alteração do pedido em ms, para ordenar a fila e mover o cursor.
export function msPedidoTiny(p: PedidoTinyLista): number | null {
  const iso = isoTiny(p.dataAtualizacao ?? p.dataAlteracao)
  return iso === null ? null : new Date(iso).getTime()
}

// Corpo da resposta sem estourar SyntaxError com trecho do HTML dentro: a mensagem
// de um erro do worker vai parar em connectors.ultimo_erro, que o dono lê na tela.
export function jsonTiny<T>(texto: string, contexto: string): T {
  if (texto.trim() === '') return {} as T
  try {
    return JSON.parse(texto) as T
  } catch {
    throw new ErroConector('tiny', `${contexto}: o Tiny respondeu em formato inesperado (não é JSON)`)
  }
}

// Erro que só se resolve com o admin reautorizando (refresh vencido, rotacionado por
// outro processo ou sessão encerrada no Keycloak). Só o veredito sai daqui, nunca o corpo.
const MARCAS_REAUTH = ['invalid_grant', 'invalid_token', 'token is not active', 'session not active', 'not_active']
export function ehErroDeReauth(status: number, texto: string): boolean {
  if (status !== 400 && status !== 401 && status !== 403) return false
  const t = texto.toLowerCase()
  return MARCAS_REAUTH.some((m) => t.includes(m))
}

// Mensagem de erro do Tiny sem nunca vazar credencial: só campos conhecidos de erro.
export function mensagemErroTiny(texto: string): string {
  try {
    const j = JSON.parse(texto) as Record<string, unknown>
    const erros = Array.isArray(j.errors) ? (j.errors as Record<string, unknown>[]) : []
    const doArray = erros.map((e) => String(e?.mensagem ?? e?.message ?? '')).filter(Boolean).join('; ')
    const direto = [j.error_description, j.mensagem, j.message, j.descricao, j.error].find((x) => typeof x === 'string' && x)
    return String(direto ?? doArray ?? '').slice(0, 200) || 'sem detalhe'
  } catch {
    return 'sem detalhe'
  }
}

// GET /notas/{id}/xml pode devolver o XML cru, {xml: "<nfeProc…>"} ou o XML em base64.
export function extrairXmlTiny(texto: string): string | undefined {
  const cru = texto.trim()
  if (cru.startsWith('<')) return cru
  let bruto: unknown
  try {
    const j = JSON.parse(cru) as Record<string, unknown>
    bruto = j.xml ?? j.xmlNota ?? j.conteudo
  } catch {
    return undefined
  }
  if (typeof bruto !== 'string' || bruto === '') return undefined
  if (bruto.trimStart().startsWith('<')) return bruto
  try {
    // atob devolve bytes, não texto: sem o TextDecoder os acentos do emitente viram lixo.
    const bytes = Uint8Array.from(atob(bruto), (c) => c.charCodeAt(0))
    const decodificado = new TextDecoder('utf-8').decode(bytes)
    return decodificado.trimStart().startsWith('<') ? decodificado : undefined
  } catch {
    return undefined
  }
}

const skuDoItem = (it: ItemPedidoTiny): string => String(it.produto?.sku ?? it.produto?.codigo ?? it.codigo ?? '').trim()

export function normalizarPedidoTiny(p: PedidoTinyDetalhe, agoraIso: string): PedidoNormalizado {
  return {
    externalId: String(p.id),
    status: String(p.situacao ?? ''),
    confirmedAt: isoTiny(p.data),
    updatedAt: isoTiny(p.dataAlteracao ?? p.dataAtualizacao) ?? agoraIso,
    total: numero(p.valorTotalPedido ?? p.valorTotalProdutos),
    itens: (p.itens ?? []).map((it) => ({
      skuExterno: skuDoItem(it),
      quantidade: numero(it.quantidade),
      preco: numero(it.valorUnitario ?? it.valor),
      nome: it.produto?.descricao ?? it.descricao,
      produtoExternoId: it.produto?.id === undefined ? undefined : String(it.produto.id),
    })),
    raw: p,
  }
}

export function normalizarProdutoTiny(p: ProdutoTiny): ItemCatalogo | null {
  const sku = String(p.sku ?? p.codigo ?? '').trim()
  if (!sku) return null
  return { externalId: String(p.id), skuExterno: sku, nome: String(p.descricao ?? p.nome ?? ''), ean: p.gtin || undefined }
}

export function itensDaNotaTiny(n: NotaTinyDetalhe): { codigo: string; descricao: string; quantidade: number; valor: number }[] {
  return (n.itens ?? []).map((it) => ({
    codigo: skuDoItem(it),
    descricao: String(it.produto?.descricao ?? it.descricao ?? ''),
    quantidade: numero(it.quantidade),
    valor: numero(it.valorUnitario ?? it.valor),
  }))
}

// Saldo do depósito configurado; sem depósito, o saldo físico total (o auditor compara
// produção apontada com saldo físico, então "disponivel" — que desconta reservas — é só fallback).
// Devolve null quando a resposta não tem saldo nenhum: o auditor ignora o SKU em vez de
// registrar divergência contra um zero inventado (se o mapa estiver errado, o dia inteiro
// viraria "produção sumiu do hub").
export function saldoDoEstoqueTiny(e: EstoqueTiny, depositoId?: string | number): number | null {
  if (depositoId !== undefined && depositoId !== '') {
    const alvo = String(depositoId)
    const depositos = e.depositos ?? []
    if (depositos.length === 0) return null // sem quebra por depósito não dá para responder pelo depósito pedido
    const d = depositos.find((x) => String(x.id ?? x.deposito?.id ?? '') === alvo)
    const saldo = d?.saldo ?? d?.deposito?.saldo
    return saldo === undefined || saldo === null ? 0 : numero(saldo) // depósito ausente na lista = sem saldo lá
  }
  const total = e.saldo ?? e.disponivel
  return total === undefined || total === null ? null : numero(total)
}
