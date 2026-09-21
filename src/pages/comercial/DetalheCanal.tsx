import { ArrowDownToLine, X } from 'lucide-react'
import { useState } from 'react'
import { brl } from '../../domain/format'
import { avaliarPreco, precoParaMargem, type ResultadoPreco } from '../../domain/precificacao'
import { useStore } from '../../domain/store'
import type { Channel, Product } from '../../domain/types'
import { Button, Card, cx } from '../../ui'
import { MargemBadge, NumInput } from './campos'
import { COMPONENTES, pctBR } from './precoUtils'

function Barras({ r, titulo }: { r: ResultadoPreco; titulo: string }) {
  const base = Math.max(r.preco, 0.01)
  const itens = COMPONENTES.map((c) => ({ ...c, valor: r[c.key] })).filter((c) => c.key === 'lucro' || c.key === 'custo' || Math.abs(c.valor) >= 0.005)
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-[13px] font-medium">{titulo}</span>
        <span className="text-sm font-semibold tabular-nums">{brl(r.preco)}</span>
      </div>
      {/* Barra empilhada: cada fatia é proporcional ao preço */}
      <div className="h-3 w-full rounded-full bg-surface-2 overflow-hidden flex mb-3">
        {itens
          .filter((c) => c.valor > 0)
          .map((c) => (
            <div key={c.key} className={cx('h-full', c.cor)} style={{ width: `${Math.min(100, (c.valor / base) * 100)}%` }} title={`${c.label}: ${brl(c.valor)}`} />
          ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {itens.map((c) => {
          const p = Math.max(0, Math.min(100, (c.valor / base) * 100))
          const negativo = c.valor < 0
          return (
            <li key={c.key} className="grid grid-cols-[96px_1fr_84px_52px] items-center gap-2 text-[13px]">
              <span className={cx('flex items-center gap-1.5 truncate', c.key === 'lucro' && 'font-medium')}>
                <span className={cx('inline-block h-2.5 w-2.5 rounded-sm shrink-0', negativo ? 'bg-danger' : c.cor)} />
                {c.label}
              </span>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <div className={cx('h-full rounded-full', negativo ? 'bg-danger' : c.cor)} style={{ width: `${negativo ? Math.min(100, (-c.valor / base) * 100) : p}%` }} />
              </div>
              <span className={cx('text-right tabular-nums', negativo ? 'text-danger' : c.key === 'lucro' ? 'text-ok font-medium' : 'text-muted')}>{brl(c.valor)}</span>
              <span className="text-right tabular-nums text-[12px] text-faint">{pctBR(c.valor / base)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function DetalheCanal({
  canal,
  produto,
  custo,
  pesoKg,
  margemAlvo,
  onFechar,
}: {
  canal: Channel
  produto: Product
  custo: number
  pesoKg: number
  margemAlvo: number
  onFechar: () => void
}) {
  const s = useStore()
  const sugerido = precoParaMargem(canal, custo, pesoKg, margemAlvo)
  const praticado = produto.precoVenda?.[canal.id]
  const [simulado, setSimulado] = useState<number | undefined>(praticado ?? sugerido.preco)
  const [prevCanal, setPrevCanal] = useState(canal.id)
  if (prevCanal !== canal.id) {
    setPrevCanal(canal.id)
    setSimulado(praticado ?? sugerido.preco)
  }
  const sim = avaliarPreco(canal, simulado ?? 0, custo, pesoKg)
  const freteAtivo = canal.freteVendedor.length > 0
  const faixa = freteAtivo ? (canal.freteVendedor.find((f) => pesoKg <= f.ateKg) ?? canal.freteVendedor[canal.freteVendedor.length - 1]) : undefined

  return (
    <Card
      title={
        <span className="flex items-center gap-2 flex-wrap">
          {canal.nome}
          <span className="text-[12px] font-normal text-muted">detalhe do canal</span>
        </span>
      }
      actions={
        <button type="button" onClick={onFechar} className="text-muted hover:text-text rounded-md p-1" aria-label="Fechar detalhe">
          <X size={16} />
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Barras r={sugerido} titulo={`Preço sugerido para ${pctBR(margemAlvo)} de margem`} />
        <div className="min-w-0">
          <div className="rounded-lg border border-border bg-surface-2/50 p-4 mb-4">
            <div className="text-[13px] font-medium mb-2">Se eu vender a</div>
            <div className="flex items-center gap-3 flex-wrap">
              <NumInput value={simulado} onCommit={(v) => setSimulado(v)} prefix="R$" min={0} className="w-40" ariaLabel="Preço simulado" />
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">lucro</span>
                <span className={cx('text-lg font-semibold tabular-nums', sim.lucro < 0 ? 'text-danger' : 'text-ok')}>{brl(sim.lucro)}</span>
                <MargemBadge margem={sim.margem} alvo={margemAlvo} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => setSimulado(sugerido.preco)}>Usar sugerido</Button>
              {praticado !== undefined && (
                <Button size="sm" variant="ghost" onClick={() => setSimulado(praticado)}>Usar praticado ({brl(praticado)})</Button>
              )}
              <Button size="sm" variant="primary" onClick={() => simulado !== undefined && s.setPrecoVenda(produto.id, canal.id, simulado)} disabled={simulado === undefined || simulado === praticado}>
                <ArrowDownToLine size={14} /> Gravar como preço praticado
              </Button>
            </div>
          </div>
          <Barras r={sim} titulo="Decomposição do preço simulado" />
          <div className="mt-4 text-[12px] text-muted flex flex-col gap-1">
            {freteAtivo && faixa && (
              <span>
                Frete do vendedor: faixa até {faixa.ateKg.toLocaleString('pt-BR')} kg = {brl(faixa.valor)}
                {canal.freteGratisAcimaDe !== undefined && ` · cobrado só a partir de ${brl(canal.freteGratisAcimaDe)}`}
              </span>
            )}
            {canal.taxaFixaAbaixoDe !== undefined && canal.taxaFixa > 0 && <span>Taxa fixa de {brl(canal.taxaFixa)} só abaixo de {brl(canal.taxaFixaAbaixoDe)}.</span>}
            {canal.observacao && <span>{canal.observacao}</span>}
          </div>
        </div>
      </div>
    </Card>
  )
}
