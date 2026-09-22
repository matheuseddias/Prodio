import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import { cnpjFmt } from '../../domain/format'
import type { Tenant } from '../../domain/types'
import { Button, Card, Input, Select, Toggle } from '../../ui'
import { DOMINIO_EMAIL_XML } from '../recebimento/nfeUtils'
import { Row, SaveBar } from './ConfigShared'

export default function ConfigEmpresa() {
  const { tenant, setTenant } = useStore()
  const [f, setF] = useState<Tenant>(tenant)
  const [copiado, setCopiado] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(tenant)
  const slug = tenant.nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const email = `xml@${slug}.${DOMINIO_EMAIL_XML}`
  const copiar = () => {
    try {
      void navigator.clipboard?.writeText(email)
    } catch {
      /* ignore */
    }
    setCopiado(true)
    window.setTimeout(() => setCopiado(false), 1200)
  }
  return (
    <Card title="Empresa">
      <Row label="Nome da empresa">
        <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      </Row>
      <Row label="CNPJ" hint="Um CNPJ por conta. Filiais entram como outra empresa.">
        <Input value={cnpjFmt(f.cnpj)} onChange={(e) => setF({ ...f, cnpj: e.target.value.replace(/\D/g, '').slice(0, 14) })} inputMode="numeric" className="font-mono max-w-xs" />
      </Row>
      <Row label="Regime tributário" hint="Define se o custo do insumo entra com ou sem os impostos recuperáveis.">
        <div className="space-y-3">
          <Select value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value as Tenant['regime'] })} className="max-w-xs">
            <option value="simples">Simples Nacional</option>
            <option value="presumido">Lucro Presumido</option>
            <option value="real">Lucro Real</option>
          </Select>
          <Toggle checked={f.creditaImpostos} onChange={(v) => setF({ ...f, creditaImpostos: v })} label="Credita impostos na compra (ICMS/IPI/PIS/COFINS)" />
          <p className="text-[12px] text-muted">
            A partir de 01/2027 a CBS substitui PIS/COFINS; o Prodio usa os valores destacados no XML por tributo com vigência.
          </p>
        </div>
      </Row>
      <Row label="Margem alvo padrão (%)" hint="Usada na Precificação por canal como meta de margem líquida quando o produto não tem uma margem própria.">
        <div className="flex items-center gap-2 max-w-[160px]">
          <Input
            type="number"
            min={0}
            max={95}
            value={Math.round(f.margemAlvoPadrao * 100)}
            onChange={(e) => setF({ ...f, margemAlvoPadrao: Math.min(95, Math.max(0, Number(e.target.value))) / 100 })}
          />
          <span className="text-sm text-muted">%</span>
        </div>
      </Row>
      <Row label="E-mail de recebimento de XML" hint="Peça aos fornecedores para copiar este endereço no envio da NF-e. O XML entra direto em Recebimento.">
        <div className="flex items-center gap-2">
          <Input readOnly value={email} className="font-mono bg-surface-2" />
          <Button onClick={copiar} className="shrink-0" aria-label="Copiar e-mail">
            {copiado ? <Check size={15} className="text-ok" /> : <Copy size={15} />}
            <span className="hidden sm:inline">{copiado ? 'Copiado' : 'Copiar'}</span>
          </Button>
        </div>
      </Row>
      <SaveBar dirty={dirty} onSave={() => setTenant(f)} />
    </Card>
  )
}
