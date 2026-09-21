import { Check, Download, Loader2, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { brl, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Connector, Product } from '../../domain/types'
import { Badge, Button, EmptyState, Select, cx } from '../../ui'
import { Nota } from './ConectorCard'
import { META, PUSH_CATALOGO, SKUS_SEM_DEPARA } from './ConectorMeta'

const CAMPOS_ENVIADOS = ['SKU', 'Nome', 'EAN', 'NCM', 'Peso', 'Preço por canal (quando houver)']

interface Props {
  c: Connector
  depara: Record<string, string>
  setDepara: (fn: (d: Record<string, string>) => Record<string, string>) => void
}

/** Aba Catálogo do modal de configuração: importar do ERP (De-Para) e enviar produtos ao ERP/hub. */
export function ConectorCatalogo({ c, depara, setDepara }: Props) {
  const { products, channels } = useStore()
  const m = META[c.plataforma]
  const push = PUSH_CATALOGO[c.plataforma]
  const [importando, setImportando] = useState<'idle' | 'rodando' | 'ok'>('idle')
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [enviados, setEnviados] = useState<Set<string>>(() => new Set())
  const [enviando, setEnviando] = useState(false)

  const ativos = useMemo(() => products.filter((p) => p.status === 'ativo'), [products])
  // Simulação: produto sem alias comercial ainda não existe na plataforma.
  const naoVinculados = useMemo(() => ativos.filter((p) => p.aliases.length === 0), [ativos])
  const pendentes = naoVinculados.filter((p) => !enviados.has(p.id))
  const podeEnviar = c.capacidades.pushCatalogo && push.ficha !== 'confirmar'

  const importar = () => {
    setImportando('rodando')
    window.setTimeout(() => setImportando('ok'), 1500)
  }
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const todos = () => setSel(sel.size === pendentes.length ? new Set() : new Set(pendentes.map((p) => p.id)))
  const enviar = () => {
    if (!sel.size) return
    setEnviando(true)
    window.setTimeout(() => {
      setEnviados((e) => new Set([...e, ...sel]))
      setSel(new Set())
      setEnviando(false)
    }, 1500)
  }

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
      {/* Importar do ERP (De-Para) */}
      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold">Importar produtos do ERP</h4>
            <p className="text-sm text-muted">SKUs externos que chegaram em pedidos e ainda não têm produto correspondente no Prodio.</p>
          </div>
          <span title={c.plataforma === 'baselinker' ? 'BaseLinker não expõe ficha técnica' : m.catalogo} className="inline-flex shrink-0">
            <Button size="sm" disabled={c.plataforma === 'baselinker' || c.plataforma === 'magis5' || importando === 'rodando'} onClick={importar}>
              {importando === 'rodando' ? <Loader2 size={14} className="animate-spin" /> : importando === 'ok' ? <Check size={14} /> : <Download size={14} />}
              {importando === 'ok' ? 'Importado' : 'Importar ficha técnica do ERP'}
            </Button>
          </span>
        </div>
        {SKUS_SEM_DEPARA.length === 0 ? (
          <EmptyState title="Tudo mapeado" />
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
                {SKUS_SEM_DEPARA.map((s) => (
                  <tr key={s} className="border-t border-border/70">
                    <td className="px-3 py-2 font-mono text-[13px]">{s}</td>
                    <td className="px-3 py-2">
                      <Select value={depara[s] ?? ''} onChange={(e) => setDepara((d) => ({ ...d, [s]: e.target.value }))} className="h-9">
                        <option value="">Selecionar…</option>
                        {ativos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} · {p.nome} {p.atributos.cor ? `(${p.atributos.cor})` : ''}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Enviar produtos ao ERP/hub */}
      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold">Enviar produtos ao ERP/hub</h4>
            <p className="text-sm text-muted">Produtos do Prodio que ainda não existem em {c.nome.split(' ')[0]}. O SKU vira o código do produto na plataforma; nada de planilha.</p>
          </div>
          <Button size="sm" variant="primary" disabled={!podeEnviar || sel.size === 0 || enviando} onClick={enviar} className="shrink-0" title={!podeEnviar ? push.texto : undefined}>
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {enviando ? 'Enviando…' : `Enviar ${sel.size || ''} produto${sel.size === 1 ? '' : 's'}`.replace('  ', ' ')}
          </Button>
        </div>

        <Nota tone={push.ficha === 'confirmar' ? 'warn' : 'info'}>{push.texto}</Nota>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span>Campos enviados:</span>
          {CAMPOS_ENVIADOS.map((f) => (
            <span key={f} className="rounded-md bg-surface-2 px-2 py-0.5 font-medium text-text">
              {f}
            </span>
          ))}
          {push.ficha === 'sim' && <span className="rounded-md bg-accent-soft px-2 py-0.5 font-medium text-accent-text">Ficha técnica</span>}
        </div>

        {naoVinculados.length === 0 ? (
          <EmptyState title="Todos os produtos já existem na plataforma" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-surface-2 text-[12px] uppercase tracking-wide text-muted">
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" aria-label="Selecionar todos" checked={pendentes.length > 0 && sel.size === pendentes.length} onChange={todos} disabled={!podeEnviar || pendentes.length === 0} />
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
                {naoVinculados.map((p) => {
                  const enviado = enviados.has(p.id)
                  return (
                    <tr key={p.id} className={cx('border-t border-border/70', enviado && 'text-muted')}>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" aria-label={`Selecionar ${p.sku}`} checked={sel.has(p.id)} disabled={enviado || !podeEnviar} onChange={() => toggle(p.id)} />
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
                      <td className="px-3 py-2">{enviado ? <Badge tone="ok">enviado</Badge> : <Badge tone="warn">não vinculado</Badge>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[12px] text-faint">Produtos com alias comercial já estão vinculados à plataforma e não aparecem aqui.</p>
      </section>
    </div>
  )
}
