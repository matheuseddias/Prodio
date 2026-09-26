// "Fechamento do dia" da Linha de hoje: os insumos mais consumidos pelo que já foi bipado (a baixa é
// automática a cada bipe, pela ficha de cada SKU).
import { Tag } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { num } from '../../domain/format'
import { explodeBom, useLookups, useStore } from '../../domain/store'
import type { DailyPlanLine } from '../../domain/types'
import { Button, Card, EmptyState, cx } from '../../ui'

export default function LinhaFechamento({ linhas, bipado }: { linhas: DailyPlanLine[]; bipado: number }) {
  const { boms } = useStore()
  const { material } = useLookups()
  const nav = useNavigate()

  const consumoHoje = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const l of linhas) {
      if (l.bipado <= 0) continue
      const exp = explodeBom(l.productId, l.bipado, boms)
      for (const [mid, q] of Object.entries(exp)) acc[mid] = (acc[mid] ?? 0) + q
    }
    return Object.entries(acc)
      .map(([mid, q]) => ({ m: material(mid), q }))
      .filter((x) => x.m)
      .sort((a, b) => b.q * b.m!.custoMedio - a.q * a.m!.custoMedio)
      .slice(0, 5)
  }, [linhas, boms, material])

  return (
    <Card className="mt-5" title="Fechamento do dia">
      <p className="text-sm text-muted mb-4">
        Não existe "fechar o dia" manual: a baixa de insumos é automática a cada bipe, pela ficha técnica de cada SKU. Abaixo, os insumos mais consumidos hoje a partir do que já foi bipado ({num(bipado)} un).
      </p>
      {consumoHoje.length === 0 ? (
        <EmptyState title="Nada bipado ainda" description="Os consumos aparecem aqui conforme a linha bipa." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {consumoHoje.map(({ m, q }) => (
            <div key={m!.id} className="rounded-lg border border-border bg-surface-2/50 p-3 min-w-0">
              <div className="text-[12px] text-muted font-mono">{m!.sku}</div>
              <div className="text-sm font-medium truncate" title={m!.nome}>
                {m!.nome}
              </div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {num(q, q < 10 ? 2 : 0)} <span className="text-[12px] text-muted font-normal">{m!.unidadeConsumo}</span>
              </div>
              <div className={cx('text-[12px] tabular-nums', m!.saldo - q < m!.minimo ? 'text-danger' : 'text-muted')}>
                saldo {num(m!.saldo, 1)} · mín {num(m!.minimo)}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3">
        <Button variant="ghost" size="sm" onClick={() => nav('/estoque')}>
          <Tag size={14} /> Ver estoque de insumos
        </Button>
      </div>
    </Card>
  )
}
