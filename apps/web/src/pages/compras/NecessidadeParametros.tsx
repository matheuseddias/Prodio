// Parâmetros da Necessidade de compra. São da empresa (tenants): valem também na Linha de hoje e em
// Configurações › Produção. A janela da média de vendas muda a demanda que o banco soma.
import { JANELA_MAX_DIAS, janelaDaDemanda } from '@prodio/core/planejamento'
import { useState, type ChangeEvent } from 'react'
import { useStore } from '../../domain/store'
import { Button, Field, Input, Modal } from '../../ui'

export default function NecessidadeParametros({ onClose }: { onClose: () => void }) {
  const { tenant, setTenant } = useStore()
  const [f, setF] = useState({
    dias: String(tenant.diasDemanda ?? 14),
    margemPct: String(Math.round(tenant.margemProjecao * 100)),
    diasCobertura: String(tenant.diasCobertura),
    diasUteis: String(tenant.diasUteisMes),
  })
  const n = (v: string) => Number(v.replace(',', '.'))
  const invalido = !(n(f.dias) >= 1 && n(f.dias) <= JANELA_MAX_DIAS) || !(n(f.margemPct) >= 0) || !(n(f.diasCobertura) >= 0) || !(n(f.diasUteis) >= 1 && n(f.diasUteis) <= 31)
  const aplicar = () => {
    setTenant({ ...tenant, diasDemanda: janelaDaDemanda(n(f.dias)), margemProjecao: n(f.margemPct) / 100, diasCobertura: Math.round(n(f.diasCobertura)), diasUteisMes: Math.round(n(f.diasUteis)) })
    onClose()
  }
  const campo = (k: keyof typeof f) => ({ inputMode: 'decimal' as const, value: f[k], onChange: (e: ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value })) })
  return (
    <Modal
      open
      onClose={onClose}
      title="Parâmetros do cálculo"
      size="sm"
      footer={
        <Button variant="primary" onClick={aplicar} disabled={invalido}>
          Aplicar e salvar
        </Button>
      }
    >
      <p className="mb-3 text-[13px] text-muted">
        São da empresa: ao aplicar, ficam salvos e valem também na Linha de hoje e em Configurações › Produção.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Média de vendas (dias)" hint={`Pedidos confirmados nos últimos N dias (1 a ${JANELA_MAX_DIAS}), inclusive cancelados e enviados.`}>
          <Input {...campo('dias')} />
        </Field>
        <Field label="Margem (%)" hint="Folga sobre a média">
          <Input {...campo('margemPct')} />
        </Field>
        <Field label="Dias de cobertura" hint="Segurança além do lead time">
          <Input {...campo('diasCobertura')} />
        </Field>
        <Field label="Dias úteis no mês" hint="Converte a venda do mês em demanda por dia de produção">
          <Input {...campo('diasUteis')} />
        </Field>
      </div>
    </Modal>
  )
}
