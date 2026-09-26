// Modal de "Calcular mínimos por consumo" da tela de Insumos.
//
// Mora em arquivo próprio por causa do limite de 400 linhas do CLAUDE.md: é a única parte de
// Insumos.tsx que não depende de nada da tela (recebe só `onClose` e lê o resto do store).
import { useMemo, useState } from 'react'
import { num } from '../../domain/format'
import { explodeBom, useStore } from '../../domain/store'
import { Button, EmptyState, Field, Input, Modal, Table, Td, Th, cx } from '../../ui'

export default function CalcularMinimosModal({ onClose }: { onClose: () => void }) {
  const { materials, boms, demanda, tenant, upsertMaterial } = useStore()
  const [dias, setDias] = useState(String(tenant.diasCobertura))
  const nDias = Math.max(0, Number(dias) || 0)

  // Consumo por dia corrido pela venda dos pedidos (demanda do banco, janela da empresa), explodida pela
  // ficha. Antes vinha da demanda gravada no plano do dia, que fica zerada quando ninguém aplica o plano.
  const consumoDia = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of demanda.produtos) {
      if (!(p.vendido > 0)) continue
      const exp = explodeBom(p.productId, p.vendido / demanda.dias, boms)
      for (const [mid, q] of Object.entries(exp)) out[mid] = (out[mid] ?? 0) + q
    }
    return out
  }, [demanda, boms])

  const linhas = materials
    .map((m) => {
      const dia = consumoDia[m.id] ?? 0
      const sugerido = Math.ceil(dia * nDias)
      return { m, dia, sugerido, delta: sugerido - m.minimo }
    })
    .sort((a, b) => b.dia * b.m.custoMedio - a.dia * a.m.custoMedio)
  const comConsumo = linhas.filter((l) => l.dia > 0)
  const aplicar = () => {
    for (const l of comConsumo) if (l.sugerido !== l.m.minimo) upsertMaterial({ ...l.m, minimo: l.sugerido })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Calcular mínimos por consumo"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={comConsumo.length === 0 || nDias <= 0} onClick={aplicar}>
            Aplicar {comConsumo.length} sugestões
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end mb-4">
        <Field label="Mínimo = dias de consumo" className="sm:w-48">
          <Input type="number" inputMode="numeric" min="1" value={dias} onChange={(e) => setDias(e.target.value)} className="text-right tabular-nums" />
        </Field>
        <p className="text-[12px] text-muted flex-1">
          Consumo diário = explosão das fichas × venda por dia de cada produto (pedidos dos últimos {demanda.dias} dias, inclusive cancelados e enviados). Sugerido = consumo diário × {nDias} dias, arredondado para cima. Insumos sem consumo ficam como estão.
        </p>
      </div>
      {comConsumo.length === 0 ? (
        <EmptyState title="Sem consumo projetado" description={`Nenhum produto vendido nos últimos ${demanda.dias} dias tem ficha técnica que consuma estes insumos.`} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Insumo</Th>
              <Th right>Consumo/dia</Th>
              <Th right>Mínimo atual</Th>
              <Th right>Sugerido</Th>
              <Th right>Δ</Th>
            </tr>
          </thead>
          <tbody>
            {comConsumo.map((l) => (
              <tr key={l.m.id}>
                <Td>
                  <span className="font-mono text-[12px] text-muted mr-1.5">{l.m.sku}</span>
                  {l.m.nome}
                </Td>
                <Td right className="text-muted">
                  {num(l.dia, 3)} {l.m.unidadeConsumo}
                </Td>
                <Td right>{num(l.m.minimo, 0)}</Td>
                <Td right className="font-medium">{num(l.sugerido, 0)}</Td>
                <Td right className={cx(l.delta > 0 ? 'text-warn' : l.delta < 0 ? 'text-ok' : 'text-faint')}>
                  {l.delta > 0 ? '+' : ''}
                  {num(l.delta, 0)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  )
}
