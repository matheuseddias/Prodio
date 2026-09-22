// Modal de cadastro/edição de fornecedor, da tela de Fornecedores.
//
// Mora em arquivo próprio por causa do limite de 400 linhas do CLAUDE.md. Junto com ele vieram os
// ajudantes que só ele usa (máscara e dígito verificador de CNPJ) e o `vazio()` que monta um
// fornecedor em branco — a tela importa esse daqui para não criar um ciclo entre os dois arquivos.
import { X } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import type { Supplier } from '../../domain/types'
import { Badge, Button, Field, Input, Modal, Select, cx } from '../../ui'

const uid = () => Math.random().toString(36).slice(2, 10)

/* ---------- CNPJ ---------- */
const mascaraCnpj = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}
function cnpjValido(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const calc = (len: number) => {
    let soma = 0
    let peso = len - 7
    for (let i = 0; i < len; i++) {
      soma += Number(d[i]) * peso--
      if (peso < 2) peso = 9
    }
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

export function vazio(): Supplier {
  return { id: uid(), nome: '', cnpj: '', regime: 'normal', leadTimeDias: 7, condicaoPagamento: [30] }
}

interface Vinculo {
  materialId: string
  codigoFornecedor: string
  fator: number
}

export default function FornecedorModal({ fornecedor, todos, onClose, onSave }: { fornecedor?: Supplier; todos: Supplier[]; onClose: () => void; onSave: (s: Supplier) => void }) {
  const { materials, nfes } = useStore()
  const base = fornecedor ?? vazio()
  const [nome, setNome] = useState(base.nome)
  const [cnpj, setCnpj] = useState(mascaraCnpj(base.cnpj))
  const [regime, setRegime] = useState<Supplier['regime']>(base.regime)
  const [lead, setLead] = useState(String(base.leadTimeDias))
  const [cond, setCond] = useState<number[]>(base.condicaoPagamento)
  const [novaCond, setNovaCond] = useState('')
  const [contato, setContato] = useState(base.contato ?? '')
  const [erro, setErro] = useState<string>()

  // De-Para (estado local: o store não guarda código do fornecedor por insumo)
  const [vinculos, setVinculos] = useState<Vinculo[]>(() =>
    materials
      .filter((m) => m.fornecedorPadraoId === base.id)
      .map((m) => {
        const item = nfes.filter((n) => n.supplierId === base.id).flatMap((n) => n.itens).find((it) => it.materialId === m.id)
        return { materialId: m.id, codigoFornecedor: item?.cProd ?? '', fator: item?.fator ?? m.fatorConversao }
      }),
  )

  const cnpjOk = cnpjValido(cnpj)
  const digitos = cnpj.replace(/\D/g, '')

  const addCond = () => {
    const n = Number(novaCond)
    if (Number.isNaN(n) || novaCond.trim() === '' || n < 0) return
    setCond((c) => Array.from(new Set([...c, n])).sort((a, b) => a - b))
    setNovaCond('')
  }

  const salvar = () => {
    if (!nome.trim()) return setErro('Informe o nome.')
    if (!cnpjOk) return setErro('CNPJ inválido — confira os dígitos.')
    if (todos.some((s) => s.id !== base.id && s.cnpj === digitos)) return setErro('Já existe um fornecedor com este CNPJ.')
    onSave({ ...base, nome: nome.trim(), cnpj: digitos, regime, leadTimeDias: Number(lead) || 0, condicaoPagamento: cond, contato: contato.trim() || undefined })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={fornecedor ? `Editar ${fornecedor.nome}` : 'Novo fornecedor'}
      size="lg"
      footer={
        <>
          {erro && <span className="mr-auto text-[13px] text-danger">{erro}</span>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={salvar}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Nome *">
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Razão social ou fantasia" autoFocus={!fornecedor} />
          </Field>
          <Field label="CNPJ *" hint={digitos.length === 14 ? (cnpjOk ? 'dígitos verificadores ok' : 'dígitos verificadores não conferem') : undefined}>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(mascaraCnpj(e.target.value))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              className={cx('font-mono', digitos.length === 14 && (cnpjOk ? 'border-ok' : 'border-danger'))}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Regime" hint="Simples não destaca IPI/ICMS-ST na NF-e.">
            <Select value={regime} onChange={(e) => setRegime(e.target.value as Supplier['regime'])}>
              <option value="simples">Simples Nacional</option>
              <option value="normal">Regime normal</option>
            </Select>
          </Field>
          <Field label="Lead time (dias)">
            <Input type="number" inputMode="numeric" min="0" value={lead} onChange={(e) => setLead(e.target.value)} className="text-right tabular-nums" />
          </Field>
          <Field label="Contato">
            <Input value={contato} onChange={(e) => setContato(e.target.value)} placeholder="Nome, e-mail ou telefone" />
          </Field>
        </div>

        <div>
          <span className="block text-[13px] font-medium text-muted mb-1.5">Condição de pagamento (dias)</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {cond.map((c) => (
              <Badge key={c} tone="accent" className="tabular-nums">
                {c === 0 ? 'à vista' : `${c} d`}
                <button type="button" onClick={() => setCond((l) => l.filter((x) => x !== c))} className="ml-0.5 hover:text-danger" aria-label={`Remover ${c}`}>
                  <X size={12} />
                </button>
              </Badge>
            ))}
            <Input
              type="number"
              inputMode="numeric"
              min="0"
              value={novaCond}
              onChange={(e) => setNovaCond(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCond()
                }
              }}
              placeholder="dias"
              className="h-8 w-24 text-right tabular-nums"
            />
            <Button size="sm" onClick={addCond}>
              Adicionar
            </Button>
          </div>
          <p className="text-[12px] text-faint mt-1.5">Ex.: 28 e 42 = duas parcelas, 28/42 dias. 0 = à vista.</p>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-medium">Insumos deste fornecedor</span>
            <span className="text-[12px] text-muted tabular-nums">{vinculos.length} vinculado(s)</span>
          </div>
          <p className="text-[12px] text-muted mb-3">
            É o De-Para usado ao ler a NF-e: o código do produto no XML do fornecedor (cProd) aponta para o seu insumo, e o fator converte a unidade da nota para a unidade de consumo.
          </p>
          {vinculos.length === 0 ? (
            <div className="text-[13px] text-faint">Nenhum insumo tem este fornecedor como padrão. Defina em Cadastros → Insumos.</div>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_150px_90px] gap-2 text-[11px] uppercase tracking-wide text-muted px-1">
                <span>Insumo</span>
                <span>Cód. no fornecedor</span>
                <span className="text-right">Fator</span>
              </div>
              {vinculos.map((v) => {
                const m = materials.find((x) => x.id === v.materialId)!
                return (
                  <div key={v.materialId} className="grid grid-cols-1 sm:grid-cols-[1fr_150px_90px] gap-2 items-center">
                    <div className="text-sm min-w-0">
                      <span className="font-mono text-[12px] text-muted mr-1.5">{m.sku}</span>
                      <span className="truncate">{m.nome}</span>
                      <span className="text-[12px] text-faint"> · {m.unidadeCompra} → {m.unidadeConsumo}</span>
                    </div>
                    <Input value={v.codigoFornecedor} onChange={(e) => setVinculos((l) => l.map((x) => (x.materialId === v.materialId ? { ...x, codigoFornecedor: e.target.value } : x)))} placeholder="cProd" className="h-9 font-mono" />
                    <Input type="number" inputMode="decimal" step="0.01" value={v.fator} onChange={(e) => setVinculos((l) => l.map((x) => (x.materialId === v.materialId ? { ...x, fator: Number(e.target.value) } : x)))} className="h-9 text-right tabular-nums" />
                  </div>
                )
              })}
              <p className="text-[12px] text-faint">Código e fator ficam salvos nesta sessão (o store ainda não guarda De-Para por fornecedor).</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
