import { Check, CreditCard } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore } from '../../domain/store'
import { brl, dataBR, num } from '../../domain/format'
import { Badge, Button, Card, Modal, Stat, Table, Td, Th, cx } from '../../ui'

const INCLUSOS = ['Bipadores e dispositivos ilimitados', 'Todos os conectores inclusos', 'Etiquetas e apontamentos sem limite', 'Recebimento de NF-e por e-mail e XML', 'Suporte por WhatsApp em horário comercial']
const PLANOS = [
  { nome: 'Fábrica', preco: 349, d: '1 CNPJ, tudo incluso.', atual: true },
  { nome: 'Grupo', preco: 899, d: 'Até 4 CNPJs, consolidação de compras entre empresas.', atual: false },
]

export default function ConfigPlano() {
  const { labels, connectors, devices } = useStore()
  const [alterar, setAlterar] = useState(false)
  const conectados = connectors.filter((c) => c.status === 'conectado').length
  const faturas = useMemo(() => {
    const out: { id: string; competencia: string; valor: number; status: 'paga' | 'aberta' }[] = []
    for (let i = 0; i < 4; i++) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      out.push({ id: `F${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`, competencia: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), valor: 349, status: i === 0 ? 'aberta' : 'paga' })
    }
    return out
  }, [])
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] uppercase tracking-wide text-muted">Plano atual</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">Fábrica</div>
              <div className="mt-1 text-sm text-muted">
                <span className="text-lg font-semibold text-text">{brl(349)}</span> /mês por CNPJ
              </div>
            </div>
            <Badge tone="ok">Ativo</Badge>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {INCLUSOS.map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check size={15} className="text-ok shrink-0" /> {t}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setAlterar(true)}>
              Alterar plano
            </Button>
            <Button>
              <CreditCard size={15} /> Forma de pagamento
            </Button>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 content-start">
          <Stat label="Etiquetas impressas no mês" value={num(labels.length)} />
          <Stat label="Conectores ativos" value={conectados} hint={`de ${connectors.length} disponíveis`} />
          <Stat label="Dispositivos" value={devices.length} hint="ilimitados" />
          <Stat label="Próxima cobrança" value={dataBR(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 5).toISOString())} />
        </div>
      </div>

      <Card title="Faturas">
        <Table>
          <thead>
            <tr>
              <Th>Nº</Th>
              <Th>Competência</Th>
              <Th right>Valor</Th>
              <Th>Status</Th>
              <Th right />
            </tr>
          </thead>
          <tbody>
            {faturas.map((f) => (
              <tr key={f.id}>
                <Td mono>{f.id}</Td>
                <Td className="capitalize">{f.competencia}</Td>
                <Td right>{brl(f.valor)}</Td>
                <Td>{f.status === 'paga' ? <Badge tone="ok">paga</Badge> : <Badge tone="warn">em aberto</Badge>}</Td>
                <Td right>
                  <Button size="sm" variant="ghost">
                    {f.status === 'paga' ? 'Recibo' : 'Pagar'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Modal open={alterar} onClose={() => setAlterar(false)} title="Alterar plano" footer={<Button onClick={() => setAlterar(false)}>Fechar</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {PLANOS.map((p) => (
            <div key={p.nome} className={cx('rounded-lg border p-4', p.atual ? 'border-accent bg-accent-soft/30' : 'border-border')}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{p.nome}</div>
                {p.atual && <Badge tone="accent">atual</Badge>}
              </div>
              <div className="mt-1 text-lg font-semibold">
                {brl(p.preco)} <span className="text-sm font-normal text-muted">/mês</span>
              </div>
              <p className="mt-1 text-[13px] text-muted">{p.d}</p>
              <Button size="sm" className="mt-3 w-full" disabled={p.atual} variant={p.atual ? 'secondary' : 'primary'}>
                {p.atual ? 'Plano atual' : 'Falar com o time'}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
