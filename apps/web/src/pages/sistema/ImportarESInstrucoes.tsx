// Passo 1 da importação do ES: como baixar o backup e onde soltar o arquivo.
// O arquivo é lido por quem chama (ConfigImportarES) e o input é zerado aqui na hora: o File não fica na tela.
import { AlertTriangle, FileJson, Loader2, Lock, Upload } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { Card, cx } from '../../ui'

const PASSOS = [
  'No ES, aperte F5 e espere a tela carregar por inteiro.',
  'Não edite nada no ES enquanto baixa o backup.',
  'Abra Administração → Configurações.',
  'No painel "Backup dos dados", clique em "Baixar backup completo".',
  'Escolha aqui o arquivo backup-suprimentos-AAAAMMDD-HHMM.json que o navegador baixou.',
]

const ENTRA = ['Fornecedores (com CNPJ, prazo e contato)', 'Insumos (unidades, fator de compra, mínimo e custo)', 'Produtos e apelidos de SKU (de/para TM → ED)', 'Fichas técnicas', 'Vínculos insumo-fornecedor (código do item na nota, fator e preço)']

export default function ImportarESInstrucoes({ onArquivo, lendo, erro }: { onArquivo: (f: File) => void; lendo: boolean; erro?: string | null }) {
  const [arrastando, setArrastando] = useState(false)

  const soltar = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setArrastando(false)
    const f = e.dataTransfer.files?.[0]
    if (f && !lendo) onArquivo(f)
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Como baixar o backup no ES">
          <ol className="space-y-2 text-sm">
            {PASSOS.map((p, i) => (
              <li key={p} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent-text">{i + 1}</span>
                <span className="pt-0.5">{p}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 space-y-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-[13px] text-warn">
            <p className="flex gap-2 font-medium">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Não clique em "Restaurar" no ES: isso troca os dados de lá pelos do arquivo.
            </p>
            <p className="flex gap-2">
              <Lock size={15} className="mt-0.5 shrink-0" /> O arquivo tem as senhas do ES. Não mande por WhatsApp, chat ou e-mail, e apague do computador depois de importar.
            </p>
          </div>
        </Card>

        <Card title="O que entra no Prodio">
          <ul className="space-y-1.5 text-sm">
            {ENTRA.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-muted">
            Antes de gravar você vê a prévia: o que é novo, o que muda e o que tem problema. Nada é apagado, o que não está no arquivo fica como está, e importar o mesmo arquivo de novo não duplica nada.
          </p>
        </Card>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setArrastando(true)
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:ring-2 focus-within:ring-accent/40',
          arrastando ? 'border-accent bg-accent-soft/40' : 'border-border bg-surface hover:bg-surface-2',
          lendo && 'pointer-events-none opacity-70',
        )}
      >
        {lendo ? <Loader2 size={28} className="animate-spin text-accent" /> : arrastando ? <FileJson size={28} className="text-accent" /> : <Upload size={28} className="text-faint" />}
        <span className="font-medium">{lendo ? 'Lendo o arquivo…' : 'Arraste o backup aqui ou clique para escolher'}</span>
        <span className="text-[13px] text-muted">Arquivo .json do ES, até 50 MB</span>
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={lendo}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = '' // zera o input: o arquivo não fica preso na tela
            if (f) onArquivo(f)
          }}
        />
      </label>
      {erro && (
        <div role="alert" className="flex gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {erro}
        </div>
      )}
      <p className="flex items-start gap-2 text-[13px] text-muted">
        <Lock size={14} className="mt-0.5 shrink-0" />
        O arquivo é lido só neste navegador. Usuários, senhas, configurações, pedidos, vendas, notas e movimentações não saem daqui: ao banco vai só o cadastro.
      </p>
    </div>
  )
}
