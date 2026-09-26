// Fornecedores do ES → suppliers. No ES o fornecedor é identificado pelo NOME e o CNPJ é opcional; no Prodio
// o CNPJ é a chave. Ordem de resolução do CNPJ: cadastro (DV válido) → digitado na prévia → fornecedor de
// mesmo nome já no Prodio → kaminoForn → notas importadas (cnpj + OC → fornecedor da OC).
import type { BackupES, FornecedorES } from './ler'
import { chaveNome, comparar, digitos, documentoValido, prazo } from './normalizar'
import type { Registro } from './registro'
import type { FornecedorImport, OpcoesImportacaoES } from './tipos'

export interface ResultadoFornecedores {
  itens: FornecedorImport[]
  /** Nome exato do ES → CNPJ, só dos fornecedores que entram. */
  cnpjPorNome: Map<string, string>
  /** Nome normalizado → CNPJ (null quando dois CNPJs têm o mesmo nome normalizado). */
  cnpjPorChave: Map<string, string | null>
  /** Nomes do cadastro do ES que ficaram de fora (sem CNPJ). */
  deFora: Set<string>
  nomePorCnpj: Map<string, string>
  leadTimePorCnpj: Map<string, number>
  semCnpj: { nome: string; insumos: number }[]
  noArquivo: number
}

const MSG_NOTAS = 'CNPJ achado nas notas'

/** Candidatos únicos: devolve o CNPJ se houver exatamente um distinto. */
const unico = (xs: string[]): string | undefined => {
  const s = [...new Set(xs)]
  return s.length === 1 ? s[0] : undefined
}

function cnpjDoKamino(bk: BackupES, nome: string): string | undefined {
  const validos = [...bk.kaminoForn].filter(([c]) => documentoValido(c))
  const exato = unico(validos.filter(([, n]) => n === nome).map(([c]) => c))
  if (exato) return exato
  const k = chaveNome(nome)
  return unico(validos.filter(([, n]) => chaveNome(n) === k).map(([c]) => c))
}

function cnpjDasNotas(bk: BackupES, nome: string): string | undefined {
  const k = chaveNome(nome)
  const ocs = new Set(bk.ordens.filter((o) => o.numero && chaveNome(o.fornecedor) === k).map((o) => o.numero))
  return unico(bk.notas.filter((n) => n.ordem && ocs.has(n.ordem) && documentoValido(n.cnpj)).map((n) => n.cnpj))
}

function manual(mapa: Record<string, string> | undefined, nome: string): string | undefined {
  if (!mapa || !Object.prototype.hasOwnProperty.call(mapa, nome)) return undefined
  const d = digitos(mapa[nome])
  return documentoValido(d) ? d : undefined
}

