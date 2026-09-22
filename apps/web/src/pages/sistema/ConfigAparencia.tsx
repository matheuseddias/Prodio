// Aparência. Só o tema é real (useTheme grava no navegador).
//
// "Densidade" saiu: era um useState que não mudava nenhuma tabela e nem chegava ao localStorage —
// sumia ao trocar de aba. E o rodapé dizia "Último acesso <agora>", que era a hora de abrir a tela,
// não um acesso registrado em lugar nenhum.
import { Laptop, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../app/theme'
import { Card, Select, cx } from '../../ui'
import { Row } from './ConfigShared'

const TEMAS = [
  { id: 'system', label: 'Sistema', icon: Monitor },
  { id: 'light', label: 'Claro', icon: Sun },
  { id: 'dark', label: 'Escuro', icon: Moon },
] as const
export default function ConfigAparencia() {
  const { theme, setTheme } = useTheme()
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
      <Row label="Idioma">
        <Select value="pt-BR" disabled className="max-w-xs">
          <option value="pt-BR">Português (Brasil)</option>
        </Select>
      </Row>
      <p className="mt-3 text-[12px] text-faint inline-flex items-center gap-1">
        <Laptop size={12} /> O tema fica guardado neste navegador.
      </p>
    </Card>
  )
}
