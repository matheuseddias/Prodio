// Configurações › Etiquetas: os tamanhos que a empresa usa (label_sizes) e o perfil de cada família, com o
// tamanho escolhido. Os perfis eram editados em Produção; vieram para cá junto com os tamanhos, e família nova
// não trava mais o Salvar da aba Produção.
import { useMemo, useState } from 'react'
import { useStore } from '../../domain/store'
import type { LabelProfile } from '../../domain/types'
import { Card } from '../../ui'
import { produtoParaEtiqueta } from '../producao/etiquetasImpressao'
import { mesclarPerfis, perfilInvalido } from './ConfigPerfis'
import PerfisEtiquetaEditor from './ConfigPerfisEditor'
import { SaveBar } from './ConfigShared'
import TamanhosEtiqueta from './ConfigTamanhos'

export default function ConfigEtiquetas() {
  const { tenant, setTenant, products, labelSizes } = useStore()
  const familias = useMemo(() => Array.from(new Set(products.map((p) => p.familia))), [products])
  const base = useMemo(() => mesclarPerfis(tenant.perfisEtiqueta, familias), [tenant.perfisEtiqueta, familias])
  // Sem edição, a tela acompanha o store (um tamanho apagado devolve o perfil ao padrão na hora).
  const [rascunho, setRascunho] = useState<LabelProfile[] | null>(null)
  const perfis = rascunho ?? base
  const dirty = rascunho !== null && JSON.stringify(rascunho) !== JSON.stringify(base)
  const invalidos = perfis.filter(perfilInvalido).length
  const produtosPorFamilia = useMemo(() => {
    const m = new Map<string, ReturnType<typeof produtoParaEtiqueta>[]>()
    for (const p of products) m.set(p.familia, [...(m.get(p.familia) ?? []), produtoParaEtiqueta(p)])
    return m
  }, [products])

  const salvar = () => {
    // Tamanho que sumiu enquanto a tela estava aberta volta ao padrão (a FK recusaria o id apagado).
    const existe = new Set(labelSizes.map((t) => t.id))
    const perfisEtiqueta = perfis.map((p) => (p.tamanhoId && !existe.has(p.tamanhoId) ? { ...p, tamanhoId: null } : p))
    setTenant({ ...tenant, perfisEtiqueta })
    setRascunho(null)
  }

  return (
    <div className="space-y-5">
      <TamanhosEtiqueta produtos={products} perfis={tenant.perfisEtiqueta} />
      <Card title="Perfis por família">
        <p className="mb-3 text-[13px] text-muted">
          O serial começa com o prefixo da família. Cada família define quais etiquetas saem por peça (a de Produto é sempre gerada) e em que tamanho elas saem.
        </p>
        <PerfisEtiquetaEditor value={perfis} onChange={setRascunho} tamanhos={labelSizes} produtosPorFamilia={produtosPorFamilia} />
        <SaveBar
          dirty={dirty && invalidos === 0}
          aviso={invalidos > 0 ? `${invalidos} ${invalidos === 1 ? 'família com perfil inválido' : 'famílias com perfil inválido'}` : undefined}
          onSave={salvar}
        />
      </Card>
    </div>
  )
}
