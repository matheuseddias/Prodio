import { AlertTriangle, Check, ExternalLink, Info, Loader2, Plug, RefreshCw, Settings2, ShieldCheck, Unplug } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useLookups, useStore } from '../../domain/store'
import { dataHoraBR, horaBR, num, relativo } from '../../domain/format'
import type { Connector } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Stat, Table, Tabs, Td, Th, Toggle, cx } from '../../ui'

type Plataforma = Connector['plataforma']

// ---------- Metadados por plataforma (fatos de integração) ----------
const META: Record<
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

const CAPS: { key: keyof Connector['capacidades']; label: string }[] = [
  { key: 'pedidos', label: 'Pedidos' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'catalogo', label: 'Catálogo' },
  { key: 'pushEstoque', label: 'Push de estoque' },
  { key: 'nfeCompra', label: 'NF-e de compra' },
]

const STATUS_TONE = { conectado: 'ok', erro: 'danger', desconectado: 'neutral' } as const
const STATUS_LABEL = { conectado: 'Conectado', erro: 'Erro', desconectado: 'Desconectado' } as const

function Logo({ p, size = 'md' }: { p: Plataforma; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg font-bold text-white', META[p].cor, size === 'md' ? 'h-10 w-10 text-sm' : 'h-7 w-7 text-[11px]')}>
      {META[p].iniciais}
    </span>
  )
}

