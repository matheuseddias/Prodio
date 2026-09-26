// Configurações → Importar do ES: traz fornecedores, insumos, produtos (com apelidos de SKU), fichas técnicas
// e vínculos insumo-fornecedor do backup do Eddias Suprimentos.
//
// Caminho do arquivo: FileReader → lerTextoBackup (JSON.parse + leitura em lista branca do core) → o texto e o
// objeto cru morrem ali. A tela guarda só o backup já em lista branca (num ref, para refazer a prévia com os
// CNPJs digitados) e o plano. Nada do arquivo vai para store, localStorage, URL ou console; ao banco vai só o
// payload de cadastro, primeiro como simulação (a prévia) e depois, exatamente o mesmo, como gravação.
import type { BackupES, PayloadImportacao, PlanoImportacaoES, ResultadoImportacao } from '@prodio/core/importacaoEs'
import { juntarPrevia, planejarBackupES } from '@prodio/core/importacaoEs'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../app/auth'
import { mensagemErro } from '../../data/erros'
import { diaISO } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Button, Card, Modal, cx } from '../../ui'
import ImportarESInstrucoes from './ImportarESInstrucoes'
import ImportarESPrevia from './ImportarESPrevia'
import ImportarESResultado from './ImportarESResultado'
import { cnpjPorNome, cnpjsValidos, conferirArquivo, lerTextoBackup, textoConfirmacao } from './importarESLogica'

type Passo = 'arquivo' | 'previa' | 'resultado'
const PASSOS: { id: Passo; rotulo: string }[] = [
  { id: 'arquivo', rotulo: 'Arquivo' },
  { id: 'previa', rotulo: 'Prévia' },
  { id: 'resultado', rotulo: 'Resultado' },
]

interface Simulacao {
  payload: PayloadImportacao
  resultado: ResultadoImportacao
}

