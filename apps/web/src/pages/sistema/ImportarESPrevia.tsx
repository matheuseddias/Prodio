// Passo 2 da importação do ES: a prévia. Junta a análise local do arquivo (plano do core) com a simulação no
// banco (o que a gravação faria no estado atual, sem gravar nada). O botão Importar só liga com uma simulação
// do payload atual e sem bloqueio.
import type { PlanoImportacaoES, PreviaImportacao, ResultadoImportacao } from '@prodio/core/importacaoEs'
import { AlertTriangle, CheckCircle2, Download, FileJson, Link2, Loader2, RefreshCw } from 'lucide-react'
import { dataBR, diaISO, num } from '../../domain/format'
import { Badge, Button, Card, Stat } from '../../ui'
import ImportarESCnpj from './ImportarESCnpj'
import ImportarESTabela from './ImportarESTabela'
import { ENTIDADES, csvPrevia, instrucoesExemplo, resumoContagem, rotuloImportar, textoItensReligados } from './importarESLogica'

const SENTIDO: Record<PlanoImportacaoES['origem']['sentidoDepara'], string> = {
  'TM→ED': 'TM → ED (o atual)',
  'ED→TM': 'ED → TM (o antigo)',
  misto: 'misto (os dois sentidos)',
  'sem de/para': 'sem de/para',
}

function idade(dias: number | undefined): string {
  if (dias === undefined) return ''
  if (dias <= 0) return ' (de hoje)'
  if (dias === 1) return ' (de ontem)'
  return ` (há ${dias} dias)`
}

