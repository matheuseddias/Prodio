// Locais (fábricas, terceiros, depósitos).
//
// A lista é a do store (tabela `locations`) e o Salvar grava de verdade — antes era uma cópia de
// `mock.locations` que morria ao trocar de aba, e a contagem "N dispositivos · N usuários" comparava
// aparelhos reais com ids de exemplo, dando sempre zero.
import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../app/auth'
import { desativarLocal, salvarLocal } from '../../data/locais'
import { mensagemErro } from '../../data/erros'
import { useStore } from '../../domain/store'
import type { Location } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select } from '../../ui'
import { LOCAL_TIPO } from './ConfigConst'

export default function ConfigLocais() {
  const { locations, devices, members, recarregar } = useStore()
  const { tenantId } = useAuth()
  const [edit, setEdit] = useState<Location | null>(null)
  const [removendo, setRemovendo] = useState<Location | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const executar = async (acao: () => Promise<unknown>) => {
    setSalvando(true)
    setErro(null)
    try {
      await acao()
      await recarregar()
      setEdit(null)
      setRemovendo(null)
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Card
        title="Locais"
        actions={
          <Button variant="primary" size="sm" onClick={() => { setErro(null); setEdit({ id: '', nome: '', tipo: 'fabrica' }) }}>
            <Plus size={14} /> Adicionar local
          </Button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">Fábricas próprias, terceiros que produzem para você e depósitos. Dispositivos e usuários de produção ficam presos a um local.</p>
        {locations.length === 0 ? (
          <EmptyState title="Nenhum local" description="O estoque é contado por local e o aparelho do chão aponta produção em um deles." />
        ) : (
          <ul className="divide-y divide-border/70">
            {locations.map((l) => {
              const aparelhos = devices.filter((d) => d.localId === l.id).length
              const pessoas = members.filter((m) => m.localId === l.id).length
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{l.nome}</span>
                      <Badge tone={l.tipo === 'fabrica' ? 'accent' : l.tipo === 'terceiro' ? 'info' : 'neutral'}>{LOCAL_TIPO[l.tipo]}</Badge>
                    </div>
                    <div className="text-[12px] text-muted">
                      {aparelhos} {aparelhos === 1 ? 'dispositivo' : 'dispositivos'} · {pessoas} {pessoas === 1 ? 'usuário' : 'usuários'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setErro(null); setEdit(l) }}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => { setErro(null); setRemovendo(l) }}>
                      Desativar
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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
              <Button variant="primary" disabled={!edit.nome.trim() || salvando} onClick={() => void executar(() => salvarLocal(tenantId, edit))}>
                {salvando ? <Loader2 size={15} className="animate-spin" /> : null}
                {salvando ? 'Salvando…' : 'Salvar'}
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
            {erro && <p className="text-[13px] text-danger">{erro}</p>}
          </div>
        </Modal>
      )}

      {removendo && (
        <Modal
          open
          onClose={() => setRemovendo(null)}
          title="Desativar local"
          size="sm"
          footer={
            <>
              <Button onClick={() => setRemovendo(null)}>Cancelar</Button>
              <Button variant="danger" disabled={salvando} onClick={() => void executar(() => desativarLocal(tenantId, removendo.id))}>
                {salvando ? 'Desativando…' : 'Desativar'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{removendo.nome}</strong> sai das listas de escolha. O histórico de estoque, os apontamentos e quem já estava vinculado a ele continuam como estão.
          </p>
          {erro && <p className="mt-3 text-[13px] text-danger">{erro}</p>}
        </Modal>
      )}
    </>
  )
}
