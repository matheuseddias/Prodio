// Barreira de erro: um defeito de render numa tela não pode apagar o sistema inteiro.
// Sem isto, qualquer throw no React 19 desmonta a raiz e o usuário vê uma página branca, sem pista
// nenhuma — inaceitável numa fábrica. Aqui o erro fica contido, aparece em português e a navegação
// continua de pé. Há três variantes: 'app' (raiz, ainda sem shell), 'rota' (dentro do AppShell) e
// 'chao' (telas escuras do chão de fábrica, com alvos de toque grandes).
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Card } from '../ui'

export type VarianteErro = 'app' | 'rota' | 'chao'

interface Props {
  children: ReactNode
  variante?: VarianteErro
  /** Quando muda (ex.: o caminho da rota), a barreira se rearma sozinha. */
  chaveReset?: string
  /** Nome da tela, só para o texto de apoio. */
  onde?: string
}

interface Estado {
  erro: Error | null
  pilha: string | null
  /** Última chave vista, para rearmar a barreira quando a rota muda. */
  chave?: string
}

/** Falha de chunk (deploy novo, rede caiu no meio) pede recarregar, não "tentar de novo". */
function ehFalhaDeCarregamento(erro: Error): boolean {
  const m = `${erro?.name ?? ''} ${erro?.message ?? ''}`
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch/i.test(m)
}

function mensagemDe(erro: Error): string {
  const bruta = typeof erro?.message === 'string' ? erro.message.trim() : ''
  return bruta || 'Erro sem mensagem.'
}

export default class ErrorBoundary extends Component<Props, Estado> {
  state: Estado = { erro: null, pilha: null }

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro }
  }

  /** Trocou de rota: esquece o erro anterior e tenta renderizar a tela nova. */
  static getDerivedStateFromProps(props: Props, state: Estado): Partial<Estado> | null {
    if (state.chave === props.chaveReset) return null
    return state.erro ? { erro: null, pilha: null, chave: props.chaveReset } : { chave: props.chaveReset }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // O console é a única trilha que o suporte tem quando o cliente manda um print.
    console.error('[Prodio] erro de render em', this.props.onde ?? this.props.variante ?? 'app', erro, info.componentStack)
    this.setState({ pilha: info.componentStack ?? null })
  }

  private tentarDeNovo = () => this.setState({ erro: null, pilha: null })
  private recarregar = () => window.location.reload()

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children
    const recarregarPrimeiro = ehFalhaDeCarregamento(erro)
    const dados = {
      titulo: recarregarPrimeiro ? 'Não foi possível carregar esta tela' : 'Esta tela parou de funcionar',
      descricao: recarregarPrimeiro
        ? 'Parte do sistema não chegou até o navegador. Costuma acontecer logo depois de uma atualização ou com a rede instável: recarregue a página.'
        : 'O erro ficou preso aqui — o resto do Prodio continua funcionando. Se acontecer de novo, mande este texto para o suporte.',
      mensagem: mensagemDe(erro),
      onde: this.props.onde,
      pilha: this.state.pilha,
      recarregarPrimeiro,
      tentarDeNovo: this.tentarDeNovo,
      recarregar: this.recarregar,
    }
    if (this.props.variante === 'chao') return <FalhaChao {...dados} />
    if (this.props.variante === 'app') return <FalhaApp {...dados} />
    return <FalhaRota {...dados} />
  }
}

interface FalhaProps {
  titulo: string
  descricao: string
  mensagem: string
  onde?: string
  pilha: string | null
  recarregarPrimeiro: boolean
  tentarDeNovo: () => void
  recarregar: () => void
}

function Detalhes({ mensagem, onde, pilha }: { mensagem: string; onde?: string; pilha: string | null }) {
  return (
    <details className="mt-4 text-left">
      <summary className="cursor-pointer text-[13px] text-muted">Detalhes técnicos</summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words text-muted">
        {[onde && `Tela: ${onde}`, mensagem, pilha?.trim()].filter(Boolean).join('\n')}
      </pre>
    </details>
  )
}

function Acoes({ recarregarPrimeiro, tentarDeNovo, recarregar }: Pick<FalhaProps, 'recarregarPrimeiro' | 'tentarDeNovo' | 'recarregar'>) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button variant={recarregarPrimeiro ? 'primary' : 'secondary'} onClick={recarregar}>
        <RefreshCw size={16} /> Recarregar a página
      </Button>
      <Button variant={recarregarPrimeiro ? 'secondary' : 'primary'} onClick={tentarDeNovo}>
        <RotateCcw size={16} /> Tentar de novo
      </Button>
    </div>
  )
}

/** Dentro do AppShell: o menu e o cabeçalho continuam na tela. */
function FalhaRota(p: FalhaProps) {
  return (
    <Card>
      <div className="flex gap-3">
        <AlertTriangle size={22} className="shrink-0 text-warn" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{p.titulo}</h2>
          <p className="mt-1 text-sm text-muted max-w-prose">{p.descricao}</p>
          <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-muted break-words">{p.mensagem}</p>
          <Acoes recarregarPrimeiro={p.recarregarPrimeiro} tentarDeNovo={p.tentarDeNovo} recarregar={p.recarregar} />
          <Detalhes mensagem={p.mensagem} onde={p.onde} pilha={p.pilha} />
        </div>
      </div>
    </Card>
  )
}

/** Raiz do app: ainda não há shell nenhum para segurar a tela. */
function FalhaApp(p: FalhaProps) {
  return (
    <div className="h-full min-h-screen grid place-items-center bg-bg p-6 text-text">
      <div className="max-w-lg text-center">
        <AlertTriangle size={30} className="mx-auto text-warn" />
        <h1 className="mt-3 text-lg font-semibold">{p.titulo}</h1>
        <p className="mt-1.5 text-sm text-muted">{p.descricao}</p>
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] text-muted break-words">{p.mensagem}</p>
        <div className="flex justify-center">
          <Acoes recarregarPrimeiro={p.recarregarPrimeiro} tentarDeNovo={p.tentarDeNovo} recarregar={p.recarregar} />
        </div>
        <Detalhes mensagem={p.mensagem} onde={p.onde} pilha={p.pilha} />
      </div>
    </div>
  )
}

/** Chão de fábrica: paleta escura, texto grande e botões de 56px, como o resto de /chao. */
function FalhaChao(p: FalhaProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-slate-100">
      <AlertTriangle size={32} className="text-amber-300" />
      <div className="text-[17px] font-semibold">{p.titulo}</div>
      <p className="max-w-sm text-[14px] text-slate-400">{p.descricao}</p>
      <p className="max-w-full break-words rounded-xl bg-slate-900 px-3 py-2 font-mono text-[12px] text-slate-400">{p.mensagem}</p>
      <div className="mt-1 flex w-full max-w-sm flex-col gap-2">
        <button type="button" onClick={p.recarregar} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-teal-500 px-6 text-[15px] font-semibold text-slate-950 active:bg-teal-400">
          <RefreshCw size={18} /> Recarregar
        </button>
        <button type="button" onClick={p.tentarDeNovo} className="flex h-14 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 text-[15px] font-medium text-slate-200 active:bg-slate-800">
          <RotateCcw size={18} /> Tentar de novo
        </button>
      </div>
    </div>
  )
}
