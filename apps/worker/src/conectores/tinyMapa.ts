// ---------------------------------------------------------------------------
// MAPA DA API DO TINY (Olist) v3 — ÚNICO lugar do adaptador com caminho de
// endpoint, nome de parâmetro de query, nome de campo de payload e valor de
// enum. `tiny.ts` nunca escreve um caminho ou um nome de campo na mão: tudo sai
// de MAPA_TINY ou das interfaces deste arquivo.
//
// ATENÇÃO — VALIDAR ANTES DE USAR EM PRODUÇÃO
// Este mapa foi montado a partir da documentação pública da API v3
// (api-docs.erp.olist.com / erp.olist.com/public-api/v3/swagger) e de
// integrações abertas. A rede desta máquina não alcança tiny.com.br nem o
// portal de documentação, então NADA aqui foi conferido contra uma conta real.
// Antes do primeiro sync de verdade, confira cada linha com credenciais do
// cliente (ver "Tiny (Olist)" no README do worker). Se um endpoint estiver
// errado, o conserto é neste arquivo e só nele.
// ---------------------------------------------------------------------------
import { numero, type ItemCatalogo, type PedidoNormalizado } from './tipos'

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
}

export interface PedidoTinyDetalhe extends PedidoTinyLista {
  data?: string // AAAA-MM-DD da emissão
  dataAlteracao?: string
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
    const decodificado = atob(bruto)
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
export function saldoDoEstoqueTiny(e: EstoqueTiny, depositoId?: string | number): number {
  if (depositoId !== undefined && depositoId !== '') {
    const alvo = String(depositoId)
    const d = (e.depositos ?? []).find((x) => String(x.id ?? x.deposito?.id ?? '') === alvo)
    if (d) return numero(d.saldo ?? d.deposito?.saldo)
  }
  return numero(e.saldo ?? e.disponivel)
}
