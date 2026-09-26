// Fichas técnicas do ES (bom[] plano) → bom_versions + bom_lines. Ficha nunca entra pela metade: qualquer
// linha que não resolve derruba a ficha inteira. O consumo do ES já inclui a perda, então perda_pct = 0
// (em FRAÇÃO, como no Prodio) e o calc vira o BomCalc do core só como registro de como o consumo nasceu.
import { calcConsumo } from '../ficha'
import type { BomCalc, BomCalcParte, BomCalcTipo } from '../tipos'
import type { ResultadoDepara } from './depara'
import type { ResultadoInsumos } from './insumos'
import type { BackupES, CalcES, LinhaBomES } from './ler'
import { arred, bytesUtf8, comparar, naoNumerico, num, SKU_VALIDO, sku, texto, unidade } from './normalizar'
import type { Registro } from './registro'
import type { FichaImport, LinhaFichaImport } from './tipos'

export interface ResultadoFichas {
  itens: FichaImport[]
  /** Produtos (SKU principal) que levam ficha nesta importação. */
  comFicha: Set<string>
  /** Produtos que tinham ficha no ES mas ela ficou de fora. */
  fichaComProblema: Set<string>
  noArquivo: number
}

const MAX_LINHAS = 200
// Faixas de import_catalog_validate: um valor fora delas recusa o payload INTEIRO, então aqui ele não vai.
const MAX_CONSUMO = 1e8 // bom_lines.consumo numeric(14,6)
const MAX_LARGURA_ROLO_M = 1000
const MAX_CALC_BYTES = 7000 // o banco aceita 8.000 bytes do jsonb::text, que é maior que o JSON.stringify (espaços)
const TIPOS_CALC: readonly BomCalcTipo[] = ['area', 'rolo', 'comprimento', 'peso', 'unidade']
const positivo = (x: unknown, max = 1e9): number | undefined => {
  const v = num(x)
  if (v === undefined || !(v > 0)) return undefined
  const r = arred(v, 6)
  return r > 0 && r < max ? r : undefined
}

/** calc do ES → BomCalc do Prodio. Devolve undefined (com aviso) quando não dá para aproveitar. */
export function converterCalc(c: CalcES, avisos: string[]): BomCalc | undefined {
  const tipo = TIPOS_CALC.find((t) => t === c.tipo)
  if (!tipo) {
    avisos.push(`calculadora de tipo "${c.tipo ?? '?'}" descartada`)
    return undefined
  }
  const partes: BomCalcParte[] = []
  for (const p of c.partes) {
    const parte: BomCalcParte = {}
    if (p.nome) parte.nome = p.nome
    parte.qtd = positivo(p.qtd) ?? 1
    const campos: [keyof BomCalcParte, unknown][] = [['largCm', p.larg], ['altCm', p.alt], ['compCm', p.comp], ['pesoG', p.peso], ['un', p.un]]
    for (const [k, v] of campos) {
      const n = positivo(v)
      if (n !== undefined) (parte as Record<string, unknown>)[k] = n
    }
    partes.push(parte)
  }
  if (!partes.length) {
    avisos.push('calculadora sem partes descartada')
    return undefined
  }
  const calc: BomCalc = { tipo, partes }
  if (tipo === 'rolo') {
    const largura = positivo(c.larguraRolo) ?? positivo(c.partes[0]?.larguraRolo) ?? 1.4
    if (largura >= MAX_LARGURA_ROLO_M) {
      avisos.push(`calculadora com largura do rolo ${largura} m descartada (digitada em cm ou mm?)`)
      return undefined
    }
    calc.larguraRoloM = largura
  }
  const perda = positivo(c.perda, 1e6)
  if (perda !== undefined) {
    if (c.perdaTipo === 'pct') calc.perda = { tipo: 'pct', valor: arred(perda / 100, 6) }
    else if (c.perdaTipo === 'fixo') calc.perda = { tipo: 'fixa', valor: perda }
  }
  if (bytesUtf8(JSON.stringify(calc)) > MAX_CALC_BYTES) {
    avisos.push('calculadora grande demais para guardar descartada')
    return undefined
  }
  return calc
}

interface LinhaMontada {
  tipo: 'insumo' | 'produto'
  ref: string
  consumo: number
  unidade: string
  calc?: BomCalc
  somada: boolean
}

