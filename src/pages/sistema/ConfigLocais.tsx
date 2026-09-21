// Locais (fábricas, terceiros, depósitos). Ainda sem locais no store: lista local.
import { Plus } from 'lucide-react'
import { useState } from 'react'
import * as mock from '../../domain/mock'
import { useStore } from '../../domain/store'
import type { Location } from '../../domain/types'
import { Badge, Button, Card, Field, Input, Modal, Select } from '../../ui'
import { LOCAL_TIPO, uid } from './ConfigConst'

export default function ConfigLocais() {
  const [locais, setLocais] = useState<Location[]>(mock.locations)
  const [edit, setEdit] = useState<Location | null>(null)
  const { devices, members } = useStore()
  return (
    <>
      <Card
        title="Locais"
        actions={
          <Button variant="primary" size="sm" onClick={() => setEdit({ id: '', nome: '', tipo: 'fabrica' })}>
            <Plus size={14} /> Adicionar local
          </Button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">Fábricas próprias, terceiros que produzem para você e depósitos. Dispositivos e usuários de produção ficam presos a um local.</p>
        <ul className="divide-y divide-border/70">
          {locais.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{l.nome}</span>
                  <Badge tone={l.tipo === 'fabrica' ? 'accent' : l.tipo === 'terceiro' ? 'info' : 'neutral'}>{LOCAL_TIPO[l.tipo]}</Badge>
                </div>
                <div className="text-[12px] text-muted">
                  {devices.filter((d) => d.localId === l.id).length} dispositivos · {members.filter((m) => m.localId === l.id).length} usuários
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEdit(l)}>
                Editar
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? 'Editar local' : 'Novo local'}
          size="sm"
          footer={
            <>
              <Button onClick={() => setEdit(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={!edit.nome.trim()}
                onClick={() => {
                  const item = { ...edit, id: edit.id || uid() }
                  setLocais((ls) => (ls.some((x) => x.id === item.id) ? ls.map((x) => (x.id === item.id ? item : x)) : [...ls, item]))
                  setEdit(null)
                }}
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Nome">
              <Input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} autoFocus />
            </Field>
            <Field label="Tipo">
              <Select value={edit.tipo} onChange={(e) => setEdit({ ...edit, tipo: e.target.value as Location['tipo'] })}>
                <option value="fabrica">Fábrica</option>
                <option value="terceiro">Terceiro</option>
                <option value="deposito">Depósito</option>
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </>
  )
}
