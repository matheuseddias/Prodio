// Cadastro e edição de um tamanho de etiqueta: medidas, margem, impressora, orientação e colunas do rolo, com a
// prévia em escala real ao lado e a conferência das famílias que usam o tamanho. As regras são as do core
// (validarTamanho, avisosDoTamanho) e as mesmas da RPC save_label_size.
import { conferirTamanho, situacaoDaConferencia } from '@prodio/core/etiquetaAmostra'
import { DPIS, avisosDoTamanho, nomeDasMedidas, tamanhoPadrao, validarTamanho } from '@prodio/core/etiquetaTamanhos'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LabelProfile, LabelSize, Product } from '../../domain/types'
import { Button, CampoNumero, Field, Input, Modal, Select, Toggle } from '../../ui'
import { produtoParaEtiqueta } from '../producao/etiquetasImpressao'
import PreviaTamanho from './ConfigTamanhoPrevia'

interface Props {
  tamanho: LabelSize | null
  outros: LabelSize[]
  produtos: Product[]
  perfis: LabelProfile[]
  somenteLeitura: boolean
  onSalvar: (t: LabelSize) => void
  onClose: () => void
}

export default function TamanhoModal({ tamanho, outros, produtos, perfis, somenteLeitura, onSalvar, onClose }: Props) {
  const base = tamanhoPadrao(outros)
  // Tamanho novo nasce com a impressora e a margem do padrão; id fora do formato uuid = "criar" na RPC.
  const [t, setT] = useState<LabelSize>(
    () => tamanho ?? { id: `novo-${Date.now().toString(36)}`, nome: '', larguraMm: 60, alturaMm: 40, margemMm: base.margemMm, dpi: base.dpi, orientacao: 'normal', colunas: 1, espacoColunasMm: 0, padrao: false },
  )
  // O nome acompanha as medidas até a pessoa digitar um nome próprio.
  const [nomeManual, setNomeManual] = useState(!!tamanho)
  const atual: LabelSize = { ...t, nome: nomeManual ? t.nome : nomeDasMedidas(t.larguraMm, t.alturaMm) }
  const set = (d: Partial<LabelSize>) => setT((x) => ({ ...x, ...d }))
  const erros = validarTamanho(atual, outros)
  const avisos = avisosDoTamanho(atual)
  const eraPadrao = !!tamanho?.padrao

  // Famílias que imprimem neste tamanho (as escolhidas nele e, se for o padrão, as que não escolheram).
  const familias = useMemo(() => {
    const usa = perfis.filter((p) => p.tamanhoId === atual.id || (!p.tamanhoId && (atual.padrao || eraPadrao)))
    return usa.map((p) => {
      const doProduto = produtos.filter((x) => x.familia === p.familia).map(produtoParaEtiqueta)
      return { familia: p.familia, situacao: situacaoDaConferencia(conferirTamanho(doProduto, p, atual)) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfis, produtos, JSON.stringify(atual), eraPadrao])

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={somenteLeitura ? atual.nome : tamanho ? `Editar ${tamanho.nome}` : 'Novo tamanho de etiqueta'}
      footer={
        somenteLeitura ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={erros.length > 0} onClick={() => onSalvar(atual)}>
              Salvar tamanho
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <fieldset disabled={somenteLeitura} className="space-y-3">
          <Field label="Nome" hint="Como aparece na escolha do perfil e na impressão.">
            <Input
              value={atual.nome}
              maxLength={40}
              onChange={(e) => {
                setNomeManual(true)
                set({ nome: e.target.value })
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Largura (mm)" hint="Atravessa o rolo">
              <CampoNumero value={t.larguraMm} onChange={(v) => set({ larguraMm: v })} casas={1} min={10} max={220} aria-label="Largura em mm" />
            </Field>
            <Field label="Altura (mm)" hint="Sentido do avanço">
              <CampoNumero value={t.alturaMm} onChange={(v) => set({ alturaMm: v })} casas={1} min={10} max={300} aria-label="Altura em mm" />
            </Field>
            <Field label="Margem (mm)" hint="Nos 4 lados">
              <CampoNumero value={t.margemMm} onChange={(v) => set({ margemMm: v })} casas={1} min={0} max={10} aria-label="Margem em mm" />
            </Field>
            <Field label="Impressora" hint={`${t.dpi === 203 ? 8 : t.dpi === 300 ? 12 : 24} pontos por mm`}>
              <Select value={String(t.dpi)} onChange={(e) => set({ dpi: Number(e.target.value) as LabelSize['dpi'] })} aria-label="Resolução da impressora">
                {DPIS.map((d) => (
                  <option key={d} value={d}>
                    {d} dpi
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Orientação" hint="Girada: para etiqueta estreita e comprida, o conteúdo sai deitado.">
            <Select value={t.orientacao} onChange={(e) => set({ orientacao: e.target.value as LabelSize['orientacao'] })}>
              <option value="normal">Normal</option>
              <option value="girada">Girada 90°</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Colunas no rolo" hint="Etiquetas lado a lado">
              <Select value={String(t.colunas)} onChange={(e) => set({ colunas: Number(e.target.value), espacoColunasMm: Number(e.target.value) > 1 ? t.espacoColunasMm || 2 : 0 })}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vão entre colunas (mm)">
              <CampoNumero value={t.espacoColunasMm} onChange={(v) => set({ espacoColunasMm: v })} casas={1} min={0} max={20} disabled={t.colunas === 1} aria-label="Vão entre colunas em mm" />
            </Field>
          </div>
          <div className="pt-1">
            <Toggle checked={atual.padrao} onChange={(v) => set({ padrao: v })} disabled={eraPadrao || somenteLeitura} label="Tamanho padrão da empresa" />
            <p className="mt-1 text-[12px] text-faint">
              {eraPadrao ? 'Para trocar o padrão, marque outro tamanho como padrão.' : 'Vale para as famílias que não escolheram um tamanho.'}
            </p>
          </div>
          {erros.length > 0 && (
            <ul className="space-y-1 text-[13px] text-danger">
              {erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {avisos.length > 0 && (
            <ul className="space-y-1 text-[13px] text-warn">
              {avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </fieldset>

        <div className="min-w-0 space-y-4">
          {erros.some((e) => /Largura|Altura|Margem|sobram/.test(e)) ? (
            <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-[13px] text-muted">Corrija as medidas para ver a prévia.</p>
          ) : (
            <PreviaTamanho tamanho={atual} produtos={produtos} perfis={perfis} />
          )}
          {familias.length > 0 && (
            <div>
              <div className="mb-1 text-[13px] font-medium">Famílias neste tamanho</div>
              <ul className="space-y-1 text-[13px]">
                {familias.map(({ familia, situacao }) => (
                  <li key={familia} className="flex items-start gap-1.5" title={situacao.textos.join('\n')}>
                    {situacao.nivel === 'erro' ? (
                      <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
                    ) : situacao.nivel === 'aviso' ? (
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
                    ) : (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
                    )}
                    <span>
                      <span className="font-medium">{familia}</span>
                      <span className="text-muted"> — {situacao.nivel === 'ok' ? 'cabe inteira' : situacao.textos[0]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
