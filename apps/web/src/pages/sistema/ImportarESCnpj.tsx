// Fornecedores sem CNPJ no backup do ES: a única escolha do usuário na importação. Quem ficar em branco fica
// de fora (e os insumos dele entram sem fornecedor padrão). O CNPJ é conferido pelo dígito verificador.
import { Button, Card, Input } from '../../ui'
import { conferirCnpjDigitado } from './importarESLogica'

export default function ImportarESCnpj({
  itens,
  digitado,
  pendente,
  ocupado,
  onChange,
  onAtualizar,
}: {
  itens: { nome: string; insumos: number }[]
  digitado: Record<string, string>
  pendente: boolean
  ocupado: boolean
  onChange: (nome: string, valor: string) => void
  onAtualizar: () => void
}) {
  return (
    <Card title={`Fornecedores sem CNPJ (${itens.length})`}>
      <p className="mb-3 text-[13px] text-muted">
        O ES não tem o CNPJ destes fornecedores e ele não apareceu nas notas. Digite o CNPJ de quem deve entrar; quem ficar em branco fica de fora.
      </p>
      <div className="divide-y divide-border/70">
        {itens.map((f) => {
          const v = digitado[f.nome] ?? ''
          const c = conferirCnpjDigitado(v)
          return (
            <div key={f.nome} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-start sm:gap-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{f.nome}</div>
                <div className="text-[12px] text-muted">{f.insumos === 1 ? '1 insumo depende dele' : `${f.insumos} insumos dependem dele`}</div>
              </div>
              <div>
                <Input
                  inputMode="numeric"
                  aria-label={`CNPJ de ${f.nome}`}
                  placeholder="00.000.000/0000-00"
                  value={v}
                  onChange={(e) => onChange(f.nome, e.target.value)}
                  className={c.erro ? 'border-danger focus:border-danger focus:ring-danger/30' : undefined}
                />
                {c.erro && <span className="mt-1 block text-[12px] text-danger">{c.erro}</span>}
                {c.cnpj && <span className="mt-1 block text-[12px] text-ok">CNPJ confere</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {pendente && <span className="text-[13px] text-warn">Há CNPJ digitado que ainda não está na prévia.</span>}
        <Button variant={pendente ? 'primary' : 'secondary'} onClick={onAtualizar} disabled={!pendente || ocupado}>
          Atualizar prévia
        </Button>
      </div>
    </Card>
  )
}
