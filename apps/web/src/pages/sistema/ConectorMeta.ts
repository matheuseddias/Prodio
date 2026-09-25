import { workerUrl } from '../../data/supabaseClient'
import type { Connector } from '../../domain/types'

export type Plataforma = Connector['plataforma']

/**
 * URL de retorno (redirect_uri) que o cliente cadastra no hub dele.
 * O callback do OAuth é no worker, nunca na interface: é o worker que guarda o
 * client_secret e troca o código pelo token. Fora do worker cai no origin da
 * janela, que é o que serve durante o desenvolvimento.
 */
export function urlRetornoOauth(plataforma: Plataforma): string {
  const base = workerUrl || (typeof window === 'undefined' ? '' : window.location.origin)
  return `${base}/connectors/${plataforma}/oauth/callback`
}

// ---------- Metadados por plataforma (fatos de integração) ----------
export const META: Record<
  Plataforma,
  {
    iniciais: string
    cor: string
    curto: string
    auth: string
    pedidos: string
    webhooks: string
    estoque: string
    nfe: string
    catalogo: string
  }
> = {
  baselinker: {
    iniciais: 'BL',
    curto: 'Token de conta',
    cor: 'bg-sky-600',
    auth: 'Token estático da conta (header X-BLToken), sem OAuth.',
    pedidos: 'Pedidos por polling, itens já no payload. Status personalizados por conta: precisam de mapeamento.',
    webhooks: 'Sem webhooks nativos: o Prodio consulta em intervalos.',
    estoque: 'Escrita por saldo absoluto no inventário escolhido.',
    nfe: 'Não expõe NF-e de compra.',
    catalogo: 'Catálogo e SKUs legíveis; sem ficha técnica.',
  },
  bling: {
    iniciais: 'Bl',
    curto: 'OAuth 2.0',
    cor: 'bg-emerald-600',
    auth: 'OAuth 2.0: o cliente autoriza o app. Access token ~6 h, refresh 30 dias.',
    pedidos: 'Listagem sem itens (detalhe por pedido), 3 req/s.',
    webhooks: 'Webhooks assinados (HMAC).',
    estoque: 'POST de estoque.',
    nfe: 'NF-e de entrada consultável por chave.',
    catalogo: 'Ficha técnica (estrutura) importável.',
  },
  tiny: {
    iniciais: 'Ti',
    curto: 'OAuth, app privado',
    cor: 'bg-violet-600',
    auth: 'OAuth (Keycloak) com app privado por seller: o cliente cria o aplicativo na conta dele. Access 4 h, refresh 1 dia.',
    pedidos: 'Listagem sem itens (detalhe por pedido).',
    webhooks: 'Sem webhooks na API (só pela interface).',
    estoque: 'Envio de estoque por API.',
    nfe: 'NF de entrada por XML.',
    catalogo: 'Ficha técnica em /fabricado.',
  },
  omie: {
    iniciais: 'Om',
    curto: 'app_key / app_secret',
    cor: 'bg-amber-600',
    auth: 'app_key e app_secret colados pelo cliente.',
    pedidos: 'Pedidos e OP nativa. Limite 240 req/min; bloqueio por "consumo redundante".',
    webhooks: 'Webhooks (Omie Connect), sem assinatura.',
    estoque: 'Ajuste de estoque por API.',
    nfe: 'Recebimento de NF-e consultável por chave.',
    catalogo: 'Estrutura (malha) importável.',
  },
  magis5: {
    iniciais: 'M5',
    curto: 'Chave de API',
    cor: 'bg-rose-600',
    auth: 'Chave de API no header.',
    pedidos: 'Listagem de pedidos a confirmar com conta de teste.',
    webhooks: 'Webhooks a confirmar; documentação pública limitada.',
    estoque: 'Push de estoque não confirmado.',
    nfe: 'Sem NF-e de compra.',
    catalogo: 'Catálogo a confirmar.',
  },
}

export const CAPS: { key: keyof Connector['capacidades']; label: string }[] = [
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'catalogo', label: 'Catálogo' },
  { key: 'pushEstoque', label: 'Push de estoque' },
  { key: 'pushCatalogo', label: 'Enviar catálogo' },
  { key: 'nfeCompra', label: 'NF-e de compra' },
]

