import { useMemo, useState } from 'react'
import { useStore } from '../../domain/store'
import type { Tenant } from '../../domain/types'
import { Card, Input, Select, Toggle } from '../../ui'
import PerfisEtiquetaEditor from './ConfigEtiquetas'
import { mesclarPerfis, perfilInvalido } from './ConfigPerfis'
import { Row, SaveBar } from './ConfigShared'

export default function ConfigProducao() {
  const { tenant, setTenant, products } = useStore()
  const familias = useMemo(() => Array.from(new Set(products.map((p) => p.familia))), [products])
  // Base de comparação: o tenant com um perfil para cada família que ainda não tem.
  const base = useMemo<Tenant>(() => ({ ...tenant, perfisEtiqueta: mesclarPerfis(tenant.perfisEtiqueta, familias) }), [tenant, familias])
  const [f, setF] = useState<Tenant>(base)
  // Estado local: sem campo correspondente no Tenant
  const [tamanho, setTamanho] = useState('50x30')
  const [localDirty, setLocalDirty] = useState(false)
  const dirty = localDirty || JSON.stringify(f) !== JSON.stringify(base)
  const invalidos = f.perfisEtiqueta.filter(perfilInvalido).length

  return (
    <Card title="Produção">
      <Row label="Hora de virada do dia" hint="Bipes antes desta hora contam no dia anterior (turno da madrugada).">
        <Input type="time" value={f.horaVirada} onChange={(e) => setF({ ...f, horaVirada: e.target.value })} className="max-w-[160px]" />
      </Row>
      <Row label="Dias úteis no mês" hint="Usado para converter a venda mensal em demanda diária.">
        <Input type="number" min={1} max={31} value={f.diasUteisMes} onChange={(e) => setF({ ...f, diasUteisMes: Number(e.target.value) })} className="max-w-[160px]" />
      </Row>
      <Row label="Margem de projeção" hint="Percentual acima da média de vendas sugerido na Linha de hoje.">
        <div className="flex items-center gap-2 max-w-[160px]">
          <Input type="number" min={0} max={100} value={Math.round(f.margemProjecao * 100)} onChange={(e) => setF({ ...f, margemProjecao: Number(e.target.value) / 100 })} />
          <span className="text-sm text-muted">%</span>
        </div>
      </Row>
      <Row label="Dias de cobertura" hint="Quantos dias de venda o estoque de insumos deve cobrir para sugerir compra.">
        <Input type="number" min={1} value={f.diasCobertura} onChange={(e) => setF({ ...f, diasCobertura: Number(e.target.value) })} className="max-w-[160px]" />
      </Row>
      <Row label="Exigir projeção do dia para imprimir etiquetas" hint="Evita imprimir sem a encarregada ter confirmado a meta na Linha de hoje.">
        <Toggle
          checked={f.exigirProjecaoParaImprimir}
          onChange={(v) => setF({ ...f, exigirProjecaoParaImprimir: v })}
          label={f.exigirProjecaoParaImprimir ? 'Exigido' : 'Livre'}
        />
      </Row>
      <Row label="Tamanho de etiqueta padrão" hint="Em mm, conforme a impressora térmica.">
        <Select
          value={tamanho}
          onChange={(e) => {
            setTamanho(e.target.value)
            setLocalDirty(true)
          }}
          className="max-w-xs"
        >
          <option value="50x30">50 × 30 mm</option>
          <option value="60x40">60 × 40 mm</option>
          <option value="100x50">100 × 50 mm</option>
          <option value="100x150">100 × 150 mm</option>
        </Select>
      </Row>
      <Row label="Etiquetas por família" hint="O serial começa com o prefixo da família. Cada família define quais etiquetas saem por peça; a de Produto é sempre gerada.">
        <PerfisEtiquetaEditor value={f.perfisEtiqueta} onChange={(perfisEtiqueta) => setF({ ...f, perfisEtiqueta })} />
      </Row>
      <SaveBar
        dirty={dirty && invalidos === 0}
        aviso={invalidos > 0 ? `${invalidos} ${invalidos === 1 ? 'família com perfil inválido' : 'famílias com perfil inválido'}` : undefined}
        onSave={() => {
          setTenant(f)
          setLocalDirty(false)
        }}
      />
    </Card>
  )
}