export default function ConfigImportarES({ onPerfis }: { onPerfis?: () => void }) {
  const { papel } = useAuth()
  const { suppliers, modo, simularImportacao, gravarImportacao } = useStore()
  const admin = papel === 'admin'

  const backup = useRef<BackupES | null>(null)
  const rodada = useRef(0)
  const vivo = useRef(true)
  const [passo, setPasso] = useState<Passo>('arquivo')
  const [nomeArquivo, setNomeArquivo] = useState('')
  const [lendo, setLendo] = useState(false)
  const [erroArquivo, setErroArquivo] = useState<string | null>(null)
  const [plano, setPlano] = useState<PlanoImportacaoES | null>(null)
  // Fornecedores sem CNPJ no arquivo (da primeira leitura): continuam no cartão depois de digitados, para corrigir.
  const [semCnpj, setSemCnpj] = useState<{ nome: string; insumos: number }[]>([])
  const [cnpjDigitado, setCnpjDigitado] = useState<Record<string, string>>({})
  const [cnpjAplicado, setCnpjAplicado] = useState<Record<string, string>>({})
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null)
  const [simulando, setSimulando] = useState(false)
  const [erroSimulacao, setErroSimulacao] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [erroGravacao, setErroGravacao] = useState<string | null>(null)
  const [gravada, setGravada] = useState<{ simulada: ResultadoImportacao; gravada: ResultadoImportacao; plano: PlanoImportacaoES } | null>(null)

  // O plano e o backup lido morrem com a página.
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
      backup.current = null
    }
  }, [])

  // Gravando: fechar a aba no meio não estraga nada (é uma transação), mas a pessoa fica sem o resultado.
  useEffect(() => {
    if (!gravando) return
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [gravando])

  const simular = useCallback(
    async (p: PlanoImportacaoES) => {
      const minha = ++rodada.current
      setSimulando(true)
      setErroSimulacao(null)
      setSimulacao(null)
      try {
        const resultado = await simularImportacao(p.payload)
        if (vivo.current && minha === rodada.current) setSimulacao({ payload: p.payload, resultado })
      } catch (e) {
        if (vivo.current && minha === rodada.current) setErroSimulacao(mensagemErro(e))
      } finally {
        if (vivo.current && minha === rodada.current) setSimulando(false)
      }
    },
    [simularImportacao],
  )

  const planejar = useCallback(
    (nome: string, cnpjManual: Record<string, string>, primeiraLeitura = false) => {
      const p = planejarBackupES(backup.current ?? undefined, { nomeArquivo: nome, hoje: diaISO(), cnpjManual, cnpjPorNomeNoProdio: cnpjPorNome(suppliers) })
      if (!p.aceito) {
        backup.current = null
        setPlano(null)
        setErroArquivo(p.recusa ?? 'O arquivo não pode ser importado.')
        setPasso('arquivo')
        return
      }
      if (primeiraLeitura) {
        setSemCnpj(p.fornecedoresSemCnpj)
        // Sem CNPJ a digitar, a prévia nunca será refeita a partir do arquivo: o backup lido já pode ir embora.
        if (!p.fornecedoresSemCnpj.length) backup.current = null
      }
      setCnpjAplicado(cnpjManual)
      setPlano(p)
      setPasso('previa')
      void simular(p)
    },
    [suppliers, simular],
  )

  const escolherArquivo = (f: File) => {
    const problema = conferirArquivo(f)
    if (problema) {
      setErroArquivo(problema)
      return
    }
    setErroArquivo(null)
    setLendo(true)
    const leitor = new FileReader()
    leitor.onerror = () => {
      if (!vivo.current) return
      setLendo(false)
      setErroArquivo('Não consegui ler o arquivo. Baixe o backup de novo no ES e tente outra vez.')
    }
    leitor.onload = () => {
      if (!vivo.current) return
      const leitura = lerTextoBackup(typeof leitor.result === 'string' ? leitor.result : '')
      setLendo(false)
      if (!leitura.ok) {
        setErroArquivo(leitura.motivo)
        return
      }
      backup.current = leitura.backup
      setNomeArquivo(f.name)
      setCnpjDigitado({})
      planejar(f.name, {}, true)
    }
    leitor.readAsText(f, 'utf-8')
  }

  const recomecar = () => {
    rodada.current++
    backup.current = null
    setPlano(null)
    setSimulacao(null)
    setSimulando(false)
    setErroSimulacao(null)
    setErroGravacao(null)
    setGravada(null)
    setSemCnpj([])
    setCnpjDigitado({})
    setCnpjAplicado({})
    setErroArquivo(null)
    setPasso('arquivo')
  }

  const validos = useMemo(() => cnpjsValidos(cnpjDigitado), [cnpjDigitado])
  const cnpjPendente = JSON.stringify(validos) !== JSON.stringify(cnpjAplicado)
  // A prévia só vale para o payload que foi simulado (o botão Importar grava exatamente esse).
  const previa = useMemo(() => (plano && simulacao && simulacao.payload === plano.payload ? juntarPrevia(plano, simulacao.resultado) : null), [plano, simulacao])

  const gravar = async () => {
    if (!plano || !simulacao || !previa?.podeGravar || !admin) return
    setConfirmando(false)
    setGravando(true)
    setErroGravacao(null)
    try {
      const resultado = await gravarImportacao(simulacao.payload)
      if (!vivo.current) return
      setGravada({ simulada: simulacao.resultado, gravada: resultado, plano })
      backup.current = null
      setPasso('resultado')
    } catch (e) {
      if (vivo.current) setErroGravacao(mensagemErro(e))
    } finally {
      if (vivo.current) setGravando(false)
    }
  }

  if (!admin) {
    return (
      <Card title="Importar do ES">
        <p className="text-sm text-muted">Só o administrador da empresa importa o cadastro do Eddias Suprimentos.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {PASSOS.map((s, i) => (
          <span key={s.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-faint">›</span>}
            <span className={cx('rounded-full px-2.5 py-1', passo === s.id ? 'bg-accent-soft font-medium text-accent-text' : 'text-muted')}>
              {i + 1}. {s.rotulo}
            </span>
          </span>
        ))}
      </div>

      {passo === 'arquivo' && <ImportarESInstrucoes onArquivo={escolherArquivo} lendo={lendo} erro={erroArquivo} />}

      {passo === 'previa' && plano && (
        <ImportarESPrevia
          plano={plano}
          nomeArquivo={nomeArquivo}
          previa={previa}
          simulacao={simulacao?.resultado ?? null}
          simulando={simulando}
          erroSimulacao={erroSimulacao}
          demonstracao={modo === 'memoria'}
          admin={admin}
          semCnpj={semCnpj}
          cnpjDigitado={cnpjDigitado}
          cnpjPendente={cnpjPendente}
          onCnpj={(nome, valor) => setCnpjDigitado((d) => ({ ...d, [nome]: valor }))}
          onAtualizarPrevia={() => planejar(nomeArquivo, validos)}
          onSimular={() => void simular(plano)}
          onImportar={() => {
            setErroGravacao(null)
            setConfirmando(true)
          }}
          onTrocarArquivo={recomecar}
        />
      )}

      {passo === 'resultado' && gravada && <ImportarESResultado plano={gravada.plano} simulada={gravada.simulada} gravada={gravada.gravada} onOutroArquivo={recomecar} onPerfis={onPerfis} />}

      <Modal
        open={confirmando || gravando || !!erroGravacao}
        onClose={() => {
          if (gravando) return
          setConfirmando(false)
          setErroGravacao(null)
        }}
        title={gravando ? 'Gravando…' : erroGravacao ? 'Nada foi gravado' : 'Importar do ES'}
        size="sm"
        footer={
          gravando ? null : (
            <>
              <Button
                onClick={() => {
                  setConfirmando(false)
                  setErroGravacao(null)
                }}
              >
                {erroGravacao ? 'Fechar' : 'Cancelar'}
              </Button>
              <Button variant="primary" onClick={() => void gravar()} disabled={!previa?.podeGravar}>
                {erroGravacao ? 'Tentar de novo' : 'Importar'}
              </Button>
            </>
          )
        }
      >
        {gravando ? (
          <p className="flex items-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin text-accent" /> Gravando… não feche a aba.
          </p>
        ) : erroGravacao ? (
          <div className="space-y-2 text-sm">
            <p className="text-danger">{erroGravacao}</p>
            <p className="text-muted">A importação é uma transação só: deu erro, nada entrou. Tentar de novo é seguro, porque importar o mesmo arquivo não duplica.</p>
          </div>
        ) : (
          previa && <p className="text-sm">{textoConfirmacao(previa)}</p>
        )}
      </Modal>
    </div>
  )
}
