import { Check, Copy, FileUp, Mail, Plug, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../domain/store'
import { Badge, Button, Card } from '../../ui'
import { emailXml } from './nfeUtils'

/** Cartão "Como as notas chegam": as três origens oficiais de NF-e no Prodio. */
export function ComoChegam() {
  const { tenant, connectors } = useStore()
  const email = emailXml(tenant.nome)
  const [copiado, setCopiado] = useState(false)
  const [upload, setUpload] = useState<string | null>(null)
  const erpNfe = connectors.filter((c) => c.status === 'conectado' && c.capacidades.nfeCompra)

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
    <Card title="Como as notas chegam">
      <ul className="space-y-4 text-sm">
        <li className="flex gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-info-soft text-info">
            <Mail size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">XML por e-mail, upload ou compartilhamento</div>
            <div className="text-muted">
              Peça ao fornecedor (ou ao contador) para mandar o XML para este endereço: a nota aparece aqui em segundos. No celular, compartilhe o arquivo do e-mail ou do WhatsApp direto
              para o Prodio.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px]">{email}</code>
              <Button size="sm" onClick={copiar}>
                {copiado ? <Check size={14} /> : <Copy size={14} />}
                {copiado ? 'Copiado' : 'Copiar'}
              </Button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
                <FileUp size={14} /> Enviar XML
                <input type="file" accept=".xml,text/xml" className="hidden" onChange={(e) => setUpload(e.target.files?.[0]?.name ?? null)} />
              </label>
            </div>
            {upload && (
              <div className="mt-2 text-[12px] text-muted">
                <span className="font-mono">{upload}</span> · <span className="text-warn">parser no servidor: em breve</span>
              </div>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
            <Plug size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">ERP conectado</div>
            <div className="text-muted">
              Bling, Tiny ou Omie trazem as NF-e de compra lançadas no ERP automaticamente.{' '}
              {erpNfe.length ? <Badge tone="ok">{erpNfe.map((c) => c.nome.split(' ')[0]).join(', ')} ativo</Badge> : <Badge tone="neutral">nenhum ERP com NF-e de compra conectado</Badge>}
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
            <ScanSearch size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Consulta por chave na hora do bipe</div>
            <div className="text-muted">
              Quando a chave bipada no recebimento não está no Prodio, o provedor de NF-e busca o XML na SEFAZ na hora: Focus NFe (certificado A1 da empresa) ou NFE.io (consulta paga por
              chave, sem certificado).{' '}
              <Link to="/conectores" className="font-medium text-accent-text hover:underline">
                Configurar em Conectores
              </Link>
            </div>
          </div>
        </li>
      </ul>
    </Card>
  )
}

export function RegrasCfop() {
  return (
    <Card title="Regras de CFOP">
      <div className="space-y-3 text-sm">
        <div>
          <div className="mb-1 flex items-center gap-2 font-medium">
            <Badge tone="ok">entram automático</Badge>
          </div>
          <ul className="text-muted space-y-0.5">
            <li>
              <span className="font-mono text-text">5101 / 5102</span> · venda de produção ou de terceiros
            </li>
            <li>
              <span className="font-mono text-text">5401 / 5403 / 5405</span> · venda com substituição tributária
            </li>
            <li>
              <span className="font-mono text-text">6xxx</span> · os mesmos códigos de outro estado
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2 font-medium">
            <Badge tone="warn">pedem classificação manual</Badge>
          </div>
          <ul className="text-muted space-y-0.5">
            <li>
              <span className="font-mono text-text">5901 / 5902</span> · remessa e retorno de industrialização
            </li>
            <li>
              <span className="font-mono text-text">5910</span> · bonificação ou brinde
            </li>
            <li>
              <span className="font-mono text-text">5915 / 5916</span> · remessa e retorno de conserto
            </li>
            <li>
              <span className="font-mono text-text">5202</span> · devolução de compra
            </li>
            <li>
              <span className="font-mono text-text">5949</span> · outras saídas
            </li>
          </ul>
        </div>
        <p className="text-[12px] text-faint">A regra vale por item: uma nota pode ter itens que entram e itens que não entram no estoque.</p>
      </div>
    </Card>
  )
}
