import { Save, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, num } from '../../domain/format'
import { custoFicha, useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, Field, SearchInput, cx } from '../../ui'
import DetalheCanal from './DetalheCanal'
import TabelaCanais from './TabelaCanais'
import { NumInput } from './campos'
import { labelProduto } from './precoUtils'

export default function Calculadora({ onIrParaCanais }: { onIrParaCanais: () => void }) {
  const s = useStore()
  const [busca, setBusca] = useState('')
  const [productId, setProductId] = useState(() => s.products.find((p) => p.status === 'ativo' && p.temFicha)?.id ?? s.products[0]?.id ?? '')
  const [custoManual, setCustoManual] = useState<number | undefined>(undefined)
  const [pesos, setPesos] = useState<{ real?: number; cubado?: number } | null>(null)
  const [margemAlvoPct, setMargemAlvoPct] = useState(Math.round(s.tenant.margemAlvoPadrao * 1000) / 10)
  const [canalDetalhe, setCanalDetalhe] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)

  const produto = s.products.find((p) => p.id === productId)
  const bomAtiva = s.boms.find((b) => b.productId === productId && b.ativa)
  const custoVivo = useMemo(() => (productId ? custoFicha(productId, s.boms, s.materials) : undefined), [productId, s.boms, s.materials])
  const custoBase = custoVivo ?? produto?.custoFicha
  const custo = custoManual ?? custoBase ?? 0
  const origemCusto: 'ficha' | 'cadastro' | 'manual' | 'nenhum' = custoManual !== undefined ? 'manual' : custoVivo !== undefined ? 'ficha' : custoBase !== undefined ? 'cadastro' : 'nenhum'

  const pesoReal = pesos ? pesos.real : produto?.pesoKg
  const pesoCubado = pesos ? pesos.cubado : produto?.pesoCubadoKg
  const pesoFat = Math.max(pesoReal ?? 0, pesoCubado ?? 0)
  const margemAlvo = margemAlvoPct / 100

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return s.products
      .filter((p) => p.status === 'ativo')
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.nome.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q)) || (p.atributos.cor ?? '').toLowerCase().includes(q))
      .map((p) => ({ p, custo: custoFicha(p.id, s.boms, s.materials) ?? p.custoFicha }))
  }, [busca, s.products, s.boms, s.materials])

  const selecionar = (id: string) => {
    setProductId(id)
    setCustoManual(undefined)
    setPesos(null)
    setCanalDetalhe(null)
    setSalvo(false)
  }

  const salvarNoProduto = () => {
    if (!produto) return
    s.upsertProduct({ ...produto, custoFicha: Math.round(custo * 100) / 100, pesoKg: pesoReal, pesoCubadoKg: pesoCubado })
    setCustoManual(undefined)
    setPesos(null)
    setSalvo(true)
  }

  const canaisAtivos = s.channels.filter((c) => c.ativo)
  const canalSel = canaisAtivos.find((c) => c.id === canalDetalhe) ?? null

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 items-start">
      <div className="flex flex-col gap-5 min-w-0">
        <Card title="Produto" padded={false}>
          <div className="px-5 pb-3">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por SKU ou nome…" />
          </div>
          <div className="max-h-[320px] overflow-y-auto border-t border-border">
            {lista.length === 0 ? (
              <EmptyState title="Nenhum produto encontrado" />
            ) : (
              lista.map(({ p, custo: c }) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selecionar(p.id)}
                  className={cx(
                    'w-full flex items-center justify-between gap-3 px-5 py-2.5 text-left border-b border-border/60 last:border-b-0 hover:bg-surface-2/70 transition-colors',
                    p.id === productId && 'bg-accent-soft/50',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{labelProduto(p)}</span>
                    <span className="block text-[12px] text-muted font-mono">{p.sku}</span>
                  </span>
                  <span className="text-right shrink-0">
                    {c !== undefined ? (
                      <span className="block text-sm tabular-nums">{brl(c)}</span>
                    ) : (
                      <Badge tone="warn">sem ficha</Badge>
                    )}
                    <span className="block text-[11px] text-faint">{p.temFicha ? 'custo da ficha' : 'cadastre a ficha'}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card
          title="Parâmetros do cálculo"
          actions={<Settings2 size={16} className="text-faint" />}
        >
          {!produto ? (
            <EmptyState title="Selecione um produto" />
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Custo unitário" hint={origemCusto === 'nenhum' ? 'Sem ficha técnica ativa: informe o custo manualmente.' : 'Editável. Custo da ficha = insumos explodidos × custo médio.'}>
                <div className="flex items-center gap-2">
                  <NumInput value={custo} onCommit={(v) => setCustoManual(v ?? 0)} prefix="R$" min={0} className="flex-1" ariaLabel="Custo unitário" />
                  {origemCusto === 'ficha' && <Badge tone="ok">pela ficha v{bomAtiva?.versao ?? 1}</Badge>}
                  {origemCusto === 'cadastro' && <Badge tone="info">do cadastro</Badge>}
                  {origemCusto === 'manual' && <Badge tone="warn">manual</Badge>}
                  {origemCusto === 'nenhum' && <Badge tone="danger">sem custo</Badge>}
                </div>
                {origemCusto === 'manual' && custoBase !== undefined && (
                  <button type="button" className="mt-1 text-[12px] text-accent-text hover:underline" onClick={() => setCustoManual(undefined)}>
                    Voltar ao custo da ficha ({brl(custoBase)})
                  </button>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Peso real (kg)">
                  <NumInput value={pesoReal} onCommit={(v) => setPesos({ real: v, cubado: pesoCubado })} casas={3} min={0} allowEmpty placeholder="0,000" ariaLabel="Peso real" />
                </Field>
                <Field label="Peso cubado (kg)">
                  <NumInput value={pesoCubado} onCommit={(v) => setPesos({ real: pesoReal, cubado: v })} casas={3} min={0} allowEmpty placeholder="0,000" ariaLabel="Peso cubado" />
                </Field>
              </div>
              <div className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] flex items-center justify-between">
                <span className="text-muted">Peso faturável (maior dos dois)</span>
                <span className="font-medium tabular-nums">{num(pesoFat, 3)} kg</span>
              </div>
              <Field label="Margem alvo (% sobre o preço)" hint={`Padrão da empresa: ${num(s.tenant.margemAlvoPadrao * 100, 1)}%. Ajuste em Parâmetros.`}>
                <NumInput value={margemAlvoPct} onCommit={(v) => setMargemAlvoPct(Math.min(90, v ?? 0))} casas={1} min={0} suffix="%" ariaLabel="Margem alvo" />
              </Field>
              <Button onClick={salvarNoProduto} disabled={custoManual === undefined && pesos === null}>
                <Save size={16} /> Salvar custo e pesos no produto
              </Button>
              {salvo && <div className="text-[12px] text-ok -mt-2">Produto atualizado.</div>}
            </div>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-5 min-w-0">
        {!produto ? (
          <Card>
            <EmptyState title="Selecione um produto" description="Escolha um produto à esquerda para ver o preço por canal." />
          </Card>
        ) : canaisAtivos.length === 0 ? (
          <Card>
            <EmptyState
              title="Nenhum canal ativo"
              description="Cadastre ou ative um canal de venda para calcular preços."
              action={<Button variant="primary" onClick={onIrParaCanais}>Configurar canais</Button>}
            />
          </Card>
        ) : (
          <>
            <TabelaCanais
              produto={produto}
              canais={canaisAtivos}
              custo={custo}
              pesoKg={pesoFat}
              margemAlvo={margemAlvo}
              selecionado={canalDetalhe}
              onSelecionar={(id) => setCanalDetalhe((cur) => (cur === id ? null : id))}
            />
            {canalSel && (
              <DetalheCanal canal={canalSel} produto={produto} custo={custo} pesoKg={pesoFat} margemAlvo={margemAlvo} onFechar={() => setCanalDetalhe(null)} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
