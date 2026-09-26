// Vínculo insumo-fornecedor (De-Para da NF-e) → supplier_materials. Um vínculo por par (CNPJ, SKU do insumo);
// o par existe se aparecer em qualquer fonte: insumos[].fornecedores[], insumos[].fornecedor, fornInsumo,
// deparaForn (cProd da nota) e kaminoItem. O Prodio guarda um código por par e um par por código.
import { cnpjDoNome, type ResultadoFornecedores } from './fornecedores'
import type { ResultadoInsumos } from './insumos'
import type { BackupES } from './ler'
import { arred, comparar, sku, texto } from './normalizar'
import type { Registro } from './registro'
import type { VinculoImport } from './tipos'

interface Codigo {
  codigo: string
  rank: number // 0 deparaForn objeto com fator · 1 objeto sem fator · 2 string legada · 3 kaminoItem
  fator?: number
}
interface Par {
  cnpj: string
  sku: string
  codigos: Codigo[]
  preco?: number
  aliq?: number
  temLista: boolean
  padrao: boolean
  oc?: { un?: string; fator?: number; inteiro?: boolean }
}

/** fator de supplier_materials (numeric(14,6), > 0): fora de (0, 1e8) depois de arredondar não vai (o banco recusaria o payload). */
const fatorOk = (x: number | undefined): number | undefined => {
  if (x === undefined || !(x > 0)) return undefined
  const r = arred(x, 6)
  return r > 0 && r < 1e8 ? r : undefined
}
/** preco é numeric(14,4): o banco aceita até 1e10. */
const MAX_PRECO = 1e9

export interface ResultadoVinculos {
  itens: VinculoImport[]
  noArquivo: number
}

