import { useState } from 'react'
import { useStore } from '../../domain/store'
import { num } from '../../domain/format'
import type { Connector } from '../../domain/types'
import { PageHeader, Stat } from '../../ui'
import { ConectorCard } from './ConectorCard'
import { ConectorConectarModal } from './ConectorConectarModal'
import { ConectorConfigModal } from './ConectorConfigModal'
import { ConectorNfeProvedor } from './ConectorNfeProvedor'
import { ConectorAuditor, ConectorOutbox } from './ConectorOutbox'

// ---------- Página ----------
export default function Conectores() {
  const { connectors, outbox } = useStore()
  const [conectar, setConectar] = useState<Connector | null>(null)
  const [config, setConfig] = useState<Connector | null>(null)

  const conectados = connectors.filter((c) => c.status === 'conectado').length
  // "Pedidos 24h" é uma contagem em `orders` por conector (data/leituras.ts, lerConnectors), feita
  // só para conectores ligados. Somar com `?? 0` transformava "não sei" em "zero"; sem nenhuma
  // contagem, mostra "—".
  const comPedidos24h = connectors.filter((c) => c.pedidos24h !== undefined)
  const pedidos24h = comPedidos24h.length ? comPedidos24h.reduce((a, c) => a + (c.pedidos24h ?? 0), 0) : null
  const erros = outbox.filter((o) => o.status === 'erro').length
  const pendentes = outbox.filter((o) => o.status === 'pendente').length

  // Mantém referência atualizada ao conector aberto no modal
  const conectarAtual = conectar ? (connectors.find((c) => c.id === conectar.id) ?? conectar) : null
  const configAtual = config ? (connectors.find((c) => c.id === config.id) ?? config) : null

  return (
    <>
      <PageHeader title="Conectores" subtitle="Hubs e ERPs que alimentam a demanda, recebem a produção bipada e trazem as NF-e de compra." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Conectados" value={`${conectados} / ${connectors.length}`} />
        <Stat
          label="Pedidos 24h"
          value={pedidos24h === null ? '—' : num(pedidos24h)}
          hint={pedidos24h === null ? (connectors.some((c) => c.status !== 'desconectado') ? 'contagem indisponível agora' : 'nenhum hub conectado') : 'confirmados, somando todos os hubs'}
        />
        <Stat label="Outbox pendente" value={pendentes} tone={pendentes ? 'warn' : undefined} />
        <Stat label="Outbox com erro" value={erros} tone={erros ? 'danger' : undefined} />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {connectors.map((c) => (
          <ConectorCard key={c.id} c={c} onConnect={() => setConectar(c)} onConfig={() => setConfig(c)} />
        ))}
      </div>

      <div className="space-y-5">
        <ConectorNfeProvedor />
        <ConectorOutbox />
        <ConectorAuditor />
      </div>

      {conectarAtual && <ConectorConectarModal key={conectarAtual.id} c={conectarAtual} onClose={() => setConectar(null)} />}
      {configAtual && <ConectorConfigModal key={configAtual.id} c={configAtual} onClose={() => setConfig(null)} />}
    </>
  )
}
