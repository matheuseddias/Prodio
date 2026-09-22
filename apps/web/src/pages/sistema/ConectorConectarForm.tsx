// Formulário e instruções da modal de conexão. As definições de campo (o que cada plataforma pede
// e para onde o valor vai) estão em ./ConectorCampos.
import { Field, Input } from '../../ui'
import { workerConfigurado } from '../../data/worker'
import { CAMPOS, type CampoConector } from './ConectorCampos'
import { Nota } from './ConectorCard'
import { META, urlRetornoOauth, type Plataforma } from './ConectorMeta'

// ---------- Instruções por plataforma ----------
export function Instrucoes({ plataforma }: { plataforma: Plataforma }) {
  const m = META[plataforma]
  if (plataforma === 'baselinker') {
    return (
      <>
        <p className="text-sm text-muted">{m.auth} Gere o token em Minha conta → API na sua conta BaseLinker.</p>
        <Nota>{m.pedidos} Depois de conectar, configure o De-Para de status.</Nota>
      </>
    )
  }
  if (plataforma === 'bling') {
    return (
      <>
        <p className="text-sm text-muted">
          {m.auth} Ao autorizar, o Bling abre numa janela nova: você entra na sua conta, aceita as permissões do Prodio e fecha a janela. A renovação do token é automática.
        </p>
        <ul className="space-y-1 text-[13px] text-muted">
          <li>• {m.webhooks}</li>
          <li>• {m.pedidos}</li>
          <li>• {m.catalogo}</li>
        </ul>
        <Nota tone="warn">Desde abril/2026, pedidos lidos por API podem contar no limite do plano do cliente no Bling. Ajuste o intervalo de polling em Sincronização para reduzir leituras.</Nota>
      </>
    )
  }
  if (plataforma === 'tiny') {
    return (
      <>
        <p className="text-sm text-muted">{m.auth}</p>
        <ol className="space-y-2 text-sm">
          {[
            'No Tiny, abra Configurações → Aplicativos → Criar aplicativo (privado).',
            `Dê o nome "Prodio" e informe a URL de retorno: ${urlRetornoOauth('tiny')}.`,
            'Copie o client_id e o client_secret gerados e cole abaixo.',
            'Clique em Autorizar: a janela do Tiny abre, você aceita e fecha.',
          ].map((t, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text">{i + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        {!workerConfigurado() && (
          <Nota tone="warn">A URL de retorno acima está usando o endereço desta janela. Defina VITE_WORKER_URL com o endereço público do worker antes de cadastrar o aplicativo no Tiny.</Nota>
        )}
        <Nota>{m.webhooks} O Prodio consulta pedidos em intervalos e busca o detalhe de cada pedido para obter os itens.</Nota>
      </>
    )
  }
  return <p className="text-sm text-muted">{m.auth}</p>
}

// ---------- Campos ----------
export function CamposPlataforma({
  plataforma,
  valores,
  onChange,
  desabilitado,
}: {
  plataforma: Plataforma
  valores: Record<string, string>
  onChange: (chave: string, valor: string) => void
  desabilitado?: boolean
}) {
  const campos = CAMPOS[plataforma]
  if (!campos.length) return null
  // Dois campos curtos seguidos dividem a linha; o resto ocupa a largura toda.
  const linhas: CampoConector[][] = []
  for (const campo of campos) {
    const ultima = linhas[linhas.length - 1]
    if (campo.curto && ultima?.length === 1 && ultima[0].curto) ultima.push(campo)
    else linhas.push([campo])
  }
  return (
    <div className="space-y-3">
      {linhas.map((linha, i) => (
        <div key={i} className={linha.length > 1 ? 'grid gap-3 sm:grid-cols-2' : undefined}>
          {linha.map((campo) => (
            <Field key={campo.chave} label={campo.obrigatorio ? campo.label : `${campo.label} · ${campo.aviso ?? 'opcional'}`} hint={campo.hint}>
              <Input
                value={valores[campo.chave] ?? ''}
                onChange={(e) => onChange(campo.chave, e.target.value)}
                type={campo.secreto ? 'password' : 'text'}
                placeholder={campo.placeholder}
                disabled={desabilitado}
                className="font-mono"
                autoFocus={campo === campos[0]}
              />
            </Field>
          ))}
        </div>
      ))}
    </div>
  )
}
