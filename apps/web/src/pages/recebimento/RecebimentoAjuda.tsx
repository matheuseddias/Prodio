import { Check, Copy, FileUp, Loader2, Mail, Plug, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth'
import { mensagemErro } from '../../data/erros'
import { enviarXmlNfe, resumoXmlEnviado } from '../../data/nfeXml'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, cx } from '../../ui'
import { emailXml } from './nfeUtils'

/** Cartão "Como as notas chegam": as três origens oficiais de NF-e no Prodio. */
export function ComoChegam() {
  const { tenant, connectors, modo, recarregar } = useStore()
  const { tenantId } = useAuth()
  const email = emailXml(tenant)
  const [copiado, setCopiado] = useState(false)
  const [upload, setUpload] = useState<{ nome: string; estado: 'enviando' | 'ok' | 'erro'; detalhe?: string } | null>(null)
  const erpNfe = connectors.filter((c) => c.status === 'conectado' && c.capacidades.nfeCompra)

  // O arquivo vai para POST /nfe/xml no worker, que roda o parser do core e grava a nota. Depois a
  // lista de notas é recarregada do banco — a tela não cria nem adivinha item nenhum.
  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return
    if (modo === 'memoria') {
      setUpload({ nome: arquivo.name, estado: 'erro', detalhe: 'Sem banco configurado, o XML não é enviado a lugar nenhum. Este modo é só demonstração.' })
      return
    }
    setUpload({ nome: arquivo.name, estado: 'enviando' })
    try {
      const r = await enviarXmlNfe(arquivo, tenantId)
      await recarregar()
      setUpload({ nome: arquivo.name, estado: 'ok', detalhe: resumoXmlEnviado(r) })
    } catch (e) {
      setUpload({ nome: arquivo.name, estado: 'erro', detalhe: mensagemErro(e) })
    }
  }

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
              <label
                className={cx(
                  'inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium',
                  upload?.estado === 'enviando' ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2',
                )}
              >
                {upload?.estado === 'enviando' ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
                {upload?.estado === 'enviando' ? 'Enviando…' : 'Enviar XML'}
                <input type="file" accept=".xml,text/xml" className="hidden" disabled={upload?.estado === 'enviando'} onChange={(e) => void enviar(e.target.files?.[0])} />
              </label>
            </div>
            {upload && (
              <div className="mt-2 text-[12px] text-muted">
                <span className="font-mono">{upload.nome}</span>
                {upload.detalhe && (
                  <>
                    {' · '}
                    <span className={upload.estado === 'erro' ? 'text-danger' : 'text-ok'}>{upload.detalhe}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
            <Plug size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              ERP conectado{' '}
              {erpNfe.length ? <Badge tone="ok">{erpNfe.map((c) => c.nome.split(' ')[0]).join(', ')} ativo</Badge> : <Badge tone="neutral">ainda não disponível</Badge>}
            </div>
            {/* `nfeCompra` sai de data/mapeadoresConectores: o worker sabe procurar a nota pela
                chave no Bling e no Tiny (findInboundNfe), mas nenhum job nem rota chama isso. */}
            <div className="text-muted">
              Traria as NF-e de compra lançadas no Bling ou no Tiny. O Prodio ainda não busca notas no ERP: por enquanto, use o e-mail ou o envio de XML acima.
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
            <ScanSearch size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              Consulta por chave na hora do bipe <Badge tone="neutral">ainda não disponível</Badge>
            </div>
            <div className="text-muted">
              Buscaria o XML na SEFAZ quando a chave bipada não estivesse no Prodio, por um provedor (Focus NFe com certificado A1, ou NFE.io por consulta paga). Enquanto não existir, a chave
              desconhecida no chão de fábrica oferece o recebimento às cegas contra a OC.{' '}
              <Link to="/conectores" className="font-medium text-accent-text hover:underline">
                Ver em Conectores
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
