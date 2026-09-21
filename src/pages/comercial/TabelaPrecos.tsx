import { AlertTriangle, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, num } from '../../domain/format'
import { avaliarPreco, pesoFaturavel } from '../../domain/precificacao'
import { custoFicha, useStore } from '../../domain/store'
import { Badge, Button, Card, EmptyState, SearchInput, Select, Table, Td, Th, Toggle, cx } from '../../ui'
import { MargemBadge, NumInput } from './campos'
import { baixarCsv, labelProduto, pctBR } from './precoUtils'

export default function TabelaPrecos() {
  const s = useStore()
  const [busca, setBusca] = useState('')
  const [familia, setFamilia] = useState('')
  const [soPendentes, setSoPendentes] = useState(false)
  const margemAlvo = s.tenant.margemAlvoPadrao
  const canais = s.channels.filter((c) => c.ativo)

  const familias = useMemo(() => Array.from(new Set(s.products.map((p) => p.familia))).sort(), [s.products])

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return s.products
      .filter((p) => p.status === 'ativo')
      .filter((p) => !familia || p.familia === familia)
      .filter((p) => !q || p.sku.toLowerCase().includes(q) || p.nome.toLowerCase().includes(q) || p.aliases.some((a) => a.toLowerCase().includes(q)))
      .map((p) => {
        const custo = custoFicha(p.id, s.boms, s.materials) ?? p.custoFicha
        const peso = pesoFaturavel(p)
        const celulas = canais.map((c) => {
          const preco = p.precoVenda?.[c.id]
          const r = preco !== undefined && custo !== undefined ? avaliarPreco(c, preco, custo, peso) : null
          return { c, preco, r }
        })
        const faltando = celulas.filter((x) => x.preco === undefined).length
        return { p, custo, peso, celulas, faltando }
      })
      .filter((l) => !soPendentes || l.faltando > 0 || l.celulas.some((x) => x.r && x.r.margem < margemAlvo))
  }, [busca, familia, soPendentes, s.products, s.boms, s.materials, canais, margemAlvo])

  const totalFaltando = linhas.reduce((a, l) => a + l.faltando, 0)
  const totalAbaixo = linhas.reduce((a, l) => a + l.celulas.filter((x) => x.r && x.r.margem < margemAlvo).length, 0)

  const exportar = () => {
    const cab = ['SKU', 'Produto', 'Família', 'Custo ficha', 'Peso fat. (kg)', ...canais.flatMap((c) => [`Preço ${c.nome}`, `Margem ${c.nome}`, `Lucro ${c.nome}`])]
    const dados = linhas.map((l) => [
      l.p.sku,
      labelProduto(l.p),
      l.p.familia,
      l.custo ?? '',
      l.peso,
      ...l.celulas.flatMap((x) => [x.preco ?? '', x.r ? pctBR(x.r.margem) : '', x.r ? x.r.lucro : '']),
    ])
    baixarCsv(`tabela-precos-${new Date().toISOString().slice(0, 10)}.csv`, [cab, ...dados])
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2 flex-wrap">
          Tabela de preços
          <span className="text-[12px] font-normal text-muted">margem alvo {pctBR(margemAlvo)} · clique numa célula para editar</span>
        </span>
      }
      actions={
        <Button size="sm" onClick={exportar} disabled={linhas.length === 0}>
          <Download size={14} /> Exportar CSV
        </Button>
      }
      padded={false}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-5 pb-3">
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar SKU ou nome…" className="sm:w-72" />
        <Select value={familia} onChange={(e) => setFamilia(e.target.value)} className="sm:w-44" aria-label="Família">
          <option value="">Todas as famílias</option>
          {familias.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </Select>
        <Toggle checked={soPendentes} onChange={setSoPendentes} label="Só pendências" />
        <div className="sm:ml-auto flex items-center gap-2">
          {totalFaltando > 0 && (
            <Badge tone="warn">
              <AlertTriangle size={12} /> {totalFaltando} sem preço
            </Badge>
          )}
          {totalAbaixo > 0 && <Badge tone="danger">{totalAbaixo} abaixo da meta</Badge>}
          {totalFaltando === 0 && totalAbaixo === 0 && linhas.length > 0 && <Badge tone="ok">tudo precificado</Badge>}
        </div>
      </div>
      {canais.length === 0 ? (
        <EmptyState title="Nenhum canal ativo" description="Ative um canal na aba Canais para montar a tabela." />
      ) : linhas.length === 0 ? (
        <EmptyState title="Nenhum produto" description="Ajuste a busca ou o filtro de família." />
      ) : (
        <div className="px-5">
          <Table>
            <thead>
              <tr>
                <Th>Produto</Th>
                <Th right>Custo ficha</Th>
                {canais.map((c) => (
                  <Th key={c.id} right>
                    {c.nome}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ p, custo, celulas, faltando }) => (
                <tr key={p.id} className={cx(faltando > 0 && 'bg-warn-soft/25')}>
                  <Td>
                    <div className="font-medium truncate max-w-[240px]">{labelProduto(p)}</div>
                    <div className="text-[12px] text-muted font-mono">
                      {p.sku} <span className="font-sans">· {p.familia}</span>
                    </div>
                  </Td>
                  <Td right>
                    {custo !== undefined ? (
                      <span className="tabular-nums">{brl(custo)}</span>
                    ) : (
                      <Badge tone="warn">sem ficha</Badge>
                    )}
                    {p.pesoKg !== undefined && <div className="text-[11px] text-faint tabular-nums">{num(pesoFaturavel(p), 2)} kg</div>}
                  </Td>
                  {celulas.map(({ c, preco, r }) => (
                    <Td key={c.id} right className={cx(preco === undefined && 'bg-warn-soft/40')}>
                      <div className="flex flex-col items-end gap-1">
                        <NumInput value={preco} onCommit={(v) => s.setPrecoVenda(p.id, c.id, v)} prefix="R$" min={0} allowEmpty placeholder="—" className="w-32" ariaLabel={`${p.sku} em ${c.nome}`} />
                        {r ? (
                          <MargemBadge margem={r.margem} alvo={margemAlvo} />
                        ) : preco === undefined ? (
                          <span className="text-[11px] text-warn">sem preço</span>
                        ) : (
                          <span className="text-[11px] text-muted">sem custo</span>
                        )}
                      </div>
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <div className="px-5 py-3 border-t border-border text-[12px] text-muted">
        Margem = lucro ÷ preço, com custo da ficha ao vivo e peso faturável do cadastro. Linhas destacadas têm canal sem preço. O CSV usa ponto e vírgula, pronto para o Excel em pt-BR.
      </div>
    </Card>
  )
}
