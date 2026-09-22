// Cartão "Consulta de NF-e por chave".
//
// POR QUE AQUI NÃO SE DIGITA CREDENCIAL: o certificado A1 e a senha do certificado são segredo, e
// segredo do Prodio só existe cifrado em `connector_credentials`, com a chave que mora no worker
// (docs/arquitetura.md, seção 2.12). Não há conector de provedor de NF-e no banco (as plataformas
// aceitas são baselinker, bling, tiny, omie e magis5), não há adaptador no worker e não há rota de
// consulta por chave. A versão anterior desta tela guardava token, nome do arquivo .pfx e senha em
// useState, e o "Testar" era um setTimeout que respondia "devolveu a NF-e 48211 em 0,8 s" sem sair
// do navegador. Enquanto as três peças não existirem, o cartão explica as opções e fica desligado.
import { Check, Copy, FileKey, KeyRound, Mail } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useStore } from '../../domain/store'
import { Badge, Button, Card } from '../../ui'
import { emailXml } from '../recebimento/nfeUtils'
import { Nota } from './ConectorCard'

const PROVEDORES: { id: string; nome: string; modo: string; desc: string; icone: ReactNode }[] = [
  {
    id: 'focus',
    nome: 'Focus NFe',
    modo: 'Certificado A1 do cliente',
    desc: 'Consultaria as NF-e destinadas ao seu CNPJ na SEFAZ (DF-e) com o certificado A1 da empresa, trazendo o XML completo — inclusive de notas que nunca chegaram por e-mail.',
    icone: <FileKey size={18} />,
  },
  {
    id: 'nfeio',
    nome: 'NFE.io',
    modo: 'Consulta por chave, sem certificado',
    desc: 'Consulta paga por chave de acesso: não precisa de certificado, cobra por consulta e devolve o XML quando a nota está autorizada.',
    icone: <KeyRound size={18} />,
  },
]

export function ConectorNfeProvedor() {
  const { tenant } = useStore()
  const email = emailXml(tenant.nome)
  const [copiado, setCopiado] = useState(false)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <Card title="Consulta de NF-e por chave" actions={<Badge tone="neutral">ainda não disponível</Badge>}>
      <p className="text-sm text-muted">
        Quando a chave bipada no recebimento não está no Prodio, um provedor poderia buscar o XML na hora. Esta integração ainda não existe: hoje a nota chega por e-mail, por upload do XML ou
        pelo ERP conectado, e o bipe de uma chave desconhecida oferece o recebimento às cegas contra a OC.
      </p>

      <Nota tone="warn">
        Nada é salvo neste cartão. Certificado A1 e senha são segredo e só podem ser guardados cifrados pelo worker; enquanto não houver conector de provedor no banco e rota de consulta no
        worker, nenhum campo aqui teria para onde ir.
      </Nota>

      <div className="mt-4 space-y-3">
        {PROVEDORES.map((p) => (
          <div key={p.id} className="rounded-lg border border-border p-4 opacity-75">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">{p.icone}</span>
              <div className="min-w-0">
                <div className="font-semibold">
                  {p.nome} <span className="font-normal text-muted">· {p.modo}</span>
                </div>
                <p className="mt-0.5 text-[13px] text-muted">{p.desc}</p>
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-info-soft text-info">
              <Mail size={18} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold">
                XML por e-mail <Badge tone="ok">sempre ativo</Badge>
              </div>
              <p className="mt-0.5 text-[13px] text-muted">Fornecedor ou contador mandam o XML para este endereço e a nota aparece em segundos. Não depende de provedor.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px]">{email}</code>
            <Button size="sm" onClick={copiar}>
              {copiado ? <Check size={14} /> : <Copy size={14} />}
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
