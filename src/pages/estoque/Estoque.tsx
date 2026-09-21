import { AlertTriangle, Boxes, Coins, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import { PageHeader, Stat, Tabs } from '../../ui'
import EstoqueExtrato from './EstoqueExtrato'
import EstoqueInventario from './EstoqueInventario'
import EstoqueMovimentacoes from './EstoqueMovimentacoes'
import EstoqueSaldos from './EstoqueSaldos'
import { consumoDiario, mesmoDia, useLinhasSaldo } from './estoqueShared'

type Aba = 'saldos' | 'movimentos' | 'inventario'

export default function Estoque() {
  const { materials, stockMoves, addStockMove } = useStore()
  const [aba, setAba] = useState<Aba>('saldos')
  const [aberto, setAberto] = useState<string | null>(null)

  const linhas = useLinhasSaldo(materials, stockMoves)

  const stats = useMemo(() => {
    const abaixo = linhas.filter((l) => l.estado === 'critico').length
    const valor = linhas.reduce((s, l) => s + l.valor, 0)
    const hoje = stockMoves.filter((mv) => mesmoDia(mv.em)).length
    return { total: materials.length, abaixo, valor, hoje }
  }, [linhas, materials.length, stockMoves])

  const materialAberto = aberto ? materials.find((m) => m.id === aberto) : undefined

  return (
    <>
      <PageHeader title="Estoque de insumos" subtitle="Saldos em unidade de consumo, cobertura, movimentações e conferência de cada insumo." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Insumos cadastrados" value={num(stats.total)} icon={<Boxes size={16} />} />
        <Stat label="Abaixo do mínimo" value={num(stats.abaixo)} tone={stats.abaixo > 0 ? 'danger' : 'ok'} icon={<AlertTriangle size={16} />} hint={stats.abaixo > 0 ? 'precisam de reposição' : 'tudo coberto'} />
        <Stat label="Valor em estoque" value={brl(stats.valor)} hint="Σ saldo × custo médio" icon={<Coins size={16} />} />
        <Stat label="Movimentos hoje" value={num(stats.hoje)} icon={<History size={16} />} />
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'saldos', label: 'Saldos', count: materials.length },
          { id: 'movimentos', label: 'Movimentações', count: stockMoves.length },
          { id: 'inventario', label: 'Inventário' },
        ]}
      />

      {aba === 'saldos' && <EstoqueSaldos linhas={linhas} onAbrir={setAberto} />}
      {aba === 'movimentos' && <EstoqueMovimentacoes moves={stockMoves} onAbrir={setAberto} />}
      {aba === 'inventario' && <EstoqueInventario />}

      {materialAberto && (
        <EstoqueExtrato
          material={materialAberto}
          moves={stockMoves.filter((mv) => mv.materialId === materialAberto.id)}
          consumo={consumoDiario(materialAberto.id, stockMoves)}
          onClose={() => setAberto(null)}
          addStockMove={addStockMove}
        />
      )}
    </>
  )
}