export function planejarFichas(bk: BackupES, dp: ResultadoDepara, ins: ResultadoInsumos, produtosComProblema: Set<string>, reg: Registro): ResultadoFichas {
  const principalDoDono = new Map(dp.grupos.map((g) => [g.dono, g.principal]))
  const produtos = new Set(dp.grupos.map((g) => g.principal))
  const porPai = new Map<string, LinhaBomES[]>()
  for (const l of bk.bom) {
    const pai = sku(l.sku)
    if (!pai || !SKU_VALIDO.test(pai)) {
      reg.aviso('ficha', `(sem SKU) #${l.indice + 1}`, 'linha de ficha sem SKU do produto; ignorada')
      continue
    }
    if (!porPai.has(pai)) porPai.set(pai, [])
    porPai.get(pai)?.push(l)
  }

  const candidatas = new Map<string, LinhaMontada[]>()
  const fichaComProblema = new Set<string>()
  for (const [pai, linhasEs] of porPai) {
    const principal = principalDoDono.get(pai)
    if (!principal) {
      if (produtosComProblema.has(pai)) reg.problema('ficha', pai, `o produto ${pai} está com problema; a ficha fica de fora`)
      else if (!dp.espelhos.has(pai) && !dp.principalDe.has(pai)) {
        reg.aviso('ficha', pai, `ficha órfã: ${pai} não está entre os produtos importados; fica de fora`)
      }
      continue
    }
    const problemas: string[] = []
    const avisos: string[] = []
    const montadas = new Map<string, LinhaMontada>()
    for (const l of linhasEs) {
      const n = `linha ${l.indice + 1} da ficha`
      const mp = sku(l.mpCode)
      if (!mp) {
        problemas.push(`${n}: sem código do insumo ou componente`)
        continue
      }
      if (l.consumo === 'invalido' || naoNumerico(l.consumo)) {
        problemas.push(`${mp}: consumo não numérico`)
        continue
      }
      const consumo = num(l.consumo) ?? 0
      if (consumo < 0 || consumo >= MAX_CONSUMO) {
        problemas.push(`${mp}: consumo ${consumo} inválido`)
        continue
      }
      if (arred(consumo, 6) === 0) {
        avisos.push(`${mp}: linha com consumo zero descartada (no ES ela somava 0)`)
        continue
      }
      let tipo: 'insumo' | 'produto'
      let ref: string | undefined
      const comoProduto = dp.principalDe.get(mp) ?? (produtos.has(mp) ? mp : undefined)
      if (l.tipo === 'produto') {
        tipo = 'produto'
        ref = comoProduto
        if (!ref) problemas.push(`componente ${mp} não é um produto importado`)
      } else if (l.tipo === undefined || l.tipo === 'insumo') {
        tipo = 'insumo'
        if (ins.porSku.has(mp)) ref = mp
        else if (ins.comProblema.has(mp)) problemas.push(`insumo ${mp} está com problema e ficou de fora`)
        else if (comoProduto) {
          tipo = 'produto'
          ref = comoProduto
          avisos.push(`${mp} não é insumo; lido como componente (produto)`)
        } else {
          const extraido = mp.match(/MP\d+/)?.[0]
          if (extraido && extraido !== mp && ins.porSku.has(extraido)) {
            ref = extraido
            avisos.push(`código "${mp}" lido como ${extraido}`)
          } else problemas.push(`insumo ${mp} não existe entre os insumos importados`)
        }
      } else {
        tipo = 'insumo'
        problemas.push(`${mp}: tipo de linha "${l.tipo}" desconhecido`)
      }
      if (!ref) continue
      if (tipo === 'produto' && ref === principal) {
        problemas.push(`${mp}: o produto não pode ser componente de si mesmo`)
        continue
      }
      const un = tipo === 'produto' ? 'un' : (ins.porSku.get(ref)?.unidadeConsumo ?? 'un')
      const unEs = unidade(l.unidade)?.codigo
      if (tipo === 'insumo' && l.unidade !== undefined && l.unidade !== '' && unEs !== un) {
        avisos.push(`${ref}: unidade da linha estava desatualizada ("${texto(l.unidade, 20) ?? ''}"); vale ${un} do insumo`)
      }
      const chave = `${tipo}|${ref}`
      const existente = montadas.get(chave)
      if (existente) {
        existente.consumo += consumo
        existente.somada = true
        existente.calc = undefined
        avisos.push(`${ref}: linhas repetidas somadas (no ES elas se somavam)`)
        continue
      }
      const avisosCalc: string[] = []
      const calc = l.calc ? converterCalc(l.calc, avisosCalc) : undefined
      avisos.push(...avisosCalc.map((a) => `${ref}: ${a}`))
      montadas.set(chave, { tipo, ref, consumo, unidade: un, calc, somada: false })
    }
    const linhas = [...montadas.values()]
    for (const m of linhas) {
      m.consumo = arred(m.consumo, 6)
      if (m.consumo >= MAX_CONSUMO) problemas.push(`${m.ref}: consumo ${m.consumo} (linhas somadas) inválido`)
      if (m.calc && !m.somada) {
        const calculado = calcConsumo(m.calc)
        if (calculado > 0 && Math.abs(calculado - m.consumo) / m.consumo > 0.005) {
          avisos.push(`${m.ref}: consumo editado à mão (a calculadora dá ${calculado}); vale o consumo ${m.consumo}`)
        }
      }
    }
    if (!problemas.length && !linhas.length) problemas.push('ficha sem nenhuma linha válida')
    if (linhas.length > MAX_LINHAS) problemas.push(`ficha com ${linhas.length} linhas (máximo ${MAX_LINHAS})`)
    for (const a of avisos) reg.aviso('ficha', principal, a)
    if (problemas.length) {
      for (const p of problemas) reg.problema('ficha', principal, p)
      reg.problema('ficha', principal, 'a ficha inteira fica de fora (nunca entra pela metade)')
      fichaComProblema.add(principal)
      continue
    }
    candidatas.set(principal, linhas)
  }

  // Fichas que formam ciclo entre si ficam de fora (o banco também recusa, mas a prévia precisa dizer).
  for (const ciclo of ciclos(candidatas)) {
    for (const p of ciclo) {
      reg.problema('ficha', p, `ciclo entre fichas: ${[...ciclo, ciclo[0]].join(' → ')}`)
      candidatas.delete(p)
      fichaComProblema.add(p)
    }
  }

  const itens: FichaImport[] = [...candidatas]
    .sort(([a], [b]) => comparar(a, b))
    .map(([produto_sku, linhas]) => {
      reg.ok('ficha', produto_sku)
      return {
        produto_sku,
        linhas: linhas.map((m): LinhaFichaImport => {
          const l: LinhaFichaImport =
            m.tipo === 'insumo'
              ? { tipo: 'insumo', insumo_sku: m.ref, consumo: m.consumo, unidade: m.unidade, perda_pct: 0 }
              : { tipo: 'produto', componente_sku: m.ref, consumo: m.consumo, unidade: m.unidade, perda_pct: 0 }
          if (m.calc) l.calc = m.calc
          return l
        }),
      }
    })
  return { itens, comFicha: new Set(candidatas.keys()), fichaComProblema, noArquivo: porPai.size }
}

