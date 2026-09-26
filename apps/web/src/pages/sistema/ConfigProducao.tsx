import { Tags } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import type { Tenant } from '../../domain/types'
import { Button, Card, Input, Toggle } from '../../ui'
import { Row, SaveBar } from './ConfigShared'

// Os perfis de etiqueta por família saíram daqui para a aba Etiquetas (com os tamanhos). Esta aba grava só os
// parâmetros de produção: família nova sem prefixo não trava mais o Salvar da hora de virada.
export default function ConfigProducao({ onEtiquetas }: { onEtiquetas?: () => void }) {
  const { tenant, setTenant } = useStore()
  const [f, setF] = useState<Tenant>(tenant)
  const semPerfis = (t: Tenant) => JSON.stringify({ ...t, perfisEtiqueta: [] })
  const dirty = semPerfis(f) !== semPerfis(tenant)

  return (
    <Card title="Produção">
      <Row label="Hora de virada do dia" hint="Bipes antes desta hora contam no dia anterior (turno da madrugada).">
        <Input type="time" value={f.horaVirada} onChange={(e) => setF({ ...f, horaVirada: e.target.value })} className="max-w-[160px]" />
      </Row>
      <Row label="Média de vendas (dias)" hint="Janela dos pedidos que entram na demanda da Linha de hoje e da Necessidade de compra (1 a 90 dias). Todo pedido confirmado conta, inclusive cancelado e enviado.">
        <Input type="number" min={1} max={90} value={f.diasDemanda ?? 14} onChange={(e) => setF({ ...f, diasDemanda: Number(e.target.value) })} className="max-w-[160px]" />
      </Row>
      <Row label="Dias úteis no mês" hint="Converte a venda do mês em demanda por dia de produção.">
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
      <Row label="Cobertura do acabado no hub (dias)" hint="Com o saldo do hub conhecido (conferência noturna), a sugestão da Linha de hoje repõe o produto acabado até esta quantidade de dias de venda. Sem saldo, a meta é a venda de um dia.">
        <Input type="number" min={0} max={60} value={f.diasCoberturaAcabado ?? 3} onChange={(e) => setF({ ...f, diasCoberturaAcabado: Number(e.target.value) })} className="max-w-[160px]" />
      </Row>
      <Row label="Exigir projeção do dia para imprimir etiquetas" hint="Evita imprimir sem a encarregada ter confirmado a meta na Linha de hoje.">
        <Toggle
          checked={f.exigirProjecaoParaImprimir}
          onChange={(v) => setF({ ...f, exigirProjecaoParaImprimir: v })}
          label={f.exigirProjecaoParaImprimir ? 'Exigido' : 'Livre'}
        />
      </Row>
      <Row label="Etiquetas por família" hint="Prefixo do serial, etiquetas geradas por peça e o tamanho de cada família.">
        <Button size="sm" onClick={onEtiquetas}>
          <Tags size={14} /> Abrir perfis e tamanhos de etiqueta
        </Button>
      </Row>
      <SaveBar dirty={dirty} onSave={() => setTenant({ ...f, perfisEtiqueta: tenant.perfisEtiqueta })} />
    </Card>
  )
}
