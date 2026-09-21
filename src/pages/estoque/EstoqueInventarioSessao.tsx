import { AlertTriangle, CalendarClock, CheckCircle2, Coins, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { brl, num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { Material } from '../../domain/types'
import { Badge, Button, Field, Input, Modal, SearchInput, Select, cx } from '../../ui'
import EstoqueInventarioItens from './EstoqueInventarioItens'
import { LOCAIS_CONTAGEM, congelarItens, novoItem, resumoSessao, uid, unLabel, type ItemSessao, type SessaoInventario } from './inventarioSessoes'

interface Props {
  sessao?: SessaoInventario
  idsIniciais: string[]
  sugestoes: { venceHoje: string[]; abaixoMinimo: string[]; maisCaros: string[] }
  onSalvar: (s: SessaoInventario) => void
  onFechar: (s: SessaoInventario) => void
  onClose: () => void
}

const nova = (): SessaoInventario => ({ id: `inv-${uid()}`, abertaEm: new Date().toISOString(), local: LOCAIS_CONTAGEM[0], por: 'Matheus Moreno', origem: 'desktop', status: 'aberta', itens: [] })

export default function EstoqueInventarioSessao({ sessao, idsIniciais, sugestoes, onSalvar, onFechar, onClose }: Props) {
  const { materials } = useStore()
  const [s, setS] = useState<SessaoInventario>(() => {
    if (sessao) return sessao
    const base = nova()
    return { ...base, itens: idsIniciais.map((id) => materials.find((m) => m.id === id)).filter((m): m is Material => !!m).map(novoItem) }
  })
  const somenteLeitura = s.status === 'fechada'
  const [etapa, setEtapa] = useState<'escolher' | 'contar'>(sessao && sessao.itens.length > 0 ? 'contar' : 'escolher')
  const [busca, setBusca] = useState('')
  const [confirmar, setConfirmar] = useState(false)

  const r = useMemo(() => resumoSessao(s, materials), [s, materials])
  const ids = s.itens.map((i) => i.materialId)

  const toggle = (m: Material) =>
    setS((x) => ({ ...x, itens: ids.includes(m.id) ? x.itens.filter((i) => i.materialId !== m.id) : [...x.itens, novoItem(m)] }))
  const adicionar = (lista: string[]) =>
    setS((x) => {
      const faltam = lista.filter((id) => !x.itens.some((i) => i.materialId === id)).map((id) => materials.find((m) => m.id === id)).filter((m): m is Material => !!m)
      return { ...x, itens: [...x.itens, ...faltam.map(novoItem)] }
    })
  const updItem = (materialId: string, patch: Partial<ItemSessao>) =>
    setS((x) => ({ ...x, itens: x.itens.map((i) => (i.materialId === materialId ? { ...i, ...patch } : i)) }))
  const remover = (materialId: string) => setS((x) => ({ ...x, itens: x.itens.filter((i) => i.materialId !== materialId) }))

  const fechar = () => {
    const itens = congelarItens(s, materials)
    onFechar({ ...s, status: 'fechada', fechadaEm: new Date().toISOString(), itens })
  }
  // sair sem fechar mantém a sessão aberta (retomável), desde que tenha algum insumo
  const sair = () => {
    if (!somenteLeitura && s.itens.length > 0) onSalvar(s)
    onClose()
  }

  const q = busca.trim().toLowerCase()
  const lista = materials.filter((m) => !q || m.nome.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q))
  const chip = (label: string, icon: ReactNode, lista: string[]) => (
    <button type="button" onClick={() => adicionar(lista)} disabled={lista.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] hover:bg-surface-2 disabled:opacity-50">
      {icon} {label} <Badge>{lista.length}</Badge>
    </button>
  )

  const titulo = somenteLeitura ? `Sessão fechada · ${s.local}` : sessao ? `Retomar sessão · ${s.local}` : 'Nova sessão de contagem'

  const rodape = somenteLeitura ? (
    <Button onClick={onClose}>Fechar</Button>
  ) : etapa === 'escolher' ? (
    <>
      <Button onClick={onClose}>Cancelar</Button>
      <Button variant="primary" disabled={s.itens.length === 0} onClick={() => setEtapa('contar')}>Começar contagem · {s.itens.length}</Button>
    </>
  ) : (
    <>
      <span className="mr-auto text-[12px] text-muted tabular-nums">
        {r.contados.length} de {s.itens.length} contados · {r.divergentes.length} divergentes
        {r.semMotivo.length > 0 && <span className="text-warn"> · {r.semMotivo.length} sem motivo</span>}
      </span>
      <Button variant="ghost" onClick={() => setEtapa('escolher')}><Plus size={14} /> Insumos</Button>
      <Button onClick={sair}>Salvar e sair</Button>
      <Button variant="primary" disabled={!r.completa} onClick={() => setConfirmar(true)}>Fechar sessão</Button>
    </>
  )

  return (
    <Modal open onClose={sair} title={titulo} size="xl" footer={rodape}>
      {etapa === 'escolher' && !somenteLeitura ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Local">
              <Select value={s.local} onChange={(e) => setS((x) => ({ ...x, local: e.target.value }))}>
                {LOCAIS_CONTAGEM.map((l) => <option key={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Quem conta">
              <Input value={s.por} onChange={(e) => setS((x) => ({ ...x, por: e.target.value }))} />
            </Field>
          </div>
          <div>
            <div className="text-[13px] font-medium text-muted mb-1.5">Sugestões</div>
            <div className="flex flex-wrap gap-2">
              {chip('Vence hoje', <CalendarClock size={14} className="text-warn" />, sugestoes.venceHoje)}
              {chip('Abaixo do mínimo', <AlertTriangle size={14} className="text-danger" />, sugestoes.abaixoMinimo)}
              {chip('Mais caros', <Coins size={14} className="text-accent-text" />, sugestoes.maisCaros)}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[13px] font-medium text-muted">Insumos da sessão</span>
              <span className="text-[12px] text-muted tabular-nums">{s.itens.length} selecionados</span>
            </div>
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar insumo…" />
            <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-border rounded-lg border border-border">
              {lista.map((m) => {
                const on = ids.includes(m.id)
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => toggle(m)} className={cx('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2', on && 'bg-accent-soft/30')}>
                      <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-white dark:text-slate-900' : 'border-border')}>{on && <CheckCircle2 size={14} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.nome}</span>
                        <span className="block text-[12px] text-muted font-mono">{m.sku} · {num(m.saldo, m.unidadeConsumo === 'un' ? 0 : 2)} {unLabel(m.unidadeConsumo)} · {brl(m.saldo * m.custoMedio)}</span>
                      </span>
                      {sugestoes.venceHoje.includes(m.id) && <Badge tone="warn">vence</Badge>}
                      {m.saldo < m.minimo && <Badge tone="danger">mínimo</Badge>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
            <span>Local <strong className="text-text">{s.local}</strong></span>
            <span>Quem <strong className="text-text">{s.por}</strong></span>
            {r.contados.length > 0 && (
              <span className="sm:ml-auto tabular-nums">
                Divergência <strong className={cx(r.valorDiverg > 0 ? 'text-warn' : 'text-ok')}>{brl(r.valorDiverg)}</strong> ({num(r.pct, 1)}%)
              </span>
            )}
          </div>
          <EstoqueInventarioItens itens={r.itens} somenteLeitura={somenteLeitura} onChange={updItem} onRemover={remover} />
          {!somenteLeitura && <p className="mt-3 text-[12px] text-faint">Sobras aproveitáveis contam como estoque. Quebra e caco não entram na contagem: viram diferença com o motivo «Quebra».</p>}
        </>
      )}

      <Modal open={confirmar} onClose={() => setConfirmar(false)} title="Fechar sessão" size="sm" footer={<><Button onClick={() => setConfirmar(false)}>Voltar</Button><Button variant="primary" onClick={fechar}>Fechar e ajustar</Button></>}>
        <p className="text-sm text-muted">
          {r.divergentes.length === 0
            ? 'Tudo bateu. Nenhum ajuste será gerado; a sessão fica registrada para a acurácia.'
            : `Serão lançados ${r.divergentes.length} ajuste${r.divergentes.length === 1 ? '' : 's'} de estoque (motivo «Inventário · …»), somando ${brl(r.valorDiverg)}. Os demais ${r.contados.length - r.divergentes.length} itens bateram.`}
        </p>
      </Modal>
    </Modal>
  )
}
