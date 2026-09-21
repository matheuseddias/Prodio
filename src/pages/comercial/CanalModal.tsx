import { AlertTriangle, ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PRESETS } from '../../domain/precificacao'
import type { Channel } from '../../domain/types'
import { Button, Field, Input, Modal, cx } from '../../ui'
import { parseNumBR, uid } from './precoUtils'

// Rascunho do formulário com campos numéricos como texto (aceita vírgula, permite vazio).
interface Draft {
  id: string
  preset?: Channel['preset']
  ativo: boolean
  nome: string
  comissaoPct: string
  taxaFixa: string
  taxaFixaAbaixoDe: string
  faixas: { k: string; ateKg: string; valor: string }[]
  freteGratisAcimaDe: string
  impostoVendaPct: string
  adsPct: string
  parcelamentoPct: string
  outrosPct: string
  observacao: string
}

const n2s = (v: number | undefined) => (v === undefined ? '' : String(v).replace('.', ','))
const s2n = (v: string, fallback = 0) => {
  const n = parseNumBR(v)
  return Number.isNaN(n) ? fallback : n
}
const s2opt = (v: string) => (v.trim() === '' ? undefined : s2n(v))

function paraDraft(c: Channel): Draft {
  return {
    id: c.id,
    preset: c.preset,
    ativo: c.ativo,
    nome: c.nome,
    comissaoPct: n2s(c.comissaoPct),
    taxaFixa: n2s(c.taxaFixa),
    taxaFixaAbaixoDe: n2s(c.taxaFixaAbaixoDe),
    faixas: c.freteVendedor.map((f) => ({ k: uid(), ateKg: n2s(f.ateKg), valor: n2s(f.valor) })),
    freteGratisAcimaDe: n2s(c.freteGratisAcimaDe),
    impostoVendaPct: n2s(c.impostoVendaPct),
    adsPct: n2s(c.adsPct),
    parcelamentoPct: n2s(c.parcelamentoPct),
    outrosPct: n2s(c.outrosPct),
    observacao: c.observacao ?? '',
  }
}

function paraCanal(d: Draft): Channel {
  const faixas = d.faixas
    .filter((f) => f.ateKg.trim() !== '')
    .map((f) => ({ ateKg: s2n(f.ateKg), valor: s2n(f.valor) }))
    .sort((a, b) => a.ateKg - b.ateKg)
  return {
    id: d.id,
    nome: d.nome.trim(),
    preset: d.preset,
    ativo: d.ativo,
    comissaoPct: s2n(d.comissaoPct),
    taxaFixa: s2n(d.taxaFixa),
    taxaFixaAbaixoDe: s2opt(d.taxaFixaAbaixoDe),
    freteVendedor: faixas,
    freteGratisAcimaDe: s2opt(d.freteGratisAcimaDe),
    impostoVendaPct: s2n(d.impostoVendaPct),
    adsPct: s2n(d.adsPct),
    parcelamentoPct: s2n(d.parcelamentoPct),
    outrosPct: s2n(d.outrosPct),
    observacao: d.observacao.trim() || undefined,
  }
}

const vazio = (impostoPadrao: number): Channel => ({
  id: uid(),
  nome: '',
  ativo: true,
  comissaoPct: 0,
  taxaFixa: 0,
  freteVendedor: [],
  impostoVendaPct: impostoPadrao,
  adsPct: 0,
  parcelamentoPct: 0,
  outrosPct: 0,
})

function NumField({ label, value, onChange, suffix, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; suffix: string; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <Input value={value} inputMode="decimal" placeholder={placeholder ?? '0'} onChange={(e) => onChange(e.target.value)} className="pr-10 text-right tabular-nums" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted">{suffix}</span>
      </div>
    </Field>
  )
}

