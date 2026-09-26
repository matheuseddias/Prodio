// Tabelas da aba Produtividade: por operador, por SKU e fechamentos do período.
import { Download } from 'lucide-react'
import { dataBR, num, pct } from '../../domain/format'
import { useLookups } from '../../domain/store'
import { Badge, Button, Card, EmptyState, Table, Td, Th, cx } from '../../ui'
import { aderenciaDe, baixarCsv, csvFechamentos, toneAderencia, type DiaProducao, type LinhaOperador, type LinhaSku } from './produtividadeUtils'

export function TabelaOperadores({ linhas, periodo }: { linhas: LinhaOperador[]; periodo: number }) {
  return (
    <Card title="Por operador" padded={false} actions={<span className="text-[13px] text-muted">bipes de hoje · sem apontamento manual</span>}>
      {linhas.length === 0 ? (
        <EmptyState title="Sem bipes hoje" />
      ) : (
        <div className="px-5 pb-2">
          <Table>
            <thead>
              <tr>
                <Th>Operador</Th>
                <Th right>Peças hoje</Th>
                <Th right>Média/hora</Th>
                <Th right>Participação</Th>
                <Th right>{periodo} dias (est.)</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((o, i) => (
                <tr key={o.nome}>
                  <Td>
                    <span className="text-faint tabular-nums mr-1.5">{i + 1}.</span>
                    <span className="font-medium">{o.nome}</span>
                  </Td>
                  <Td right className="font-semibold">{num(o.hoje)}</Td>
                  <Td right>{num(o.mediaHora, 1)}</Td>
                  <Td right>
                    <div className="inline-flex items-center gap-2">
                      <span className="h-1.5 w-16 rounded-full bg-surface-2 overflow-hidden">
                        <span className="block h-full bg-accent rounded-full" style={{ width: `${Math.round(o.participacao * 100)}%` }} />
                      </span>
                      <span className="tabular-nums w-10 text-right">{pct(o.participacao)}</span>
                    </div>
                  </Td>
                  <Td right className="text-muted">{num(o.periodoEstimado)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

export function TabelaSkus({ linhas }: { linhas: LinhaSku[] }) {
  const { productRef } = useLookups()
  return (
    <Card title="Por SKU" padded={false} actions={<span className="text-[13px] text-muted">hoje × projetado</span>}>
      {linhas.length === 0 ? (
        <EmptyState title="Sem produção hoje" />
      ) : (
        <div className="px-5 pb-2">
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th right>Projetado</Th>
                <Th right>Bipado</Th>
                <Th right>Aderência</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const ref = productRef(l.productId)
                return (
                  <tr key={l.productId}>
                    <Td>
                      <div className="min-w-[160px]">
                        <span className={cx(ref.removido && 'text-muted italic')}>{ref.nome}</span>
                        {ref.cor && <span className="uppercase text-accent-text"> · {ref.cor}</span>}
                      </div>
                      <div className="text-[12px] text-muted font-mono">{ref.sku}</div>
                    </Td>
                    <Td right className="text-muted">{num(l.projetado)}</Td>
                    <Td right className={cx('font-semibold', l.projetado === 0 && 'text-warn')}>{num(l.hoje)}</Td>
                    <Td right>
                      {l.projetado > 0 ? (
                        <Badge tone={toneAderencia(l.aderencia)}>{pct(l.aderencia)}</Badge>
                      ) : (
                        <Badge tone="warn">fora do plano</Badge>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  )
}

export function Fechamentos({ historico, periodo }: { historico: DiaProducao[]; periodo: number }) {
  const linhas = [...historico].reverse()
  const exportar = () => baixarCsv(`fechamentos-${periodo}d.csv`, csvFechamentos(historico))
  return (
    <Card
      title="Fechamentos"
      padded={false}
      actions={
        <Button size="sm" onClick={exportar}>
          <Download size={14} /> Exportar CSV
        </Button>
      }
    >
      {linhas.length === 0 ? (
        <EmptyState title="Ainda sem histórico" description="Os fechamentos aparecem aqui a partir do primeiro dia com projeção ou bipe." />
      ) : (
      <div className="px-5 pb-2 max-h-[420px] overflow-y-auto">
        <Table>
          <thead>
            <tr>
              <Th>Dia</Th>
              <Th right>Projetado</Th>
              <Th right>Produzido</Th>
              <Th right>Aderência</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((d, i) => {
              const folga = d.projetado === 0
              return (
                <tr key={d.dia} className={cx(folga && 'text-faint')}>
                  <Td className="whitespace-nowrap">
                    {dataBR(d.dia + 'T12:00:00')}
                    {i === 0 && <Badge tone="accent" className="ml-2">hoje · parcial</Badge>}
                  </Td>
                  <Td right>{folga ? '—' : num(d.projetado)}</Td>
                  <Td right className={cx(!folga && 'font-medium')}>{folga ? '—' : num(d.produzido)}</Td>
                  <Td right>{folga ? <span className="text-[12px]">sem produção</span> : <Badge tone={toneAderencia(aderenciaDe(d))}>{pct(aderenciaDe(d))}</Badge>}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>
      )}
    </Card>
  )
}
