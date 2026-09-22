// De-Para de SKU: SKUs externos que chegaram em pedidos e ainda não têm produto no Prodio.
//
// A lista vem de `order_items` (product_id nulo) e o vínculo é gravado em `sku_aliases` na hora em
// que o produto é escolhido — não há botão Salvar aqui de propósito: cada linha é uma escrita só.
// É esse vínculo que faz o próximo pedido com esse SKU virar demanda do produto certo.
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../app/auth'
import { lerSkusSemDePara, vincularSkuExterno, type SkuSemDePara } from '../../data/conectores'
import { mensagemErro } from '../../data/erros'
import { useStore } from '../../domain/store'
import { EmptyState, Select } from '../../ui'
import { Nota } from './ConectorCard'

type EstadoLinha = 'idle' | 'salvando' | 'ok' | 'erro'

export function ConectorDePara({ onPendentes }: { onPendentes?: (n: number) => void }) {
  const { products, modo } = useStore()
  const { tenantId } = useAuth()
  const [lista, setLista] = useState<SkuSemDePara[]>([])
  const [carregando, setCarregando] = useState(modo === 'supabase')
  const [erro, setErro] = useState<string | null>(null)
  const [vinculado, setVinculado] = useState<Record<string, string>>({})
  const [estado, setEstado] = useState<Record<string, EstadoLinha>>({})
  const [erroLinha, setErroLinha] = useState<Record<string, string>>({})

  const ativos = useMemo(() => products.filter((p) => p.status === 'ativo'), [products])
  const pendentes = lista.filter((s) => !vinculado[s.sku]).length

  // A aba Catálogo mostra este número no badge. `onPendentes` é um setState do pai (estável).
  useEffect(() => {
    onPendentes?.(pendentes)
  }, [pendentes, onPendentes])

  useEffect(() => {
    if (modo !== 'supabase') return
    let ativo = true
    void lerSkusSemDePara()
      .then((l) => ativo && setLista(l))
      .catch((e) => ativo && setErro(mensagemErro(e)))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [modo])

  const vincular = async (sku: string, productId: string) => {
    if (!productId) return
    setEstado((s) => ({ ...s, [sku]: 'salvando' }))
    setErroLinha((s) => ({ ...s, [sku]: '' }))
    try {
      await vincularSkuExterno(tenantId, sku, productId)
      setVinculado((v) => ({ ...v, [sku]: productId }))
      setEstado((s) => ({ ...s, [sku]: 'ok' }))
    } catch (e) {
      setEstado((s) => ({ ...s, [sku]: 'erro' }))
      setErroLinha((s) => ({ ...s, [sku]: mensagemErro(e) }))
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h4 className="font-semibold">SKUs de pedido sem produto no Prodio</h4>
        <p className="text-sm text-muted">
          Vieram em pedidos da plataforma e não bateram com nenhum SKU daqui. Escolher o produto grava o vínculo na hora; o próximo pedido com esse código já entra como demanda dele.
        </p>
      </div>

      {modo !== 'supabase' ? (
        <Nota>Sem banco configurado, não há pedidos reais para conferir. Esta lista sai de order_items quando o worker começar a trazer pedidos.</Nota>
      ) : erro ? (
        <Nota tone="warn">{erro}</Nota>
      ) : carregando ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Lendo os pedidos…
        </div>
      ) : lista.length === 0 ? (
        <EmptyState title="Nada pendente" description="Todo SKU que chegou em pedido tem produto correspondente no Prodio." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 text-left font-medium">SKU externo</th>
                <th className="px-3 py-2 text-left font-medium">Produto no Prodio</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => {
                const e = estado[s.sku] ?? 'idle'
                return (
                  <tr key={s.sku} className="border-t border-border/70">
                    <td className="px-3 py-2">
                      <div className="font-mono text-[13px]">{s.sku}</div>
                      <div className="text-[12px] text-muted">
                        {s.vezes} {s.vezes === 1 ? 'linha de pedido' : 'linhas de pedido'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Select value={vinculado[s.sku] ?? ''} disabled={e === 'salvando'} onChange={(ev) => void vincular(s.sku, ev.target.value)} className="h-9">
                          <option value="">Selecionar…</option>
                          {ativos.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} · {p.nome} {p.atributos.cor ? `(${p.atributos.cor})` : ''}
                            </option>
                          ))}
                        </Select>
                        {e === 'salvando' && <Loader2 size={14} className="shrink-0 animate-spin text-muted" />}
                        {e === 'ok' && <Check size={14} className="shrink-0 text-ok" />}
                        {e === 'erro' && <AlertTriangle size={14} className="shrink-0 text-danger" />}
                      </div>
                      {erroLinha[s.sku] && <div className="mt-1 text-[12px] text-danger">{erroLinha[s.sku]}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
