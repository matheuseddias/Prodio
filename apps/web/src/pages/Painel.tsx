import { AlertTriangle, ArrowRight, Bell, BookOpen, Boxes, Package, PackageX, Plug, ShoppingCart, Sparkles, Truck } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { foraDaTela, frescorDaTela, linhasParaAplicar, sugestoesDoDia } from '../domain/demanda'
import { dataHoraBR, diaProducao, hojeISO, num, pct, relativo } from '../domain/format'
import { comHoje, semProducao, semVendas, ultimosDias } from '../domain/historico'
import { useLookups, useStore } from '../domain/store'
import { Badge, Button, Card, EmptyState, Progress, Stat, cx, type Tone } from '../ui'
import AvisoDemanda from './producao/AvisoDemanda'
import { GroupedBars } from './producao/charts'
import { useDemandaViva } from './producao/useDemandaViva'

const rotaNotificacao: Record<string, string> = {
  minimo: '/estoque',
  oc_atrasada: '/compras/ordens',
  nfe: '/recebimento',
  conector: '/conectores',
  cadastro: '/cadastros/fichas',
}

function SaudeItem({ to, icon, label, count, tone }: { to: string; icon: ReactNode; label: string; count: number; tone: Tone }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg px-2 py-2 -mx-2 hover:bg-surface-2 transition-colors">
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg', count > 0 ? { ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent-text', neutral: 'bg-surface-2 text-muted' }[tone] : 'bg-surface-2 text-faint')}>
        {icon}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      <span className={cx('text-sm font-semibold tabular-nums', count > 0 ? '' : 'text-faint')}>{num(count)}</span>
      <ArrowRight size={14} className="text-faint" />
    </Link>
  )
}

