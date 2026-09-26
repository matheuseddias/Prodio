// Necessidade de compra pela demanda dos pedidos (docs/melhorias.md item 13): a venda dos últimos N dias
// (todo pedido confirmado, inclusive cancelado e enviado) explodida pela ficha até o insumo, pelo core
// (necessidadeDeCompra) — não mais pelo plano digitado na Linha de hoje. O que ficou de fora (SKU sem
// produto, produto sem ficha) aparece com o motivo, em vez de um "Nada a comprar" mudo.
import { necessidadeDeCompra } from '@prodio/core/necessidade'
import { Calculator, Settings2, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { entradaNecessidade, foraDaTela, type ModoCompra } from '../../domain/demanda'
import { brl, diaISO, num, pct } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, PageHeader, Stat, Toggle, cx } from '../../ui'
import AvisoDemanda, { BotaoAtualizarDemanda } from '../producao/AvisoDemanda'
import { useDemandaViva } from '../producao/useDemandaViva'
import NecessidadeFora from './NecessidadeFora'
import NecessidadeGrupo from './NecessidadeGrupo'
import NecessidadeParametros from './NecessidadeParametros'
import { agruparPorFornecedor, linhasDaTela, ordensDaSelecao, resumoDaCompra } from './necessidadeLogica'
import { hojeLocal } from './ocUtils'

