// Aviso de "demanda desatualizada" (robô parado, carga inicial ainda longe de hoje, leitura que falhou) e o
// botão Atualizar. Usado pela Linha de hoje, pela Necessidade e pelo Painel; a releitura automática está em
// useDemandaViva.ts.
import { AlertTriangle, Info, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { avisoDaDemanda, frescorDaTela } from '../../domain/demanda'
import { useStore } from '../../domain/store'
import { Button, cx } from '../../ui'

export default function AvisoDemanda({ className }: { className?: string }) {
  const { demanda, connectors } = useStore()
  const aviso = useMemo(() => avisoDaDemanda(demanda, frescorDaTela(demanda, connectors)), [demanda, connectors])
  if (!aviso) return null
  const cor = { warn: 'border-warn/30 bg-warn-soft text-warn', danger: 'border-danger/30 bg-danger-soft text-danger', info: 'border-info/30 bg-info-soft text-info' }[aviso.tom]
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm', cor, className)} role="status">
      {aviso.tom === 'info' ? <Info size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0">
        <div className="font-medium">{aviso.titulo}</div>
        <div className="text-[13px] opacity-90">
          {aviso.texto}{' '}
          <Link to="/conectores" className="underline underline-offset-2">
            Conectores
          </Link>
        </div>
      </div>
    </div>
  )
}

/** Botão "Atualizar" da demanda (só com banco; na demonstração não há o que reler). */
export function BotaoAtualizarDemanda({ lendo, reler }: { lendo: boolean; reler?: () => Promise<void> }) {
  if (!reler) return null
  return (
    <Button size="sm" variant="ghost" onClick={() => void reler()} disabled={lendo} title="Reler os pedidos agregados do banco">
      <RefreshCw size={14} className={cx(lendo && 'animate-spin')} /> {lendo ? 'Atualizando…' : 'Atualizar'}
    </Button>
  )
}