export default function Painel() {
  const s = useStore()
  const { productRef } = useLookups()
  const nav = useNavigate()
  const hoje = hojeISO()
  useDemandaViva()

  const produzido = s.dailyPlan.reduce((a, l) => a + l.bipado, 0)
  const projetado = s.dailyPlan.reduce((a, l) => a + l.projetado, 0)
  // Pedidos 24h: com a demanda lida, a regra dela (decisão de 25/09) — todo pedido confirmado nas últimas 24 h
  // que não é 'ignorar', de todos os hubs. Sem ela, a contagem em `orders` por conector (data/leituras.ts,
  // lerConnectors); sem nenhuma das duas, "—" em vez de um zero com cara de número real. Durante a carga
  // inicial o zero é verdadeiro, mas o hint diz até onde o robô leu.
  const comPedidos24h = s.connectors.filter((c) => c.pedidos24h !== undefined)
  const pedidos24h = s.demanda.disponivel ? s.demanda.pedidos24h : comPedidos24h.length ? comPedidos24h.reduce((a, c) => a + (c.pedidos24h ?? 0), 0) : undefined
  const frescor = useMemo(() => frescorDaTela(s.demanda, s.connectors), [s.demanda, s.connectors])
  const cargaAtrasada = frescor?.situacao === 'carga_atrasada' && !!s.demanda.ultimoPedido
  const hintPedidos =
    pedidos24h === undefined
      ? s.connectors.some((c) => c.status !== 'desconectado') ? 'contagem indisponível agora' : 'nenhum hub conectado'
      : cargaAtrasada
        ? `o robô leu até ${dataHoraBR(s.demanda.ultimoPedido!)}`
        : s.demanda.disponivel
          ? 'confirmados, menos "ignorar"'
          : comPedidos24h.length === 1
            ? comPedidos24h[0].nome
            : 'somando todos os hubs'
  const abaixoMinimo = s.materials.filter((m) => m.saldo < m.minimo)
  const ocsHoje = s.purchaseOrders.filter((po) => (po.status === 'aberta' || po.status === 'parcial') && po.entregaPrevista === hoje)
  const ocsAtrasadas = s.purchaseOrders.filter((po) => (po.status === 'aberta' || po.status === 'parcial') && !!po.entregaPrevista && po.entregaPrevista < hoje)
  const nfesPendentes = s.nfes.filter((n) => n.status === 'pendente' || n.status === 'aguardando_xml')
  // Vendidos na janela da demanda sem ficha ativa. Antes contava todo produto ativo sem ficha, vendido ou não.
  const fora = useMemo(() => foraDaTela(s.demanda, s.products), [s.demanda, s.products])
  const sugeridos = useMemo(
    () => (s.dailyPlan.length > 0 ? [] : linhasParaAplicar(sugestoesDoDia({ tenant: s.tenant, demanda: s.demanda, boms: s.boms, products: s.products, dailyPlan: s.dailyPlan, labels: s.labels, scans: s.scans }))),
    [s.tenant, s.demanda, s.boms, s.products, s.dailyPlan, s.labels, s.scans],
  )
  const outboxErro = s.outbox.filter((o) => o.status === 'erro')
  const avisos = s.notifications.filter((n) => !n.lida)

  const topLinha = useMemo(
    () => [...s.dailyPlan].filter((l) => l.projetado > 0).sort((a, b) => b.projetado - a.projetado).slice(0, 6),
    [s.dailyPlan],
  )
  const aderencia = projetado > 0 ? produzido / projetado : 0

  // Gráficos: histórico real do banco (v_daily_plan e orders). Hoje vem do store, que já soma os
  // bipes da fila offline. Empresa sem histórico mostra estado vazio, nunca número inventado.
  const producao14 = useMemo(
    () => ultimosDias(comHoje(s.historico.producao, diaProducao(s.tenant.horaVirada), { projetado, produzido }), 14),
    [s.historico.producao, s.tenant.horaVirada, projetado, produzido],
  )
  const vendas14 = useMemo(() => ultimosDias(s.historico.vendas, 14), [s.historico.vendas])
  // Sem banco (modo demonstração) o gráfico é ilustrativo e tem de dizer isso sem margem a dúvida.
  const marcaExemplo = s.historico.exemplo ? <Badge tone="warn">dados de exemplo</Badge> : null

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Painel</h1>
          <p className="text-sm text-muted mt-1">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} · {s.tenant.nome}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => nav('/producao/etiquetas')}>Imprimir etiquetas</Button>
          <Button variant="primary" onClick={() => nav('/producao/linha-de-hoje')}>
            Linha de hoje <ArrowRight size={16} />
          </Button>
        </div>
      </div>

      <AvisoDemanda className="mb-4" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <Link to="/producao/linha-de-hoje" className="col-span-2 lg:col-span-1">
          <Stat
            label="Produzido hoje"
            value={
              <>
                {num(produzido)} <span className="text-base text-muted font-normal">/ {num(projetado)}</span>
              </>
            }
            hint={`${pct(aderencia)} do projetado`}
            tone={aderencia >= 1 ? 'ok' : aderencia >= 0.6 ? 'accent' : 'warn'}
          />
        </Link>
        <Link to="/conectores">
          <Stat
            label="Pedidos 24h"
            value={pedidos24h === undefined ? '—' : num(pedidos24h)}
            hint={hintPedidos}
            tone={cargaAtrasada ? 'warn' : undefined}
            icon={<ShoppingCart size={16} />}
          />
        </Link>
        <Link to="/estoque">
          <Stat label="Insumos abaixo do mínimo" value={num(abaixoMinimo.length)} tone={abaixoMinimo.length ? 'danger' : 'ok'} icon={<Boxes size={16} />} />
        </Link>
        <Link to="/compras/ordens">
          <Stat label="OCs a receber hoje" value={num(ocsHoje.length)} hint={ocsAtrasadas.length ? `${ocsAtrasadas.length} atrasada(s)` : 'nenhuma atrasada'} tone={ocsAtrasadas.length ? 'warn' : undefined} icon={<Package size={16} />} />
        </Link>
        <Link to="/recebimento">
          <Stat label="NF-e pendentes" value={num(nfesPendentes.length)} hint="aguardando conferência" icon={<Truck size={16} />} />
        </Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card
          className="xl:col-span-1"
          title="Linha de hoje"
          actions={
            <Link to="/producao/linha-de-hoje" className="text-[13px] text-accent-text hover:underline">
              Ver tudo
            </Link>
          }
        >
          {topLinha.length === 0 ? (
            sugeridos.length > 0 ? (
              <EmptyState
                icon={<Sparkles size={28} />}
                title="Sem plano para hoje"
                description={`A média de vendas sugere ${num(sugeridos.length)} SKUs e ${num(sugeridos.reduce((a, l) => a + l.projetado, 0))} un para hoje.`}
                action={<Button size="sm" variant="primary" onClick={() => nav('/producao/linha-de-hoje')}>Ver e aplicar a sugestão</Button>}
              />
            ) : (
              <EmptyState title="Sem plano para hoje" description="Defina a projeção do dia na Linha de hoje." action={<Button size="sm" onClick={() => nav('/producao/linha-de-hoje')}>Definir projeção</Button>} />
            )
          ) : (
            <ul className="space-y-3">
              {topLinha.map((l) => {
                const ref = productRef(l.productId)
                const r = l.projetado > 0 ? l.bipado / l.projetado : 0
                return (
                  <li key={l.productId}>
                    <Link to="/producao/linha-de-hoje" className="block rounded-lg -mx-2 px-2 py-1 hover:bg-surface-2">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate">
                          {ref.nome}
                          {ref.cor && <span className="text-muted"> · {ref.cor}</span>}
                        </span>
                        <span className="tabular-nums shrink-0">
                          {num(l.bipado)} <span className="text-muted">/ {num(l.projetado)}</span>
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Progress value={l.bipado} max={l.projetado} tone={r >= 1 ? 'ok' : l.impresso === 0 ? 'neutral' : 'accent'} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card
          className="xl:col-span-2"
          title="Projetado × Produzido · 14 dias"
          actions={
            <>
              {marcaExemplo}
              <Link to="/producao/apontamentos" className="text-[13px] text-accent-text hover:underline">
                Apontamentos
              </Link>
            </>
          }
        >
          {semProducao(producao14) ? (
            <EmptyState
              title="Ainda sem histórico"
              description="Nada projetado nem bipado nos últimos 14 dias. O gráfico começa no primeiro dia com projeção na Linha de hoje."
              action={<Button size="sm" onClick={() => nav('/producao/linha-de-hoje')}>Definir projeção</Button>}
            />
          ) : (
            <GroupedBars
              dias={producao14.map((d) => d.dia)}
              series={[
                { nome: 'Projetado', valores: producao14.map((d) => d.projetado), tone: 'faint' },
                { nome: 'Produzido', valores: producao14.map((d) => d.produzido), tone: 'accent' },
              ]}
            />
          )}
        </Card>

        <Card
          className="xl:col-span-2"
          title="Vendas · 14 dias"
          actions={
            <>
              {marcaExemplo}
              <span className="text-[13px] text-muted tabular-nums">{num(vendas14.reduce((a, d) => a + d.unidades, 0))} un no período</span>
            </>
          }
        >
          {semVendas(vendas14) ? (
            <EmptyState
              title="Ainda sem vendas no período"
              description={
                cargaAtrasada
                  ? `O robô ainda está lendo pedidos de ${dataHoraBR(s.demanda.ultimoPedido!)}: as vendas destes 14 dias aparecem quando a carga chegar nelas.`
                  : 'As unidades vendidas por dia vêm dos pedidos do conector (todo pedido confirmado, menos "ignorar"). Conecte um canal para o Prodio contar as vendas.'
              }
              action={
                <Button size="sm" onClick={() => nav('/conectores')}>
                  Conectores
                </Button>
              }
            />
          ) : (
            <GroupedBars dias={vendas14.map((d) => d.dia)} series={[{ nome: 'Unidades vendidas', valores: vendas14.map((d) => d.unidades), tone: 'info' }]} altura={130} />
          )}
        </Card>

        <Card title="Saúde do cadastro" className="xl:col-span-1">
          <div className="space-y-0.5">
            <SaudeItem to="/cadastros/fichas" icon={<BookOpen size={16} />} label="Produtos vendidos sem ficha" count={fora.semFicha.length} tone="warn" />
            <SaudeItem to="/compras/necessidade" icon={<PackageX size={16} />} label="SKUs vendidos sem produto" count={fora.semProduto.skus} tone="warn" />
            <SaudeItem to="/estoque" icon={<Boxes size={16} />} label="Insumos abaixo do mínimo" count={abaixoMinimo.length} tone="danger" />
            <SaudeItem to="/compras/ordens" icon={<Package size={16} />} label="OCs atrasadas" count={ocsAtrasadas.length} tone="warn" />
            <SaudeItem to="/conectores" icon={<Plug size={16} />} label="Outbox com erro" count={outboxErro.length} tone="danger" />
          </div>
        </Card>

        <Card
          className="xl:col-span-3"
          title={
            <span className="inline-flex items-center gap-2">
              Avisos {avisos.length > 0 && <Badge tone="danger">{avisos.length}</Badge>}
            </span>
          }
        >
          {avisos.length === 0 ? (
            <EmptyState icon={<Bell size={28} />} title="Nenhum aviso não lido" description="Quando algo cruzar o mínimo, atrasar ou falhar, aparece aqui." />
          ) : (
            <ul className="divide-y divide-border/70">
              {avisos.map((n) => (
                <li key={n.id}>
                  <Link to={rotaNotificacao[n.tipo] ?? '/painel'} onClick={() => s.markNotification(n.id)} className="flex items-start gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-surface-2">
                    <AlertTriangle size={16} className={cx('mt-0.5 shrink-0', n.tipo === 'minimo' || n.tipo === 'conector' ? 'text-danger' : 'text-warn')} />
                    <span className="flex-1 text-sm">{n.texto}</span>
                    <span className="text-[12px] text-faint shrink-0">{relativo(n.em)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