/**
 * O que cada plataforma aceitaria ao receber produtos do Prodio. É fato da API da plataforma, não
 * promessa: nenhum adaptador do worker envia produto hoje (pushCatalogo é false nos três), e a aba
 * Catálogo diz isso ao lado deste texto.
 */
export const PUSH_CATALOGO: Record<Plataforma, { texto: string; ficha: 'sim' | 'nao' | 'confirmar' }> = {
  bling: { texto: 'Bling recebe o produto com estrutura: a ficha técnica do Prodio vira componentes do produto.', ficha: 'sim' },
  tiny: { texto: 'Tiny recebe o produto com estrutura (produto fabricado): a ficha técnica vai junto.', ficha: 'sim' },
  omie: { texto: 'Omie recebe o produto e a malha (estrutura de produto).', ficha: 'sim' },
  baselinker: {
    texto: 'BaseLinker recebe o produto no inventário escolhido. Pela documentação da API (addInventoryProduct), também aceita kit com os componentes vinculados, desde que os componentes já existam lá. A ficha técnica de insumos não vai.',
    ficha: 'nao',
  },
  magis5: { texto: 'Magis5: envio de produtos a confirmar com conta de teste. Por enquanto, cadastre no hub e vincule aqui.', ficha: 'confirmar' },
}

export const STATUS_TONE = { conectado: 'ok', erro: 'danger', desconectado: 'neutral' } as const
export const STATUS_LABEL = { conectado: 'Conectado', erro: 'Erro', desconectado: 'Desconectado' } as const

// ---------- Configuração: pedidos ----------
export type Significado = 'ignorar' | 'demanda' | 'carteira' | 'enviado' | 'cancelado'
export const SIGNIFICADOS: { id: Significado; label: string }[] = [
  { id: 'ignorar', label: 'Ignorar' },
  { id: 'demanda', label: 'Demanda' },
  { id: 'carteira', label: 'Carteira firme' },
  { id: 'enviado', label: 'Enviado' },
  { id: 'cancelado', label: 'Cancelado' },
]

export const STATUS_PLATAFORMA: Record<Plataforma, { nome: string; padrao: Significado }[]> = {
  baselinker: [
    { nome: 'Novo', padrao: 'demanda' },
    { nome: 'Pago', padrao: 'carteira' },
    { nome: 'Em separação', padrao: 'carteira' },
    { nome: 'Enviado', padrao: 'enviado' },
    { nome: 'Cancelado', padrao: 'cancelado' },
  ],
  bling: [
    { nome: 'Em aberto', padrao: 'demanda' },
    { nome: 'Em andamento', padrao: 'carteira' },
    { nome: 'Atendido', padrao: 'enviado' },
    { nome: 'Cancelado', padrao: 'cancelado' },
  ],
  tiny: [
    { nome: 'Aberto', padrao: 'demanda' },
    { nome: 'Aprovado', padrao: 'carteira' },
    { nome: 'Preparando envio', padrao: 'carteira' },
    { nome: 'Enviado', padrao: 'enviado' },
    { nome: 'Cancelado', padrao: 'cancelado' },
  ],
  omie: [
    { nome: 'Pedido novo', padrao: 'demanda' },
    { nome: 'Faturado', padrao: 'carteira' },
    { nome: 'Entregue', padrao: 'enviado' },
    { nome: 'Cancelado', padrao: 'cancelado' },
  ],
  magis5: [
    { nome: 'Aprovado', padrao: 'carteira' },
    { nome: 'Enviado', padrao: 'enviado' },
    { nome: 'Cancelado', padrao: 'cancelado' },
  ],
}

/**
 * Histórico de execuções da demonstração (modo memória). Com banco de verdade a tabela não aparece:
 * não existe registro de execução de sync para ler, e execução inventada é pior que nenhuma.
 */
export const HISTORICO_SYNC = [
  { em: new Date(Date.now() - 12 * 60000).toISOString(), pedidos: 18, novos: 6, ms: 840, ok: true },
  { em: new Date(Date.now() - 27 * 60000).toISOString(), pedidos: 22, novos: 9, ms: 910, ok: true },
  { em: new Date(Date.now() - 42 * 60000).toISOString(), pedidos: 0, novos: 0, ms: 4200, ok: false, erro: 'timeout' },
  { em: new Date(Date.now() - 57 * 60000).toISOString(), pedidos: 31, novos: 14, ms: 1020, ok: true },
]