export function planejarFornecedores(bk: BackupES, opcoes: OpcoesImportacaoES, reg: Registro): ResultadoFornecedores {
  // Quantos insumos dependem de cada nome (padrão ou lista de fornecedores do insumo).
  const insumosPorNome = new Map<string, Set<number>>()
  for (const i of bk.insumos) {
    for (const n of [i.fornecedor, ...i.fornecedores.map((f) => f.nome)]) {
      if (!n) continue
      if (!insumosPorNome.has(n)) insumosPorNome.set(n, new Set())
      insumosPorNome.get(n)?.add(i.indice)
    }
  }
  const qtdInsumos = (nome: string) => insumosPorNome.get(nome)?.size ?? 0

  const resolvidos: { f: FornecedorES; nome: string; cnpj: string; msgs: string[] }[] = []
  const semCnpj: { nome: string; insumos: number }[] = []
  const deFora = new Set<string>()
  const vistos = new Set<string>()
  for (const f of bk.fornecedores) {
    const nome = f.nome
    if (!nome) {
      reg.problema('fornecedor', `(sem nome) #${f.indice + 1}`, 'fornecedor sem nome no ES; fica de fora')
      continue
    }
    if (vistos.has(nome)) {
      reg.aviso('fornecedor', `nome:${nome}`, 'nome repetido no cadastro do ES; vale o primeiro', nome)
      continue
    }
    vistos.add(nome)
    const msgs: string[] = []
    const doCadastro = digitos(f.cnpj)
    let cnpj: string | undefined = documentoValido(doCadastro) ? doCadastro : undefined
    if (!cnpj && doCadastro) msgs.push(`CNPJ "${doCadastro}" do cadastro tem dígito verificador inválido`)
    if (!cnpj) {
      const candidatos: [() => string | undefined, string][] = [
        [() => manual(opcoes.cnpjManual, nome), 'CNPJ digitado na prévia'],
        [() => manual(opcoes.cnpjPorNomeNoProdio, nome), 'CNPJ do fornecedor de mesmo nome já cadastrado no Prodio'],
        [() => cnpjDoKamino(bk, nome), MSG_NOTAS],
        [() => cnpjDasNotas(bk, nome), MSG_NOTAS],
      ]
      for (const [achar, msg] of candidatos) {
        cnpj = achar()
        if (!cnpj) continue
        msgs.push(msg)
        break
      }
    }
    if (!cnpj) {
      const motivo = doCadastro ? 'CNPJ com dígito verificador inválido' : 'sem CNPJ'
      reg.problema('fornecedor', `nome:${nome}`, `${motivo}: digite o CNPJ na prévia ou o fornecedor fica de fora`, nome)
      semCnpj.push({ nome, insumos: qtdInsumos(nome) })
      deFora.add(nome)
      continue
    }
    resolvidos.push({ f, nome, cnpj, msgs })
  }

  // CNPJ repetido: vira um fornecedor só; o nome é o do que tem mais insumos (empate: ordem alfabética).
  const porCnpj = new Map<string, typeof resolvidos>()
  for (const r of resolvidos) {
    if (!porCnpj.has(r.cnpj)) porCnpj.set(r.cnpj, [])
    porCnpj.get(r.cnpj)?.push(r)
  }
  const itens: FornecedorImport[] = []
  const cnpjPorNome = new Map<string, string>()
  const nomePorCnpj = new Map<string, string>()
  const leadTimePorCnpj = new Map<string, number>()
  for (const [cnpj, grupo] of [...porCnpj].sort(([a], [b]) => comparar(a, b))) {
    const ordenados = [...grupo].sort((a, b) => qtdInsumos(b.nome) - qtdInsumos(a.nome) || comparar(a.nome, b.nome))
    const [dono, ...outros] = ordenados
    const pegar = <K extends keyof FornecedorES>(k: K): FornecedorES[K] | undefined => ordenados.map((r) => r.f[k]).find((v) => v !== undefined)
    for (const r of grupo) cnpjPorNome.set(r.nome, cnpj)
    nomePorCnpj.set(cnpj, dono.nome)
    for (const m of grupo.flatMap((r) => r.msgs)) reg.aviso('fornecedor', cnpj, m, dono.nome)
    if (outros.length) {
      reg.aviso('fornecedor', cnpj, `${grupo.length} fornecedores do ES com o mesmo CNPJ viraram um só: ${ordenados.map((r) => r.nome).join(', ')}`, dono.nome)
    }

    const item: FornecedorImport = { cnpj, nome: dono.nome }
    const regimeNormal = pegar('regimeNormal')
    if (regimeNormal === true) item.regime = 'normal'
    else if (regimeNormal === false) item.regime = 'simples'
    else reg.aviso('fornecedor', cnpj, 'regime tributário não informado no ES; fornecedor novo entra como normal', dono.nome)
    const lead = pegar('leadTime')
    if (lead !== undefined && lead >= 0) {
      item.lead_time_dias = Math.min(3650, Math.round(lead))
      leadTimePorCnpj.set(cnpj, item.lead_time_dias)
    }
    const p = prazo(pegar('prazo'))
    if (p.valor) item.condicao_pagamento = p.valor
    else if (p.aviso) reg.aviso('fornecedor', cnpj, p.aviso, dono.nome)
    const contato = pegar('contato')
    if (contato) item.contato = contato
    itens.push(item)
    reg.ok('fornecedor', cnpj, dono.nome)
  }

  const cnpjPorChave = new Map<string, string | null>()
  for (const [nome, cnpj] of cnpjPorNome) {
    const k = chaveNome(nome)
    const atual = cnpjPorChave.get(k)
    cnpjPorChave.set(k, atual === undefined || atual === cnpj ? cnpj : null)
  }
  return {
    itens,
    cnpjPorNome,
    cnpjPorChave,
    deFora,
    nomePorCnpj,
    leadTimePorCnpj,
    semCnpj: semCnpj.sort((a, b) => b.insumos - a.insumos || comparar(a.nome, b.nome)),
    noArquivo: bk.fornecedores.length,
  }
}

/**
 * Nome citado num insumo (fornecedor padrão, lista de fornecedores, fornInsumo) → CNPJ importado.
 * Casa pelo nome exato; se não achar, pelo nome normalizado, se houver um só. Nunca por "contém".
 */
export function cnpjDoNome(r: ResultadoFornecedores, nome: string): { cnpj?: string; aviso?: string } {
  const exato = r.cnpjPorNome.get(nome)
  if (exato) return { cnpj: exato }
  const porChave = r.cnpjPorChave.get(chaveNome(nome))
  if (porChave) return { cnpj: porChave, aviso: `fornecedor "${nome}" casado pelo nome com "${r.nomePorCnpj.get(porChave)}"` }
  if (r.deFora.has(nome)) return { aviso: `fornecedor "${nome}" ficou de fora (sem CNPJ)` }
  return { aviso: `fornecedor "${nome}" não está no cadastro de fornecedores do ES` }
}
