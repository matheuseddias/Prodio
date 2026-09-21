import { Check, ExternalLink, Landmark, Percent, Target } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { num } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, Field } from '../../ui'
import { NumInput } from './campos'

const REGIME: Record<string, string> = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' }

export default function Parametros({ impostoPadrao, onImpostoPadrao }: { impostoPadrao: number; onImpostoPadrao: (v: number) => void }) {
  const s = useStore()
  const [margem, setMargem] = useState(Math.round(s.tenant.margemAlvoPadrao * 1000) / 10)
  const [salvo, setSalvo] = useState(false)
  const alterada = Math.abs(margem / 100 - s.tenant.margemAlvoPadrao) > 1e-6

  const salvarMargem = () => {
    s.setTenant({ ...s.tenant, margemAlvoPadrao: margem / 100 })
    setSalvo(true)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      <Card title={<span className="flex items-center gap-2"><Target size={16} className="text-accent-text" /> Margem alvo padrão</span>}>
        <p className="text-[13px] text-muted mb-3">Margem sobre o preço usada como padrão na Calculadora e como régua da Tabela de preços (abaixo dela a célula fica em alerta).</p>
        <Field label="Margem alvo (% sobre o preço)">
          <NumInput value={margem} onCommit={(v) => { setMargem(Math.min(90, v ?? 0)); setSalvo(false) }} casas={1} min={0} suffix="%" ariaLabel="Margem alvo padrão" />
        </Field>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" onClick={salvarMargem} disabled={!alterada}>
            Salvar
          </Button>
          {salvo && !alterada && (
            <Badge tone="ok">
              <Check size={12} /> salvo
            </Badge>
          )}
          {!salvo && !alterada && <span className="text-[12px] text-faint">atual: {num(s.tenant.margemAlvoPadrao * 100, 1)}%</span>}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Percent size={16} className="text-accent-text" /> Imposto sobre venda para canais novos</span>}>
        <p className="text-[13px] text-muted mb-3">Pré-preenche o campo "Imposto sobre venda" ao criar um canal. Não altera canais já cadastrados.</p>
        <Field label="Imposto padrão (% do preço)">
          <NumInput value={impostoPadrao} onCommit={(v) => onImpostoPadrao(Math.min(60, v ?? 0))} casas={2} min={0} suffix="%" ariaLabel="Imposto padrão" />
        </Field>
        <div className="mt-3 text-[12px] text-faint">Aplicado na hora. Vale só nesta sessão até existir no cadastro da empresa.</div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Landmark size={16} className="text-accent-text" /> Regime tributário</span>}>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Badge tone="info">{REGIME[s.tenant.regime] ?? s.tenant.regime}</Badge>
          <Badge>{s.tenant.creditaImpostos ? 'credita impostos de compra' : 'sem crédito de impostos'}</Badge>
        </div>
        <p className="text-[13px] text-muted">
          O regime vem das Configurações da empresa e orienta o imposto sobre venda de cada canal. No Simples, use a alíquota efetiva da sua faixa; no Presumido/Real, some PIS, COFINS e ICMS efetivos (o crédito de compra já entra no custo médio dos insumos).
        </p>
        <Link to="/configuracoes" className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-accent-text hover:underline">
          Abrir Configurações <ExternalLink size={13} />
        </Link>
      </Card>
    </div>
  )
}
