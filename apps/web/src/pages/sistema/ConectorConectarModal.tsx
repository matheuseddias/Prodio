import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useStore } from '../../domain/store'
import type { Connector } from '../../domain/types'
import { Button, Field, Input, Modal } from '../../ui'
import { Nota } from './ConectorCard'
import { META } from './ConectorMeta'

// ---------- Modal de conexão por plataforma ----------
export function ConectorConectarModal({ c, onClose }: { c: Connector; onClose: () => void }) {
  const { setConnector } = useStore()
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [fase, setFase] = useState<'form' | 'testando' | 'redirecionando' | 'ok'>('form')
  const set = (k: string, v: string) => setCampos((s) => ({ ...s, [k]: v }))
  const m = META[c.plataforma]

  const concluir = () => {
    setConnector({
      ...c,
      status: 'conectado',
      ultimoSync: new Date().toISOString(),
      pedidos24h: c.pedidos24h ?? 0,
      outboxPendentes: c.outboxPendentes ?? 0,
      cursor: c.cursor ?? 'inicial',
    })
    setFase('ok')
  }
  const simular = (f: 'testando' | 'redirecionando') => {
    setFase(f)
    window.setTimeout(concluir, 1000)
  }

  const preenchido = (...ks: string[]) => ks.every((k) => (campos[k] ?? '').trim().length > 0)

  let corpo: ReactNode
  let footer: ReactNode

  if (fase === 'ok') {
    corpo = (
      <div className="flex flex-col items-center py-6 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-soft text-ok">
          <Check size={24} />
        </span>
        <div className="mt-3 font-semibold">{c.nome} conectado</div>
        <p className="mt-1 max-w-sm text-sm text-muted">O primeiro sync de pedidos começa em instantes. Depois, mapeie os status em Configurar → Pedidos.</p>
      </div>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Fechar
      </Button>
    )
  } else if (fase === 'testando' || fase === 'redirecionando') {
    corpo = (
      <div className="flex flex-col items-center py-8 text-center">
        <Loader2 size={28} className="animate-spin text-accent" />
        <div className="mt-3 text-sm text-muted">{fase === 'testando' ? 'Testando conexão…' : `Redirecionando para ${c.nome}… você volta ao Prodio depois de autorizar.`}</div>
      </div>
    )
  } else {
    switch (c.plataforma) {
      case 'baselinker':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth} Gere o token em Minha conta → API na sua conta BaseLinker.</p>
            <Field label="Token da API" hint="Enviado como X-BLToken. Fica salvo criptografado.">
              <Input value={campos.token ?? ''} onChange={(e) => set('token', e.target.value)} placeholder="Cole o token da conta" className="font-mono" autoFocus />
            </Field>
            <Nota>{m.pedidos} Após conectar, configure o De-Para de status.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('token')} onClick={() => simular('testando')}>
              Testar conexão
            </Button>
          </>
        )
        break
      case 'bling':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {m.auth} Ao clicar em Autorizar, você vai para o Bling, entra na sua conta, aceita as permissões do Prodio e volta para cá já conectado. A renovação do token é automática.
            </p>
            <ul className="space-y-1 text-[13px] text-muted">
              <li>• {m.webhooks}</li>
              <li>• {m.pedidos}</li>
              <li>• {m.catalogo}</li>
            </ul>
            <Nota tone="warn">Desde abril/2026, pedidos lidos por API podem contar no limite do plano do cliente no Bling. Ajuste o intervalo de polling em Sincronização para reduzir leituras.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={() => simular('redirecionando')}>
              <ExternalLink size={15} /> Autorizar no Bling
            </Button>
          </>
        )
        break
      case 'tiny':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth}</p>
            <ol className="space-y-2 text-sm">
              {[
                'No Tiny, abra Configurações → Aplicativos → Criar aplicativo (privado).',
                'Dê o nome "Prodio" e informe a URL de retorno: https://app.prodio.app/oauth/tiny.',
                'Copie o client_id e o client_secret gerados e cole abaixo.',
                'Clique em Autorizar: você entra no Tiny, aceita e volta conectado.',
              ].map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="client_id">
                <Input value={campos.clientId ?? ''} onChange={(e) => set('clientId', e.target.value)} className="font-mono" />
              </Field>
              <Field label="client_secret">
                <Input type="password" value={campos.clientSecret ?? ''} onChange={(e) => set('clientSecret', e.target.value)} className="font-mono" />
              </Field>
            </div>
            <Nota>{m.webhooks} O Prodio consulta pedidos em intervalos e busca o detalhe de cada pedido para obter os itens.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('clientId', 'clientSecret')} onClick={() => simular('redirecionando')}>
              <ExternalLink size={15} /> Autorizar no Tiny
            </Button>
          </>
        )
        break
      case 'omie':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth} Gere em Configurações → Aplicativos → Chaves de API dentro do Omie.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="app_key">
                <Input value={campos.appKey ?? ''} onChange={(e) => set('appKey', e.target.value)} className="font-mono" autoFocus />
              </Field>
              <Field label="app_secret">
                <Input type="password" value={campos.appSecret ?? ''} onChange={(e) => set('appSecret', e.target.value)} className="font-mono" />
              </Field>
            </div>
            <Nota>
              {m.pedidos} O Prodio respeita o limite e evita chamadas repetidas. {m.webhooks}
            </Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('appKey', 'appSecret')} onClick={() => simular('testando')}>
              Testar conexão
            </Button>
          </>
        )
        break
      case 'magis5':
        corpo = (
          <div className="space-y-4">
            <p className="text-sm text-muted">{m.auth}</p>
            <Field label="Chave de API">
              <Input value={campos.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} className="font-mono" autoFocus />
            </Field>
            <Nota tone="warn">A documentação pública do Magis5 é limitada: a listagem de pedidos e os webhooks precisam ser confirmados com uma conta de teste antes de usar em produção.</Nota>
          </div>
        )
        footer = (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!preenchido('apiKey')} onClick={() => simular('testando')}>
              Testar conexão
            </Button>
          </>
        )
        break
    }
  }

  return (
    <Modal open onClose={onClose} title={`Conectar ${c.nome}`} footer={footer}>
      {corpo}
    </Modal>
  )
}