export default function CanalModal({ open, canal, impostoPadrao, onClose, onSave }: { open: boolean; canal: Channel | null; impostoPadrao: number; onClose: () => void; onSave: (c: Channel) => void }) {
  const [etapa, setEtapa] = useState<'preset' | 'form'>('form')
  const [d, setD] = useState<Draft>(() => paraDraft(vazio(impostoPadrao)))
  const [aberto, setAberto] = useState(false)
  // Reinicia o rascunho a cada abertura.
  if (open !== aberto) {
    setAberto(open)
    if (open) {
      setEtapa(canal ? 'form' : 'preset')
      setD(paraDraft(canal ?? vazio(impostoPadrao)))
    }
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const setFaixa = (k: string, campo: 'ateKg' | 'valor', v: string) => set('faixas', d.faixas.map((f) => (f.k === k ? { ...f, [campo]: v } : f)))

  const escolherPreset = (p: (typeof PRESETS)[number] | null) => {
    const base = p ? { ...vazio(impostoPadrao), ...p.base, impostoVendaPct: impostoPadrao, nome: p.nome, preset: p.preset } : vazio(impostoPadrao)
    setD(paraDraft({ ...base, id: d.id }))
    setEtapa('form')
  }

  const salvar = () => {
    if (!d.nome.trim()) return
    onSave(paraCanal(d))
    onClose()
  }

  const titulo = canal ? `Editar canal · ${canal.nome}` : etapa === 'preset' ? 'Novo canal' : `Novo canal${d.preset ? ` · ${d.nome}` : ' · do zero'}`

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titulo}
      size="lg"
      footer={
        etapa === 'form' ? (
          <>
            {!canal && (
              <Button variant="ghost" onClick={() => setEtapa('preset')} className="mr-auto">
                <ArrowLeft size={14} /> Trocar preset
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={salvar} disabled={!d.nome.trim()}>
              {canal ? 'Salvar alterações' : 'Criar canal'}
            </Button>
          </>
        ) : undefined
      }
    >
      {etapa === 'preset' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-[13px] text-warn">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>Os valores dos presets são referência e mudam com frequência. Confira comissão, taxa fixa e tabela de frete na sua conta da plataforma antes de usar.</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRESETS.map((p) => (
              <button key={p.preset} type="button" onClick={() => escolherPreset(p)} className="rounded-lg border border-border bg-surface p-3 text-left hover:border-accent hover:bg-accent-soft/30 transition-colors">
                <div className="font-medium">{p.nome}</div>
                <div className="text-[12px] text-muted mt-1">
                  {p.base.comissaoPct}% comissão{p.base.taxaFixa ? ` · fixa R$ ${p.base.taxaFixa}` : ''}
                  {p.base.freteVendedor.length ? ` · frete por peso` : ''}
                  {p.base.parcelamentoPct ? ` · parc. ${p.base.parcelamentoPct}%` : ''}
                </div>
              </button>
            ))}
            <button type="button" onClick={() => escolherPreset(null)} className="rounded-lg border border-dashed border-border bg-surface p-3 text-left hover:border-accent hover:bg-accent-soft/30 transition-colors">
              <div className="font-medium flex items-center gap-1.5">
                <Plus size={14} /> Do zero
              </div>
              <div className="text-[12px] text-muted mt-1">Sem taxas pré-preenchidas. Só o imposto padrão ({String(impostoPadrao).replace('.', ',')}%).</div>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Nome do canal" hint="Ex.: Mercado Livre · Premium, Loja física, Representante Sul">
            <Input value={d.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Nome" autoFocus />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <NumField label="Comissão" value={d.comissaoPct} onChange={(v) => set('comissaoPct', v)} suffix="%" />
            <NumField label="Taxa fixa por venda" value={d.taxaFixa} onChange={(v) => set('taxaFixa', v)} suffix="R$" />
            <NumField label="Só abaixo de" value={d.taxaFixaAbaixoDe} onChange={(v) => set('taxaFixaAbaixoDe', v)} suffix="R$" placeholder="sempre" hint="Vazio = taxa fixa em toda venda" />
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <div className="text-[13px] font-medium">Frete pago pelo vendedor por faixa de peso</div>
                <div className="text-[12px] text-faint">Usa o peso faturável do produto. Acima da última faixa, vale o último valor.</div>
              </div>
              <Button size="sm" onClick={() => set('faixas', [...d.faixas, { k: uid(), ateKg: '', valor: '' }])}>
                <Plus size={14} /> Faixa
              </Button>
            </div>
            {d.faixas.length === 0 ? (
              <div className="text-[13px] text-muted py-2">Sem frete do vendedor (frete por conta do comprador ou embutido na comissão).</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[1fr_1fr_36px] gap-2 text-[11px] uppercase tracking-wide text-muted px-1">
                  <span>Até (kg)</span>
                  <span>Valor (R$)</span>
                  <span />
                </div>
                {d.faixas.map((f) => (
                  <div key={f.k} className="grid grid-cols-[1fr_1fr_36px] gap-2 items-center">
                    <Input value={f.ateKg} inputMode="decimal" placeholder="0,5" onChange={(e) => setFaixa(f.k, 'ateKg', e.target.value)} className="h-9 text-right tabular-nums" aria-label="Até kg" />
                    <Input value={f.valor} inputMode="decimal" placeholder="0,00" onChange={(e) => setFaixa(f.k, 'valor', e.target.value)} className="h-9 text-right tabular-nums" aria-label="Valor" />
                    <button type="button" onClick={() => set('faixas', d.faixas.filter((x) => x.k !== f.k))} className={cx('h-9 w-9 inline-flex items-center justify-center rounded-md text-muted hover:text-danger hover:bg-danger-soft')} aria-label="Remover faixa">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <div className="text-[11px] text-faint px-1">As faixas são ordenadas por peso ao salvar.</div>
              </div>
            )}
            <div className="mt-3 max-w-xs">
              <NumField label="Vendedor paga o frete a partir de" value={d.freteGratisAcimaDe} onChange={(v) => set('freteGratisAcimaDe', v)} suffix="R$" placeholder="sempre" hint="Abaixo desse preço o comprador paga o frete (custo zero para você)." />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <NumField label="Imposto sobre venda" value={d.impostoVendaPct} onChange={(v) => set('impostoVendaPct', v)} suffix="%" />
            <NumField label="Ads" value={d.adsPct} onChange={(v) => set('adsPct', v)} suffix="%" />
            <NumField label="Parcelamento" value={d.parcelamentoPct} onChange={(v) => set('parcelamentoPct', v)} suffix="%" />
            <NumField label="Outros" value={d.outrosPct} onChange={(v) => set('outrosPct', v)} suffix="%" />
          </div>
          <Field label="Observação">
            <Input value={d.observacao} onChange={(e) => set('observacao', e.target.value)} placeholder="Ex.: reputação verde, tabela de frete de março" />
          </Field>
        </div>
      )}
    </Modal>
  )
}