function Nota({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : Info
  return (
    <div className={cx('flex gap-2 rounded-lg px-3 py-2 text-[13px]', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info')}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

// ---------- Cartão ----------
function ConnectorCard({ c, onConnect, onConfig }: { c: Connector; onConnect: () => void; onConfig: () => void }) {
  const m = META[c.plataforma]
  const ativo = c.status === 'conectado'
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo p={c.plataforma} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{c.nome}</div>
            <div className="truncate text-[12px] text-muted">{m.curto}</div>
          </div>
        </div>
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-muted">Último sync</dt>
          <dd className="truncate font-medium">{c.ultimoSync ? relativo(c.ultimoSync) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Pedidos 24h</dt>
          <dd className="font-medium tabular-nums">{c.pedidos24h !== undefined ? num(c.pedidos24h) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Outbox</dt>
          <dd className="font-medium tabular-nums">
            {c.outboxPendentes ? <span className="text-warn">{c.outboxPendentes} pend.</span> : c.status === 'conectado' ? '0' : '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {CAPS.map((cap) => {
          const ok = c.capacidades[cap.key]
          return (
            <span
              key={cap.key}
              title={ok ? 'Suportado' : 'Não suportado'}
              className={cx(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                ok ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-faint line-through decoration-faint/60',
              )}
            >
              {ok && <Check size={11} />}
              {cap.label}
            </span>
          )
        })}
      </div>

      <div className="mt-4 flex gap-2 pt-1">
        {ativo ? (
          <>
            <Button size="sm" onClick={onConfig} className="flex-1">
              <Settings2 size={14} /> Configurar
            </Button>
            <Button size="sm" variant="ghost" onClick={onConnect}>
              Reconectar
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={onConnect} className="flex-1">
              <Plug size={14} /> Conectar
            </Button>
            {c.status === 'erro' && (
              <Button size="sm" variant="ghost" onClick={onConfig}>
                Configurar
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

// ---------- Modal de conexão por plataforma ----------
function ConnectModal({ c, onClose }: { c: Connector; onClose: () => void }) {
  const { setConnector } = useStore()
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [fase, setFase] = useState<'form' | 'testando' | 'redirecionando' | 'ok'>('form')
  const set = (k: string, v: string) => setCampos((s) => ({ ...s, [k]: v }))
  const m = META[c.plataforma]

  const concluir = () => {
    setConnector({
      ...c,
      status: 'conectado',
      ultimoSync: new Date().toISOString(),
      pedidos24h: c.pedidos24h ?? 0,
      outboxPendentes: c.outboxPendentes ?? 0,
      cursor: c.cursor ?? 'inicial',
    })
    setFase('ok')
  }
  const simular = (f: 'testando' | 'redirecionando') => {
    setFase(f)
    window.setTimeout(concluir, 1000)
  }

  const preenchido = (...ks: string[]) => ks.every((k) => (campos[k] ?? '').trim().length > 0)

  let corpo: ReactNode
  let footer: ReactNode

  if (fase === 'ok') {
    corpo = (
      <div className="flex flex-col items-center py-6 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-soft text-ok">
          <Check size={24} />
        </span>
        <div className="mt-3 font-semibold">{c.nome} conectado</div>
        <p className="mt-1 max-w-sm text-sm text-muted">O primeiro sync de pedidos começa em instantes. Depois, mapeie os status em Configurar → Pedidos.</p>
      </div>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Fechar
      </Button>
    )
  } else if (fase === 'testando' || fase === 'redirecionando') {
    corpo = (
      <div className="flex flex-col items-center py-8 text-center">
        <Loader2 size={28} className="animate-spin text-accent" />
        <div className="mt-3 text-sm text-muted">{fase === 'testando' ? 'Testando conexão…' : `Redirecionando para ${c.nome}… você volta ao Prodio depois de autorizar.`}</div>
      </div>
    )
  } else {
    switch (c.plataforma) {
      case 'baselinker':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth} Gere o token em Minha conta → API na sua conta BaseLinker.</p>
            <Field label="Token da API" hint="Enviado como X-BLToken. Fica salvo criptografado.">
              <Input value={campos.token ?? ''} onChange={(e) => set('token', e.target.value)} placeholder="Cole o token da conta" className="font-mono" autoFocus />
            </Field>
            <Nota>{m.pedidos} Após conectar, configure o De-Para de status.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('token')} onClick={() => simular('testando')}>
              Testar conexão
            </Button>
          </>
        )
        break
      case 'bling':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {m.auth} Ao clicar em Autorizar, você vai para o Bling, entra na sua conta, aceita as permissões do Prodio e volta para cá já conectado. A renovação do token é automática.
            </p>
            <ul className="space-y-1 text-[13px] text-muted">
              <li>• {m.webhooks}</li>
              <li>• {m.pedidos}</li>
              <li>• {m.catalogo}</li>
            </ul>
            <Nota tone="warn">Desde abril/2026, pedidos lidos por API podem contar no limite do plano do cliente no Bling. Ajuste o intervalo de polling em Sincronização para reduzir leituras.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={() => simular('redirecionando')}>
              <ExternalLink size={15} /> Autorizar no Bling
            </Button>
          </>
        )
        break
      case 'tiny':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth}</p>
            <ol className="space-y-2 text-sm">
              {[
                'No Tiny, abra Configurações → Aplicativos → Criar aplicativo (privado).',
                'Dê o nome "Prodio" e informe a URL de retorno: https://app.prodio.app/oauth/tiny.',
                'Copie o client_id e o client_secret gerados e cole abaixo.',
                'Clique em Autorizar: você entra no Tiny, aceita e volta conectado.',
              ].map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="client_id">
                <Input value={campos.clientId ?? ''} onChange={(e) => set('clientId', e.target.value)} className="font-mono" />
              </Field>
              <Field label="client_secret">
                <Input type="password" value={campos.clientSecret ?? ''} onChange={(e) => set('clientSecret', e.target.value)} className="font-mono" />
              </Field>
            </div>
            <Nota>{m.webhooks} O Prodio consulta pedidos em intervalos e busca o detalhe de cada pedido para obter os itens.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('clientId', 'clientSecret')} onClick={() => simular('redirecionando')}>
              <ExternalLink size={15} /> Autorizar no Tiny
            </Button>
          </>
        )
        break
      case 'omie':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth} Gere em Configurações → Aplicativos → Chaves de API dentro do Omie.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="app_key">
                <Input value={campos.appKey ?? ''} onChange={(e) => set('appKey', e.target.value)} className="font-mono" autoFocus />
              </Field>
              <Field label="app_secret">
                <Input type="password" value={campos.appSecret ?? ''} onChange={(e) => set('appSecret', e.target.value)} className="font-mono" />
              </Field>
            </div>
            <Nota>
              {m.pedidos} O Prodio respeita o limite e evita chamadas repetidas. {m.webhooks}
            </Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('appKey', 'appSecret')} onClick={() => simular('testando')}>
              Testar conexão
            </Button>
          </>
        )
        break
      case 'magis5':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth}</p>
            <Field label="Chave de API">
              <Input value={campos.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} className="font-mono" autoFocus />
            </Field>
            <Nota tone="warn">A documentação pública do Magis5 é limitada: a listagem de pedidos e os webhooks precisam ser confirmados com uma conta de teste antes de usar em produção.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('apiKey')} onClick={() => simular('testando')}>
              Testar conexão
            </Button>
          </>
        )
        break
    }
  }

  return (
    <Modal open onClose={onClose} title={`Conectar ${c.nome}`} footer={footer}>
      {corpo}
    </Modal>
  )
}

