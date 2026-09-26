// "Fora do cálculo": o que foi vendido e não virou necessidade de insumo, com o motivo. Antes a tela dizia
// "Nada a comprar" sem explicar que metade das vendas não casava com produto ou não tinha ficha.
import type { LinhaNecessidade } from '@prodio/core/necessidade'
import type { ForaDaDemanda } from '@prodio/core/planejamento'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { num } from '../../domain/format'
import { useLookups } from '../../domain/store'
import { Button, Card } from '../../ui'

const CURTA = 8
const plural = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`

function Bloco({ titulo, dica, link, itens }: { titulo: string; dica: string; link?: { to: string; texto: string }; itens: { chave: string; nome: ReactNode; valor: string }[] }) {
  const [todos, setTodos] = useState(false)
  if (itens.length === 0) return null
  const visiveis = todos ? itens : itens.slice(0, CURTA)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium">{titulo}</div>
        {link && (
          <Link to={link.to} className="text-[12px] text-accent-text hover:underline shrink-0">
            {link.texto}
          </Link>
        )}
      </div>
      <p className="text-[12px] text-muted mb-2">{dica}</p>
      <ul className="space-y-1">
        {visiveis.map((i) => (
          <li key={i.chave} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{i.nome}</span>
            <span className="tabular-nums text-muted shrink-0">{i.valor}</span>
          </li>
        ))}
      </ul>
      {itens.length > CURTA && (
        <Button size="sm" variant="ghost" className="mt-1 -ml-3" onClick={() => setTodos((v) => !v)}>
          {todos ? 'Mostrar menos' : `Ver todos (${num(itens.length)})`}
        </Button>
      )}
    </div>
  )
}

export default function NecessidadeFora({ fora, semCadastro, dias }: { fora: ForaDaDemanda; semCadastro: LinhaNecessidade[]; dias: number }) {
  const { productRef } = useLookups()
  const produto = (id: string) => {
    const ref = productRef(id)
    return (
      <>
        <span className="font-mono text-[12px] text-muted">{ref.sku}</span> {ref.nome}
        {ref.cor && <span className="text-muted"> · {ref.cor}</span>}
      </>
    )
  }
  const unidadesSemFicha = fora.semFicha.reduce((a, p) => a + p.vendido, 0)
  const total = fora.semProduto.skus + fora.semFicha.length + fora.inativos.length + semCadastro.length
  if (total === 0) return null
  return (
    <Card title="Fora do cálculo">
      <div className="grid gap-x-8 md:grid-cols-2 [&>*]:py-3">
        <Bloco
          titulo={`${plural(fora.semProduto.skus, 'SKU vendido', 'SKUs vendidos')} sem produto no Prodio · ${num(fora.semProduto.unidades)} un`}
          dica={`Chegaram nos pedidos dos últimos ${dias} dias e não casam com SKU nem apelido de produto. Cadastre o produto ou o apelido: a importação do ES e o próximo pedido religam sozinhos.`}
          link={{ to: '/cadastros/produtos', texto: 'Produtos' }}
          itens={fora.skusSemProduto.map((s) => ({ chave: `sku:${s.sku}`, nome: <span className="font-mono">{s.sku || '(sem SKU)'}</span>, valor: `${num(s.unidades)} un · ${num(s.pedidos)} ped.` }))}
        />
        <Bloco
          titulo={`${plural(fora.semFicha.length, 'produto vendido', 'produtos vendidos')} sem ficha técnica · ${num(unidadesSemFicha)} un`}
          dica="Entram na Linha de hoje, mas não geram compra de insumo até a ficha ser ativada."
          link={{ to: '/cadastros/fichas', texto: 'Fichas técnicas' }}
          itens={fora.semFicha.map((p) => ({ chave: p.productId, nome: produto(p.productId), valor: `${num(p.vendido)} un` }))}
        />
        <Bloco
          titulo={`${plural(fora.inativos.length, 'produto vendido', 'produtos vendidos')} inativo ou excluído no Prodio`}
          dica="Venderam na janela, mas o produto está inativo no Prodio: fica fora da sugestão do dia (a compra ainda conta, se ele tiver ficha)."
          link={{ to: '/cadastros/produtos', texto: 'Produtos' }}
          itens={fora.inativos.map((p) => ({ chave: p.productId, nome: produto(p.productId), valor: `${num(p.vendido)} un` }))}
        />
        <Bloco
          titulo={`${plural(semCadastro.length, 'insumo de ficha', 'insumos de fichas')} fora do cadastro`}
          dica="Uma ficha ativa aponta para um insumo que não existe mais: a necessidade dele não aparece na lista."
          link={{ to: '/cadastros/insumos', texto: 'Insumos' }}
          itens={semCadastro.map((l) => ({ chave: l.materialId, nome: <span className="font-mono">{l.materialId}</span>, valor: `${num(l.qtdMes, 2)} /mês` }))}
        />
      </div>
    </Card>
  )
}
