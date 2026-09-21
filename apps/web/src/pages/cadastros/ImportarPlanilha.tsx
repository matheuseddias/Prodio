import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Badge, Button, Field, Modal, Select, Table, Td, Th, cx } from '../../ui'
import { parseNumBR } from './numeros'

export interface CampoImport {
  key: string
  label: string
  obrigatorio?: boolean
  aliases?: string[]
  numerico?: boolean
  exemplo?: [string, string]
}

export type LinhaImport = Record<string, string>

interface Props {
  open: boolean
  onClose: () => void
  titulo: string
  campos: CampoImport[]
  chave: string
  /** chaves já cadastradas (para contar novos × atualizados) */
  existentes?: string[]
  /** normaliza a chave antes de comparar (ex.: só dígitos do CNPJ) */
  normalizaChave?: (v: string) => string
  onImport: (rows: LinhaImport[]) => void
}

const normaliza = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')

function parseCsv(text: string): { colunas: string[]; linhas: string[][] } {
  const linhasBrutas = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (linhasBrutas.length === 0) return { colunas: [], linhas: [] }
  const primeira = linhasBrutas[0]
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ','
  const split = (l: string) => {
    const out: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]
      if (ch === '"') {
        if (quoted && l[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = !quoted
      } else if (ch === sep && !quoted) {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }
  const colunas = split(primeira)
  const linhas = linhasBrutas.slice(1).map(split)
  return { colunas, linhas }
}

function exemploCsv(campos: CampoImport[]) {
  const header = campos.map((c) => c.key).join(';')
  const l1 = campos.map((c) => c.exemplo?.[0] ?? '').join(';')
  const l2 = campos.map((c) => c.exemplo?.[1] ?? '').join(';')
  return `${header}\n${l1}\n${l2}\n`
}

function baixar(nome: string, conteudo: string) {
  const blob = new Blob([`\uFEFF${conteudo}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const passos = ['Arquivo', 'Mapear colunas', 'Prévia'] as const

export default function ImportarPlanilha({ open, onClose, titulo, campos, chave, existentes = [], normalizaChave, onImport }: Props) {
  const [passo, setPasso] = useState(0)
  const [arquivo, setArquivo] = useState<string>()
  const [aviso, setAviso] = useState<string>()
  const [colunas, setColunas] = useState<string[]>([])
  const [linhas, setLinhas] = useState<string[][]>([])
  const [mapa, setMapa] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setPasso(0)
    setArquivo(undefined)
    setAviso(undefined)
    setColunas([])
    setLinhas([])
    setMapa({})
  }
  const fechar = () => {
    reset()
    onClose()
  }

  const autoMapear = (cols: string[]) => {
    const m: Record<string, string> = {}
    for (const c of campos) {
      const candidatos = [c.key, c.label, ...(c.aliases ?? [])].map(normaliza)
      const achou = cols.find((col) => candidatos.includes(normaliza(col)))
      if (achou) m[c.key] = achou
    }
    setMapa(m)
  }

  const carregarTexto = (nome: string, texto: string) => {
    const r = parseCsv(texto)
    setArquivo(nome)
    setColunas(r.colunas)
    setLinhas(r.linhas)
    autoMapear(r.colunas)
    setPasso(1)
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    setAviso(undefined)
    if (/\.xlsx?$/i.test(f.name)) {
      setAviso('Leitura de .xlsx no servidor: em breve. Usando a planilha-exemplo para você conhecer o fluxo.')
      carregarTexto(f.name, exemploCsv(campos))
      return
    }
    const reader = new FileReader()
    reader.onload = () => carregarTexto(f.name, String(reader.result ?? ''))
    reader.readAsText(f, 'utf-8')
  }

  const previa = useMemo(() => {
    const nk = (v: string) => (normalizaChave ? normalizaChave(v) : v).trim().toLowerCase()
    const setExist = new Set(existentes.map(nk))
    const rows = linhas.map((cells, i) => {
      const obj: LinhaImport = {}
      const erros: string[] = []
      for (const c of campos) {
        const col = mapa[c.key]
        const idx = col ? colunas.indexOf(col) : -1
        const v = idx >= 0 ? (cells[idx] ?? '') : ''
        obj[c.key] = v
        if (c.obrigatorio && !v.trim()) erros.push(`${c.label} vazio`)
        if (c.numerico && v.trim() && Number.isNaN(parseNumBR(v))) erros.push(`${c.label} inválido`)
      }
      const k = nk(obj[chave] ?? '')
      const novo = k ? !setExist.has(k) : true
      return { n: i + 2, obj, erros, novo }
    })
    const validas = rows.filter((r) => r.erros.length === 0)
    return {
      rows,
      validas,
      novos: validas.filter((r) => r.novo).length,
      atualizados: validas.filter((r) => !r.novo).length,
      comErro: rows.length - validas.length,
    }
  }, [linhas, colunas, mapa, campos, chave, existentes, normalizaChave])

  const obrigatoriosMapeados = campos.filter((c) => c.obrigatorio).every((c) => !!mapa[c.key])

  return (
    <Modal
      open={open}
      onClose={fechar}
      title={titulo}
      size="lg"
      footer={
        <>
          {passo > 0 && (
            <Button onClick={() => setPasso((p) => p - 1)}>Voltar</Button>
          )}
          {passo === 1 && (
            <Button variant="primary" disabled={!obrigatoriosMapeados} onClick={() => setPasso(2)}>
              Ver prévia
            </Button>
          )}
          {passo === 2 && (
            <Button
              variant="primary"
              disabled={previa.validas.length === 0}
              onClick={() => {
                onImport(previa.validas.map((r) => r.obj))
                fechar()
              }}
            >
              Importar {previa.validas.length} {previa.validas.length === 1 ? 'linha' : 'linhas'}
            </Button>
          )}
        </>
      }
    >
      <ol className="flex items-center gap-2 mb-4 text-[12px]">
        {passos.map((p, i) => (
          <li key={p} className="flex items-center gap-2">
            <span
              className={cx(
                'grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold',
                i === passo ? 'bg-accent text-white dark:text-slate-900' : i < passo ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-muted',
              )}
            >
              {i + 1}
            </span>
            <span className={i === passo ? 'font-medium' : 'text-muted'}>{p}</span>
            {i < passos.length - 1 && <span className="w-6 h-px bg-border" />}
          </li>
        ))}
      </ol>

      {passo === 0 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border bg-surface-2/40 px-4 py-10 text-center hover:border-accent hover:bg-accent-soft/30 transition-colors"
          >
            <Upload className="mx-auto text-faint mb-2" size={24} />
            <div className="font-medium text-sm">Escolher arquivo .csv ou .xlsx</div>
            <div className="text-[12px] text-muted mt-1">Separador ; ou , · primeira linha com os nomes das colunas</div>
          </button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] text-muted">
              Colunas esperadas: {campos.map((c) => (
                <span key={c.key} className={cx('font-mono', c.obrigatorio && 'text-text font-medium')}>
                  {c.key}
                  {c.obrigatorio ? '*' : ''}{' '}
                </span>
              ))}
            </div>
            <Button size="sm" onClick={() => baixar(`exemplo-${normaliza(titulo)}.csv`, exemploCsv(campos))}>
              <Download size={14} /> Baixar planilha-exemplo
            </Button>
          </div>
          {aviso && (
            <div className="flex items-start gap-2 rounded-lg bg-warn-soft text-warn px-3 py-2 text-[13px]">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {aviso}
            </div>
          )}
        </div>
      )}

      {passo === 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <FileSpreadsheet size={16} className="text-faint" />
            <span className="font-medium truncate">{arquivo}</span>
            <span className="text-muted">· {colunas.length} colunas · {linhas.length} linhas</span>
          </div>
          {aviso && <div className="rounded-lg bg-warn-soft text-warn px-3 py-2 text-[13px]">{aviso}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map((c) => (
              <Field key={c.key} label={`${c.label}${c.obrigatorio ? ' *' : ''}`} hint={c.aliases?.length ? `também: ${c.aliases.join(', ')}` : undefined}>
                <Select value={mapa[c.key] ?? ''} onChange={(e) => setMapa((m) => ({ ...m, [c.key]: e.target.value }))}>
                  <option value="">— não importar —</option>
                  {colunas.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          {!obrigatoriosMapeados && <div className="text-[13px] text-danger">Mapeie todos os campos obrigatórios (*) para continuar.</div>}
        </div>
      )}

      {passo === 2 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="ok">{previa.novos} novos</Badge>
            <Badge tone="info">{previa.atualizados} atualizados</Badge>
            {previa.comErro > 0 && <Badge tone="danger">{previa.comErro} com erro (ignorados)</Badge>}
            <span className="text-[12px] text-muted self-center">comparando pela coluna «{chave}» · mostrando as primeiras 20 linhas</span>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th></Th>
                {campos.map((c) => (
                  <Th key={c.key} right={c.numerico}>
                    {c.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previa.rows.slice(0, 20).map((r) => (
                <tr key={r.n} className={r.erros.length ? 'bg-danger-soft/40' : ''}>
                  <Td mono className="text-muted">{r.n}</Td>
                  <Td>
                    {r.erros.length ? (
                      <Badge tone="danger" className="!whitespace-normal">{r.erros.join(' · ')}</Badge>
                    ) : r.novo ? (
                      <Badge tone="ok">novo</Badge>
                    ) : (
                      <Badge tone="info">atualiza</Badge>
                    )}
                  </Td>
                  {campos.map((c) => (
                    <Td key={c.key} right={c.numerico} className="max-w-[220px] truncate">
                      {r.obj[c.key] || <span className="text-faint">—</span>}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Modal>
  )
}
