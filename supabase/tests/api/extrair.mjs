// Acha no código da web e do worker toda cadeia supabase .from('<tabela>')…select('<colunas>').
// Usa a árvore sintática do TypeScript (já é devDependency da raiz) em vez de regex: pega cadeia
// quebrada em várias linhas, template string sem interpolação e coluna guardada numa const do arquivo.
// Por quê: o select com embed tenants(slug, fuso) do Db.listarConectoresAtivos voltava PGRST201 e
// nenhum teste via — o que não dá para resolver aqui é impresso como pulado, nunca escondido.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const PASTAS = ['apps/web/src', 'apps/worker/src']
const EXTENSOES = /\.(ts|tsx|mts|js|jsx|mjs)$/
const IGNORAR = /(\.test\.|\.spec\.|\.d\.ts$|__tests__|__mocks__)/
const ESCRITAS = new Set(['insert', 'update', 'upsert', 'delete'])
// Filtros do postgrest-js cujo 1º argumento é nome de coluna.
const FILTROS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf',
  'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent', 'overlaps', 'textSearch', 'not', 'filter'])
// .from() de quem não é o Supabase.
const NAO_SUPABASE = /^(Array|Buffer|Object|String|Set|Map|Promise|Iterator|\w*Array)$/

function listar(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) listar(caminho, saida)
    else if (EXTENSOES.test(nome) && !IGNORAR.test(caminho)) saida.push(caminho)
  }
  return saida
}

