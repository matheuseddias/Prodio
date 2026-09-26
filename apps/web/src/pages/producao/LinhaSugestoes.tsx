// Sugestão do dia pela média de vendas (docs/melhorias.md item 13): o que a demanda dos pedidos pede para
// hoje e ainda não está no plano. "Aplicar" grava pela set_daily_plan só produto fora do plano: o ajuste
// da encarregada nunca é sobrescrito.
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { COBERTURA_ACABADO_PADRAO } from '@prodio/core/planejamento'
import { linhasParaAplicar, type LinhaSugerida } from '../../domain/demanda'
import { num, pct } from '../../domain/format'
import { useLookups, useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, Table, Td, Th, cx } from '../../ui'

const VISIVEIS = 30

export default function LinhaSugestoes({ sugestoes, temPlano }: { sugestoes: LinhaSugerida[]; temPlano: boolean }) {
  const { demanda, tenant, adicionarAoPlano } = useStore()
  const { productRef } = useLookups()
  const [todos, setTodos] = useState(false)
  const [aplicadas, setAplicadas] = useState<number | null>(null)
  if (!demanda.disponivel) return null

  const fora = sugestoes.filter((s) => !s.noPlano && s.sugerido > 0)
  const aplicaveis = linhasParaAplicar(fora)
  const total = aplicaveis.reduce((a, l) => a + l.projetado, 0)
  const temDerivada = fora.some((s) => s.demandaDerivada > 0)
  // Componente fabricado (pino, base) não entra no plano pela demanda dos pais: o bipe do pai já baixa o insumo dele.
  const componentes = sugestoes.filter((s) => s.componente).sort((a, b) => b.demandaDerivada - a.demandaDerivada)
  const visiveis = todos ? fora : fora.slice(0, VISIVEIS)
  const cobertura = tenant.diasCoberturaAcabado ?? COBERTURA_ACABADO_PADRAO

  if (fora.length === 0) {
    if (temPlano) return null
    return (
      <Card className="mb-5">
        <EmptyState icon={<Sparkles size={28} />} title="Sem sugestão para hoje" description={motivoSemSugestao(demanda)} action={
          demanda.semProduto.skus > 0 ? (
            <Link to="/compras/necessidade" className="text-[13px] text-accent-text hover:underline">
              Ver os SKUs sem produto
            </Link>
          ) : undefined
        } />
      </Card>
    )
  }

  const aplicar = () => setAplicadas(adicionarAoPlano(aplicaveis))

  return (
    <Card
      padded={false}
      className="mb-5"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles size={16} className="text-accent-text" />
          {temPlano ? `Sugeridos fora do plano (${fora.length})` : 'Sugestão de hoje pela média de vendas'}
          {demanda.exemplo && <Badge tone="warn">dados de exemplo</Badge>}
        </span>
      }
      actions={
        <Button variant="primary" size="sm" disabled={aplicaveis.length === 0} onClick={aplicar}>
          {temPlano ? 'Adicionar ao plano' : 'Aplicar sugestão'} ({num(aplicaveis.length)} {aplicaveis.length === 1 ? 'SKU' : 'SKUs'} · {num(total)} un)
        </Button>
      }
    >
      <p className="px-5 pb-3 text-[13px] text-muted">
        Vendas dos últimos {demanda.dias} dias ({num(demanda.pedidos)} pedidos, inclusive cancelados e enviados), por dia de produção: × 30 ÷ {tenant.diasUteisMes} dias úteis, + {pct(tenant.margemProjecao)} de margem.
        Com o saldo do hub conhecido, repõe até {cobertura} dias de venda no hub; sem saldo, a meta é a demanda de um dia. Tudo menos o que já está em produção.
        {temPlano && ' Quem já está no plano não muda.'}
        {aplicadas !== null && <span className="text-ok"> {num(aplicadas)} linhas entraram no plano.</span>}
      </p>
      <div className="px-5">
        <Table>
          <thead>
            <tr>
              <Th>Produto</Th>
              <Th right className="whitespace-nowrap">Vendido {demanda.dias} d</Th>
              <Th right className="whitespace-nowrap">Demanda/dia</Th>
              {temDerivada && (
                <Th right className="whitespace-nowrap">
                  <span title="Quanto os produtos que levam este na ficha consomem por dia. Não entra no sugerido: o bipe do produto pai já baixa o insumo do componente.">Nos pais/dia</span>
                </Th>
              )}
              <Th right className="whitespace-nowrap">Saldo hub</Th>
              <Th right className="whitespace-nowrap">Em produção</Th>
              <Th right>Sugerido</Th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((s) => {
              const ref = productRef(s.productId)
              return (
                <tr key={s.productId}>
                  <Td className="min-w-[220px]">
                    <div className="font-medium">
                      {ref.nome}
                      {ref.cor && <span className="uppercase text-accent-text"> · {ref.cor}</span>}
                    </div>
                    <div className="text-[12px] text-muted font-mono">{ref.sku}</div>
                  </Td>
                  <Td right className="text-muted">{num(s.vendido)}</Td>
                  <Td right>{num(s.demandaDia, 1)}</Td>
                  {temDerivada && <Td right className="text-muted">{s.demandaDerivada > 0 ? num(s.demandaDerivada, 1) : '—'}</Td>}
                  <Td right className={cx('whitespace-nowrap', s.saldoHub === undefined && 'text-faint')}>{s.saldoHub === undefined ? 'sem saldo' : num(s.saldoHub)}</Td>
                  <Td right className="text-muted">{num(s.emProducao)}</Td>
                  <Td right className="font-semibold">
                    {num(s.sugerido)}
                    <div className="whitespace-nowrap text-[11px] font-normal text-muted">{s.base === 'cobertura' ? `repõe ${cobertura} d` : 'meta de 1 dia'}</div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>
      {componentes.length > 0 && (
        <p className="px-5 pt-3 text-[12px] text-muted">
          Componentes fabricados não entram no plano pela demanda dos produtos que os levam: o bipe do produto pai já baixa o insumo deles
          (entrar no plano e ser bipado à parte baixaria duas vezes). Consumo pelos pais, por dia:{' '}
          {componentes
            .slice(0, 8)
            .map((c) => `${productRef(c.productId).sku} ${num(c.demandaDerivada, 1)}`)
            .join(' · ')}
          {componentes.length > 8 && ` · e mais ${num(componentes.length - 8)}`}.
        </p>
      )}
      {fora.length > VISIVEIS && (
        <div className="px-5 py-3 border-t border-border">
          <Button size="sm" variant="ghost" onClick={() => setTodos((v) => !v)}>
            {todos ? 'Mostrar só os 30 maiores' : `Mostrar todos (${num(fora.length)})`}
          </Button>
        </div>
      )}
    </Card>
  )
}

function motivoSemSugestao(d: ReturnType<typeof useStore>['demanda']): string {
  if (d.pedidos === 0) return `Nenhum pedido confirmado nos últimos ${d.dias} dias. Quando o robô gravar pedidos, a sugestão aparece aqui.`
  if (d.produtos.length === 0) {
    return `Há ${num(d.pedidos)} pedidos nos últimos ${d.dias} dias, mas nenhum item casa com produto do Prodio (${num(d.semProduto.skus)} SKUs sem produto). Cadastre o produto ou o apelido com o SKU da Base.`
  }
  return 'O saldo no hub e o que já está em produção cobrem a demanda dos produtos ativos.'
}
