// Tamanhos de etiqueta da empresa (label_sizes): lista, padrão, edição e exclusão. Cadastrar e alterar é do admin
// (RPC save_label_size); os outros papéis veem a lista. Banco sem a tabela: mostra os tamanhos de fábrica e avisa.
import { larguraDoRoloMm, nomeDasMedidas, presetsComId } from '@prodio/core/etiquetaTamanhos'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../app/auth'
import { num } from '../../domain/format'
import { useStore } from '../../domain/store'
import type { LabelProfile, LabelSize, Product } from '../../domain/types'
import { Badge, Button, Card, Table, Td, Th } from '../../ui'
import TamanhoModal from './ConfigTamanhoModal'

const mm = (n: number) => `${num(n, Number.isInteger(n) ? 0 : 1)} mm`

/** Silhueta da etiqueta (proporção real, 40 px de altura no máximo). */
function Silhueta({ t }: { t: LabelSize }) {
  const k = Math.min(40 / t.alturaMm, 64 / larguraDoRoloMm(t))
  return (
    <div className="flex items-center" style={{ gap: `${t.espacoColunasMm * k}px` }} aria-hidden>
      {Array.from({ length: t.colunas }, (_, i) => (
        <div key={i} className="rounded-[2px] border border-muted/60 bg-surface" style={{ width: `${t.larguraMm * k}px`, height: `${t.alturaMm * k}px` }} />
      ))}
    </div>
  )
}

export default function TamanhosEtiqueta({ produtos, perfis }: { produtos: Product[]; perfis: LabelProfile[] }) {
  const { labelSizes, saveLabelSize, removeLabelSize, modo } = useStore()
  const admin = useAuth().papel === 'admin'
  const [editando, setEditando] = useState<LabelSize | 'novo' | null>(null)
  const semTabela = labelSizes.length === 0
  const lista = semTabela ? presetsComId() : labelSizes
  const usoDe = (t: LabelSize) => perfis.filter((p) => p.tamanhoId === t.id || (!p.tamanhoId && t.padrao)).map((p) => p.familia)
  const podeEditar = admin && !semTabela

  const apagar = (t: LabelSize) => {
    const uso = usoDe(t)
    const texto = uso.length ? `Apagar "${t.nome}"? ${uso.join(', ')} ${uso.length === 1 ? 'volta' : 'voltam'} para o tamanho padrão.` : `Apagar "${t.nome}"?`
    if (window.confirm(texto)) removeLabelSize(t.id)
  }

  return (
    <Card
      title="Tamanhos de etiqueta"
      actions={
        podeEditar && (
          <Button size="sm" variant="primary" onClick={() => setEditando('novo')}>
            <Plus size={14} /> Novo tamanho
          </Button>
        )
      }
      padded={false}
    >
      <div className="px-5 pb-2">
        <p className="mb-3 text-[13px] text-muted">
          Cada impressora e cada rolo têm a sua medida. Cadastre os tamanhos que a fábrica usa e escolha em cada família qual sai; a etiqueta se ajusta (QR e texto crescem ou
          encolhem, o serial nunca é cortado) e a impressão sai na medida exata.
        </p>
        {semTabela && (
          <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">
            {modo === 'supabase'
              ? 'O banco ainda não tem os tamanhos cadastráveis (publicação pendente). Até lá a impressão usa os três tamanhos de fábrica abaixo.'
              : 'Sem tamanhos cadastrados: a impressão usa os três tamanhos de fábrica.'}
          </p>
        )}
        {!admin && !semTabela && <p className="mb-3 text-[12px] text-faint">Só o administrador cadastra e altera tamanhos. A escolha do tamanho de cada família fica em Perfis por família.</p>}
        <Table>
          <thead>
            <tr>
              <Th></Th>
              <Th>Tamanho</Th>
              <Th>Medidas</Th>
              <Th>Impressora</Th>
              <Th>Rolo</Th>
              <Th>Famílias</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => {
              const uso = usoDe(t)
              return (
                <tr key={t.id}>
                  <Td className="w-[76px]">
                    <Silhueta t={t} />
                  </Td>
                  <Td>
                    <div className="font-medium">{t.nome}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {t.padrao && <Badge tone="accent">padrão</Badge>}
                      {t.preset && <Badge>de fábrica</Badge>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {nomeDasMedidas(t.larguraMm, t.alturaMm)}
                    <div className="text-[12px] text-muted">margem {mm(t.margemMm)}{t.orientacao === 'girada' ? ' · girada 90°' : ''}</div>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{t.dpi} dpi</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {t.colunas === 1 ? '1 coluna' : `${t.colunas} colunas`}
                    <div className="text-[12px] text-muted">{t.colunas > 1 ? `vão ${mm(t.espacoColunasMm)} · rolo ${mm(larguraDoRoloMm(t))}` : `rolo ${mm(t.larguraMm)}`}</div>
                  </Td>
                  <Td className="text-[13px]">
                    {uso.length ? <span title={uso.join(', ')}>{uso.length === 1 ? uso[0] : `${uso.length} famílias`}</span> : <span className="text-faint">nenhuma</span>}
                  </Td>
                  <Td right>
                    <div className="flex justify-end gap-1">
                      {podeEditar && !t.padrao && (
                        <Button size="sm" variant="ghost" onClick={() => saveLabelSize({ ...t, padrao: true })} title="Usar como padrão das famílias sem tamanho escolhido">
                          <Star size={14} /> Padrão
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditando(t)} aria-label={`${podeEditar ? 'Editar' : 'Ver'} ${t.nome}`}>
                        <Pencil size={14} /> {podeEditar ? 'Editar' : 'Ver'}
                      </Button>
                      {podeEditar && (
                        <Button size="sm" variant="ghost" disabled={t.padrao} onClick={() => apagar(t)} title={t.padrao ? 'O padrão não pode ser apagado: marque outro como padrão antes' : 'Apagar'} aria-label={`Apagar ${t.nome}`}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>
      {editando && (
        <TamanhoModal
          tamanho={editando === 'novo' ? null : editando}
          outros={lista}
          produtos={produtos}
          perfis={perfis}
          somenteLeitura={!podeEditar}
          onSalvar={(t) => {
            saveLabelSize(t)
            setEditando(null)
          }}
          onClose={() => setEditando(null)}
        />
      )}
    </Card>
  )
}