/** Ciclos entre fichas candidatas (componentes fortemente conexos com mais de um nó, ou laço). */
function ciclos(fichas: Map<string, LinhaMontada[]>): string[][] {
  const arestas = new Map<string, string[]>()
  for (const [p, ls] of fichas) arestas.set(p, ls.filter((l) => l.tipo === 'produto' && fichas.has(l.ref)).map((l) => l.ref))
  const indice = new Map<string, number>()
  const baixo = new Map<string, number>()
  const pilha: string[] = []
  const naPilha = new Set<string>()
  const saida: string[][] = []
  let contador = 0
  const visitar = (v: string) => {
    indice.set(v, contador)
    baixo.set(v, contador++)
    pilha.push(v)
    naPilha.add(v)
    for (const w of arestas.get(v) ?? []) {
      if (!indice.has(w)) {
        visitar(w)
        baixo.set(v, Math.min(baixo.get(v) as number, baixo.get(w) as number))
      } else if (naPilha.has(w)) baixo.set(v, Math.min(baixo.get(v) as number, indice.get(w) as number))
    }
    if (baixo.get(v) !== indice.get(v)) return
    const comp: string[] = []
    let w: string
    do {
      w = pilha.pop() as string
      naPilha.delete(w)
      comp.push(w)
    } while (w !== v)
    if (comp.length > 1 || (arestas.get(v) ?? []).includes(v)) saida.push(comp.sort(comparar))
  }
  for (const v of [...arestas.keys()].sort(comparar)) if (!indice.has(v)) visitar(v)
  return saida
}