function baixarCsv(nome: string, conteudo: string) {
  const url = URL.createObjectURL(new Blob([`﻿${conteudo}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface PropsPrevia {
  plano: PlanoImportacaoES
  nomeArquivo: string
  previa: PreviaImportacao | null
  simulacao: ResultadoImportacao | null
  simulando: boolean
  erroSimulacao: string | null
  demonstracao: boolean
  admin: boolean
  /** "da Base", "dos conectores"…: de onde vêm os pedidos que a importação religa (origemDosPedidos). */
  origemPedidos: string
  semCnpj: { nome: string; insumos: number }[]
  cnpjDigitado: Record<string, string>
  cnpjPendente: boolean
  onCnpj: (nome: string, valor: string) => void
  onAtualizarPrevia: () => void
  onSimular: () => void
  onImportar: () => void
  onTrocarArquivo: () => void
}

function Exemplo({ r, onSimular, simulando }: { r: Pick<ResultadoImportacao, 'exemplo' | 'usoReal'>; onSimular: () => void; simulando: boolean }) {
  const { titulo, script, passos } = instrucoesExemplo(r)
  return (
    <Card className="border-danger/40">
      <div className="flex gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" />
        <div className="min-w-0 space-y-2 text-sm">
          <p className="font-semibold text-danger">{titulo}</p>
          <p>
            Script a rodar: <span className="break-all font-mono text-[12px]">{script}</span>
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-muted">
            {passos.map((passo) => (
              <li key={passo}>{passo}</li>
            ))}
          </ol>
          <Button size="sm" onClick={onSimular} disabled={simulando}>
            <RefreshCw size={14} /> Simular de novo
          </Button>
        </div>
      </div>
    </Card>
  )
}

export default function ImportarESPrevia(p: PropsPrevia) {
  const { plano, previa, simulacao } = p
  const exemplo = simulacao?.exemplo
  const temExemplo = !!exemplo && exemplo.produtos + exemplo.insumos + exemplo.fornecedores > 0
  const jaIgual = !!previa && previa.totalGravacoes === 0 && previa.itensPedidoReligados === 0
  const religados = previa ? textoItensReligados(previa.itensPedidoReligados, p.origemPedidos) : undefined
  const outros = (previa?.bloqueios ?? []).filter((b) => !b.startsWith('Há dados de exemplo') && !b.startsWith('Nenhuma alteração'))
  const motivoDesligado = !p.admin
    ? 'Só o administrador da empresa importa.'
    : p.simulando
      ? 'Aguarde a simulação.'
      : !previa
        ? 'A importação só liga depois da simulação no banco.'
        : p.cnpjPendente
          ? 'Clique em "Atualizar prévia" para usar os CNPJs digitados.'
          : jaIgual
            ? 'O Prodio já está igual ao arquivo.'
            : !previa.podeGravar
              ? 'Resolva o bloqueio acima.'
              : undefined

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <FileJson size={22} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 text-sm">
              <div className="truncate font-medium">{p.nomeArquivo}</div>
              <div className="text-muted">
                Backup {plano.origem.dataArquivo ? `de ${dataBR(`${plano.origem.dataArquivo}T12:00:00`)}${idade(plano.origem.idadeDias)}` : 'sem data'} · de/para {SENTIDO[plano.origem.sentidoDepara]}
              </div>
            </div>
          </div>
          <Button size="sm" onClick={p.onTrocarArquivo} disabled={p.simulando}>
            Escolher outro arquivo
          </Button>
        </div>
        {p.demonstracao && (
          <p className="mt-3 rounded-lg bg-info-soft p-3 text-[13px] text-info">
            Modo demonstração (sem banco): a importação vale só nesta aba, sobre os dados de exemplo, e some quando a página é recarregada.
          </p>
        )}
      </Card>

      {plano.avisosGerais.length > 0 && (
        <div className="space-y-1 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
          {plano.avisosGerais.map((a) => (
            <p key={a} className="flex gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {a}
            </p>
          ))}
        </div>
      )}

      {p.simulando && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Conferindo com o cadastro do Prodio (simulação: nada é gravado)…
        </div>
      )}
      {p.erroSimulacao && !p.simulando && (
        <Card className="border-danger/40">
          <p className="text-sm font-semibold text-danger">A simulação falhou. Nada foi gravado.</p>
          <p className="mt-1 text-sm text-muted">{p.erroSimulacao}</p>
          <Button size="sm" className="mt-3" onClick={p.onSimular}>
            <RefreshCw size={14} /> Simular de novo
          </Button>
        </Card>
      )}
      {temExemplo && simulacao && <Exemplo r={simulacao} onSimular={p.onSimular} simulando={p.simulando} />}
      {outros.map((b) => (
        <Card key={b} className="border-danger/40">
          <p className="text-sm font-semibold text-danger">{b}</p>
        </Card>
      ))}
      {jaIgual && !temExemplo && (
        <div className="flex gap-2 rounded-lg border border-ok/30 bg-ok-soft p-3 text-sm text-ok">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> O Prodio já está igual ao arquivo: não há nada a gravar.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ENTIDADES.map((e) => {
          const c = previa?.contagens[e.id]
          const local = plano.contagens[e.id]
          return c ? (
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
          ) : (
            <Stat key={e.id} label={e.curto} value={num(local.entram)} hint={`${num(local.noArquivo)} no arquivo${local.problemas ? ` · ${num(local.problemas)} com problema` : ''}`} />
          )
        })}
      </div>
      <p className="-mt-2 text-[12px] text-muted">O número grande é o que vai ser gravado (novos + atualizados).</p>
      {religados && (
        <div className="flex gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm">
          <Link2 size={16} className="mt-0.5 shrink-0 text-accent" /> {religados}
        </div>
      )}

      {p.semCnpj.length > 0 && (
        <ImportarESCnpj itens={p.semCnpj} digitado={p.cnpjDigitado} pendente={p.cnpjPendente} onChange={p.onCnpj} onAtualizar={p.onAtualizarPrevia} ocupado={p.simulando} />
      )}

      {previa && (
        <Card title="O que muda, item por item">
          <ImportarESTabela linhas={previa.linhas} contagens={previa.contagens} payload={plano.payload} />
        </Card>
      )}

      {plano.origem.ignorado.length > 0 && (
        <Card title="Fica de fora (não sai do arquivo)">
          <div className="flex flex-wrap gap-2">
            {plano.origem.ignorado.map((s) => (
              <Badge key={s.secao}>
                {s.secao}: {num(s.itens)}
              </Badge>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-muted">
            Esses dados não são lidos nem enviados. Os insumos entram com saldo zero: o saldo vem do inventário no Prodio.
          </p>
        </Card>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button onClick={() => previa && baixarCsv(`previa-importacao-es-${diaISO()}.csv`, csvPrevia(previa.linhas))} disabled={!previa}>
          <Download size={15} /> Baixar relatório da prévia (CSV)
        </Button>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button variant="primary" size="lg" onClick={p.onImportar} disabled={!!motivoDesligado}>
            {rotuloImportar(previa)}
          </Button>
          {motivoDesligado && <span className="text-[12px] text-muted">{motivoDesligado}</span>}
        </div>
      </div>
    </div>
  )
}