export function planejarVinculos(bk: BackupES, forn: ResultadoFornecedores, ins: ResultadoInsumos, reg: Registro): ResultadoVinculos {
  const pares = new Map<string, Par>()
  const importados = new Set(forn.itens.map((f) => f.cnpj))
  const avisoFora = (chave: string, msg: string) => reg.aviso('vinculo', chave, `${msg}; vínculo fica de fora`)
  const par = (cnpj: string, s: string): Par => {
    const k = `${cnpj}|${s}`
    let p = pares.get(k)
    if (!p) {
      p = { cnpj, sku: s, codigos: [], temLista: false, padrao: false }
      pares.set(k, p)
    }
    return p
  }
  const insumoDe = (mp: unknown, chave: (s: string) => string): string | undefined => {
    const s = sku(mp)
    if (s && ins.porSku.has(s)) return s
    avisoFora(chave(s ?? '?'), `insumo ${s ?? '?'} não é um insumo importado`)
    return undefined
  }

  for (const i of ins.porSku.values()) {
    for (const f of i.fornecedores) {
      if (!f.nome) continue
      const r = cnpjDoNome(forn, f.nome)
      if (!r.cnpj) {
        avisoFora(`nome:${f.nome}|${i.sku}`, r.aviso ?? 'fornecedor não encontrado')
        continue
      }
      const p = par(r.cnpj, i.sku)
      p.temLista = true
      if (p.preco === undefined && f.preco !== undefined && f.preco > 0 && f.preco < 1e9) p.preco = f.preco
      if (p.aliq === undefined && f.aliqIcms !== undefined) p.aliq = f.aliqIcms
    }
    if (i.fornecedorPadrao) {
      const r = cnpjDoNome(forn, i.fornecedorPadrao)
      if (r.cnpj) par(r.cnpj, i.sku).padrao = true
    }
  }
  for (const [nome, itens] of bk.fornInsumo) {
    const r = cnpjDoNome(forn, nome)
    for (const [mp, v] of itens) {
      if (!r.cnpj) {
        avisoFora(`nome:${nome}|${sku(mp) ?? mp}`, r.aviso ?? 'fornecedor não encontrado')
        continue
      }
      const s = insumoDe(mp, (x) => `${r.cnpj}|${x}`)
      if (s) par(r.cnpj, s).oc = v
    }
  }
  const semFornecedor = (cnpj: string, qtd: number) => {
    if (qtd) reg.aviso('vinculo', `${cnpj}|*`, `CNPJ ${cnpj} das notas não é de um fornecedor importado; ${qtd} vínculo(s) ficam de fora`)
  }
  for (const [cnpj, itens] of bk.deparaForn) {
    if (!importados.has(cnpj)) {
      semFornecedor(cnpj, itens.size)
      continue
    }
    for (const [cProd, v] of itens) {
      const codigo = texto(cProd, 60)
      if (!codigo) continue
      const mp = 'legado' in v ? v.legado : v.mp
      const s = insumoDe(mp, (x) => `${cnpj}|${x}`)
      if (!s) continue
      const fator = 'legado' in v ? undefined : fatorOk(v.fator)
      par(cnpj, s).codigos.push({ codigo, rank: 'legado' in v ? 2 : fator !== undefined ? 0 : 1, fator })
    }
  }
  for (const [cnpj, itens] of bk.kaminoItem) {
    if (!importados.has(cnpj)) {
      semFornecedor(cnpj, itens.size)
      continue
    }
    for (const [cod, mp] of itens) {
      const codigo = texto(cod, 60)
      const s = codigo ? insumoDe(mp, (x) => `${cnpj}|${x}`) : undefined
      if (codigo && s) par(cnpj, s).codigos.push({ codigo, rank: 3 })
    }
  }

  // Um código por par (melhor fonte, depois alfabética) e um par por código dentro do fornecedor.
  const ordenados = [...pares.values()].sort((a, b) => comparar(a.cnpj, b.cnpj) || comparar(a.sku, b.sku))
  const escolhido = new Map<Par, Codigo>()
  for (const p of ordenados) {
    const cods = [...p.codigos].sort((a, b) => a.rank - b.rank || comparar(a.codigo, b.codigo))
    const unicos = cods.filter((c, i) => cods.findIndex((d) => d.codigo === c.codigo) === i)
    if (unicos.length) escolhido.set(p, unicos[0])
    if (unicos.length > 1) {
      reg.aviso('vinculo', `${p.cnpj}|${p.sku}`, `mais de um código do fornecedor para o insumo; fica ${unicos[0].codigo} (o Prodio guarda um só). Outros: ${unicos.slice(1).map((c) => c.codigo).join(', ')}`)
    }
  }
  const donoDoCodigo = new Map<string, Par>()
  for (const p of [...escolhido.keys()].sort((a, b) => (escolhido.get(a) as Codigo).rank - (escolhido.get(b) as Codigo).rank || comparar(a.sku, b.sku))) {
    const k = `${p.cnpj}|${(escolhido.get(p) as Codigo).codigo}`
    const dono = donoDoCodigo.get(k)
    if (!dono) {
      donoDoCodigo.set(k, p)
      continue
    }
    reg.aviso('vinculo', `${p.cnpj}|${p.sku}`, `código ${(escolhido.get(p) as Codigo).codigo} já é de ${dono.sku} neste fornecedor; vínculo sem código`)
    escolhido.delete(p)
  }

  const itens: VinculoImport[] = []
  for (const p of ordenados) {
    const insumo = ins.porSku.get(p.sku)
    if (!insumo) continue
    const chave = `${p.cnpj}|${p.sku}`
    const v: VinculoImport = { fornecedor_cnpj: p.cnpj, insumo_sku: p.sku }
    const cod = escolhido.get(p)
    if (cod) v.codigo_fornecedor = cod.codigo
    const fatorNota = cod?.fator ?? p.codigos.filter((c) => c.fator !== undefined).sort((a, b) => a.rank - b.rank || comparar(a.codigo, b.codigo))[0]?.fator
    const fatorOc = fatorOk(p.oc?.fator)
    if (fatorNota !== undefined) {
      v.fator = fatorNota
      if (fatorOc !== undefined && fatorOc !== fatorNota) reg.aviso('vinculo', chave, `fator da nota (${fatorNota}) difere do da OC (${fatorOc}); vale o da nota`)
    } else if (fatorOc !== undefined) {
      v.fator = fatorOc
      const un = texto(p.oc?.un, 20)?.toUpperCase().slice(0, 20) // "ß" vira "SS": o banco aceita até 20
      if (un) v.unidade_compra = un
    }
    if (p.preco !== undefined) {
      const preco = arred(v.fator !== undefined ? (p.preco * v.fator) / insumo.fator : p.preco, 4)
      if (preco > 0 && preco < MAX_PRECO) v.preco = preco
      else if (preco >= MAX_PRECO) reg.aviso('vinculo', chave, `preço calculado (${preco}) fora da faixa aceita; preço não enviado, confira o fator`)
    }
    const aliq = p.temLista || p.padrao ? (p.aliq ?? insumo.aliqIcms) : undefined
    if (aliq !== undefined && aliq >= 0 && aliq <= 100) v.aliq_icms = arred(aliq / 100, 5)
    if (p.oc?.inteiro !== undefined) v.inteiro = p.oc.inteiro
    itens.push(v)
    reg.ok('vinculo', chave, `${forn.nomePorCnpj.get(p.cnpj) ?? p.cnpj} · ${insumo.nome}`)
  }
  return { itens, noArquivo: pares.size }
}
