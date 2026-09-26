import { useState } from 'react'
import { useAuth } from '../../app/auth'
import { PageHeader, Tabs } from '../../ui'
import ConfigAparencia from './ConfigAparencia'
import ConfigDispositivos from './ConfigDispositivos'
import ConfigEmpresa from './ConfigEmpresa'
import ConfigImportarES from './ConfigImportarES'
import ConfigLocais from './ConfigLocais'
import ConfigNotificacoes from './ConfigNotificacoes'
import ConfigPlano from './ConfigPlano'
import ConfigProducao from './ConfigProducao'
import ConfigUsuarios from './ConfigUsuarios'

type Aba = 'empresa' | 'producao' | 'usuarios' | 'dispositivos' | 'locais' | 'notificacoes' | 'importar' | 'plano' | 'aparencia'

export default function Configuracoes() {
  const [aba, setAba] = useState<Aba>('empresa')
  // Importar do ES grava cadastro em lote: só admin vê a aba (a RPC import_catalog também exige admin).
  const admin = useAuth().papel === 'admin'
  const itens: { id: Aba; label: string }[] = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'producao', label: 'Produção' },
    { id: 'usuarios', label: 'Usuários' },
    { id: 'dispositivos', label: 'Dispositivos e operadores' },
    { id: 'locais', label: 'Locais' },
    { id: 'notificacoes', label: 'Notificações' },
    ...(admin ? [{ id: 'importar' as const, label: 'Importar do ES' }] : []),
    { id: 'plano', label: 'Plano e cobrança' },
    { id: 'aparencia', label: 'Aparência' },
  ]
  return (
    <>
      <PageHeader title="Configurações" subtitle="Empresa, produção, pessoas, aparelhos, importação e cobrança." />
      <Tabs value={aba} onChange={setAba} items={itens} />
      {aba === 'empresa' && <ConfigEmpresa />}
      {aba === 'producao' && <ConfigProducao />}
      {aba === 'usuarios' && <ConfigUsuarios />}
      {aba === 'dispositivos' && <ConfigDispositivos />}
      {aba === 'locais' && <ConfigLocais />}
      {aba === 'notificacoes' && <ConfigNotificacoes />}
      {aba === 'importar' && admin && <ConfigImportarES onPerfis={() => setAba('producao')} />}
      {aba === 'plano' && <ConfigPlano />}
      {aba === 'aparencia' && <ConfigAparencia />}
    </>
  )
}
