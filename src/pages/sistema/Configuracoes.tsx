import { useState } from 'react'
import { PageHeader, Tabs } from '../../ui'
import ConfigAparencia from './ConfigAparencia'
import ConfigDispositivos from './ConfigDispositivos'
import ConfigEmpresa from './ConfigEmpresa'
import ConfigLocais from './ConfigLocais'
import ConfigNotificacoes from './ConfigNotificacoes'
import ConfigPlano from './ConfigPlano'
import ConfigProducao from './ConfigProducao'
import ConfigUsuarios from './ConfigUsuarios'

type Aba = 'empresa' | 'producao' | 'usuarios' | 'dispositivos' | 'locais' | 'notificacoes' | 'plano' | 'aparencia'

export default function Configuracoes() {
  const [aba, setAba] = useState<Aba>('empresa')
  return (
    <>
      <PageHeader title="Configurações" subtitle="Empresa, produção, pessoas, aparelhos e cobrança." />
      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { id: 'empresa', label: 'Empresa' },
          { id: 'producao', label: 'Produção' },
          { id: 'usuarios', label: 'Usuários' },
          { id: 'dispositivos', label: 'Dispositivos e operadores' },
          { id: 'locais', label: 'Locais' },
          { id: 'notificacoes', label: 'Notificações' },
          { id: 'plano', label: 'Plano e cobrança' },
          { id: 'aparencia', label: 'Aparência' },
        ]}
      />
      {aba === 'empresa' && <ConfigEmpresa />}
      {aba === 'producao' && <ConfigProducao />}
      {aba === 'usuarios' && <ConfigUsuarios />}
      {aba === 'dispositivos' && <ConfigDispositivos />}
      {aba === 'locais' && <ConfigLocais />}
      {aba === 'notificacoes' && <ConfigNotificacoes />}
      {aba === 'plano' && <ConfigPlano />}
      {aba === 'aparencia' && <ConfigAparencia />}
    </>
  )
}