export default function Necessidade() {
  const { materials, suppliers, boms, products, purchaseOrders, tenant, demanda, createPurchaseOrder } = useStore()
  const navigate = useNavigate()
  const viva = useDemandaViva()
  const [modo, setModo] = useState<ModoCompra>('metrica')
  const [editParams, setEditParams] = useState(false)
  const [soComprar, setSoComprar] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [fechados, setFechados] = useState<Set<string>>(new Set())

  const resultado = useMemo(
    () => necessidadeDeCompra(entradaNecessidade({ modo, hoje: diaISO(), demanda, tenant, boms, materials, suppliers, purchaseOrders })),
    [modo, demanda, tenant, boms, materials, suppliers, purchaseOrders],
  )
  const { linhas, semCadastro } = useMemo(() => linhasDaTela(resultado, materials), [resultado, materials])
  const grupos = useMemo(() => agruparPorFornecedor(linhas, suppliers, soComprar), [linhas, suppliers, soComprar])
  const stats = useMemo(() => resumoDaCompra(linhas), [linhas])
  const fora = useMemo(() => foraDaTela(demanda, products), [demanda, products])

  const selecionadas = linhas.filter((x) => sel.has(x.m.id) && x.l.qtdCompra > 0 && x.m.fornecedorPadraoId)
  const totalSel = selecionadas.reduce((s, x) => s + x.custo, 0)
  const fornecedoresSel = new Set(selecionadas.map((x) => x.m.fornecedorPadraoId!))

  const alternar = (setter: typeof setSel) => (id: string) =>
    setter((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleGrupo = (ids: string[], marcar: boolean) =>
    setSel((s) => {
      const n = new Set(s)
      for (const id of ids) {
        if (marcar) n.add(id)
        else n.delete(id)
      }
      return n
    })

  const gerarOrdens = () => {
    const ordens = ordensDaSelecao(linhas, sel, suppliers, {
      hoje: hojeLocal(),
      observacao: `Gerada pela necessidade de compra (${modo === 'metrica' ? 'métrica do mês' : 'por saldo'}, vendas de ${demanda.dias} dias)`,
      novoId: (i) => `${Date.now().toString(36)}${i}`,
    })
    for (const po of ordens) createPurchaseOrder(po)
    setSel(new Set())
    navigate('/compras/ordens')
  }

  const vazio = motivoVazio({ disponivel: demanda.disponivel, pedidos: demanda.pedidos, dias: demanda.dias, comFicha: linhas.length, grupos: grupos.length, soComprar })

  return (
    <>
      <PageHeader
        title="Necessidade de compra"
        subtitle="O que comprar, quanto e até quando, pela venda dos pedidos, para a produção não parar."
        actions={
          <>
            <BotaoAtualizarDemanda {...viva} />
            <Button onClick={() => setEditParams(true)}>
              <Settings2 size={16} /> Parâmetros
            </Button>
          </>
        }
      />

      <AvisoDemanda className="mb-4" />

      <Card className="mb-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-3">
            <span className={cx('whitespace-nowrap text-sm font-medium', modo === 'metrica' ? 'text-text' : 'text-muted')}>Métrica do mês</span>
            <Toggle checked={modo === 'saldo'} onChange={(v) => setModo(v ? 'saldo' : 'metrica')} ariaLabel="Calcular por saldo (desligado: métrica do mês)" />
            <span className={cx('whitespace-nowrap text-sm font-medium', modo === 'saldo' ? 'text-text' : 'text-muted')}>Por saldo</span>
          </div>
          <p className="text-sm text-muted md:ml-2">
            {modo === 'metrica'
              ? 'Compra o consumo de 30 dias (vendas explodidas pela ficha, com a margem), menos saldo e trânsito.'
              : 'Compra só o que falta para cobrir o lead time do insumo + os dias de cobertura, olhando saldo e trânsito.'}
          </p>
          <div className="md:ml-auto flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted tabular-nums">
            <span>vendas {demanda.dias} d · {num(demanda.pedidos)} pedidos</span>
            <span>margem {pct(tenant.margemProjecao)}</span>
            <span>cobertura {tenant.diasCobertura} d</span>
            {demanda.exemplo && <Badge tone="warn">dados de exemplo</Badge>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Insumos a comprar" value={num(stats.itens)} hint={`${stats.fornecedores} fornecedores`} />
        <Stat label="Já deveriam ter sido comprados" value={num(stats.atrasados)} tone={stats.atrasados > 0 ? 'danger' : 'ok'} hint="prazo de compra vencido" />
        <Stat label="Custo estimado" value={brl(stats.custo)} hint="pelo custo médio" />
        <Stat label="Selecionado" value={brl(totalSel)} tone={selecionadas.length ? 'accent' : undefined} hint={`${selecionadas.length} itens`} />
      </div>

      <div className="mb-5">
        <NecessidadeFora fora={fora} semCadastro={semCadastro} dias={demanda.dias} />
      </div>

      <div className="space-y-4 pb-24">
        <div className="space-y-4 min-w-0">
          <div className="flex items-center gap-3">
            <Toggle checked={soComprar} onChange={setSoComprar} label="Só insumos com compra sugerida" />
            <span className="text-[13px] text-muted ml-auto tabular-nums">{grupos.reduce((s, g) => s + g.linhas.length, 0)} insumos</span>
          </div>

          {vazio && (
            <Card>
              <EmptyState icon={<ShoppingCart size={28} />} title={vazio.titulo} description={vazio.texto} />
            </Card>
          )}

          {grupos.map((g) => (
            <NecessidadeGrupo
              key={g.sup.id || 'sem'}
              g={g}
              sel={sel}
              fechado={fechados.has(g.sup.id)}
              onToggle={alternar(setSel)}
              onToggleGrupo={toggleGrupo}
              onToggleFechado={() => alternar(setFechados)(g.sup.id)}
            />
          ))}
        </div>

        <div>
          <Card title="Como calculamos">
            <dl className="grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
              {[
                ['Venda', `todo pedido confirmado nos últimos ${demanda.dias} dias, inclusive cancelado e enviado (só "ignorar" fica fora)`],
                ['Consumo/dia', 'Σ venda × ficha explodida (com perda) ÷ dias da janela'],
                ['Em trânsito', 'Σ (qtd − recebida) × fator das OCs abertas e parciais'],
                ['Cobertura', 'saldo ÷ consumo/dia'],
                ['Lead time', 'média das últimas OCs do fornecedor; sem OC, o cadastro'],
                ['Folga', '(saldo + trânsito) ÷ consumo/dia − lead time − dias de cobertura'],
                ['Comprar até', 'hoje + folga'],
                modo === 'metrica'
                  ? ['Comprar', 'máx(0, consumo/dia × (1 + margem) × 30 − saldo − trânsito)']
                  : ['Comprar', 'máx(0, consumo/dia × (1 + margem) × (lead time + cobertura) − saldo − trânsito)'],
                ['Un. de compra', 'comprar ÷ fator de conversão, arredondado para cima'],
                ['Custo estimado', 'qtd em un. de compra × fator × custo médio'],
                ['Curva ABC', 'A = 80% do valor a comprar, B = até 95%, C = restante'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium">{k}</dt>
                  <dd className="text-muted font-mono text-[12px] leading-relaxed">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-center gap-2 text-[12px] text-faint">
              <Calculator size={14} /> Preços das OCs geradas usam o custo médio atual.
            </div>
          </Card>
        </div>
      </div>

      {/* rodapé fixo */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-[248px] z-30 border-t border-border bg-surface/95 backdrop-blur px-4 py-3">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="text-sm">
            <span className="text-muted">Selecionado:</span> <strong className="tabular-nums">{brl(totalSel)}</strong>
            <span className="text-muted tabular-nums">
              {' '}
              · {selecionadas.length} {selecionadas.length === 1 ? 'insumo' : 'insumos'}
            </span>
          </div>
          <div className="sm:ml-auto flex gap-2">
            {sel.size > 0 && (
              <Button variant="ghost" onClick={() => setSel(new Set())}>
                Limpar
              </Button>
            )}
            <Button variant="primary" disabled={fornecedoresSel.size === 0} onClick={gerarOrdens}>
              <ShoppingCart size={16} />
              Gerar ordens de compra ({fornecedoresSel.size} {fornecedoresSel.size === 1 ? 'fornecedor' : 'fornecedores'})
            </Button>
          </div>
        </div>
      </div>

      {editParams && <NecessidadeParametros onClose={() => setEditParams(false)} />}
    </>
  )
}

/** Por que a lista está vazia, em vez de um "Nada a comprar" que não explica nada. */
function motivoVazio(e: { disponivel: boolean; pedidos: number; dias: number; comFicha: number; grupos: number; soComprar: boolean }): { titulo: string; texto: string } | null {
  if (e.grupos > 0) return null
  if (!e.disponivel) return { titulo: 'Demanda indisponível', texto: 'Não consegui ler a venda dos pedidos agora. Veja o aviso acima.' }
  if (e.pedidos === 0) return { titulo: `Nenhum pedido nos últimos ${e.dias} dias`, texto: 'Sem venda na janela, não há consumo para projetar. Veja se o robô de pedidos está lendo (aviso acima e Conectores).' }
  if (e.comFicha === 0) return { titulo: 'Nenhum produto vendido tem ficha técnica', texto: 'A compra de insumo vem da ficha de cada produto vendido. Veja ao lado o que ficou de fora e ative as fichas em Cadastros › Fichas técnicas.' }
  if (e.soComprar) return { titulo: 'Nada a comprar agora', texto: 'Saldo e ordens em trânsito cobrem a necessidade. Desligue "Só insumos com compra sugerida" para ver o consumo de todos.' }
  return { titulo: 'Nada a comprar', texto: 'Nenhum insumo com consumo na janela.' }
}
