import { ArrowDownToLine, ChevronRight } from 'lucide-react'
import { brl } from '../../domain/format'
import { avaliarPreco, custosDoCanal, precoParaMargem, type ResultadoPreco } from '@prodio/core'
import { useStore } from '../../domain/store'
import type { Channel, Product } from '../../domain/types'
import { Badge, Button, Card, Table, Td, Th, cx } from '../../ui'
import { MargemBadge, NumInput } from './campos'
import { pctBR } from './precoUtils'

// Comissão, taxa fixa, frete, imposto, ads, parcelamento e outros: a decomposição inteira fica no detalhe do canal
// (clique na linha); aqui entra a soma (core: custosDoCanal), para a tabela caber no cartão em 1366 px sem rolar de lado.
const partes = (x: ResultadoPreco): [string, number][] => [
  ['Comissão', x.comissao],
  ['Taxa fixa', x.taxaFixa],
  ['Frete', x.frete],
  ['Imposto', x.imposto],
  ['Ads', x.ads],
  ['Parcelamento', x.parcelamento],
  ['Outros', x.outros],
]

export default function TabelaCanais({
  produto,
  canais,
  custo,
  pesoKg,
  margemAlvo,
  selecionado,
  onSelecionar,
}: {
  produto: Product
  canais: Channel[]
  custo: number
  pesoKg: number
  margemAlvo: number
  selecionado: string | null
  onSelecionar: (id: string) => void
}) {
  const s = useStore()
  const linhas = canais.map((c) => {
    const sugerido = precoParaMargem(c, custo, pesoKg, margemAlvo)
    const praticado = produto.precoVenda?.[c.id]
    const atual = praticado !== undefined ? avaliarPreco(c, praticado, custo, pesoKg) : null
    return { c, sugerido, praticado, atual }
  })
  const semPreco = linhas.filter((l) => l.praticado === undefined).length
  const abaixo = linhas.filter((l) => l.atual && l.atual.margem < margemAlvo).length

  return (
    <Card
      title={
        <span className="flex items-center gap-2 flex-wrap">
          Preço por canal
          <span className="text-[12px] font-normal text-muted">
            custo {brl(custo)} · {pesoKg > 0 ? `${pesoKg.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg` : 'sem peso'} · margem alvo {pctBR(margemAlvo)}
          </span>
        </span>
      }
      actions={
        <>
          {abaixo > 0 && <Badge tone="warn">{abaixo} abaixo da meta</Badge>}
          {semPreco > 0 && <Badge>{semPreco} sem preço</Badge>}
        </>
      }
      padded={false}
    >
      <div className="px-5 pb-2">
        <Table>
          <thead>
            <tr>
              <Th>Canal</Th>
              <Th right>Sugerido</Th>
              <Th right className="hidden 2xl:table-cell">
                <span title="Comissão, taxa fixa, frete, imposto, ads, parcelamento e outros, no preço sugerido">Custos</span>
              </Th>
              <Th right className="whitespace-nowrap">Praticado hoje</Th>
              <Th right className="whitespace-nowrap">Margem hoje</Th>
              <Th>
                <span className="sr-only">Aplicar</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ c, sugerido, praticado, atual }) => {
              const ativo = selecionado === c.id
              const dif = praticado !== undefined ? praticado - sugerido.preco : undefined
              return (
                <tr
                  key={c.id}
                  onClick={() => onSelecionar(c.id)}
                  className={cx('cursor-pointer transition-colors hover:bg-surface-2/60', ativo && 'bg-accent-soft/40')}
                >
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <ChevronRight size={14} className={cx('text-faint transition-transform', ativo && 'rotate-90')} />
                      <div className="min-w-0">
                        <div className="font-medium leading-snug max-w-[220px]">{c.nome}</div>
                        <div className="text-[11px] text-muted">
                          {c.comissaoPct}% com.{c.taxaFixa ? ` · fixa ${brl(c.taxaFixa)}` : ''}
                          {c.freteVendedor.length ? ' · frete' : ''}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td right>
                    <div className="font-semibold text-accent-text whitespace-nowrap">{brl(sugerido.preco)}</div>
                    <div className="text-[11px] text-ok whitespace-nowrap">lucro {brl(sugerido.lucro)}</div>
                  </Td>
                  <Td right className="hidden 2xl:table-cell text-muted">
                    <span className="whitespace-nowrap" title={partes(sugerido).map(([k, v]) => `${k}: ${brl(v)}`).join('\n')}>
                      {brl(custosDoCanal(sugerido))}
                    </span>
                  </Td>
                  <Td right>
                    <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-end gap-0.5">
                      <NumInput
                        value={praticado}
                        onCommit={(v) => s.setPrecoVenda(produto.id, c.id, v)}
                        prefix="R$"
                        min={0}
                        allowEmpty
                        placeholder="—"
                        className="w-28"
                        ariaLabel={`Preço praticado em ${c.nome}`}
                      />
                      {dif !== undefined && Math.abs(dif) >= 0.01 && (
                        <span className={cx('text-[11px] tabular-nums whitespace-nowrap', dif < 0 ? 'text-warn' : 'text-muted')}>
                          {dif > 0 ? '+' : '−'}
                          {brl(Math.abs(dif))} vs. sugerido
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td right>
                    {atual ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <MargemBadge margem={atual.margem} alvo={margemAlvo} />
                        <span className={cx('text-[11px] tabular-nums', atual.lucro < 0 ? 'text-danger' : 'text-muted')}>lucro {brl(atual.lucro)}</span>
                      </div>
                    ) : (
                      <Badge>sem preço</Badge>
                    )}
                  </Td>
                  <Td right>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant={praticado === undefined ? 'primary' : 'secondary'}
                        onClick={() => s.setPrecoVenda(produto.id, c.id, sugerido.preco)}
                        disabled={praticado !== undefined && Math.abs(praticado - sugerido.preco) < 0.005}
                        title="Aplicar preço sugerido"
                        aria-label={`Aplicar preço sugerido em ${c.nome}`}
                      >
                        <ArrowDownToLine size={14} />
                        <span className="hidden 2xl:inline">Aplicar</span>
                      </Button>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>
      <div className="px-5 py-3 border-t border-border text-[12px] text-muted">
        Clique numa linha para ver a decomposição (comissão, taxa fixa, frete, imposto, ads, parcelamento e outros) e simular outro preço. Preços sugeridos terminam em ,x9 e já cobrem todos esses custos.
      </div>
    </Card>
  )
}
