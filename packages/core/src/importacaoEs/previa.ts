// Leitura da resposta da RPC import_catalog e junção com o plano local para a prévia da tela.
import {
  ENTIDADES_IMPORTACAO,
  type ContagemPrevia,
  type ContagemResultado,
  type EntidadeImportacao,
  type LinhaPrevia,
  type LinhaResultado,
  type PlanoImportacaoES,
  type PreviaImportacao,
  type ResultadoImportacao,
  type UsoRealImportacao,
} from './tipos'

const ehObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const inteiro = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0
const SITUACOES_SERVIDOR = new Set(['novo', 'atualizado', 'problema', 'aviso'])

function invalido(onde: string): never {
  throw new Error(`Resposta da importação em formato inesperado (${onde}).`)
}

/** Valida o formato da resposta de public.import_catalog. Lança quando não confere. */
export function lerResultadoImportacao(json: unknown): ResultadoImportacao {
  if (!ehObjeto(json)) invalido('raiz')
  if (typeof json.simulacao !== 'boolean') invalido('simulacao')
  const ex = json.exemplo
  if (!ehObjeto(ex) || !inteiro(ex.produtos) || !inteiro(ex.insumos) || !inteiro(ex.fornecedores)) invalido('exemplo')
  const uso = json.uso_real
  if (!ehObjeto(uso) || !inteiro(uso.conectores_ligados) || !inteiro(uso.pedidos_reais)) invalido('uso_real')
  if (!inteiro(json.itens_pedido_religados)) invalido('itens_pedido_religados')
  const cont = json.contagens
  if (!ehObjeto(cont)) invalido('contagens')
  const contagens = {} as Record<EntidadeImportacao, ContagemResultado>
  for (const e of ENTIDADES_IMPORTACAO) {
    const c = cont[e]
    if (!ehObjeto(c) || !inteiro(c.novos) || !inteiro(c.atualizados) || !inteiro(c.iguais) || !inteiro(c.problemas)) invalido(`contagens.${e}`)
    contagens[e] = { novos: c.novos, atualizados: c.atualizados, iguais: c.iguais, problemas: c.problemas }
  }
  if (!Array.isArray(json.linhas)) invalido('linhas')
  const linhas: LinhaResultado[] = json.linhas.map((l, i) => {
    if (!ehObjeto(l)) invalido(`linhas[${i}]`)
    const { entidade, chave, situacao, campos, mensagem } = l
    if (typeof entidade !== 'string' || !(ENTIDADES_IMPORTACAO as readonly string[]).includes(entidade)) invalido(`linhas[${i}].entidade`)
    if (typeof chave !== 'string' || typeof situacao !== 'string' || !SITUACOES_SERVIDOR.has(situacao)) invalido(`linhas[${i}]`)
    const linha: LinhaResultado = { entidade: entidade as EntidadeImportacao, chave, situacao: situacao as LinhaResultado['situacao'] }
    if (campos !== undefined && campos !== null) {
      if (!Array.isArray(campos) || !campos.every((c) => typeof c === 'string')) invalido(`linhas[${i}].campos`)
      linha.campos = campos as string[]
    }
    if (mensagem !== undefined && mensagem !== null) {
      if (typeof mensagem !== 'string') invalido(`linhas[${i}].mensagem`)
      linha.mensagem = mensagem
    }
    return linha
  })
  return {
    simulacao: json.simulacao,
    exemplo: { produtos: ex.produtos, insumos: ex.insumos, fornecedores: ex.fornecedores },
    usoReal: { conectoresLigados: uso.conectores_ligados, pedidosReais: uso.pedidos_reais },
    contagens,
    linhas,
    itensPedidoReligados: json.itens_pedido_religados,
  }
}

/** Conector ligado ou pedido que não é do exemplo: o Prodio já está em uso de verdade. */
export function temUsoReal(u: UsoRealImportacao): boolean {
  return u.conectoresLigados + u.pedidosReais > 0
}

/**
 * Script que tira os dados de exemplo no estado atual do tenant. limpar_exemplo.sql apaga todos os dados do tenant
 * (conectores, credenciais, cursor do robô e pedidos), então só serve sem uso real; com uso real é o
 * limpar_so_exemplo.sql, que apaga só o exemplo.
 */
export function scriptLimpezaExemplo(u: UsoRealImportacao): 'supabase/dist/limpar_so_exemplo.sql' | 'supabase/dist/limpar_exemplo.sql' {
  return temUsoReal(u) ? 'supabase/dist/limpar_so_exemplo.sql' : 'supabase/dist/limpar_exemplo.sql'
}

