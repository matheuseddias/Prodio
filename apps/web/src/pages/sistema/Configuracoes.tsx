import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth'
import { PageHeader, Tabs } from '../../ui'
import ConfigAparencia from './ConfigAparencia'
import ConfigDispositivos from './ConfigDispositivos'
import ConfigEmpresa from './ConfigEmpresa'
import ConfigEtiquetas from './ConfigEtiquetas'
import ConfigImportarES from './ConfigImportarES'
import ConfigLocais from './ConfigLocais'
import ConfigNotificacoes from './ConfigNotificacoes'
import ConfigPlano from './ConfigPlano'
import ConfigProducao from './ConfigProducao'
import ConfigUsuarios from './ConfigUsuarios'

type Aba = 'empresa' | 'producao' | 'etiquetas' | 'usuarios' | 'dispositivos' | 'locais' | 'notificacoes' | 'importar' | 'plano' | 'aparencia'

export default function Configuracoes() {
  // ?aba=etiquetas abre direto na aba (link "Configurar perfis e tamanhos" da tela de Etiquetas).
  const [params] = useSearchParams()
  const [aba, setAba] = useState<Aba>(() => (['producao', 'etiquetas', 'notificacoes'].includes(params.get('aba') ?? '') ? (params.get('aba') as Aba) : 'empresa'))
  // Importar do ES grava cadastro em lote: só admin vê a aba (a RPC import_catalog também exige admin).
  const admin = useAuth().papel === 'admin'
  const itens: { id: Aba; label: string }[] = [
    { id: 'empresa', label: 'Empresa' },
    { id: 'producao', label: 'Produção' },
    { id: 'etiquetas', label: 'Etiquetas' },
    { id: 'usuarios', label: 'Usuários' },
    { id: 'dispositivos', label: 'Chão de fábrica' },
    { id: 'locais', label: 'Locais' },
    { id: 'notificacoes', label: 'Notificações' },
    ...(admin ? [{ id: 'importar' as const, label: 'Importar do ES' }] : []),
    { id: 'plano', label: 'Assinatura' },
    { id: 'aparencia', label: 'Aparência' },
  ]
  return (
    <>
      <PageHeader title="Configurações" subtitle="Empresa, produção, etiquetas, pessoas, aparelhos do chão de fábrica, importação e assinatura." />
      <Tabs value={aba} onChange={setAba} items={itens} />
      {aba === 'empresa' && <ConfigEmpresa />}
      {aba === 'producao' && <ConfigProducao onEtiquetas={() => setAba('etiquetas')} />}
      {aba === 'etiquetas' && <ConfigEtiquetas />}
      {aba === 'usuarios' && <ConfigUsuarios />}
      {aba === 'dispositivos' && <ConfigDispositivos />}
      {aba === 'locais' && <ConfigLocais />}
      {aba === 'notificacoes' && <ConfigNotificacoes />}
      {aba === 'importar' && admin && <ConfigImportarES onPerfis={() => setAba('etiquetas')} />}
      {aba === 'plano' && <ConfigPlano />}
      {aba === 'aparencia' && <ConfigAparencia />}
    </>
  )
}
