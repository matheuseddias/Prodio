import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { lerNumeroBR, num } from '../../domain/format'
import { Button, Field, Input, Modal, cx } from '../../ui'

const r4 = (v: number) => Math.round(v * 10000) / 10000

type TipoCalc = 'area' | 'rolo' | 'comprimento' | 'peso' | 'unidade'

/** Calculadora de consumo por unidade (área, rolo, comprimento, peso, unidade). */
export default function FichasCalculadora({ unidade, onClose, onApply }: { unidade: string; onClose: () => void; onApply: (v: number) => void }) {
  const sugerido: TipoCalc = unidade === 'm2' ? 'area' : unidade === 'm' ? 'rolo' : unidade === 'kg' ? 'peso' : unidade === 'g' ? 'peso' : 'unidade'
  const [tipo, setTipo] = useState<TipoCalc>(sugerido)
  const [larg, setLarg] = useState('40')
  const [alt, setAlt] = useState('40')
  const [pecas, setPecas] = useState('1')
  const [rolo, setRolo] = useState('1,4')
  const [comp, setComp] = useState('100')
  const [peso, setPeso] = useState('10')
  const [un, setUn] = useState('1')
  // Campo de texto com teclado decimal: o operador digita com vírgula (type=number engolia a vírgula).
  const n = (s: string) => {
    const v = lerNumeroBR(s)
    return Number.isFinite(v) ? v : 0
  }

  const area = (n(larg) / 100) * (n(alt) / 100) * n(pecas)
  let resultado = 0
  let unidadeRes = unidade
  let explic = ''
  if (tipo === 'area') {
    resultado = area
    unidadeRes = 'm²'
    explic = `${larg} cm × ${alt} cm × ${pecas} peça(s) ÷ 10.000`
  } else if (tipo === 'rolo') {
    resultado = n(rolo) > 0 ? area / n(rolo) : 0
    unidadeRes = 'm (lineares)'
    explic = `área ${num(area, 4)} m² ÷ largura do rolo ${rolo} m`
  } else if (tipo === 'comprimento') {
    resultado = (n(comp) / 100) * n(pecas)
    unidadeRes = 'm'
    explic = `${comp} cm × ${pecas} peça(s) ÷ 100`
  } else if (tipo === 'peso') {
    resultado = unidade === 'g' ? n(peso) * n(pecas) : (n(peso) / 1000) * n(pecas)
    unidadeRes = unidade === 'g' ? 'g' : 'kg'
    explic = unidade === 'g' ? `${peso} g × ${pecas} peça(s)` : `${peso} g × ${pecas} peça(s) ÷ 1.000`
  } else {
    resultado = n(un) * n(pecas)
    unidadeRes = unidade || 'un'
    explic = `${un} × ${pecas} peça(s)`
  }

  const tipos: { id: TipoCalc; label: string }[] = [
    { id: 'area', label: 'Área' },
    { id: 'rolo', label: 'Rolo' },
    { id: 'comprimento', label: 'Comprimento' },
    { id: 'peso', label: 'Peso' },
    { id: 'unidade', label: 'Unidade' },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title="Calculadora de consumo"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={resultado <= 0} onClick={() => onApply(r4(resultado))}>
            Aplicar {num(r4(resultado), 4)}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1 mb-4">
        {tipos.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTipo(t.id)}
            className={cx('rounded-lg px-3 py-1.5 text-[13px] border transition-colors', tipo === t.id ? 'bg-accent-soft border-accent text-accent-text font-medium' : 'border-border text-muted hover:bg-surface-2')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(tipo === 'area' || tipo === 'rolo') && (
          <>
            <Field label="Largura (cm)">
              <Input inputMode="decimal" value={larg} onChange={(e) => setLarg(e.target.value)} />
            </Field>
            <Field label="Altura (cm)">
              <Input inputMode="decimal" value={alt} onChange={(e) => setAlt(e.target.value)} />
            </Field>
          </>
        )}
        {tipo === 'rolo' && (
          <Field label="Largura do rolo (m)">
            <Input inputMode="decimal" value={rolo} onChange={(e) => setRolo(e.target.value)} />
          </Field>
        )}
        {tipo === 'comprimento' && (
          <Field label="Comprimento (cm)">
            <Input inputMode="decimal" value={comp} onChange={(e) => setComp(e.target.value)} />
          </Field>
        )}
        {tipo === 'peso' && (
          <Field label="Peso por peça (g)">
            <Input inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} />
          </Field>
        )}
        {tipo === 'unidade' && (
          <Field label="Quantidade por peça">
            <Input inputMode="decimal" value={un} onChange={(e) => setUn(e.target.value)} />
          </Field>
        )}
        <Field label="Peças por produto">
          <Input inputMode="numeric" value={pecas} onChange={(e) => setPecas(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 rounded-lg bg-surface-2 px-3 py-2.5">
        <div className="text-[12px] text-muted">{explic}</div>
        <div className="text-lg font-semibold tabular-nums">
          {num(r4(resultado), 4)} <span className="text-sm font-normal text-muted">{unidadeRes}</span>
        </div>
        {unidade && unidadeRes.replace(' (lineares)', '').replace('²', '2') !== unidade && (
          <div className="mt-1 text-[12px] text-warn flex items-center gap-1">
            <AlertTriangle size={12} /> A unidade de consumo do insumo é «{unidade}». Confira antes de aplicar.
          </div>
        )}
      </div>
    </Modal>
  )
}
