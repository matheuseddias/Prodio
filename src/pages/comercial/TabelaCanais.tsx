import { ArrowDownToLine, ChevronRight } from 'lucide-react'
import { brl } from '../../domain/format'
import { avaliarPreco, precoParaMargem } from '../../domain/precificacao'
import { useStore } from '../../domain/store'
import type { Channel, Product } from '../../domain/types'
import { Badge, Button, Card, Table, Td, Th, cx } from '../../ui'
import { MargemBadge, NumInput } from './campos'
import { pctBR } from './precoUtils'

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
              <Th right>Comissão</Th>
              <Th right>Taxa fixa</Th>
              <Th right>Frete</Th>
              <Th right>Imposto</Th>
              <Th right>Ads</Th>
              <Th right>Parcel.</Th>
              <Th right>Outros</Th>
              <Th right>Lucro</Th>
              <Th right>Praticado hoje</Th>
              <Th right>Margem hoje</Th>
              <Th />
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
                        <div className="font-medium truncate max-w-[180px]">{c.nome}</div>
                        <div className="text-[11px] text-muted">
                          {c.comissaoPct}% com.{c.taxaFixa ? ` · fixa ${brl(c.taxaFixa)}` : ''}
                          {c.freteVendedor.length ? ' · frete' : ''}
                        </div>
                      </div>
                    </div>
                  </Td>
                  <Td right className="font-semibold text-accent-text">{brl(sugerido.preco)}</Td>
                  <Td right className="text-muted">{brl(sugerido.comissao)}</Td>
                  <Td right className="text-muted">{brl(sugerido.taxaFixa)}</Td>
                  <Td right className="text-muted">{brl(sugerido.frete)}</Td>
                  <Td right className="text-muted">{brl(sugerido.imposto)}</Td>
                  <Td right className="text-muted">{brl(sugerido.ads)}</Td>
                  <Td right className="text-muted">{brl(sugerido.parcelamento)}</Td>
                  <Td right className="text-muted">{brl(sugerido.outros)}</Td>
                  <Td right className="text-ok font-medium">{brl(sugerido.lucro)}</Td>
                  <Td right>
                    <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-end gap-0.5">
                      <NumInput
                        value={praticado}
                        onCommit={(v) => s.setPrecoVenda(produto.id, c.id, v)}
                        prefix="R$"
                        min={0}
                        allowEmpty
                        placeholder="—"
                        className="w-32"
                        ariaLabel={`Preço praticado em ${c.nome}`}
                      />
                      {dif !== undefined && Math.abs(dif) >= 0.01 && (
                        <span className={cx('text-[11px] tabular-nums', dif < 0 ? 'text-warn' : 'text-muted')}>
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
                      >
                        <ArrowDownToLine size={14} /> Aplicar
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
        Clique numa linha para ver a decomposição e simular outro preço. Preços sugeridos terminam em ,x9 e já cobrem comissão, taxa fixa, frete do vendedor, imposto, ads, parcelamento e outros.
      </div>
    </Card>
  )
}
