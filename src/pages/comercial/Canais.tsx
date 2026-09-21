import { Copy, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../../domain/store'
import type { Channel } from '../../domain/types'
import { Badge, Button, Card, EmptyState, Modal, Toggle, cx } from '../../ui'
import CanalModal from './CanalModal'
import { nomePreset, resumoTaxas, uid } from './precoUtils'

export default function Canais({ impostoPadrao }: { impostoPadrao: number }) {
  const s = useStore()
  const [modal, setModal] = useState<{ open: boolean; canal: Channel | null }>({ open: false, canal: null })
  const [remover, setRemover] = useState<Channel | null>(null)

  const duplicar = (c: Channel) => s.upsertChannel({ ...c, id: uid(), nome: `${c.nome} (cópia)`, freteVendedor: c.freteVendedor.map((f) => ({ ...f })) })
  const produtosComPreco = (id: string) => s.products.filter((p) => p.precoVenda?.[id] !== undefined).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted max-w-2xl">
          Cada canal tem as próprias taxas. Comece por um preset e ajuste conforme o seu contrato, ou monte do zero (atacado, representante, loja física…).
        </p>
        <Button variant="primary" onClick={() => setModal({ open: true, canal: null })}>
          <Plus size={16} /> Novo canal
        </Button>
      </div>

      {s.channels.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum canal cadastrado" description="Crie o primeiro canal a partir de um preset ou do zero." action={<Button variant="primary" onClick={() => setModal({ open: true, canal: null })}>Novo canal</Button>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {s.channels.map((c) => (
            <Card key={c.id} className={cx(!c.ativo && 'opacity-70')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{c.nome}</div>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <Badge tone={c.preset ? 'info' : 'neutral'}>{c.preset ? `preset ${nomePreset(c.preset)}` : 'do zero'}</Badge>
                    {c.ativo ? <Badge tone="ok">ativo</Badge> : <Badge>inativo</Badge>}
                  </div>
                </div>
                <Toggle checked={c.ativo} onChange={(v) => s.upsertChannel({ ...c, ativo: v })} />
              </div>
              <ul className="mt-3 flex flex-col gap-1 text-[13px]">
                {resumoTaxas(c).map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent shrink-0" />
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ul>
              {c.observacao && <p className="mt-2 text-[12px] text-muted line-clamp-2">{c.observacao}</p>}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <span className="text-[12px] text-faint">{produtosComPreco(c.id)} produto(s) com preço</span>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setModal({ open: true, canal: c })} title="Editar">
                    <Pencil size={14} /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicar(c)} title="Duplicar" aria-label="Duplicar">
                    <Copy size={14} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemover(c)} title="Remover" aria-label="Remover" className="hover:text-danger">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card title={<span className="flex items-center gap-2"><Info size={16} className="text-accent-text" /> Como o Prodio calcula</span>}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
          <div className="flex flex-col gap-2">
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-[13px]">preço = (custo + fixos) ÷ (1 − %variáveis − margem alvo)</div>
            <p className="text-muted text-[13px]">
              <b className="text-text">Fixos</b> = taxa fixa (quando o preço fica abaixo do limite) + frete do vendedor na faixa do peso faturável. <b className="text-text">Variáveis</b> = comissão + imposto + ads + parcelamento + outros, todos em % do preço.
            </p>
            <p className="text-muted text-[13px]">
              Como o frete e a taxa fixa dependem do próprio preço (faixas e limites), o cálculo itera até estabilizar e arredonda para terminar em ,x9.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 font-mono text-[13px]">lucro = preço − variáveis − fixos − custo · margem = lucro ÷ preço</div>
            <p className="text-muted text-[13px]">
              <b className="text-text">Custo</b> vem da ficha técnica ativa: insumos explodidos × custo médio de estoque. Se o produto não tem ficha, usa o custo do cadastro ou o valor digitado.
            </p>
            <p className="text-muted text-[13px]">
              <b className="text-text">Peso faturável</b> = maior entre peso real e cubado. Margem é sobre o preço de venda, não markup sobre o custo.
            </p>
          </div>
        </div>
      </Card>

      <CanalModal open={modal.open} canal={modal.canal} impostoPadrao={impostoPadrao} onClose={() => setModal({ open: false, canal: null })} onSave={(c) => s.upsertChannel(c)} />

      <Modal
        open={remover !== null}
        onClose={() => setRemover(null)}
        title="Remover canal"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemover(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (remover) s.removeChannel(remover.id)
                setRemover(null)
              }}
            >
              <Trash2 size={14} /> Remover
            </Button>
          </>
        }
      >
        {remover && (
          <p className="text-sm">
            Remover <b>{remover.nome}</b>? {produtosComPreco(remover.id) > 0 && <>Os preços praticados de {produtosComPreco(remover.id)} produto(s) neste canal deixam de aparecer na tabela.</>} Se quiser só pausar, desative o canal.
          </p>
        )}
      </Modal>
    </div>
  )
}