const qtd = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Chaves (entidade + chave) de tudo o que o payload manda ao servidor, no formato das linhas. */
export function chavesDoPayload(plano: PlanoImportacaoES): Set<string> {
  const p = plano.payload
  const k = (e: EntidadeImportacao, c: string) => `${e}\u0000${c}`
  return new Set([
    ...p.fornecedores.map((f) => k('fornecedor', f.cnpj)),
    ...p.insumos.map((i) => k('insumo', i.sku)),
    ...p.produtos.map((x) => k('produto', x.sku)),
    ...p.produtos.flatMap((x) => x.apelidos.map((a) => k('apelido', a))),
    ...p.vinculos.map((v) => k('vinculo', `${v.fornecedor_cnpj}|${v.insumo_sku}`)),
    ...p.fichas.map((f) => k('ficha', f.produto_sku)),
  ])
}

const zerada = (): ContagemPrevia => ({ novos: 0, atualizados: 0, iguais: 0, problemas: 0, avisos: 0 })

/**
 * Junta o plano (o que o arquivo traz, com nomes e avisos locais) com a simulação do servidor (o que a
 * gravação faria no estado atual do banco). Item do payload sem linha do servidor é "igual".
 */
export function juntarPrevia(plano: PlanoImportacaoES, servidor: ResultadoImportacao): PreviaImportacao {
  const mapa = new Map<string, LinhaPrevia>()
  const pegar = (entidade: EntidadeImportacao, chave: string): LinhaPrevia => {
    const k = `${entidade}\u0000${chave}`
    let l = mapa.get(k)
    if (!l) {
      l = { entidade, chave, situacao: 'igual', campos: [], mensagens: [], temAviso: false }
      mapa.set(k, l)
    }
    return l
  }
  for (const p of plano.linhas) {
    const l = pegar(p.entidade, p.chave)
    if (p.nome) l.nome = p.nome
    l.mensagens.push(...p.mensagens)
    if (p.situacao === 'problema') l.situacao = 'problema'
    if (p.situacao === 'aviso') l.temAviso = true
  }
  for (const s of servidor.linhas) {
    const l = pegar(s.entidade, s.chave)
    if (s.mensagem && !l.mensagens.includes(s.mensagem)) l.mensagens.push(s.mensagem)
    if (s.campos) for (const c of s.campos) if (!l.campos.includes(c)) l.campos.push(c)
    if (s.situacao === 'aviso') l.temAviso = true
    else if (s.situacao === 'problema') l.situacao = 'problema'
    else if (l.situacao !== 'problema' && !(l.situacao === 'novo' && s.situacao === 'atualizado')) l.situacao = s.situacao
  }
  const ordem = (e: EntidadeImportacao) => ENTIDADES_IMPORTACAO.indexOf(e)
  const linhas = [...mapa.values()].sort((a, b) => ordem(a.entidade) - ordem(b.entidade) || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0))

  // "igual" só conta item que foi ao servidor; linha só de aviso (ex.: ficha órfã) não muda nada e não é item.
  const noPayload = chavesDoPayload(plano)
  const contagens = Object.fromEntries(ENTIDADES_IMPORTACAO.map((e) => [e, zerada()])) as Record<EntidadeImportacao, ContagemPrevia>
  for (const l of linhas) {
    const c = contagens[l.entidade]
    if (l.situacao === 'novo') c.novos++
    else if (l.situacao === 'atualizado') c.atualizados++
    else if (l.situacao === 'problema') c.problemas++
    else if (noPayload.has(`${l.entidade}\u0000${l.chave}`)) c.iguais++
    if (l.temAviso && l.situacao !== 'problema') c.avisos++
  }
  const totalGravacoes = ENTIDADES_IMPORTACAO.reduce((a, e) => a + contagens[e].novos + contagens[e].atualizados, 0)

  const bloqueios: string[] = []
  if (!plano.aceito) bloqueios.push(plano.recusa ?? 'O arquivo não pode ser importado.')
  const ex = servidor.exemplo
  if (ex.produtos + ex.insumos + ex.fornecedores > 0) {
    const u = servidor.usoReal
    const script = scriptLimpezaExemplo(u)
    bloqueios.push(
      `Há dados de exemplo no Prodio (${ex.produtos} produtos, ${ex.insumos} insumos, ${ex.fornecedores} fornecedores). ` +
        (temUsoReal(u)
          ? `O Prodio já está em uso (${qtd(u.conectoresLigados, 'conector ligado', 'conectores ligados')}, ${qtd(u.pedidosReais, 'pedido real', 'pedidos reais')}): ` +
            `remova só o exemplo — no Supabase, abra o SQL Editor e rode ${script}. Não use limpar_exemplo.sql: ele apagaria a integração e os pedidos.`
          : `Remova-os antes de importar: no Supabase, abra o SQL Editor e rode ${script}.`),
    )
  }
  const itensPedidoReligados = servidor.itensPedidoReligados
  if (plano.aceito && totalGravacoes === 0 && itensPedidoReligados === 0) bloqueios.push('Nenhuma alteração a gravar: o Prodio já está igual ao arquivo.')
  return { linhas, contagens, bloqueios, totalGravacoes, itensPedidoReligados, podeGravar: bloqueios.length === 0 }
}
