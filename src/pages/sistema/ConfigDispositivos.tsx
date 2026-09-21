import { QrCode, Smartphone, WifiOff } from 'lucide-react'
import { useState } from 'react'
import * as mock from '../../domain/mock'
import { useStore } from '../../domain/store'
import { dataBR, relativo } from '../../domain/format'
import type { Device } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Table, Td, Th } from '../../ui'
import { uid } from './ConfigConst'
import ConfigOperadores from './ConfigOperadores'

export default function ConfigDispositivos() {
  const { devices, upsertDevice, removeDevice } = useStore()
  const [registrar, setRegistrar] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [novo, setNovo] = useState<{ nome: string; localId: string }>({ nome: '', localId: 'l1' })
  const [revogando, setRevogando] = useState<Device | null>(null)
  const local = (id: string) => mock.locations.find((l) => l.id === id)?.nome ?? id

  const abrirRegistro = () => {
    setCodigo(String(Math.floor(1000 + Math.random() * 9000)))
    setNovo({ nome: '', localId: 'l1' })
    setRegistrar(true)
  }
  const concluirRegistro = () => {
    upsertDevice({ id: uid(), nome: novo.nome || `Aparelho ${codigo}`, localId: novo.localId, registradoEm: new Date().toISOString(), pendentesOffline: 0 })
    setRegistrar(false)
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
          <>
            <Button onClick={() => setRegistrar(false)}>Cancelar</Button>
            <Button variant="primary" onClick={concluirRegistro}>
              Concluir pareamento
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-surface-2 p-5 text-center">
            <QrCode size={40} className="mx-auto text-faint" />
            <div className="mt-3 font-mono text-2xl font-semibold tracking-wider">PRODIO-PAIR-{codigo}</div>
            <p className="mt-2 text-[13px] text-muted">
              Abra <span className="font-mono">/chao</span> neste aparelho e leia o código. Ele expira em 10 minutos.
            </p>
          </div>
          <Field label="Nome do aparelho">
            <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Celular linha 3" />
          </Field>
          <Field label="Local">
            <Select value={novo.localId} onChange={(e) => setNovo({ ...novo, localId: e.target.value })}>
              {mock.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </Select>
          </Field>
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
