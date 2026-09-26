// Linha de hoje: o plano do dia (projetado × impresso × bipado) e, ao lado, a sugestão pela média de
// vendas dos pedidos (core: sugerirPlanoDoDia). Sem plano, a sugestão aparece inteira e entra com um
// clique; com plano, a sugestão fica ao lado de cada linha e os sugeridos de fora podem ser adicionados.
// O ajuste da encarregada nunca é sobrescrito (docs/melhorias.md item 13).
import { AlertTriangle, ArrowUpToLine, Calculator, Plus, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { elevarACarteira } from '@prodio/core/projecao'
import { sugestoesDoDia } from '../../domain/demanda'
import { dataPorExtenso, diaProducao, num, pct } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Button, Card, EmptyState, Field, Progress, Select, cx } from '../../ui'
import AvisoDemanda, { BotaoAtualizarDemanda } from './AvisoDemanda'
import LinhaFechamento from './LinhaFechamento'
import LinhaProjecaoModal from './LinhaProjecaoModal'
import LinhaSugestoes from './LinhaSugestoes'
import LinhaTabela from './LinhaTabela'
import { useDemandaViva } from './useDemandaViva'

export default function LinhaDeHoje() {
  const s = useStore()
  const nav = useNavigate()
  const viva = useDemandaViva()
  const [modal, setModal] = useState(false)
  const [elevadas, setElevadas] = useState<Set<string>>(new Set())
  const [novoSku, setNovoSku] = useState('')

  const linhas = s.dailyPlan
  const totais = useMemo(
    () => ({
      projetado: linhas.reduce((a, l) => a + l.projetado, 0),
      impresso: linhas.reduce((a, l) => a + l.impresso, 0),
      bipado: linhas.reduce((a, l) => a + l.bipado, 0),
    }),
    [linhas],
  )
  const aderencia = totais.projetado > 0 ? totais.bipado / totais.projetado : 0

  const sugestoes = useMemo(
    () => sugestoesDoDia({ tenant: s.tenant, demanda: s.demanda, boms: s.boms, products: s.products, dailyPlan: linhas, labels: s.labels, scans: s.scans }),
    [s.tenant, s.demanda, s.boms, s.products, linhas, s.labels, s.scans],
  )
  const porProduto = useMemo(() => new Map(sugestoes.map((x) => [x.productId, x])), [sugestoes])

  // Carteira viva (pedidos 'carteira' da janela) quando há; senão a gravada na linha.
  const elevarCarteira = () => {
    const subiram = new Set<string>()
    for (const l of linhas) {
      const carteira = porProduto.get(l.productId)?.carteira ?? l.carteira
      const alvo = elevarACarteira(l.projetado, carteira)
      if (alvo > l.projetado) {
        s.setProjetado(l.productId, alvo)
        subiram.add(l.productId)
      }
    }
    setElevadas(subiram)
  }

  const foraDoPlano = s.products.filter((p) => p.status === 'ativo' && !linhas.some((l) => l.productId === p.id))
  const adicionarSku = () => {
    if (!novoSku) return
    s.setProjetado(novoSku, porProduto.get(novoSku)?.sugerido ?? 0)
    setNovoSku('')
  }

  const semImpressao = linhas.filter((l) => l.projetado > 0 && l.impresso === 0).length

  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Linha de hoje</h1>
          {/* O dia de produção (com a hora de virada), o mesmo do plano; só a primeira letra maiúscula. */}
          <p className="text-sm text-muted mt-1 first-letter:uppercase">{dataPorExtenso(diaProducao(s.tenant.horaVirada))}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* O Select de Local saiu: as opções vinham de mock.locations e o valor escolhido não era
              lido por nada — trocar de local não mudava um número. O plano do dia já soma os locais
              (data/leituras.ts, lerDailyPlan); filtrar por local é trabalho para quando a tela
              souber o que fazer com ele. */}
          <BotaoAtualizarDemanda {...viva} />
          <Button onClick={() => setModal(true)} disabled={linhas.length === 0}>
            <Calculator size={16} /> Definir projeção de hoje
          </Button>
          <Button onClick={elevarCarteira} disabled={linhas.length === 0}>
            <ArrowUpToLine size={16} /> Elevar à carteira
          </Button>
          <Button variant="primary" onClick={() => nav('/producao/etiquetas')}>
            <Printer size={16} /> Imprimir etiquetas
          </Button>
        </div>
      </div>

      <AvisoDemanda className="mb-4" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Projetado', v: totais.projetado },
          { label: 'Impresso', v: totais.impresso },
          { label: 'Bipado', v: totais.bipado },
        ].map((t) => (
          <div key={t.label} className="bg-surface border border-border rounded-[var(--radius-card)] p-4">
            <div className="text-[13px] text-muted">{t.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{num(t.v)}</div>
          </div>
        ))}
        <div className="bg-surface border border-border rounded-[var(--radius-card)] p-4">
          <div className="text-[13px] text-muted">Aderência</div>
          <div className={cx('mt-1 text-2xl font-semibold tabular-nums', aderencia >= 1 ? 'text-ok' : aderencia >= 0.6 ? 'text-accent-text' : 'text-warn')}>{pct(aderencia)}</div>
          <div className="mt-2">
            <Progress value={totais.bipado} max={totais.projetado} tone={aderencia >= 1 ? 'ok' : 'accent'} />
          </div>
        </div>
      </div>

      {semImpressao > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{semImpressao} SKU(s) com projeção e nenhuma etiqueta impressa. A linha só consegue bipar depois de imprimir.</span>
        </div>
      )}

      {linhas.length === 0 && <LinhaSugestoes sugestoes={sugestoes} temPlano={false} />}

      <Card padded={false}>
        {linhas.length === 0 ? (
          <EmptyState
            title="Nenhum SKU no plano de hoje"
            description={sugestoes.some((x) => !x.noPlano && x.sugerido > 0) ? 'Aplique a sugestão acima ou adicione um SKU abaixo.' : 'Adicione um SKU abaixo.'}
          />
        ) : (
          <LinhaTabela linhas={linhas} sugestao={porProduto} elevadas={elevadas} />
        )}
        <div className="flex flex-col sm:flex-row sm:items-end gap-2 px-5 py-4 border-t border-border">
          <Field label="Adicionar SKU ao plano" className="flex-1 max-w-md">
            <Select value={novoSku} onChange={(e) => setNovoSku(e.target.value)}>
              <option value="">Selecione um produto…</option>
              {foraDoPlano.map((p) => (
                <option key={p.id} value={p.id}>
                  {[p.sku, p.nome, p.atributos.cor].filter(Boolean).join(' · ')}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={adicionarSku} disabled={!novoSku}>
            <Plus size={16} /> Adicionar
          </Button>
        </div>
      </Card>

      {linhas.length > 0 && (
        <div className="mt-5">
          <LinhaSugestoes sugestoes={sugestoes} temPlano />
        </div>
      )}

      <LinhaFechamento linhas={linhas} bipado={totais.bipado} />

      {modal && <LinhaProjecaoModal linhas={linhas} sugestao={porProduto} onClose={() => setModal(false)} />}
    </>
  )
}
