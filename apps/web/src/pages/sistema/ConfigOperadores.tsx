// Operadores do chão de fábrica (identificados por PIN).
//
// A lista é a do store (tabela `operators`) e as duas ações chamam `upsertOperator` → RPC
// `upsert_operator`, que cifra o PIN. Antes a tela mexia numa cópia de `mock.operators`: o admin
// cadastrava a operadora, saía da tela, e no celular (Pin.tsx lê store.operators) o nome não
// aparecia e o PIN não entrava.
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import type { Operator } from '../../domain/types'
import { Button, Card, EmptyState, Field, Input, Modal } from '../../ui'

function InputPin({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      value={value}
      inputMode="numeric"
      maxLength={4}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      className="max-w-[140px] text-center font-mono text-lg tracking-[0.4em]"
    />
  )
}

export default function ConfigOperadores() {
  const { operators, upsertOperator } = useStore()
  const [pinDe, setPinDe] = useState<Operator | null>(null)
  const [pin, setPin] = useState('')
  const [novoOp, setNovoOp] = useState<{ nome: string; pin: string } | null>(null)

  return (
    <>
      <Card
        title="Operadores"
        actions={
          <Button size="sm" onClick={() => setNovoOp({ nome: '', pin: '' })}>
            <Plus size={14} /> Novo operador
          </Button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">Quem bipa se identifica pelo PIN no aparelho. O PIN é só para atribuir o apontamento, não dá acesso ao painel.</p>
        {operators.length === 0 && <EmptyState title="Nenhum operador" description="Cadastre quem vai bipar na linha; o PIN é o que identifica a pessoa no aparelho." />}
        <ul className="divide-y divide-border/70">
          {operators.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-muted">{o.nome.slice(0, 2).toUpperCase()}</span>
                <span className="truncate font-medium">{o.nome}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm tracking-[0.3em] text-muted">••••</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPinDe(o)
                    setPin('')
                  }}
                >
                  Redefinir PIN
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {pinDe && (
        <Modal
          open
          onClose={() => setPinDe(null)}
          title={`Redefinir PIN de ${pinDe.nome}`}
          size="sm"
          footer={
            <>
              <Button onClick={() => setPinDe(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={pin.length !== 4}
                onClick={() => {
                  upsertOperator({ id: pinDe.id, nome: pinDe.nome, pin })
                  setPinDe(null)
                }}
              >
                Salvar PIN
              </Button>
            </>
          }
        >
          <Field label="Novo PIN (4 dígitos)">
            <InputPin value={pin} onChange={setPin} />
          </Field>
        </Modal>
      )}

      {novoOp && (
        <Modal
          open
          onClose={() => setNovoOp(null)}
          title="Novo operador"
          size="sm"
          footer={
            <>
              <Button onClick={() => setNovoOp(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={!novoOp.nome.trim() || novoOp.pin.length !== 4}
                onClick={() => {
                  upsertOperator({ nome: novoOp.nome.trim(), pin: novoOp.pin })
                  setNovoOp(null)
                }}
              >
                Criar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Nome">
              <Input value={novoOp.nome} onChange={(e) => setNovoOp({ ...novoOp, nome: e.target.value })} autoFocus />
            </Field>
            <Field label="PIN (4 dígitos)">
              <InputPin value={novoOp.pin} onChange={(pin) => setNovoOp({ ...novoOp, pin })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
