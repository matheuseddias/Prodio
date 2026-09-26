// Passo 3 da importação do ES: o que a gravação fez de verdade (contagens do banco), o que ficou de fora,
// as famílias sem perfil de etiqueta e o lembrete de apagar o arquivo.
import { juntarPrevia, type PlanoImportacaoES, type ResultadoImportacao } from '@prodio/core/importacaoEs'
import { AlertTriangle, CheckCircle2, Link2, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { num } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Badge, Button, Card, Stat, Table, Td, Th } from '../../ui'
import { nomeDaChave } from './importarESDetalhe'
import { ENTIDADES, PLURAL, chaveExibida, familiasSemPerfil, mudouDesdeAPrevia, resumoContagem, textoItensReligados, totais } from './importarESLogica'

export interface PropsResultado {
  plano: PlanoImportacaoES
  simulada: ResultadoImportacao
  gravada: ResultadoImportacao
  /** "da Base", "dos conectores"…: de onde vêm os pedidos religados (origemDosPedidos). */
  origemPedidos: string
  onOutroArquivo: () => void
  onPerfis?: () => void
}

export default function ImportarESResultado({ plano, simulada, gravada, origemPedidos, onOutroArquivo, onPerfis }: PropsResultado) {
  const { products, tenant } = useStore()
  const navigate = useNavigate()
  const previa = useMemo(() => juntarPrevia(plano, gravada), [plano, gravada])
  const problemas = previa.linhas.filter((l) => l.situacao === 'problema')
  const t = totais(previa)
  const familias = useMemo(() => familiasSemPerfil(plano.payload.produtos.map((p) => p.sku), products, tenant.perfisEtiqueta), [plano, products, tenant.perfisEtiqueta])
  const mudou = mudouDesdeAPrevia(simulada, gravada)
  const religados = textoItensReligados(gravada.itensPedidoReligados, origemPedidos)

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-[var(--radius-card)] border border-ok/30 bg-ok-soft p-4 text-ok">
        <CheckCircle2 size={22} className="mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold">Importação gravada.</p>
          <p>
            {num(t.novos)} novos, {num(t.atualizados)} atualizados, {num(t.iguais)} iguais
            {t.problemas ? `, ${num(t.problemas)} com problema (ficaram de fora)` : ''}. Nada foi apagado e o que não estava no arquivo ficou como estava.
          </p>
        </div>
      </div>
      {religados && (
        <div className="flex gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <Link2 size={16} className="mt-0.5 shrink-0 text-accent" /> {religados}
        </div>
      )}
      {mudou && (
        <div className="flex gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> O catálogo mudou desde a prévia (alguém editou o cadastro no meio). Os números abaixo são os da gravação.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ENTIDADES.map((e) => {
          const c = gravada.contagens[e.id]
          return (
            <Stat
              key={e.id}
              label={e.curto}
              value={num(c.novos + c.atualizados)}
              hint={
                <>
                  {resumoContagem(c)}
                  {c.problemas > 0 && <span className="text-danger"> · {num(c.problemas)} com problema</span>}
                </>
              }
            />
          )
        })}
      </div>

      {problemas.length > 0 && (
        <Card title={`Ficaram de fora (${problemas.length})`}>
          <p className="mb-2 text-[13px] text-muted">Corrija no ES ou no Prodio e importe de novo: o que já entrou fica igual.</p>
          <Table>
            <thead>
              <tr>
                <Th>O quê</Th>
                <Th>Chave</Th>
                <Th>Nome</Th>
                <Th>Motivo</Th>
              </tr>
            </thead>
            <tbody>
              {problemas.map((l) => (
                <tr key={`${l.entidade}|${l.chave}`}>
                  <Td className="whitespace-nowrap align-top text-muted">{PLURAL[l.entidade]}</Td>
                  <Td mono className="whitespace-nowrap align-top">
                    {chaveExibida(l.entidade, l.chave)}
                  </Td>
                  <Td className="align-top">{l.nome ?? nomeDaChave(l.entidade, l.chave, plano.payload) ?? '—'}</Td>
                  <Td className="align-top text-[13px] text-danger">{l.mensagens.join(' · ') || 'problema'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {familias.length > 0 && (
        <Card title="Famílias sem perfil de etiqueta" actions={onPerfis && <Button size="sm" onClick={onPerfis}>Abrir perfis de etiqueta</Button>}>
          <p className="mb-2 text-[13px] text-muted">Os produtos destas famílias vão sair com a etiqueta padrão (prefixo ET, tamanho padrão) até ganharem um perfil próprio (Configurações → Etiquetas).</p>
          <div className="flex flex-wrap gap-2">
            {familias.map((f) => (
              <Badge key={f.familia} tone="warn">
                {f.familia} · prefixo {f.prefixo}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
        <Trash2 size={16} className="mt-0.5 shrink-0 text-muted" />
        <span>Apague o arquivo de backup do computador (e da lixeira): ele tem as senhas do ES.</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={() => navigate('/cadastros/produtos')}>Ver produtos</Button>
        <Button onClick={() => navigate('/cadastros/insumos')}>Ver insumos</Button>
        <Button onClick={() => navigate('/cadastros/fichas')}>Ver fichas técnicas</Button>
        <Button variant="ghost" className="sm:ml-auto" onClick={onOutroArquivo}>
          Importar outro arquivo
        </Button>
      </div>
    </div>
  )
}
