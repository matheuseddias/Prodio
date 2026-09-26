// Produtos do ES (products[] + precifProd) → products. Cada grupo do de/para vira 1 produto com o cadastro
// do dono. Estoque de acabado, curva, estoque mínimo, ICMS, foto e descrição ficam de fora.
import type { Grupo, ResultadoDepara } from './depara'
import type { ResultadoFichas } from './fichas'
import type { BackupES, ProdutoES } from './ler'
import { arred, chaveNome, comparar, digitos, gtinValido, ncm, SKU_VALIDO, sku, texto } from './normalizar'
import type { Registro } from './registro'
import type { ProdutoImport } from './tipos'

export interface ProdutosValidos {
  validos: Map<string, ProdutoES>
  comProblema: Set<string>
}

/** SKU e nome obrigatórios; SKU repetido: vale o primeiro. */
export function validarProdutos(bk: BackupES, reg: Registro): ProdutosValidos {
  const validos = new Map<string, ProdutoES>()
  const comProblema = new Set<string>()
  for (const p of bk.products) {
    const s = sku(p.sku)
    if (!s) {
      reg.problema('produto', `(sem SKU) #${p.indice + 1}`, `produto sem SKU (linha ${p.indice + 1} de products); fica de fora`, p.nome)
      continue
    }
    if (!SKU_VALIDO.test(s)) {
      reg.problema('produto', s.slice(0, 40), 'SKU fora do formato aceito (letras, números e . _ / -, até 40)', p.nome)
      comProblema.add(s)
      continue
    }
    if (validos.has(s) || comProblema.has(s)) {
      reg.aviso('produto', s, `SKU repetido no arquivo (linha ${p.indice + 1} de products); vale o primeiro`)
      continue
    }
    if (!p.nome) {
      reg.problema('produto', s, 'produto sem nome; fica de fora')
      comProblema.add(s)
      continue
    }
    validos.set(s, p)
  }
  return { validos, comProblema }
}

const fmt = (n: number) => String(arred(n, 2)).replace('.', ',')

/** Tamanho: redondo → "40cm" pela largura; outros → "LxAcm"; sem medida estruturada, tira do nome. */
function tamanho(p: ProdutoES, nome: string): string | undefined {
  const l = p.largura ?? 0
  const a = p.altura ?? 0
  if (l > 0) {
    if (chaveNome(p.formato ?? '') === 'redondo' || !(a > 0)) return `${fmt(l)}cm`
    return `${fmt(l)}x${fmt(a)}cm`
  }
  const n = chaveNome(nome)
  const par = n.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/)
  if (par) return `${par[1].replace('.', ',')}x${par[2].replace('.', ',')}cm`
  const solo = n.match(/(\d+(?:[.,]\d+)?)\s*cm\b/)
  return solo ? `${solo[1].replace('.', ',')}cm` : undefined
}

function atributos(p: ProdutoES): Record<string, string> {
  const nome = p.nome ?? ''
  const partes = nome.split(' - ')
  const valores: [string, string | undefined][] = [
    ['categoria', p.categoria],
    ['cor', p.cor ?? (partes.length > 1 ? texto(partes[partes.length - 1], 60) : undefined)],
    ['divisao', p.divisao],
    ['formato', p.formato],
    ['grupo_corte', p.grupoCorte],
    ['lapidado', p.lapidado === undefined ? undefined : p.lapidado ? 'sim' : 'não'],
    ['linha', p.linha],
    ['material', p.material],
    ['tamanho', tamanho(p, nome)],
  ]
  const out: Record<string, string> = {}
  for (const [k, v] of valores) if (v) out[k] = v
  return out
}

function familia(p: ProdutoES): string {
  if (p.tipo && p.tipo !== 'Outro') return p.tipo
  return p.categoria ?? 'Sem família'
}

function ean(bruto: unknown): { valor?: string; aviso?: string } {
  if (bruto === undefined || bruto === null || bruto === '') return {}
  const d = digitos(bruto)
  if (!d) return {}
  if (gtinValido(d)) return { valor: d }
  return { aviso: `EAN "${d.slice(0, 20)}" com dígito verificador inválido; não enviado` }
}

export function montarProdutos(bk: BackupES, dp: ResultadoDepara, validos: Map<string, ProdutoES>, fichas: ResultadoFichas, reg: Registro): ProdutoImport[] {
  const tombs = bk.tombs.get('products')
  const itens: ProdutoImport[] = []
  const eans = new Map<string, string[]>()
  const precif = (g: Grupo) => [g.principal, g.dono, ...g.apelidos].map((s) => bk.precifProd.get(s)).find((x) => x)

  for (const g of dp.grupos) {
    const p = validos.get(g.dono) as ProdutoES
    const nome = p.nome as string
    const avisos: string[] = []
    const item: ProdutoImport = { sku: g.principal, nome, familia: familia(p), atributos: atributos(p), status: 'ativo', apelidos: g.apelidos }
    const e = ean(p.ean)
    if (e.valor) {
      item.ean = e.valor
      eans.set(e.valor, [...(eans.get(e.valor) ?? []), g.principal])
    } else if (e.aviso) avisos.push(e.aviso)
    const n = ncm(p.ncm)
    if (n.valor) item.ncm = n.valor
    else if (n.aviso) avisos.push(n.aviso)
    item.status = p.status && chaveNome(p.status) === 'inativo' ? 'inativo' : 'ativo'
    const pr = precif(g)
    if (pr?.pesoKg !== undefined && pr.pesoKg > 0 && pr.pesoKg < 1e6) item.peso_kg = arred(pr.pesoKg, 4)
    if (pr && [pr.c, pr.l, pr.a].every((v) => v !== undefined && v > 0 && v < 1e5)) {
      const cubado = arred(((pr.c as number) * (pr.l as number) * (pr.a as number)) / 6000, 4)
      if (cubado > 0 && cubado < 1e9) item.peso_cubado_kg = cubado // numeric(14,4): acima de 1e10 o banco recusa o payload inteiro
    }
    if (!fichas.comFicha.has(g.principal)) {
      const cmv = p.cmv !== undefined && p.cmv > 0 && p.cmv < 1e9 ? arred(p.cmv, 4) : 0
      const motivo = fichas.fichaComProblema.has(g.principal) ? 'a ficha técnica do ES ficou de fora' : 'sem ficha técnica no ES'
      if (cmv > 0) {
        item.custo_manual = cmv
        avisos.push(`${motivo}; o CMV do ES (${String(cmv).replace('.', ',')}) vai como custo manual`)
      } else avisos.push(`${motivo} e sem CMV`)
    }
    for (const s of [g.dono, ...g.apelidos]) {
      const t = tombs?.get(s)
      if (t) avisos.push(`${s} foi excluído no ES em ${t.slice(0, 10)}, mas ainda está no arquivo`)
    }
    itens.push(item)
    reg.ok('produto', g.principal, nome)
    for (const a of avisos) reg.aviso('produto', g.principal, a, nome)
    for (const apelido of g.apelidos) reg.ok('apelido', apelido, `apelido de ${g.principal}`)
  }
  for (const [codigo, skus] of eans) {
    if (skus.length < 2) continue
    for (const s of skus) reg.aviso('produto', s, `EAN ${codigo} repetido em ${skus.join(', ')}`)
  }
  return itens.sort((a, b) => comparar(a.sku, b.sku))
}
