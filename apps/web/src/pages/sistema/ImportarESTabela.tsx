// Tabela da prévia da importação do ES: uma aba por entidade, filtro (padrão: problemas e avisos), busca
// por SKU, CNPJ ou nome, 100 linhas por vez. O detalhe mostra os campos que mudam (novo e atual) e as mensagens.
import type { ContagemPrevia, EntidadeImportacao, LinhaPrevia, PayloadImportacao } from '@prodio/core/importacaoEs'
import { useMemo, useState } from 'react'
import { num } from '../../domain/format'
import { useStore } from '../../domain/store'
import { Badge, Button, EmptyState, SearchInput, Select, Table, Tabs, Td, Th } from '../../ui'
import { detalharCampos, nomeDaChave, type CatalogoAtual } from './importarESDetalhe'
import { ENTIDADES, FILTROS, LINHAS_POR_PAGINA, SITUACAO, chaveExibida, contarAtencao, filtrarLinhas, type Filtro } from './importarESLogica'

function Detalhe({ linha, payload, atual }: { linha: LinhaPrevia; payload: PayloadImportacao; atual: CatalogoAtual }) {
  const campos = detalharCampos(linha, payload, atual)
  if (!campos.length && !linha.mensagens.length) return <span className="text-faint">—</span>
  return (
    <div className="space-y-1 text-[13px]">
      {campos.map((c) => (
        <div key={c.campo}>
          <span className="text-muted">{c.rotulo}: </span>
          {c.atual !== undefined && <span className="text-muted line-through decoration-faint">{c.atual}</span>}
          {c.atual !== undefined && c.novo !== undefined && <span className="text-faint"> → </span>}
          {c.novo !== undefined && <span className="font-medium">{c.novo}</span>}
          {c.atual === undefined && c.novo === undefined && <span className="text-muted">muda</span>}
        </div>
      ))}
      {linha.mensagens.map((m) => (
        <div key={m} className={linha.situacao === 'problema' ? 'text-danger' : 'text-warn'}>
          {m}
        </div>
      ))}
    </div>
  )
}

export default function ImportarESTabela({ linhas, contagens, payload }: { linhas: LinhaPrevia[]; contagens: Record<EntidadeImportacao, ContagemPrevia>; payload: PayloadImportacao }) {
  const { suppliers, materials, products, boms } = useStore()
  const atual = useMemo<CatalogoAtual>(() => ({ suppliers, materials, products, boms }), [suppliers, materials, products, boms])
  const [aba, setAba] = useState<EntidadeImportacao>(() => ENTIDADES.find((e) => contarAtencao(linhas, e.id) > 0)?.id ?? 'fornecedor')
  const [filtro, setFiltro] = useState<Filtro>('atencao')
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(LINHAS_POR_PAGINA)

  const visiveis = useMemo(() => filtrarLinhas(linhas, aba, filtro, busca), [linhas, aba, filtro, busca])
  const trocar = (f: () => void) => {
    f()
    setLimite(LINHAS_POR_PAGINA)
  }
  const total = (e: EntidadeImportacao) => {
    const c = contagens[e]
    return c.novos + c.atualizados + c.iguais + c.problemas
  }

  return (
    <div>
      <Tabs value={aba} onChange={(v) => trocar(() => setAba(v))} items={ENTIDADES.map((e) => ({ id: e.id, label: e.plural, count: total(e.id) }))} />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Select aria-label="Filtro" value={filtro} onChange={(e) => trocar(() => setFiltro(e.target.value as Filtro))} className="sm:w-56">
          {FILTROS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.rotulo}
            </option>
          ))}
        </Select>
        <SearchInput value={busca} onChange={(v) => trocar(() => setBusca(v))} placeholder="Buscar por SKU, CNPJ ou nome" className="flex-1" />
      </div>
      {visiveis.length === 0 ? (
        <EmptyState
          title={filtro === 'atencao' && !busca ? 'Nada com problema ou aviso aqui' : 'Nenhuma linha neste filtro'}
          description={filtro === 'atencao' && !busca ? 'Troque o filtro para ver o que entra, o que muda e o que fica igual.' : undefined}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Chave</Th>
              <Th>Nome</Th>
              <Th>Situação</Th>
              <Th>Detalhe</Th>
            </tr>
          </thead>
          <tbody>
            {visiveis.slice(0, limite).map((l) => (
              <tr key={`${l.entidade}|${l.chave}`}>
                <Td mono className="whitespace-nowrap align-top">
                  {chaveExibida(l.entidade, l.chave)}
                </Td>
                <Td className="align-top">{l.nome ?? nomeDaChave(l.entidade, l.chave, payload) ?? <span className="text-faint">—</span>}</Td>
                <Td className="align-top">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].rotulo}</Badge>
                    {l.temAviso && l.situacao !== 'problema' && <Badge tone="warn">Aviso</Badge>}
                  </div>
                </Td>
                <Td className="align-top">
                  <Detalhe linha={l} payload={payload} atual={atual} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {visiveis.length > limite && (
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-muted">
          <span>
            Mostrando {num(limite)} de {num(visiveis.length)}
          </span>
          <Button size="sm" onClick={() => setLimite((n) => n + LINHAS_POR_PAGINA)}>
            Mostrar mais
          </Button>
        </div>
      )}
    </div>
  )
}
