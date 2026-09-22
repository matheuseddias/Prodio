import { AlertTriangle, Check, Info, Loader2, Plug, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../app/auth'
import { sincronizarConector } from '../../data/conectores'
import { mensagemErro } from '../../data/erros'
import { comoFrase } from '../../data/worker'
import { num, relativo } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Connector } from '../../domain/types'
import { Badge, Button, Card, cx } from '../../ui'
import { CAPS, META, STATUS_LABEL, STATUS_TONE, type Plataforma } from './ConectorMeta'
import { CICLO_CRON_MIN, situacaoConector, type TomSituacao } from './ConectorSituacao'

export function Logo({ p, size = 'md' }: { p: Plataforma; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('grid shrink-0 place-items-center rounded-lg font-bold text-white', META[p].cor, size === 'md' ? 'h-10 w-10 text-sm' : 'h-7 w-7 text-[11px]')}>
      {META[p].iniciais}
    </span>
  )
}

const TOM_CAIXA: Record<TomSituacao, string> = {
  ok: 'bg-ok-soft text-ok',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  erro: 'bg-danger-soft text-danger',
}
const TOM_ICONE: Record<TomSituacao, typeof Info> = { ok: Check, info: Info, warn: AlertTriangle, erro: AlertTriangle }

/**
 * Caixa de aviso das telas de conector. Ganhou `titulo` e os tons `ok`/`erro` para o cartão poder
 * dizer o que está acontecendo com o robô sem inventar um segundo componente para isso.
 */
export function Nota({ tone = 'info', titulo, children }: { tone?: TomSituacao; titulo?: ReactNode; children?: ReactNode }) {
  const Icon = TOM_ICONE[tone]
  return (
    <div className={cx('flex gap-2 rounded-lg px-3 py-2 text-[13px]', TOM_CAIXA[tone])}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {titulo && <div className="font-medium">{titulo}</div>}
        {children && <div className={cx('min-w-0 break-words', !!titulo && 'mt-0.5 opacity-90')}>{children}</div>}
      </div>
    </div>
  )
}

/** O que a última tentativa manual devolveu. Vive só nesta tela: o que é do domínio está no store. */
type Resultado = { tipo: 'ok'; detalhe: string } | { tipo: 'erro'; mensagem: string }

// ---------- Cartão ----------
export function ConectorCard({ c, onConnect, onConfig }: { c: Connector; onConnect: () => void; onConfig: () => void }) {
  const m = META[c.plataforma]
  const ativo = c.status === 'conectado'
  // Status 'erro' também sincroniza: a credencial continua guardada e é justamente quem está no
  // erro que precisa de um botão para tentar de novo e ver o motivo na hora, sem `wrangler tail`.
  const podeSincronizar = ativo || c.status === 'erro'

  const { recarregarFatias } = useStore()
  const { papel } = useAuth()
  const soLeitura = !!papel && papel !== 'admin'
  const [rodando, setRodando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  async function sincronizar() {
    if (rodando) return // clique duplo: a rota não é idempotente de graça, e duas rodadas juntas só brigam pelo cursor
    setRodando(true)
    setResultado(null)
    try {
      const r = await sincronizarConector(c.id)
      if (!vivo.current) return
      // O worker escreve `detalhe` em português para o dono ler; a tela não reescreve.
      setResultado({ tipo: 'ok', detalhe: comoFrase(r.detalhe) })
      // Quem tem a verdade do que mudou é o banco: ultimo_sync, ultimo_erro e status foram
      // gravados lá pelo worker. A tela relê a fatia em vez de adivinhar o novo estado.
      await recarregarFatias(['connectors'])
    } catch (e) {
      // O worker manda a frase pronta em `erro`; o cliente já a transformou em ErroWorker.
      if (vivo.current) setResultado({ tipo: 'erro', mensagem: mensagemErro(e) })
    } finally {
      if (vivo.current) setRodando(false)
    }
  }

  const situacao = situacaoConector(c)

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Logo p={c.plataforma} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{c.nome}</div>
            <div className="truncate text-[12px] text-muted">{m.curto}</div>
          </div>
        </div>
        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-muted">Último sync</dt>
          {/* "Nunca" é a verdade quando o conector está de pé e nada rodou ainda; '—' deixava a
              dúvida entre "não sei" e "não aconteceu". A caixa abaixo explica o resto. */}
          <dd className="truncate font-medium">{c.ultimoSync ? relativo(c.ultimoSync) : podeSincronizar ? 'Nunca' : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Pedidos 24h</dt>
          <dd className="font-medium tabular-nums">{c.pedidos24h !== undefined ? num(c.pedidos24h) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Outbox</dt>
          <dd className="font-medium tabular-nums">
            {c.outboxPendentes ? <span className="text-warn">{c.outboxPendentes} pend.</span> : c.status === 'conectado' ? '0' : '—'}
          </dd>
        </div>
      </dl>

      {/* O resultado do que o usuário acabou de mandar fazer tem precedência sobre a situação
          geral: é a resposta à pergunta que ele fez agora. */}
      {(resultado || situacao) && (
        <div className="mt-3">
          {resultado ? (
            resultado.tipo === 'ok' ? (
              // Sem título: a frase do worker já diz tudo, e ela cobre três desfechos diferentes
              // — pedidos gravados, nada novo desde a última leitura, e leitura que passou do
              // prazo e continua rodando no servidor. Um título fixo mentiria em pelo menos um.
              <Nota tone="ok">{resultado.detalhe}</Nota>
            ) : (
              <Nota tone="erro" titulo="Não foi possível sincronizar">
                {resultado.mensagem}
              </Nota>
            )
          ) : (
            situacao && (
              <Nota tone={situacao.tom} titulo={situacao.titulo}>
                {situacao.texto}
              </Nota>
            )
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {CAPS.map((cap) => {
          const ok = c.capacidades[cap.key]
          return (
            <span
              key={cap.key}
              title={ok ? 'Suportado' : 'Não suportado'}
              className={cx(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                ok ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-faint line-through decoration-faint/60',
              )}
            >
              {ok && <Check size={11} />}
              {cap.label}
            </span>
          )
        })}
      </div>

      <div className="mt-4 space-y-2 pt-1">
        {podeSincronizar && (
          <Button
            size="sm"
            variant={ativo ? 'primary' : 'secondary'}
            className="w-full"
            disabled={rodando || soLeitura}
            title={soLeitura ? 'Só o administrador da empresa sincroniza.' : `Roda agora a mesma busca de pedidos que o robô faz sozinho a cada ${CICLO_CRON_MIN} minutos.`}
            onClick={() => void sincronizar()}
          >
            {rodando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {rodando ? 'Sincronizando…' : 'Sincronizar agora'}
          </Button>
        )}
        <div className="flex gap-2">
          {podeSincronizar ? (
            <>
              <Button size="sm" onClick={onConfig} className="flex-1">
                <Settings2 size={14} /> Configurar
              </Button>
              <Button size="sm" variant={ativo ? 'ghost' : 'primary'} onClick={onConnect}>
                Reconectar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={onConnect} className="flex-1">
              <Plug size={14} /> Conectar
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
