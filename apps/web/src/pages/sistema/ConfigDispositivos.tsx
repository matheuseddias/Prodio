import { Loader2, QrCode, Smartphone, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../app/auth'
import { criarDispositivo, VALIDADE_PAREAMENTO_MIN } from '../../data/dispositivos'
import { mensagemErro } from '../../data/erros'
import { useStore } from '../../domain/store'
import { dataBR, relativo } from '../../domain/format'
import type { Device } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Table, Td, Th } from '../../ui'
import ConfigOperadores from './ConfigOperadores'

export default function ConfigDispositivos() {
  const { devices, locations, removeDevice, recarregar } = useStore()
  const { tenantId } = useAuth()
  const [registrar, setRegistrar] = useState(false)
  // O código só existe depois que o aparelho é criado no banco: antes disso o campo é nulo.
  const [codigo, setCodigo] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState<{ nome: string; localId: string }>({ nome: '', localId: '' })
  const [revogando, setRevogando] = useState<Device | null>(null)
  const local = (id: string) => locations.find((l) => l.id === id)?.nome ?? (id ? id : 'Todos')

  const abrirRegistro = () => {
    setCodigo(null)
    setErro(null)
    setNovo({ nome: '', localId: '' })
    setRegistrar(true)
  }
  const gerarCodigo = async () => {
    setCriando(true)
    setErro(null)
    try {
      const r = await criarDispositivo(tenantId, novo.nome.trim() || 'Aparelho do chão de fábrica', novo.localId || undefined)
      setCodigo(r.pairCode)
      await recarregar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setCriando(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card
        title="Dispositivos"
        actions={
          <Button variant="primary" size="sm" onClick={abrirRegistro}>
            <Smartphone size={14} /> Registrar dispositivo
          </Button>
        }
      >
        {devices.length === 0 ? (
          <EmptyState title="Nenhum dispositivo" description="Registre o celular ou tablet que vai bipar na linha." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Local</Th>
                <Th>Registrado em</Th>
                <Th>Último bipe</Th>
                <Th>Offline</Th>
                <Th right />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.nome}</Td>
                  <Td className="text-muted">{local(d.localId)}</Td>
                  <Td className="text-muted whitespace-nowrap">{dataBR(d.registradoEm)}</Td>
                  <Td className="text-muted whitespace-nowrap">{d.ultimoBipe ? relativo(d.ultimoBipe) : '—'}</Td>
                  <Td>
                    {d.pendentesOffline > 0 ? (
                      <Badge tone="warn">
                        <WifiOff size={12} /> {d.pendentesOffline} pendentes
                      </Badge>
                    ) : (
                      <Badge tone="ok">sincronizado</Badge>
                    )}
                  </Td>
                  <Td right>
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevogando(d)}>
                      Revogar
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfigOperadores />

      <Modal
        open={registrar}
        onClose={() => setRegistrar(false)}
        title="Registrar dispositivo"
        size="sm"
        footer={
          codigo ? (
            <Button variant="primary" onClick={() => setRegistrar(false)}>
              Concluir
            </Button>
          ) : (
            <>
              <Button onClick={() => setRegistrar(false)}>Cancelar</Button>
              <Button variant="primary" disabled={criando} onClick={() => void gerarCodigo()}>
                {criando ? <Loader2 size={15} className="animate-spin" /> : null}
                {criando ? 'Gerando…' : 'Gerar código de pareamento'}
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          {codigo ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2 p-5 text-center">
              <QrCode size={40} className="mx-auto text-faint" />
              <div className="mt-3 font-mono text-3xl font-semibold tracking-[0.2em]">{codigo}</div>
              <p className="mt-2 text-[13px] text-muted">
                Abra <span className="font-mono">/chao</span> neste aparelho e digite o código. Ele expira em {VALIDADE_PAREAMENTO_MIN} minutos e só pode ser usado uma vez.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-muted">O código de pareamento é gerado pelo banco na hora em que o aparelho é criado. Dê um nome ao aparelho e escolha o local.</p>
              <Field label="Nome do aparelho">
                <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Celular linha 3" autoFocus />
              </Field>
              <Field label="Local" hint={locations.length === 0 ? 'Nenhum local cadastrado nesta empresa.' : 'O aparelho aponta produção neste local.'}>
                <Select value={novo.localId} onChange={(e) => setNovo({ ...novo, localId: e.target.value })}>
                  <option value="">Sem local definido</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          {erro && <p className="text-[13px] text-danger">{erro}</p>}
        </div>
      </Modal>

      {revogando && (
        <Modal
          open
          onClose={() => setRevogando(null)}
          title="Revogar dispositivo"
          size="sm"
          footer={
            <>
              <Button onClick={() => setRevogando(null)}>Cancelar</Button>
              <Button
                variant="danger"
                onClick={() => {
                  removeDevice(revogando.id)
                  setRevogando(null)
                }}
              >
                Revogar
              </Button>
            </>
          }
        >
          <p className="text-sm">
            <strong>{revogando.nome}</strong> deixa de bipar na hora.
            {revogando.pendentesOffline > 0 && (
              <span className="text-warn"> Há {revogando.pendentesOffline} bipes offline que ainda não subiram e serão perdidos.</span>
            )}
          </p>
        </Modal>
      )}
    </div>
  )
}
