import { Check, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { useState } from 'react'
import { dataHoraBR, horaBR, relativo } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Connector } from '../../domain/types'
import { Badge, Button, Field, Input, Modal, Select, Tabs, Toggle, cx } from '../../ui'
import { Nota } from './ConectorCard'
import { ConectorCatalogo } from './ConectorCatalogo'
import { HISTORICO_SYNC, META, SIGNIFICADOS, SKUS_SEM_DEPARA, STATUS_PLATAFORMA, type Significado } from './ConectorMeta'

type AbaCfg = 'pedidos' | 'catalogo' | 'estoque' | 'sync' | 'desconectar'

// ---------- Modal de configuração ----------
export function ConectorConfigModal({ c, onClose }: { c: Connector; onClose: () => void }) {
  const { setConnector } = useStore()
  const [aba, setAba] = useState<AbaCfg>('pedidos')
  const m = META[c.plataforma]

  // Estado local (sem ação no store para estas preferências)
  const [mapa, setMapa] = useState<Record<string, Significado>>(() => Object.fromEntries(STATUS_PLATAFORMA[c.plataforma].map((s) => [s.nome, s.padrao])))
  const [depara, setDepara] = useState<Record<string, string>>({})
  const [pushOn, setPushOn] = useState(true)
  const [modo, setModo] = useState<'saldo' | 'documentos'>(c.plataforma === 'baselinker' ? 'saldo' : 'documentos')
  const [dryRun, setDryRun] = useState(true)
  const [deposito, setDeposito] = useState('24384')
  const [intervalo, setIntervalo] = useState(c.plataforma === 'bling' ? '15' : '5')
  const [forcando, setForcando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [confirmaDesc, setConfirmaDesc] = useState('')

  const forcar = () => {
    setForcando(true)
    window.setTimeout(() => {
      setForcando(false)
      setConnector({ ...c, ultimoSync: new Date().toISOString(), status: 'conectado' })
    }, 1000)
  }
  const salvar = () => {
    setSalvo(true)
    window.setTimeout(() => setSalvo(false), 1500)
  }
  const desconectar = () => {
    setConnector({ ...c, status: 'desconectado', ultimoSync: undefined, pedidos24h: undefined, outboxPendentes: undefined, cursor: undefined })
    onClose()
  }

  const pendentesDepara = SKUS_SEM_DEPARA.filter((s) => !depara[s]).length

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Configurar ${c.nome}`}
      footer={
        aba !== 'desconectar' && (
          <>
            <Button onClick={onClose}>Fechar</Button>
            <Button variant="primary" onClick={salvar}>
              {salvo ? <Check size={15} /> : null}
              {salvo ? 'Salvo' : 'Salvar'}
            </Button>
          </>
        )
      }
    >
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'pedidos', label: 'Pedidos' },
          { id: 'catalogo', label: 'Catálogo', count: pendentesDepara },
          { id: 'estoque', label: 'Estoque' },
          { id: 'sync', label: 'Sincronização' },
          { id: 'desconectar', label: <span className="text-danger">Desconectar</span> },
        ]}
      />

      {aba === 'pedidos' && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Cada status da plataforma vira um significado no Prodio. <strong>Demanda</strong> entra na projeção do dia; <strong>Carteira firme</strong> reserva produção; <strong>Enviado</strong> e{' '}
            <strong>Cancelado</strong> saem da fila.
          </p>
          {c.plataforma === 'baselinker' && <Nota>{m.pedidos}</Nota>}
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left font-medium">Status em {c.nome.split(' ')[0]}</th>
                  <th className="px-3 py-2 text-left font-medium">No Prodio</th>
                </tr>
              </thead>
              <tbody>
                {STATUS_PLATAFORMA[c.plataforma].map((s) => (
                  <tr key={s.nome} className="border-t border-border/70">
                    <td className="px-3 py-2 font-medium">{s.nome}</td>
                    <td className="px-3 py-2">
                      <Select value={mapa[s.nome]} onChange={(e) => setMapa((mm) => ({ ...mm, [s.nome]: e.target.value as Significado }))} className="h-9 max-w-[220px]">
                        {SIGNIFICADOS.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'catalogo' && <ConectorCatalogo c={c} depara={depara} setDepara={setDepara} />}

      {aba === 'estoque' && (
        <div className="space-y-5">
          <Toggle checked={pushOn} onChange={setPushOn} label="Enviar produção bipada para o hub" />
          <p className="text-[13px] text-muted -mt-2">Cada bipe entra no outbox; o worker aplica em lote no hub.</p>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-muted">Modo de escrita</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  { id: 'saldo', t: 'Saldo absoluto', d: 'O Prodio calcula o saldo final e sobrescreve o valor no hub.' },
                  { id: 'documentos', t: 'Documentos', d: 'Cada lote vira um documento de entrada, preservando histórico no hub.' },
                ] as const
              ).map((o) => {
                const dis = o.id === 'documentos' && c.plataforma === 'baselinker'
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={dis}
                    title={dis ? 'BaseLinker só aceita saldo absoluto' : undefined}
                    onClick={() => setModo(o.id)}
                    className={cx('rounded-lg border p-3 text-left transition-colors disabled:opacity-50', modo === o.id ? 'border-accent bg-accent-soft/40' : 'border-border hover:bg-surface-2')}
                  >
                    <div className="text-sm font-medium">{o.t}</div>
                    <div className="mt-0.5 text-[12px] text-muted">{o.d}</div>
                  </button>
                )
              })}
            </div>
          </div>
          <Toggle checked={dryRun} onChange={setDryRun} label="Simular antes de aplicar (dry-run)" />
          <p className="text-[13px] text-muted -mt-2">Mostra o que mudaria no hub sem escrever. Recomendado nos primeiros dias.</p>
          <Field label={c.plataforma === 'baselinker' ? 'Inventário alvo (ID)' : 'Depósito alvo'} hint="Onde o saldo produzido é escrito.">
            <Input value={deposito} onChange={(e) => setDeposito(e.target.value)} className="max-w-xs font-mono" />
          </Field>
          {c.plataforma === 'baselinker' && <Nota>{m.estoque} Estoque de outros canais que apontem para o mesmo inventário também será sobrescrito.</Nota>}
        </div>
      )}

      {aba === 'sync' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Intervalo de polling" hint={c.plataforma === 'bling' ? 'Leituras por API podem contar no limite do plano do Bling.' : m.webhooks}>
              <Select value={intervalo} onChange={(e) => setIntervalo(e.target.value)}>
                {['1', '5', '15', '30', '60'].map((v) => (
                  <option key={v} value={v}>
                    a cada {v} min
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cursor atual" hint="Ponto de onde o próximo sync continua.">
              <Input readOnly value={c.cursor ?? '—'} className="font-mono bg-surface-2" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={forcar} disabled={forcando}>
              {forcando ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              {forcando ? 'Sincronizando…' : 'Forçar sync agora'}
            </Button>
            <span className="text-[13px] text-muted">Último: {c.ultimoSync ? `${dataHoraBR(c.ultimoSync)} (${relativo(c.ultimoSync)})` : '—'}</span>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium text-muted">Histórico de execuções</div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 text-left font-medium">Hora</th>
                    <th className="px-3 py-2 text-right font-medium">Lidos</th>
                    <th className="px-3 py-2 text-right font-medium">Novos</th>
                    <th className="px-3 py-2 text-right font-medium">Duração</th>
                    <th className="px-3 py-2 text-left font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {HISTORICO_SYNC.map((h, i) => (
                    <tr key={i} className="border-t border-border/70">
                      <td className="px-3 py-2 tabular-nums">{horaBR(h.em)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.pedidos}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{h.novos}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(h.ms / 1000).toFixed(1)} s</td>
                      <td className="px-3 py-2">{h.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="danger">{h.erro}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {aba === 'desconectar' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
            <div className="flex items-center gap-2 font-semibold text-danger">
              <Unplug size={16} /> Desconectar {c.nome}
            </div>
            <p className="mt-1 text-sm text-muted">
              Os pedidos param de entrar, o outbox pendente é descartado e as credenciais são apagadas. Os mapeamentos de status e SKU ficam salvos para uma reconexão.
            </p>
          </div>
          <Field label={`Digite "desconectar" para confirmar`}>
            <Input value={confirmaDesc} onChange={(e) => setConfirmaDesc(e.target.value)} className="max-w-xs" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="danger" disabled={confirmaDesc.trim().toLowerCase() !== 'desconectar'} onClick={desconectar}>
              Desconectar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
