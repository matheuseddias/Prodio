import { useState } from 'react'
import { Tabs } from '../../ui'
import { Bipes } from './Bipes'
import { Produtividade } from './Produtividade'

type Aba = 'bipes' | 'produtividade'

export default function Apontamentos() {
  const [aba, setAba] = useState<Aba>('bipes')

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Apontamentos</h1>
        <p className="text-sm text-muted mt-1">
          {aba === 'bipes'
            ? 'Histórico de bipes da linha. Cada bipe é um serial único; estornos ficam registrados.'
            : 'Produtividade da linha a partir dos bipes: aderência da projeção, gargalo por hora e quem produz.'}
        </p>
      </div>

      <Tabs<Aba>
        value={aba}
        onChange={setAba}
        items={[
          { id: 'bipes', label: 'Bipes' },
          { id: 'produtividade', label: 'Produtividade' },
        ]}
      />

      {aba === 'bipes' ? <Bipes /> : <Produtividade />}
    </>
  )
}
