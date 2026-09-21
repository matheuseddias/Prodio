import { useState } from 'react'
import { useStore } from '../../domain/store'
import { PageHeader, Tabs } from '../../ui'
import Calculadora from './Calculadora'
import Canais from './Canais'
import Parametros from './Parametros'
import TabelaPrecos from './TabelaPrecos'

type Aba = 'calculadora' | 'tabela' | 'canais' | 'parametros'

export default function Precificacao() {
  const s = useStore()
  const [aba, setAba] = useState<Aba>('calculadora')
  // Imposto padrão para canais novos: parâmetro de tela (ainda não existe no Tenant).
  const [impostoPadrao, setImpostoPadrao] = useState(6)

  const ativos = s.channels.filter((c) => c.ativo).length
  const semPreco = s.products.filter((p) => p.status === 'ativo' && s.channels.some((c) => c.ativo && p.precoVenda?.[c.id] === undefined)).length

  return (
    <>
      <PageHeader
        title="Precificação por canal"
        subtitle="Preço de venda calculado a partir do custo real da ficha técnica, com as taxas de cada canal que você configura."
      />
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'calculadora', label: 'Calculadora' },
          { id: 'tabela', label: 'Tabela de preços', count: semPreco || undefined },
          { id: 'canais', label: 'Canais', count: ativos },
          { id: 'parametros', label: 'Parâmetros' },
        ]}
      />
      {aba === 'calculadora' && <Calculadora onIrParaCanais={() => setAba('canais')} />}
      {aba === 'tabela' && <TabelaPrecos />}
      {aba === 'canais' && <Canais impostoPadrao={impostoPadrao} />}
      {aba === 'parametros' && <Parametros impostoPadrao={impostoPadrao} onImpostoPadrao={setImpostoPadrao} />}
    </>
  )
}