// ---------- Modal de configuração ----------
type Significado = 'ignorar' | 'demanda' | 'carteira' | 'enviado' | 'cancelado'
const SIGNIFICADOS: { id: Significado; label: string }[] = [
  { id: 'ignorar', label: 'Ignorar' },
  { id: 'demanda', label: 'Demanda' },
  { id: 'carteira', label: 'Carteira firme' },
  { id: 'enviado', label: 'Enviado' },
  { id: 'cancelado', label: 'Cancelado' },
]

const STATUS_PLATAFORMA: Record<Plataforma, { nome: string; padrao: Significado }[]> = {
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

const SKUS_SEM_DEPARA = ['ED000002-GRAF', 'MP-DESKPAD-CAR-90', 'ESP-ADNET-60-PTO', 'KIT-JOGO-AMER-4']

const HISTORICO_SYNC = [
  { em: new Date(Date.now() - 12 * 60000).toISOString(), pedidos: 18, novos: 6, ms: 840, ok: true },
  { em: new Date(Date.now() - 27 * 60000).toISOString(), pedidos: 22, novos: 9, ms: 910, ok: true },
  { em: new Date(Date.now() - 42 * 60000).toISOString(), pedidos: 0, novos: 0, ms: 4200, ok: false, erro: 'timeout' },
  { em: new Date(Date.now() - 57 * 60000).toISOString(), pedidos: 31, novos: 14, ms: 1020, ok: true },
]

type AbaCfg = 'pedidos' | 'catalogo' | 'estoque' | 'sync' | 'desconectar'

function ConfigModal({ c, onClose }: { c: Connector; onClose: () => void }) {
  const { products, setConnector } = useStore()
  const [aba, setAba] = useState<AbaCfg>('pedidos')
  const m = META[c.plataforma]

  // Estado local (sem ação no store para estas preferências)
  const [mapa, setMapa] = useState<Record<string, Significado>>(() => Object.fromEntries(STATUS_PLATAFORMA[c.plataforma].map((s) => [s.nome, s.padrao])))
  const [depara, setDepara] = useState<Record<string, string>>({})
  const [pushOn, setPushOn] = useState(true)
  const [modo, setModo] = useState<'saldo' | 'documentos'>(c.plataforma === 'baselinker' ? 'saldo' : 'documentos')
  const [dryRun, setDryRun] = useState(true)
  const [deposito, setDeposito] = useState('24384')
  const [intervalo, setIntervalo] = useState(c.plataforma === 'bling' ? '15' : '5')
  const [forcando, setForcando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [confirmaDesc, setConfirmaDesc] = useState('')

  const forcar = () => {
    setForcando(true)
    window.setTimeout(() => {
      setForcando(false)
      setConnector({ ...c, ultimoSync: new Date().toISOString(), status: 'conectado' })
    }, 1000)
  }
  const salvar = () => {
    setSalvo(true)
    window.setTimeout(() => setSalvo(false), 1500)
  }
  const desconectar = () => {
    setConnector({ ...c, status: 'desconectado', ultimoSync: undefined, pedidos24h: undefined, outboxPendentes: undefined, cursor: undefined })
    onClose()
  }

  const ativos = products.filter((p) => p.status === 'ativo')
  const pendentesDepara = SKUS_SEM_DEPARA.filter((s) => !depara[s]).length

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Configurar ${c.nome}`}
      footer={
        aba !== 'desconectar' && (
          <>
            <Button onClick={onClose}>Fechar</Button>
            <Button variant="primary" onClick={salvar}>
              {salvo ? <Check size={15} /> : null}
              {salvo ? 'Salvo' : 'Salvar'}
            </Button>
          </>
        )
      }
    >
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'pedidos', label: 'Pedidos' },
          { id: 'catalogo', label: 'Catálogo', count: pendentesDepara },
          { id: 'estoque', label: 'Estoque' },
          { id: 'sync', label: 'Sincronização' },
          { id: 'desconectar', label: <span className="text-danger">Desconectar</span> },
        ]}
      />

      {aba === 'pedidos' && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Cada status da plataforma vira um significado no Prodio. <strong>Demanda</strong> entra na projeção do dia; <strong>Carteira firme</strong> reserva produção; <strong>Enviado</strong> e{' '}
            <strong>Cancelado</strong> saem da fila.
          </p>
          {c.plataforma === 'baselinker' && <Nota>{m.pedidos}</Nota>}
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left font-medium">Status em {c.nome.split(' ')[0]}</th>
                  <th className="px-3 py-2 text-left font-medium">No Prodio</th>
                </tr>
              </thead>
              <tbody>
                {STATUS_PLATAFORMA[c.plataforma].map((s) => (
                  <tr key={s.nome} className="border-t border-border/70">
                    <td className="px-3 py-2 font-medium">{s.nome}</td>
                    <td className="px-3 py-2">
                      <Select value={mapa[s.nome]} onChange={(e) => setMapa((mm) => ({ ...mm, [s.nome]: e.target.value as Significado }))} className="h-9 max-w-[220px]">
                        {SIGNIFICADOS.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'catalogo' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">SKUs externos que chegaram em pedidos e ainda não têm produto correspondente no Prodio.</p>
            <span title={c.plataforma === 'baselinker' ? 'BaseLinker não expõe ficha técnica' : m.catalogo} className="inline-flex">
              <Button size="sm" disabled={c.plataforma === 'baselinker' || c.plataforma === 'magis5'}>
                Importar ficha técnica do ERP
              </Button>
            </span>
          </div>
          {SKUS_SEM_DEPARA.length === 0 ? (
            <EmptyState title="Tudo mapeado" />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-left font-medium">SKU externo</th>
                    <th className="px-3 py-2 text-left font-medium">Produto no Prodio</th>
                  </tr>
                </thead>
                <tbody>
                  {SKUS_SEM_DEPARA.map((s) => (
                    <tr key={s} className="border-t border-border/70">
                      <td className="px-3 py-2 font-mono text-[13px]">{s}</td>
                      <td className="px-3 py-2">
                        <Select value={depara[s] ?? ''} onChange={(e) => setDepara((d) => ({ ...d, [s]: e.target.value }))} className="h-9">
                          <option value="">Selecionar…</option>
                          {ativos.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} · {p.nome} {p.atributos.cor ? `(${p.atributos.cor})` : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {aba === 'estoque' && (
        <div className="space-y-5">
          <Toggle checked={pushOn} onChange={setPushOn} label="Enviar produção bipada para o hub" />
          <p className="text-[13px] text-muted -mt-2">Cada bipe entra no outbox; o worker aplica em lote no hub.</p>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-muted">Modo de escrita</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { id: 'saldo', t: 'Saldo absoluto', d: 'O Prodio calcula o saldo final e sobrescreve o valor no hub.' },
                  { id: 'documentos', t: 'Documentos', d: 'Cada lote vira um documento de entrada, preservando histórico no hub.' },
                ] as const
              ).map((o) => {
                const dis = o.id === 'documentos' && c.plataforma === 'baselinker'
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={dis}
                    title={dis ? 'BaseLinker só aceita saldo absoluto' : undefined}
                    onClick={() => setModo(o.id)}
                    className={cx('rounded-lg border p-3 text-left transition-colors disabled:opacity-50', modo === o.id ? 'border-accent bg-accent-soft/40' : 'border-border hover:bg-surface-2')}
                  >
                    <div className="text-sm font-medium">{o.t}</div>
                    <div className="mt-0.5 text-[12px] text-muted">{o.d}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <Toggle checked={dryRun} onChange={setDryRun} label="Simular antes de aplicar (dry-run)" />
          <p className="text-[13px] text-muted -mt-2">Mostra o que mudaria no hub sem escrever. Recomendado nos primeiros dias.</p>
          <Field label={c.plataforma === 'baselinker' ? 'Inventário alvo (ID)' : 'Depósito alvo'} hint="Onde o saldo produzido é escrito.">
            <Input value={deposito} onChange={(e) => setDeposito(e.target.value)} className="max-w-xs font-mono" />
          </Field>
          {c.plataforma === 'baselinker' && <Nota>{m.estoque} Estoque de outros canais que apontem para o mesmo inventário também será sobrescrito.</Nota>}
        </div>
      )}

      {aba === 'sync' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Intervalo de polling" hint={c.plataforma === 'bling' ? 'Leituras por API podem contar no limite do plano do Bling.' : m.webhooks}>
              <Select value={intervalo} onChange={(e) => setIntervalo(e.target.value)}>
                {['1', '5', '15', '30', '60'].map((v) => (
                  <option key={v} value={v}>
                    a cada {v} min
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cursor atual" hint="Ponto de onde o próximo sync continua.">
              <Input readOnly value={c.cursor ?? '—'} className="font-mono bg-surface-2" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={forcar} disabled={forcando}>
              {forcando ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {forcando ? 'Sincronizando…' : 'Forçar sync agora'}
            </Button>
            <span className="text-[13px] text-muted">Último: {c.ultimoSync ? `${dataHoraBR(c.ultimoSync)} (${relativo(c.ultimoSync)})` : '—'}</span>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium text-muted">Histórico de execuções</div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-left font-medium">Hora</th>
                    <th className="px-3 py-2 text-right font-medium">Lidos</th>
                    <th className="px-3 py-2 text-right font-medium">Novos</th>
                    <th className="px-3 py-2 text-right font-medium">Duração</th>
                    <th className="px-3 py-2 text-left font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {HISTORICO_SYNC.map((h, i) => (
                    <tr key={i} className="border-t border-border/70">
                      <td className="px-3 py-2 tabular-nums">{horaBR(h.em)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.pedidos}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.novos}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(h.ms / 1000).toFixed(1)} s</td>
                      <td className="px-3 py-2">{h.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="danger">{h.erro}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {aba === 'desconectar' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
            <div className="flex items-center gap-2 font-semibold text-danger">
              <Unplug size={16} /> Desconectar {c.nome}
            </div>
            <p className="mt-1 text-sm text-muted">
              Os pedidos param de entrar, o outbox pendente é descartado e as credenciais são apagadas. Os mapeamentos de status e SKU ficam salvos para uma reconexão.
            </p>
          </div>
          <Field label={`Digite "desconectar" para confirmar`}>
            <Input value={confirmaDesc} onChange={(e) => setConfirmaDesc(e.target.value)} className="max-w-xs" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="danger" disabled={confirmaDesc.trim().toLowerCase() !== 'desconectar'} onClick={desconectar}>
              Desconectar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ---------- Outbox ----------
function OutboxSection() {
  const { outbox, connectors, retryOutbox } = useStore()
  const { product } = useLookups()
  const [filtro, setFiltro] = useState<'todos' | 'pendente' | 'aplicado' | 'erro'>('todos')
  const cont = useMemo(
    () => ({
      pendente: outbox.filter((o) => o.status === 'pendente').length,
      aplicado: outbox.filter((o) => o.status === 'aplicado').length,
      erro: outbox.filter((o) => o.status === 'erro').length,
    }),
    [outbox],
  )
  const lista = useMemo(() => {
    const l = filtro === 'todos' ? outbox : outbox.filter((o) => o.status === filtro)
    return [...l].sort((a, b) => b.em.localeCompare(a.em))
  }, [outbox, filtro])
  const tone = { pendente: 'warn', aplicado: 'ok', erro: 'danger' } as const

  return (
    <Card
      title="Outbox de estoque"
      actions={
        <Select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="h-8 w-auto text-[13px]">
          <option value="todos">Todos</option>
          <option value="pendente">Pendentes</option>
          <option value="aplicado">Aplicados</option>
          <option value="erro">Erros</option>
        </Select>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span>
          <span className="font-semibold tabular-nums text-warn">{cont.pendente}</span> <span className="text-muted">pendentes</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums text-ok">{cont.aplicado}</span> <span className="text-muted">aplicados</span>
        </span>
        <span>
          <span className="font-semibold tabular-nums text-danger">{cont.erro}</span> <span className="text-muted">erros</span>
        </span>
        <span className="basis-full text-muted sm:basis-auto sm:ml-auto">Cada bipe vira +1 na fila; o worker aplica em lote e o auditor noturno confere.</span>
      </div>
      {lista.length === 0 ? (
        <EmptyState title="Nada aqui" description="Nenhum item do outbox com este filtro." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Hora</Th>
              <Th>Conector</Th>
              <Th>Produto</Th>
              <Th right>Delta</Th>
              <Th>Status</Th>
              <Th>Erro</Th>
              <Th right />
            </tr>
          </thead>
          <tbody>
            {lista.map((o) => {
              const c = connectors.find((x) => x.id === o.connectorId)
              const p = product(o.productId)
              return (
                <tr key={o.id}>
                  <Td className="tabular-nums whitespace-nowrap">{horaBR(o.em)}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      {c && <Logo p={c.plataforma} size="sm" />}
                      <span className="whitespace-nowrap">{c?.nome.split(' ')[0] ?? o.connectorId}</span>
                    </span>
                  </Td>
                  <Td>
                    <div className="font-medium">{p?.nome ?? '—'}</div>
                    <div className="font-mono text-[12px] text-muted">{p?.sku}</div>
                  </Td>
                  <Td right className="font-semibold">
                    {o.delta > 0 ? `+${o.delta}` : o.delta}
                  </Td>
                  <Td>
                    <Badge tone={tone[o.status]}>{o.status}</Badge>
                  </Td>
                  <Td className="max-w-[260px] text-[13px] text-danger">{o.erro ?? <span className="text-faint">—</span>}</Td>
                  <Td right>
                    {o.status === 'erro' && (
                      <Button size="sm" onClick={() => retryOutbox(o.id)}>
                        <RefreshCw size={13} /> Reenviar
                      </Button>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

// ---------- Auditor noturno ----------
interface Divergencia {
  productId: string
  prodio: number
  hub: number
}

function AuditorSection() {
  const { product } = useLookups()
  const [divergencias, setDivergencias] = useState<Divergencia[]>([
    { productId: 'p2', prodio: 148, hub: 128 },
    { productId: 'p7', prodio: 312, hub: 307 },
  ])
  const [open, setOpen] = useState(false)
  const [corrigindo, setCorrigindo] = useState<string | null>(null)
  const [ultima] = useState(() => {
    const d = new Date()
    const agora = d.getTime()
    d.setHours(3, 10, 0, 0)
    if (d.getTime() > agora) d.setDate(d.getDate() - 1)
    return d.toISOString()
  })

  const corrigir = (id: string) => {
    setCorrigindo(id)
    window.setTimeout(() => {
      setDivergencias((l) => l.filter((x) => x.productId !== id))
      setCorrigindo(null)
    }, 800)
  }

  return (
    <>
      <Card title="Auditor noturno">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-lg', divergencias.length ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
              <ShieldCheck size={20} />
            </span>
            <div>
              <div className="font-medium">
                {divergencias.length === 0 ? 'Saldos conferem com o hub' : `${divergencias.length} SKUs com saldo diferente no hub`}
              </div>
              <div className="text-[13px] text-muted">
                Última execução {dataHoraBR(ultima)} · {relativo(ultima)} · comparou 11 SKUs em Base.com
              </div>
            </div>
          </div>
          {divergencias.length > 0 && (
            <Button onClick={() => setOpen(true)} className="sm:shrink-0">
              Ver divergências
            </Button>
          )}
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Roda todo dia após a virada: lê o saldo no hub, compara com o esperado a partir dos bipes e aponta o que divergir. Nada é alterado sem confirmação.
        </p>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Divergências do auditor" footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}>
        {divergencias.length === 0 ? (
          <EmptyState title="Sem divergências" description="Todos os saldos foram corrigidos." />
        ) : (
          <div className="space-y-3">
            {divergencias.map((d) => {
              const p = product(d.productId)
              const diff = d.prodio - d.hub
              return (
                <div key={d.productId} className="rounded-lg border border-border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p?.nome}</div>
                      <div className="font-mono text-[12px] text-muted">{p?.sku}</div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted">Prodio</div>
                        <div className="font-semibold tabular-nums">{num(d.prodio)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted">Hub</div>
                        <div className="font-semibold tabular-nums">{num(d.hub)}</div>
                      </div>
                      <Badge tone={diff > 0 ? 'warn' : 'danger'}>{diff > 0 ? `+${diff}` : diff}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="primary" disabled={corrigindo === d.productId} onClick={() => corrigir(d.productId)}>
                      {corrigindo === d.productId ? <Loader2 size={13} className="animate-spin" /> : null}
                      Corrigir no hub
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    </>
  )
}

// ---------- Página ----------
export default function Conectores() {
  const { connectors, outbox } = useStore()
  const [conectar, setConectar] = useState<Connector | null>(null)
  const [config, setConfig] = useState<Connector | null>(null)

  const conectados = connectors.filter((c) => c.status === 'conectado').length
  const pedidos24h = connectors.reduce((a, c) => a + (c.pedidos24h ?? 0), 0)
  const erros = outbox.filter((o) => o.status === 'erro').length
  const pendentes = outbox.filter((o) => o.status === 'pendente').length

  // Mantém referência atualizada ao conector aberto no modal
  const conectarAtual = conectar ? (connectors.find((c) => c.id === conectar.id) ?? conectar) : null
  const configAtual = config ? (connectors.find((c) => c.id === config.id) ?? config) : null

  return (
    <>
      <PageHeader title="Conectores" subtitle="Hubs e ERPs que alimentam a demanda e recebem a produção bipada." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Conectados" value={`${conectados} / ${connectors.length}`} />
        <Stat label="Pedidos 24h" value={num(pedidos24h)} hint="somando todos os hubs" />
        <Stat label="Outbox pendente" value={pendentes} tone={pendentes ? 'warn' : undefined} />
        <Stat label="Outbox com erro" value={erros} tone={erros ? 'danger' : undefined} />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {connectors.map((c) => (
          <ConnectorCard key={c.id} c={c} onConnect={() => setConectar(c)} onConfig={() => setConfig(c)} />
        ))}
      </div>

      <div className="space-y-5">
        <OutboxSection />
        <AuditorSection />
      </div>

      {conectarAtual && <ConnectModal key={conectarAtual.id} c={conectarAtual} onClose={() => setConectar(null)} />}
      {configAtual && <ConfigModal key={configAtual.id} c={configAtual} onClose={() => setConfig(null)} />}
    </>
  )
}
