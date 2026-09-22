import { Mail, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import { relativo } from '../../domain/format'
import type { Location, Member } from '../../domain/types'
import { Badge, Button, Card, Field, Input, Modal, Select, Table, Td, Th } from '../../ui'
import { PAPEL_DESC, PAPEL_LABEL, PAPEL_TONE, uid } from './ConfigConst'

function SelectPapel({ value, onChange }: { value: Member['papel']; onChange: (p: Member['papel']) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as Member['papel'])}>
      {(Object.keys(PAPEL_LABEL) as Member['papel'][]).map((p) => (
        <option key={p} value={p}>
          {PAPEL_LABEL[p]}
        </option>
      ))}
    </Select>
  )
}

// Os locais vêm do store (tabela `locations`): com a lista de exemplo, o id escolhido ('l1') não
// era uuid e o insert em memberships.location_id quebrava — e a coluna Local da tabela mostrava o
// nome errado para quem tinha local de verdade.
function SelectLocal({ value, onChange, locais }: { value: string; onChange: (id: string) => void; locais: Location[] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todos os locais</option>
      {locais.map((l) => (
        <option key={l.id} value={l.id}>
          {l.nome}
        </option>
      ))}
    </Select>
  )
}

/** Não existe envio de convite: `upsertMember` recusa id que não é uuid (data/escritasSistema.ts). */
const SEM_CONVITE = 'O convite por e-mail ainda não existe. A pessoa precisa entrar uma vez no Prodio com a conta dela; aí ela aparece nesta lista e você define papel e local.'

export default function ConfigUsuarios() {
  const { members, locations, modo, upsertMember, removeMember } = useStore()
  const [convite, setConvite] = useState(false)
  const [editando, setEditando] = useState<Member | null>(null)
  const [removendo, setRemovendo] = useState<Member | null>(null)
  const [form, setForm] = useState<{ email: string; papel: Member['papel']; localId: string }>({ email: '', papel: 'producao', localId: '' })
  const local = (id?: string) => locations.find((l) => l.id === id)?.nome

  const convidar = () => {
    upsertMember({ id: uid(), nome: form.email.split('@')[0], email: form.email, papel: form.papel, localId: form.localId || undefined })
    setConvite(false)
    setForm({ email: '', papel: 'producao', localId: '' })
  }

  return (
    <div className="space-y-5">
      <Card
        title="Usuários"
        actions={
          <span title={modo === 'supabase' ? SEM_CONVITE : undefined} className="inline-flex">
            <Button variant="primary" size="sm" disabled={modo === 'supabase'} onClick={() => setConvite(true)}>
              <UserPlus size={14} /> Convidar por e-mail
            </Button>
          </span>
        }
      >
        {modo === 'supabase' && <p className="mb-3 text-[13px] text-muted">{SEM_CONVITE}</p>}
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th>Papel</Th>
              <Th>Local</Th>
              <Th>Último acesso</Th>
              <Th right />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium">{m.nome}</Td>
                <Td className="text-muted">{m.email ?? '—'}</Td>
                <Td>
                  <Badge tone={PAPEL_TONE[m.papel]}>{PAPEL_LABEL[m.papel]}</Badge>
                </Td>
                <Td className="text-muted">{local(m.localId) ?? 'Todos'}</Td>
                <Td className="text-muted whitespace-nowrap">{m.ultimoAcesso ? relativo(m.ultimoAcesso) : 'Convite pendente'}</Td>
                <Td right>
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditando(m)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemovendo(m)} aria-label="Remover">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Papéis">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PAPEL_DESC) as Member['papel'][]).map((p) => (
            <div key={p} className="rounded-lg border border-border p-3">
              <Badge tone={PAPEL_TONE[p]}>{PAPEL_LABEL[p]}</Badge>
              <p className="mt-2 text-[13px] text-muted">{PAPEL_DESC[p]}</p>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={convite}
        onClose={() => setConvite(false)}
        title="Convidar por e-mail"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConvite(false)}>Cancelar</Button>
            <Button variant="primary" disabled={!/.+@.+\..+/.test(form.email)} onClick={convidar}>
              <Mail size={15} /> Enviar convite
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@empresa.com.br" autoFocus />
          </Field>
          <Field label="Papel" hint={PAPEL_DESC[form.papel]}>
            <SelectPapel value={form.papel} onChange={(papel) => setForm({ ...form, papel })} />
          </Field>
          <Field label="Local" hint="Restringe o que a pessoa vê à unidade escolhida.">
            <SelectLocal value={form.localId} onChange={(localId) => setForm({ ...form, localId })} locais={locations} />
          </Field>
        </div>
      </Modal>

      {editando && (
        <Modal
          open
          onClose={() => setEditando(null)}
          title={`Editar ${editando.nome}`}
          size="sm"
          footer={
            <>
              <Button onClick={() => setEditando(null)}>Cancelar</Button>
              <Button
                variant="primary"
                onClick={() => {
                  upsertMember(editando)
                  setEditando(null)
                }}
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Papel" hint={PAPEL_DESC[editando.papel]}>
              <SelectPapel value={editando.papel} onChange={(papel) => setEditando({ ...editando, papel })} />
            </Field>
            <Field label="Local">
              <SelectLocal value={editando.localId ?? ''} onChange={(localId) => setEditando({ ...editando, localId: localId || undefined })} locais={locations} />
            </Field>
          </div>
        </Modal>
      )}

      {removendo && (
        <Modal
          open
          onClose={() => setRemovendo(null)}
          title="Remover usuário"
          size="sm"
          footer={
            <>
              <Button onClick={() => setRemovendo(null)}>Cancelar</Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeMember(removendo.id)
                  setRemovendo(null)
                }}
              >
                Remover
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{removendo.nome}</strong> perde o acesso imediatamente. Os apontamentos e ações registrados por essa pessoa continuam no histórico.
          </p>
        </Modal>
      )}
    </div>
  )
}
