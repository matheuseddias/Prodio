// Plano e cobrança.
//
// Não existe faturamento no Prodio: nenhuma tabela, nenhuma rota, nenhum provedor de pagamento. O
// cartão "Faturas" mostrava quatro notas de R$ 349 geradas no navegador a partir da data de hoje,
// três com a badge verde "paga" — histórico financeiro fabricado apresentado como fato. Enquanto a
// cobrança não existir, esta aba informa o plano e diz o resto em texto, sem botão que não faz nada.
import { Check } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import { brl, num } from '../../domain/format'
import { Badge, Button, Card, EmptyState, Modal, Stat, cx } from '../../ui'

const INCLUSOS = ['Bipadores e dispositivos ilimitados', 'Todos os conectores inclusos', 'Etiquetas e apontamentos sem limite', 'Recebimento de NF-e por e-mail e XML', 'Suporte por WhatsApp em horário comercial']
const PLANOS = [
  { nome: 'Fábrica', preco: 349, d: '1 CNPJ, tudo incluso.', atual: true },
  { nome: 'Grupo', preco: 899, d: 'Até 4 CNPJs, consolidação de compras entre empresas.', atual: false },
]

export default function ConfigPlano() {
  const { labels, connectors, devices } = useStore()
  const [alterar, setAlterar] = useState(false)
  const conectados = connectors.filter((c) => c.status === 'conectado').length
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
              Ver planos
            </Button>
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3 content-start">
          <Stat label="Etiquetas impressas no mês" value={num(labels.length)} />
          <Stat label="Conectores ativos" value={conectados} hint={`de ${connectors.length} disponíveis`} />
          <Stat label="Dispositivos" value={devices.length} hint="ilimitados" />
        </div>
      </div>

      <Card title="Faturas">
        <EmptyState title="Nenhuma fatura" description="A cobrança começa quando o período de testes terminar. Até lá não há fatura, recibo nem forma de pagamento cadastrada aqui." />
      </Card>

      <Modal open={alterar} onClose={() => setAlterar(false)} title="Planos" footer={<Button onClick={() => setAlterar(false)}>Fechar</Button>}>
        <p className="mb-3 text-[13px] text-muted">A troca de plano é feita com o time do Prodio: não há contratação automática por aqui.</p>
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
              {p.atual && (
                <Button size="sm" className="mt-3 w-full" disabled variant="secondary">
                  Plano atual
                </Button>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
