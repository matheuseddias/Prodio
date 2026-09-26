// "Definir projeção de hoje": a encarregada ajusta o projetado de cada linha do plano, com a sugestão da
// média de vendas ao lado (core: sugerirPlanoDoDia). Nada é gravado até "Aplicar projeção".
import { COBERTURA_ACABADO_PADRAO } from '@prodio/core/planejamento'
import { Calculator } from 'lucide-react'
import { useState } from 'react'
import type { LinhaSugerida } from '../../domain/demanda'
import { num } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import type { DailyPlanLine } from '../../domain/types'
import { Button, Modal, Td, Th, cx } from '../../ui'
import QtyInput from './QtyInput'

export default function LinhaProjecaoModal({ linhas, sugestao, onClose }: { linhas: DailyPlanLine[]; sugestao: Map<string, LinhaSugerida>; onClose: () => void }) {
  const { tenant, demanda, setProjetado } = useStore()
  const { productRef } = useLookups()
  const [rascunho, setRascunho] = useState<Record<string, number>>(() => Object.fromEntries(linhas.map((l) => [l.productId, l.projetado])))

  const preencher = () => setRascunho(Object.fromEntries(linhas.map((l) => [l.productId, sugestao.get(l.productId)?.sugerido ?? rascunho[l.productId] ?? l.projetado])))
  const aplicar = () => {
    for (const l of linhas) {
      const v = rascunho[l.productId]
      if (v !== undefined && v !== l.projetado) setProjetado(l.productId, v)
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Definir projeção de hoje"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={aplicar}>
            Aplicar projeção
          </Button>
        </>
      }
    >
      <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm mb-4">
        <div className="font-mono text-[13px]">com saldo no hub: max(0, demanda × coberturaAcabado − saldoHub − emProdução)</div>
        <div className="font-mono text-[13px]">sem saldo no hub: max(0, demanda de 1 dia − emProdução)</div>
        <div className="text-[12px] text-muted mt-1">
          demanda = vendas dos últimos {demanda.dias} dias por dia de produção, com a margem · coberturaAcabado = {tenant.diasCoberturaAcabado ?? COBERTURA_ACABADO_PADRAO} dias (Configurações › Produção) · emProdução = impresso − bipado. Ajuste cada linha antes de aplicar.
        </div>
      </div>
      <div className="flex justify-end mb-3">
        <Button size="sm" onClick={preencher} disabled={sugestao.size === 0}>
          <Calculator size={14} /> Pré-preencher todos pela sugestão
        </Button>
      </div>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr>
              <Th>Produto</Th>
              <Th right>Demanda/dia</Th>
              <Th right>Saldo hub</Th>
              <Th right>Em prod.</Th>
              <Th right>Sugestão</Th>
              <Th right>Projetado</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const ref = productRef(l.productId)
              const s = sugestao.get(l.productId)
              return (
                <tr key={l.productId}>
                  <Td>
                    <div className="font-medium truncate max-w-[220px]">
                      <span className={cx(ref.removido && 'italic')}>{ref.nome}</span>
                      {ref.cor && <span className="text-muted"> · {ref.cor}</span>}
                    </div>
                    <div className="text-[12px] text-muted font-mono">{ref.sku}</div>
                  </Td>
                  <Td right className="text-muted">{num(s?.demandaDia ?? l.demandaDia, 1)}</Td>
                  <Td right className="text-muted">{s ? (s.saldoHub === undefined ? '—' : num(s.saldoHub)) : num(l.saldoHub)}</Td>
                  <Td right className="text-muted">{num(Math.max(0, l.impresso - l.bipado))}</Td>
                  <Td right className="text-muted">{s ? num(s.sugerido) : '—'}</Td>
                  <Td right>
                    <QtyInput value={rascunho[l.productId] ?? l.projetado} onCommit={(v) => setRascunho((r) => ({ ...r, [l.productId]: v }))} />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
