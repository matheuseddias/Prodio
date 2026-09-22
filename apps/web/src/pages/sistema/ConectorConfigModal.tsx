import { Check, Loader2, PlugZap, Unplug } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../app/auth'
import { desconectarConector, garantirConector, lerConfigConector, lerStatusConector, lerStatusMap, salvarStatusMap, testarConector } from '../../data/conectores'
import { mensagemErro } from '../../data/erros'
import { ErroWorker } from '../../data/worker'
import { dataHoraBR, horaBR, relativo } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Connector } from '../../domain/types'
import { Badge, Button, Field, Input, Modal, Select, Tabs, Toggle } from '../../ui'
import { Nota } from './ConectorCard'
import { ConectorCatalogo } from './ConectorCatalogo'
import { HISTORICO_SYNC, META, SIGNIFICADOS, STATUS_PLATAFORMA, type Significado } from './ConectorMeta'

type AbaCfg = 'pedidos' | 'catalogo' | 'estoque' | 'sync' | 'desconectar'

const mapaPadrao = (p: Connector['plataforma']): Record<string, Significado> => Object.fromEntries(STATUS_PLATAFORMA[p].map((s) => [s.nome, s.padrao]))

// ---------- Modal de configuração ----------
export function ConectorConfigModal({ c, onClose }: { c: Connector; onClose: () => void }) {
  const { setConnector, modo: modoApp } = useStore()
  const { tenantId } = useAuth()
  const [aba, setAba] = useState<AbaCfg>('pedidos')
  const m = META[c.plataforma]

  // O De-Para de status vive em connector_status_map e as preferências de estoque em
  // connectors.config: as duas coisas são lidas do banco ao abrir e gravadas no Salvar. O padrão
  // por plataforma só vale enquanto nada foi gravado — e é dito na tela.
  const [mapa, setMapa] = useState<Record<string, Significado>>(() => mapaPadrao(c.plataforma))
  const [mapaSalvo, setMapaSalvo] = useState(false)
  const [pendentesDepara, setPendentesDepara] = useState(0)
  const [pushOn, setPushOn] = useState(c.capacidades.pushEstoque)
  const [dryRun, setDryRun] = useState(false)
  const [carregando, setCarregando] = useState(modoApp === 'supabase')
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [confirmaDesc, setConfirmaDesc] = useState('')
  const [desconectando, setDesconectando] = useState(false)
  const [erroDesc, setErroDesc] = useState<string | null>(null)
  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null)
  const vivo = useRef(true)

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  useEffect(() => {
    if (modoApp !== 'supabase') return
    let ativo = true
    void Promise.all([lerStatusMap(c.id), lerConfigConector(c.id)])
      .then(([salvoNoBanco, cfg]) => {
        if (!ativo) return
        const nomes = STATUS_PLATAFORMA[c.plataforma].map((s) => s.nome)
        const gravado = Object.keys(salvoNoBanco).length > 0
        if (gravado) setMapa({ ...mapaPadrao(c.plataforma), ...Object.fromEntries(nomes.filter((n) => salvoNoBanco[n]).map((n) => [n, salvoNoBanco[n]])) })
        setMapaSalvo(gravado)
        setDryRun(!!cfg.dry_run)
      })
      .catch(() => {})
      .finally(() => {
        if (ativo) setCarregando(false)
      })
    return () => {
      ativo = false
    }
  }, [c.id, c.plataforma, modoApp])

  // Salvar de verdade: `set_status_map` troca o mapa inteiro do conector e `upsert_connector`
  // grava push_estoque e dry_run em connectors.config — as duas chaves que o worker lê ao aplicar
  // o outbox (apps/worker/src/jobs/aplicarOutbox.ts). "Salvo" só aparece depois que as duas voltam.
  const salvar = async () => {
    setSalvando(true)
    setErroSalvar(null)
    try {
      let status = c.status
      if (modoApp === 'supabase') {
        // O id que vale é o que a RPC devolve: `c.id` pode não ser o uuid do banco (conector que
        // a tela conhece antes da linha existir), e aí o De-Para iria para um id inexistente.
        const id = await garantirConector(c, tenantId, { push_estoque: pushOn, dry_run: dryRun })
        await salvarStatusMap(tenantId, id, mapa)
        setMapaSalvo(true)
        // `setConnector` grava o status junto (mapeadoresCadastros.connectorConfigParaBanco). O
        // status de verdade é o que o worker carimbou; reler evita que salvar uma preferência
        // ressuscite um status antigo da tela.
        status = (await lerStatusConector(id)) ?? c.status
      }
      setConnector({ ...c, status, capacidades: { ...c.capacidades, pushEstoque: pushOn } })
      if (!vivo.current) return
      setSalvo(true)
      window.setTimeout(() => vivo.current && setSalvo(false), 1500)
    } catch (e) {
      if (vivo.current) setErroSalvar(mensagemErro(e))
    } finally {
      if (vivo.current) setSalvando(false)
    }
  }
  // Testar sem pedir a credencial de novo: ela já está cifrada no banco e quem a decifra é o
  // worker. Sem este botão, um conector que caiu em 'erro' por uma indisponibilidade momentânea da
  // plataforma só voltava por "Reconectar", que exige colar o token outra vez — a tela nunca lê
  // credencial de volta. Quem carimba o status continua sendo o worker; aqui só espelhamos.
  const testar = async () => {
    setTestando(true)
    setTeste(null)
    try {
      const r = await testarConector(c.id)
      if (vivo.current) setTeste({ ok: true, texto: r.detalhe })
      setConnector({ ...c, status: (await lerStatusConector(c.id)) ?? 'conectado' })
    } catch (e) {
      if (vivo.current) setTeste({ ok: false, texto: mensagemErro(e) })
      // Só o worker respondendo é prova sobre a plataforma: falha de rede ou de sessão não muda
      // status nenhum (o worker já gravou o dele antes de responder).
      if (e instanceof ErroWorker && e.causa === 'worker') {
        const status = await lerStatusConector(c.id)
        if (status) setConnector({ ...c, status })
      }
    } finally {
      if (vivo.current) setTestando(false)
    }
  }
  // Desconectar é uma escrita de verdade (apaga a credencial cifrada e ignora o outbox pendente).
  // Só fecha a janela se der certo; o setConnector em seguida relê connectors e outbox do banco.
  const desconectar = async () => {
    setDesconectando(true)
    setErroDesc(null)
    try {
      await desconectarConector(tenantId, c.id)
      setConnector({ ...c, status: 'desconectado', outboxPendentes: 0 })
      onClose()
    } catch (e) {
      setErroDesc(mensagemErro(e))
    } finally {
      setDesconectando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Configurar ${c.nome}`}
      footer={
        aba !== 'desconectar' && (
          <>
            {erroSalvar && <span className="mr-auto text-[13px] text-danger">{erroSalvar}</span>}
            <Button onClick={onClose}>Fechar</Button>
            <Button variant="primary" onClick={() => void salvar()} disabled={salvando || carregando}>
              {salvando ? <Loader2 size={15} className="animate-spin" /> : salvo ? <Check size={15} /> : null}
              {salvando ? 'Salvando…' : salvo ? 'Salvo' : 'Salvar'}
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
          {modoApp === 'supabase' && !mapaSalvo && (
            <Nota tone="warn">Nenhum De-Para gravado ainda para este conector: enquanto não houver mapa salvo, todo pedido que chegar conta como demanda. O que está abaixo é a sugestão padrão — confira e clique em Salvar.</Nota>
          )}
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

      {aba === 'catalogo' && <ConectorCatalogo c={c} onPendentes={setPendentesDepara} />}

      {aba === 'estoque' && (
        <div className="space-y-5">
          <Toggle checked={pushOn} onChange={setPushOn} label="Enviar produção bipada para o hub" />
          <p className="text-[13px] text-muted -mt-2">Cada bipe entra no outbox; o worker aplica em lote no hub. Desligado, a fila continua sendo enfileirada e nada é escrito na plataforma.</p>
          {/* O adaptador de cada plataforma escreve saldo absoluto (pushFinishedStock). Não existe
              modo "documentos" implementado, então a tela informa o que acontece em vez de oferecer
              uma escolha que nada lê. */}
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="text-sm font-medium">Modo de escrita: saldo absoluto</div>
            <div className="mt-0.5 text-[12px] text-muted">
              O Prodio soma os bipes do lote e escreve o saldo do SKU {c.plataforma === 'baselinker' ? 'no inventário e depósito escolhidos ao conectar' : 'no depósito escolhido ao conectar'}. Lançar
              cada lote como documento de entrada no hub ainda não está implementado.
            </div>
          </div>
          <Toggle checked={dryRun} onChange={setDryRun} label="Simular antes de aplicar (dry-run)" />
          <p className="text-[13px] text-muted -mt-2">
            Ligado, o worker calcula o lote e registra o que faria, sem escrever no hub; os itens voltam para a fila. Recomendado nos primeiros dias. Fica em{' '}
            <span className="font-mono">connectors.config.dry_run</span> e é lido pelo worker a cada rodada.
          </p>
          <Nota>
            {c.plataforma === 'baselinker' ? 'O inventário e o depósito (warehouse_id) para onde o saldo é escrito' : 'O depósito para onde o saldo é escrito'} ficam na configuração do conector e são
            informados ao conectar: use <strong>Reconectar</strong> no cartão do conector para mudá-los.
          </Nota>
          {c.plataforma === 'baselinker' && <Nota>{m.estoque} Estoque de outros canais que apontem para o mesmo inventário também será sobrescrito.</Nota>}
        </div>
      )}

      {aba === 'sync' && (
        <div className="space-y-5">
          {/* O intervalo não é configurável por conector: quem lê pedidos é o cron do worker, de 5
              em 5 minutos (apps/worker/wrangler.toml). O Select de antes não ia para lugar nenhum. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Intervalo de leitura" hint={c.plataforma === 'bling' ? 'Leituras por API contam no limite do plano do Bling.' : m.webhooks}>
              <Input readOnly value="a cada 5 min (cron do worker)" className="bg-surface-2" />
            </Field>
            <Field label="Cursor atual" hint="Ponto de onde o próximo sync continua.">
              <Input readOnly value={c.cursor ?? '—'} className="font-mono bg-surface-2" />
            </Field>
          </div>
          {/* Não existe rota de "forçar sync" no worker: o botão de antes só esperava 1 s e marcava
              o conector como conectado. Quem sincroniza é o cron, de 5 em 5 minutos. */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px]">
            <span className="text-muted">A sincronização roda sozinha no worker, a cada 5 minutos.</span>
            <span className="font-medium">Último: {c.ultimoSync ? `${dataHoraBR(c.ultimoSync)} (${relativo(c.ultimoSync)})` : 'ainda não rodou'}</span>
          </div>
          {modoApp === 'supabase' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={() => void testar()} disabled={testando}>
                  {testando ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
                  {testando ? 'Testando…' : 'Testar conexão agora'}
                </Button>
                <span className="text-[13px] text-muted">
                  O worker faz uma chamada real e barata ao {c.nome} com a credencial já guardada — não é preciso colá-la de novo.
                </span>
              </div>
              {teste && <Nota tone={teste.ok ? 'info' : 'warn'}>{teste.texto}</Nota>}
            </div>
          )}
          <div>
            <div className="mb-2 text-[13px] font-medium text-muted">Histórico de execuções</div>
            {/* Com banco de verdade, execução inventada é pior que nenhuma: some com ela e diga por quê.
                No modo de exemplo (sem banco) a tabela continua, porque ali tudo é demonstração. */}
            {modoApp !== 'memoria' ? (
              <Nota>O histórico de execuções ainda não vem do banco. Acompanhe pelo último sync acima, pelo status do cartão e pela fila do outbox.</Nota>
            ) : (
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
            )}
          </div>
        </div>
      )}

      {aba === 'desconectar' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
            <div className="flex items-center gap-2 font-semibold text-danger">
              <Unplug size={16} /> Desconectar {c.nome}
            </div>
            {/* O texto descreve o que a RPC `disconnect_connector` faz de verdade (migration
                20260921000800): apaga a linha de connector_credentials, marca desconectado e joga
                o outbox pendente para 'ignorado'. O texto anterior dizia que a credencial ficava
                guardada — quem lesse isso reconectaria esperando não precisar do token de novo. */}
            <p className="mt-1 text-sm text-muted">
              O conector fica marcado como desconectado e o worker para de usá-lo: os pedidos não entram mais e o que estava no outbox é marcado como ignorado. A credencial cifrada é{' '}
              <strong>apagada</strong> do banco — para reconectar você vai precisar {c.plataforma === 'baselinker' ? 'do token de novo' : 'autorizar o Prodio na plataforma outra vez'}.
            </p>
          </div>
          <Field label={`Digite "desconectar" para confirmar`}>
            <Input value={confirmaDesc} onChange={(e) => setConfirmaDesc(e.target.value)} className="max-w-xs" />
          </Field>
          {erroDesc && <Nota tone="warn">{erroDesc}</Nota>}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="danger" disabled={desconectando || confirmaDesc.trim().toLowerCase() !== 'desconectar'} onClick={() => void desconectar()}>
              {desconectando ? 'Desconectando…' : 'Desconectar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
