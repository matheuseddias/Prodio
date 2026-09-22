// Aba Catálogo do modal de configuração.
//
// Duas coisas diferentes convivem aqui:
//   1. o De-Para de SKU, que funciona de verdade (lista real de order_items → sku_aliases) e mora
//      em ConectorDePara.tsx;
//   2. importar ficha técnica do ERP e enviar produtos ao hub, que dependem de rotas no worker que
//      AINDA NÃO EXISTEM. Antes os dois eram um setTimeout que pintava um check verde sem criar
//      produto nenhum. Enquanto a rota não existir, o botão fica desabilitado dizendo o porquê.
import { Download, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Connector, Product } from '../../domain/types'
import { Badge, Button, EmptyState, cx } from '../../ui'
import { Nota } from './ConectorCard'
import { ConectorDePara } from './ConectorDePara'
import { META, PUSH_CATALOGO } from './ConectorMeta'

const CAMPOS_ENVIADOS = ['SKU', 'Nome', 'EAN', 'NCM', 'Peso', 'Preço por canal (quando houver)']

/** Motivo único, escrito uma vez: nenhuma das duas ações tem rota no worker. */
const SEM_ROTA = 'O worker ainda não tem rota para isto. Enquanto não tiver, nada é criado na plataforma — por isso o botão está desligado.'

interface Props {
  c: Connector
  onPendentes?: (n: number) => void
}

export function ConectorCatalogo({ c, onPendentes }: Props) {
  const { products, channels } = useStore()
  const m = META[c.plataforma]
  const push = PUSH_CATALOGO[c.plataforma]
  const [sel, setSel] = useState<Set<string>>(() => new Set())

  const ativos = useMemo(() => products.filter((p) => p.status === 'ativo'), [products])
  // Produto sem alias comercial ainda não foi visto na plataforma.
  const naoVinculados = useMemo(() => ativos.filter((p) => p.aliases.length === 0), [ativos])

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const todos = () => setSel(sel.size === naoVinculados.length ? new Set() : new Set(naoVinculados.map((p) => p.id)))

  const precos = (p: Product) => {
    const pares = Object.entries(p.precoVenda ?? {}).filter(([, v]) => v !== undefined) as [string, number][]
    if (!pares.length) return <span className="text-faint">—</span>
    const titulo = pares.map(([ch, v]) => `${channels.find((x) => x.id === ch)?.nome ?? ch}: ${brl(v)}`).join('\n')
    return (
      <span title={titulo} className="cursor-help underline decoration-dotted decoration-faint">
        {pares.length} {pares.length === 1 ? 'canal' : 'canais'}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <ConectorDePara onPendentes={onPendentes} />

      {/* Importar ficha técnica do ERP */}
      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold">Importar ficha técnica do ERP</h4>
            <p className="text-sm text-muted">
              {c.plataforma === 'baselinker' || c.plataforma === 'magis5' ? `${m.catalogo} ` : ''}
              Traria a estrutura do produto no ERP para a ficha técnica do Prodio.
            </p>
          </div>
          <span title={SEM_ROTA} className="inline-flex shrink-0">
            <Button size="sm" disabled>
              <Download size={14} /> Importar ficha técnica do ERP
            </Button>
          </span>
        </div>
        <Nota tone="warn">{SEM_ROTA}</Nota>
      </section>

      {/* Enviar produtos ao ERP/hub */}
      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold">Enviar produtos ao ERP/hub</h4>
            <p className="text-sm text-muted">Produtos do Prodio que ainda não existem em {c.nome.split(' ')[0]}. O SKU viraria o código do produto na plataforma.</p>
          </div>
          <span title={SEM_ROTA} className="inline-flex shrink-0">
            <Button size="sm" variant="primary" disabled>
              <Send size={14} /> {`Enviar ${sel.size || ''} produto${sel.size === 1 ? '' : 's'}`.replace('  ', ' ')}
            </Button>
          </span>
        </div>

        <Nota tone="warn">
          {SEM_ROTA} Por enquanto, cadastre o produto na plataforma e vincule o SKU externo na tabela acima — é o vínculo que o Prodio usa para reconhecer o pedido.
        </Nota>
        <Nota tone={push.ficha === 'confirmar' ? 'warn' : 'info'}>{push.texto}</Nota>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>Campos que seriam enviados:</span>
          {CAMPOS_ENVIADOS.map((f) => (
            <span key={f} className="rounded-md bg-surface-2 px-2 py-0.5 font-medium text-text">
              {f}
            </span>
          ))}
          {push.ficha === 'sim' && <span className="rounded-md bg-accent-soft px-2 py-0.5 font-medium text-accent-text">Ficha técnica</span>}
        </div>

        {naoVinculados.length === 0 ? (
          <EmptyState title="Todos os produtos já têm SKU vinculado na plataforma" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" aria-label="Selecionar todos" checked={naoVinculados.length > 0 && sel.size === naoVinculados.length} onChange={todos} />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Produto</th>
                  <th className="px-3 py-2 text-left font-medium">EAN</th>
                  <th className="px-3 py-2 text-left font-medium">NCM</th>
                  <th className="px-3 py-2 text-right font-medium">Peso</th>
                  <th className="px-3 py-2 text-left font-medium">Preços</th>
                  <th className="px-3 py-2 text-left font-medium">Ficha</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {naoVinculados.map((p) => (
                  <tr key={p.id} className={cx('border-t border-border/70')}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" aria-label={`Selecionar ${p.sku}`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-text">
                        {p.nome} {p.atributos.cor ? <span className="text-muted">({p.atributos.cor})</span> : null}
                      </div>
                      <div className="font-mono text-[12px] text-muted">{p.sku}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">{p.ean ?? <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{p.ncm ?? <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.pesoKg ? `${num(p.pesoKg, 2)} kg` : <span className="text-faint">—</span>}</td>
                    <td className="px-3 py-2">{precos(p)}</td>
                    <td className="px-3 py-2">{p.temFicha ? <Badge tone="accent">com ficha</Badge> : <Badge tone="neutral">sem ficha</Badge>}</td>
                    <td className="px-3 py-2">
                      <Badge tone="warn">não vinculado</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12px] text-faint">Produtos com alias comercial já estão vinculados à plataforma e não aparecem aqui.</p>
      </section>
    </div>
  )
}