function tipoDoScript(arquivo) {
  if (arquivo.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (arquivo.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.m?js$/.test(arquivo)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

// Valor de string conhecido em tempo de compilação, ou undefined.
function estatico(no, consts) {
  if (!no) return undefined
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no)) return no.text
  if (ts.isParenthesizedExpression(no) || ts.isAsExpression(no) || ts.isNonNullExpression(no)) return estatico(no.expression, consts)
  if (ts.isSatisfiesExpression?.(no)) return estatico(no.expression, consts)
  if (ts.isIdentifier(no)) return consts.get(no.text)
  if (ts.isBinaryExpression(no) && no.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = estatico(no.left, consts)
    const b = estatico(no.right, consts)
    return a !== undefined && b !== undefined ? a + b : undefined
  }
  if (ts.isTemplateExpression(no)) {
    let texto = no.head.text
    for (const parte of no.templateSpans) {
      const v = estatico(parte.expression, consts)
      if (v === undefined) return undefined
      texto += v + parte.literal.text
    }
    return texto
  }
  return undefined
}

// const NOME = '…' do arquivo (na ordem em que aparecem). Nome que também aparece como outra const,
// let/var ou parâmetro é ambíguo (sombra): sai, e a consulta que o usa é impressa como pulada.
function constantes(sf) {
  const consts = new Map()
  const vistos = new Set()
  const registrar = (nome, valor) => {
    if (vistos.has(nome)) consts.delete(nome)
    else {
      vistos.add(nome)
      if (valor !== undefined) consts.set(nome, valor)
    }
  }
  const visitar = (no) => {
    if (ts.isVariableDeclaration(no) && ts.isIdentifier(no.name)) {
      const ehConst = ts.isVariableDeclarationList(no.parent) && (no.parent.flags & ts.NodeFlags.Const) !== 0
      registrar(no.name.text, ehConst ? estatico(no.initializer, consts) : undefined)
    } else if (ts.isParameter(no) && ts.isIdentifier(no.name)) registrar(no.name.text, undefined)
    ts.forEachChild(no, visitar)
  }
  visitar(sf)
  return consts
}

// Sobe a partir do .from(...) juntando os métodos encadeados: from → select → eq → order → limit…
function cadeia(chamadaFrom) {
  const metodos = []
  let atual = chamadaFrom
  for (;;) {
    const acesso = atual.parent
    if (!acesso || !ts.isPropertyAccessExpression(acesso) || acesso.expression !== atual) break
    const chamada = acesso.parent
    if (!chamada || !ts.isCallExpression(chamada) || chamada.expression !== acesso) break
    metodos.push({ nome: acesso.name.text, args: chamada.arguments, no: acesso.name })
    atual = chamada
  }
  return metodos
}

function propriedade(objeto, nome) {
  if (!objeto || !ts.isObjectLiteralExpression(objeto)) return undefined
  return objeto.properties.find((p) => ts.isPropertyAssignment(p) && p.name && (p.name.text ?? p.name.escapedText) === nome)
}

function receptor(chamadaFrom) {
  const alvo = chamadaFrom.expression.expression
  if (ts.isIdentifier(alvo)) return alvo.text
  if (ts.isPropertyAccessExpression(alvo)) return alvo.name.text
  return ''
}

/**
 * Devolve { consultas, puladas, escritas } a partir de `raiz` (a raiz do repositório).
 * consultas: { arquivo, linha, tabela, colunas, count, filtros, ordens, aposEscrita }
 * puladas:   { arquivo, linha, motivo }
 * escritas:  { arquivo, linha, tabela, metodo } — escrita direta sem select encadeado (não exercitada).
 */
export function extrairConsultas(raiz) {
  const consultas = []
  const puladas = []
  const escritas = []
  for (const pasta of PASTAS) {
    for (const caminho of listar(join(raiz, pasta))) {
      const arquivo = relative(raiz, caminho).split('\\').join('/')
      const sf = ts.createSourceFile(caminho, readFileSync(caminho, 'utf8'), ts.ScriptTarget.Latest, true, tipoDoScript(caminho))
      const consts = constantes(sf)
      const linhaDe = (no) => sf.getLineAndCharacterOfPosition(no.getStart(sf)).line + 1

      const visitar = (no) => {
        if (ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression) && no.expression.name.text === 'from') {
          const quem = receptor(no)
          if (quem !== 'storage' && !NAO_SUPABASE.test(quem)) analisar(no)
        }
        ts.forEachChild(no, visitar)
      }

      const analisar = (chamadaFrom) => {
        const metodos = cadeia(chamadaFrom)
        const iSelect = metodos.findIndex((m) => m.nome === 'select')
        const escrita = metodos.slice(0, iSelect < 0 ? metodos.length : iSelect).find((m) => ESCRITAS.has(m.nome))
        const tabela = estatico(chamadaFrom.arguments[0], consts)
        const linhaFrom = linhaDe(chamadaFrom.expression.name)
        if (iSelect < 0) {
          if (escrita) escritas.push({ arquivo, linha: linhaFrom, tabela: tabela ?? '(dinâmica)', metodo: escrita.nome })
          else if (metodos.length === 0) puladas.push({ arquivo, linha: linhaFrom, motivo: `.from(${tabela ?? '?'}) sem método encadeado (a cadeia continua numa variável)` })
          return
        }
        const select = metodos[iSelect]
        const linha = linhaDe(select.no)
        if (tabela === undefined) {
          puladas.push({ arquivo, linha, motivo: `tabela dinâmica: .from(${chamadaFrom.arguments[0]?.getText(sf) ?? ''})` })
          return
        }
        const colunas = select.args.length === 0 ? '*' : estatico(select.args[0], consts)
        if (colunas === undefined) {
          puladas.push({ arquivo, linha, motivo: `colunas dinâmicas em ${tabela}: .select(${select.args[0].getText(sf)})` })
          return
        }
        const count = estatico(propriedade(select.args[1], 'count')?.initializer, consts)
        const filtros = []
        const ordens = []
        for (const m of metodos.slice(iSelect + 1)) {
          const coluna = estatico(m.args[0], consts)
          if (coluna === undefined) continue
          const opcoes = m.args[1]
          // Ordem/filtro em tabela embutida não vale na tabela de cima: fica de fora.
          if (propriedade(opcoes, 'referencedTable') || propriedade(opcoes, 'foreignTable')) continue
          if (FILTROS.has(m.nome)) filtros.push(coluna)
          else if (m.nome === 'order') ordens.push({ coluna, ascendente: propriedade(opcoes, 'ascending')?.initializer?.kind !== ts.SyntaxKind.FalseKeyword })
        }
        consultas.push({ arquivo, linha, tabela, colunas, count, filtros: [...new Set(filtros)], ordens, aposEscrita: escrita?.nome ?? null })
      }

      visitar(sf)
    }
  }
  return { consultas, puladas, escritas }
}
