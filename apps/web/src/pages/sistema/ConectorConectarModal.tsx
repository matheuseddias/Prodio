// Conectar uma plataforma de verdade.
//
// Nada aqui marca um conector como conectado por conta própria: quem carimba é o worker, depois de
// uma chamada real à plataforma (POST /connectors/:id/test). A tela só mostra o andamento e, no
// fim, espelha no store o status que foi verificado. A ordem dos passos e a razão de cada um estão
// em apps/web/src/data/conectores.ts.
//
// Por que esta tela chama data/ direto em vez de passar tudo pelo store: conectar é um aperto de
// mão com credencial (RPC que devolve o id → worker cifra → worker testa), não estado de domínio.
// O estado de domínio continua sendo do store: quem muda o conector na tela é `setConnector`, e só
// depois da prova — o SupabaseRepo relê `connectors` e `outbox` do banco nessa mesma ação.
import { AlertTriangle, Check, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../app/auth'
import { garantirConector, iniciarOauth, lerConfigConector, lerStatusConector, salvarCredenciais, testarConector } from '../../data/conectores'
import { mensagemErro } from '../../data/erros'
import { ErroWorker, exigirWorkerConfigurado } from '../../data/worker'
import { useStore } from '../../domain/store'
import type { Connector } from '../../domain/types'
import { Button, Modal, cx } from '../../ui'
import { CAMPOS, TEM_ADAPTADOR, ehOauth, faltaObrigatorio, separar } from './ConectorCampos'
import { Nota } from './ConectorCard'
import { CamposPlataforma, Instrucoes } from './ConectorConectarForm'

type EstadoPasso = 'espera' | 'rodando' | 'ok' | 'falhou'
interface Passo {
  chave: string
  titulo: string
  estado: EstadoPasso
  detalhe?: string
}

/** Tempo máximo esperando o consentimento na janela da plataforma. */
const LIMITE_AUTORIZACAO_MS = 10 * 60_000

export function ConectorConectarModal({ c, onClose }: { c: Connector; onClose: () => void }) {
  const { setConnector } = useStore()
  const { tenantId, papel } = useAuth()
  const [valores, setValores] = useState<Record<string, string>>({})
  const [fase, setFase] = useState<'form' | 'andamento' | 'ok'>('form')
  const [passos, setPassos] = useState<Passo[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState('')
  const [aguardando, setAguardando] = useState(false)
  const [urlManual, setUrlManual] = useState<string | null>(null)
  const espera = useRef<{ concluir: () => void; cancelar: () => void } | null>(null)
  const janelaRef = useRef<Window | null>(null)
  const vivo = useRef(true)

  const set = (k: string, v: string) => setValores((s) => ({ ...s, [k]: v }))
  const oauth = ehOauth(c.plataforma)
  const pronto = TEM_ADAPTADOR[c.plataforma]
  const soLeitura = !!papel && papel !== 'admin'

  // Reconexão não pode perder o endereçamento já salvo: config vem do banco e pré-preenche.
  useEffect(() => {
    void lerConfigConector(c.id).then((cfg) => {
      if (!vivo.current) return
      setValores((v) => {
        const novo = { ...v }
        for (const campo of CAMPOS[c.plataforma]) {
          const atual = cfg[campo.chave]
          if (campo.destino === 'config' && novo[campo.chave] === undefined && atual != null && atual !== '') novo[campo.chave] = String(atual)
        }
        return novo
      })
    })
  }, [c.id, c.plataforma])

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
      espera.current?.cancelar()
      janelaRef.current?.close()
    }
  }, [])

  const marcar = (chave: string, estado: EstadoPasso, det?: string) => setPassos((ps) => ps.map((p) => (p.chave === chave ? { ...p, estado, detalhe: det ?? p.detalhe } : p)))

  // Espera o consentimento: termina quando a janela da plataforma é fechada (o callback do worker
  // responde HTML pedindo isso) ou quando o usuário diz que já autorizou. Nunca fica presa: tem
  // prazo, botão e Cancelar.
  const esperarAutorizacao = (janela: Window | null): Promise<void> =>
    new Promise((resolve, reject) => {
      let vigia = 0
      let prazo = 0
      const encerrar = () => {
        window.clearInterval(vigia)
        window.clearTimeout(prazo)
        espera.current = null
        setAguardando(false)
      }
      vigia = window.setInterval(() => {
        if (janela && janela.closed) {
          encerrar()
          resolve()
        }
      }, 700)
      prazo = window.setTimeout(() => {
        encerrar()
        reject(new Error('A autorização demorou demais. Feche a janela da plataforma e tente de novo.'))
      }, LIMITE_AUTORIZACAO_MS)
      espera.current = {
        concluir: () => {
          encerrar()
          resolve()
        },
        cancelar: () => {
          encerrar()
          reject(new Error('Conexão cancelada.'))
        },
      }
      setAguardando(true)
    })

  async function conectar() {
    // Sem endereço de worker nada vai para frente: diga isso ainda no formulário, com o que a
    // pessoa digitou na tela, em vez de criar a linha do conector e travar no passo seguinte.
    try {
      exigirWorkerConfigurado()
    } catch (e) {
      setErro(mensagemErro(e))
      setFase('form')
      return
    }
    // A janela precisa abrir no clique, antes de qualquer await, senão o navegador bloqueia.
    const janela = oauth ? window.open('', `prodio-oauth-${c.plataforma}`, 'width=560,height=760') : null
    janelaRef.current = janela
    const credenciais = separar(c.plataforma, valores, 'credencial')
    setPassos(
      [
        { chave: 'conector', titulo: 'Registrando o conector no Prodio' },
        ...(Object.keys(credenciais).length ? [{ chave: 'credencial', titulo: 'Guardando a credencial cifrada' }] : []),
        ...(oauth ? [{ chave: 'autorizacao', titulo: `Autorização no ${c.nome}` }] : []),
        { chave: 'teste', titulo: `Testando a conexão com ${c.nome}` },
      ].map((p) => ({ ...p, estado: 'espera' as EstadoPasso })),
    )
    setErro(null)
    setUrlManual(null)
    setFase('andamento')
    // Só muda o status do conector o que foi verificado agora; falha de rede ou de sessão não é
    // prova de nada sobre a plataforma.
    let verificado: Connector['status'] | null = null
    let idConector = ''
    try {
      marcar('conector', 'rodando')
      const id = await garantirConector(c, tenantId, separar(c.plataforma, valores, 'config'))
      idConector = id
      marcar('conector', 'ok')

      if (Object.keys(credenciais).length) {
        marcar('credencial', 'rodando')
        const r = await salvarCredenciais(id, credenciais)
        marcar('credencial', 'ok', `${r.campos.join(', ')} — cifrado no banco`)
      }

      if (ehOauth(c.plataforma)) {
        marcar('autorizacao', 'rodando')
        const { url } = await iniciarOauth(id, c.plataforma)
        if (janela && !janela.closed) janela.location.href = url
        else setUrlManual(url)
        await esperarAutorizacao(janela)
        marcar('autorizacao', 'ok')
      }

      marcar('teste', 'rodando')
      try {
        const r = await testarConector(id)
        verificado = 'conectado'
        marcar('teste', 'ok', r.detalhe)
        setDetalhe(r.detalhe)
        setFase('ok')
      } catch (e) {
        // O worker respondeu: ele mesmo já gravou 'erro' com esta mensagem no conector.
        if (e instanceof ErroWorker && e.causa === 'worker') verificado = 'erro'
        throw e
      }
    } catch (e) {
      janela?.close()
      setErro(mensagemErro(e))
      setPassos((ps) => ps.map((p) => (p.estado === 'rodando' ? { ...p, estado: 'falhou' } : p)))
    } finally {
      janelaRef.current = null
      // O worker respondeu ao teste: quem tem a verdade é o banco, onde ele acabou de gravar o
      // status verificado (pode ser 'desconectado', se descobriu que não há credencial salva).
      // Só o "conectado" tem fallback próprio: a resposta 200 do teste já é a prova.
      if (verificado) {
        const status = (await lerStatusConector(idConector)) ?? (verificado === 'conectado' ? 'conectado' : null)
        if (status) setConnector({ ...c, status })
      }
    }
  }

  const bloqueado = !pronto || soLeitura || faltaObrigatorio(c.plataforma, valores)
  let corpo: ReactNode
  let footer: ReactNode

  if (fase === 'ok') {
    corpo = (
      <div className="flex flex-col items-center py-6 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-soft text-ok">
          <Check size={24} />
        </span>
        <div className="mt-3 font-semibold">{c.nome} conectado</div>
        <p className="mt-1 max-w-sm text-sm text-muted">{detalhe}</p>
        <p className="mt-2 max-w-sm text-[13px] text-faint">O primeiro sync de pedidos entra no próximo ciclo do worker (a cada 5 min). Depois, mapeie os status em Configurar → Pedidos.</p>
      </div>
    )
    footer = (
      <Button variant="primary" onClick={onClose}>
        Fechar
      </Button>
    )
  } else if (fase === 'andamento') {
    corpo = (
      <div className="space-y-4">
        <ListaPassos passos={passos} />
        {aguardando && (
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-[13px]">
            <div className="font-medium">Autorize o Prodio na janela que abriu.</div>
            <p className="mt-1 text-muted">Ao terminar, feche aquela janela: o Prodio testa a conexão sozinho. Se ela não abriu, use o link abaixo.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {urlManual && (
                <a href={urlManual} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text underline">
                  <ExternalLink size={14} /> Abrir autorização do {c.nome}
                </a>
              )}
              <Button size="sm" onClick={() => espera.current?.concluir()}>
                Já autorizei, testar agora
              </Button>
            </div>
          </div>
        )}
        {erro && <CaixaErro texto={erro} />}
      </div>
    )
    footer = erro ? (
      <>
        <Button onClick={() => setFase('form')}>Voltar</Button>
        <Button variant="primary" onClick={() => void conectar()}>
          Tentar de novo
        </Button>
      </>
    ) : (
      <Button
        onClick={() => {
          espera.current?.cancelar()
          onClose()
        }}
      >
        Cancelar
      </Button>
    )
  } else {
    corpo = (
      <div className="space-y-4">
        <Instrucoes plataforma={c.plataforma} />
        {pronto && <CamposPlataforma plataforma={c.plataforma} valores={valores} onChange={set} desabilitado={soLeitura} />}
        {!pronto && <Nota tone="warn">O worker do Prodio ainda não tem adaptador para {c.nome}: guardar a credencial agora não conectaria nada. Conecte BaseLinker, Bling ou Tiny enquanto isso.</Nota>}
        {soLeitura && <Nota tone="warn">Só o administrador da empresa conecta plataformas.</Nota>}
        {erro && <CaixaErro texto={erro} />}
      </div>
    )
    footer = (
      <>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={bloqueado} onClick={() => void conectar()}>
          {oauth ? (
            <>
              <ExternalLink size={15} /> Autorizar no {c.nome}
            </>
          ) : (
            'Salvar e testar conexão'
          )}
        </Button>
      </>
    )
  }

  return (
    <Modal open onClose={onClose} title={`Conectar ${c.nome}`} footer={footer}>
      {corpo}
    </Modal>
  )
}

// ---------- Andamento ----------
function ListaPassos({ passos }: { passos: Passo[] }) {
  return (
    <ol className="space-y-3">
      {passos.map((p) => (
        <li key={p.chave} className="flex gap-3">
          <span
            className={cx(
              'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full',
              p.estado === 'ok' && 'bg-ok-soft text-ok',
              p.estado === 'rodando' && 'bg-accent-soft text-accent-text',
              p.estado === 'falhou' && 'bg-danger-soft text-danger',
              p.estado === 'espera' && 'bg-surface-2 text-faint',
            )}
          >
            {p.estado === 'ok' && <Check size={14} />}
            {p.estado === 'rodando' && <Loader2 size={14} className="animate-spin" />}
            {p.estado === 'falhou' && <AlertTriangle size={14} />}
            {p.estado === 'espera' && <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
          </span>
          <div className="min-w-0">
            <div className={cx('text-sm', p.estado === 'espera' ? 'text-faint' : 'font-medium')}>{p.titulo}</div>
            {p.detalhe && <div className="text-[13px] text-muted">{p.detalhe}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function CaixaErro({ texto }: { texto: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-danger/30 bg-danger-soft/40 px-3 py-2 text-[13px] text-danger">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{texto}</span>
    </div>
  )
}
