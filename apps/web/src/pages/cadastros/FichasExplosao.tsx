import { AlertTriangle, History } from 'lucide-react'
import { brl, dataHoraBR, num, relativo } from '../../domain/format'
import type { Bom, Material } from '../../domain/types'
import { Badge, Card, EmptyState, Table, Td, Th } from '../../ui'

export interface Versao {
  versao: number
  em: string
  custo: number
  linhas: number
}

export interface LinhaExplosao {
  mid: string
  q: number
  m?: Material
}

/** Explosão multinível (1 unidade) e histórico de versões salvas nesta sessão. */
export default function FichasExplosao({ explosao, custoTotal, bomAtual, hist }: { explosao: LinhaExplosao[]; custoTotal: number; bomAtual?: Bom; hist: Versao[] }) {
  const insumosInexistentes = explosao.filter((e) => !e.m)
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <Card title="Explosão (1 unidade)" padded={false}>
        {insumosInexistentes.length > 0 && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-warn-soft text-warn px-3 py-2 text-[13px]">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {insumosInexistentes.length} insumo(s) referenciado(s) na ficha não existem mais no cadastro de insumos. Eles não entram no custo.
          </div>
        )}
        {explosao.length === 0 ? (
          <EmptyState title="Nada para explodir" description="A explosão soma os insumos da ficha, incluindo os de produtos componentes." />
        ) : (
          <div className="px-5 pb-2">
            <Table>
              <thead>
                <tr>
                  <Th>Insumo</Th>
                  <Th right>Quantidade</Th>
                  <Th>Unid.</Th>
                  <Th right>Custo médio</Th>
                  <Th right>Custo</Th>
                </tr>
              </thead>
              <tbody>
                {explosao.map((e) => (
                  <tr key={e.mid}>
                    <Td>
                      {e.m ? (
                        <>
                          <span className="font-mono text-[12px] text-muted mr-1.5">{e.m.sku}</span>
                          {e.m.nome}
                        </>
                      ) : (
                        <span className="text-danger">insumo {e.mid} não encontrado</span>
                      )}
                    </Td>
                    <Td right>{num(e.q, 4)}</Td>
                    <Td className="text-muted">{e.m?.unidadeConsumo ?? '—'}</Td>
                    <Td right className="text-muted">{e.m ? brl(e.m.custoMedio) : '—'}</Td>
                    <Td right className="font-medium">{e.m ? brl(e.q * e.m.custoMedio) : '—'}</Td>
                  </tr>
                ))}
                <tr>
                  <td className="px-5 py-3 border-b border-border/70 align-middle font-semibold" colSpan={4}>
                    Total
                  </td>
                  <Td right className="font-semibold">{brl(custoTotal)}</Td>
                </tr>
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <History size={16} className="text-faint" /> Versões nesta sessão
          </span>
        }
      >
        {hist.length === 0 ? (
          <p className="text-[13px] text-muted">
            Cada «Salvar» cria uma nova versão. {bomAtual ? `A versão atual (v${bomAtual.versao}) foi salva ${relativo(bomAtual.atualizadoEm)}.` : 'Este produto ainda não tem ficha.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {hist.map((v) => (
              <li key={v.versao} className="py-2 flex items-center gap-3 text-sm">
                <Badge tone={v.versao === bomAtual?.versao ? 'ok' : 'neutral'}>v{v.versao}</Badge>
                <span className="text-muted text-[12px] flex-1">{dataHoraBR(v.em)} · {v.linhas} linhas</span>
                <span className="font-medium tabular-nums">{brl(v.custo)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
