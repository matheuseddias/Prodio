import { Laptop, Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useTheme } from '../../app/theme'
import { dataHoraBR } from '../../domain/format'
import { Card, Select, cx } from '../../ui'
import { Row } from './ConfigShared'

const TEMAS = [
  { id: 'system', label: 'Sistema', icon: Monitor },
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Escuro', icon: Moon },
] as const
const DENSIDADES = [
  { id: 'confortavel', label: 'Confortável' },
  { id: 'compacta', label: 'Compacta' },
] as const

export default function ConfigAparencia() {
  const { theme, setTheme } = useTheme()
  const [densidade, setDensidade] = useState<'confortavel' | 'compacta'>('confortavel')
  return (
    <Card title="Aparência">
      <Row label="Tema" hint="Sistema segue a preferência do aparelho.">
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {TEMAS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cx('flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors', theme === t.id ? 'border-accent bg-accent-soft/40 font-medium' : 'border-border hover:bg-surface-2')}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Densidade" hint="Compacta mostra mais linhas por tela nas tabelas.">
        <div className="grid grid-cols-2 gap-2 max-w-md">
          {DENSIDADES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDensidade(d.id)}
              className={cx('rounded-lg border p-3 text-sm transition-colors', densidade === d.id ? 'border-accent bg-accent-soft/40 font-medium' : 'border-border hover:bg-surface-2')}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Idioma">
        <Select value="pt-BR" disabled className="max-w-xs">
          <option value="pt-BR">Português (Brasil)</option>
        </Select>
      </Row>
      <p className="mt-3 text-[12px] text-faint inline-flex items-center gap-1">
        <Laptop size={12} /> Preferências de aparência ficam neste navegador. Último acesso {dataHoraBR(new Date().toISOString())}.
      </p>
    </Card>
  )
}
