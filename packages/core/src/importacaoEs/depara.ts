// De/para de SKU do ES → produtos + sku_aliases. No ES, depara[de] = para e o PARA é o dono (cadastro e
// ficha). O sentido mudou em 09/07/2026 (ED→TM virou TM→ED, por botão), e pode haver cadeias. Por isso o
// grupo é o componente conexo do grafo de/para nos dois sentidos, e o dono é decidido pelos dados.
import type { BackupES, ProdutoES } from './ler'
import { comparar, num, SKU_VALIDO, sku } from './normalizar'
import type { Registro } from './registro'
import type { SentidoDepara } from './tipos'

export interface Grupo {
  /** SKU principal no Prodio. */
  principal: string
  /** SKU do ES cujo cadastro e ficha valem para o grupo. */
  dono: string
  apelidos: string[]
}

export interface ResultadoDepara {
  grupos: Grupo[]
  /** Todo SKU que virou produto ou apelido → SKU principal. */
  principalDe: Map<string, string>
  /** SKU do grupo que não é o dono e tem ficha própria no ES (ficha espelhada, ignorada). */
  espelhos: Set<string>
  sentido: SentidoDepara
  pares: number
}

/** Assinatura da ficha de cada SKU pai (linhas somadas por tipo + código), para comparar fichas. */
export function assinaturasDeFicha(bk: BackupES): Map<string, string> {
  const acc = new Map<string, Map<string, number>>()
  for (const l of bk.bom) {
    const pai = sku(l.sku)
    const mp = sku(l.mpCode)
    if (!pai || !mp) continue
    const tipo = l.tipo === 'produto' ? 'produto' : 'insumo'
    const m = acc.get(pai) ?? new Map<string, number>()
    acc.set(pai, m)
    m.set(`${tipo}|${mp}`, (m.get(`${tipo}|${mp}`) ?? 0) + (num(l.consumo) ?? 0))
  }
  const out = new Map<string, string>()
  for (const [pai, m] of acc) {
    out.set(pai, [...m].map(([k, v]) => `${k}|${Math.round(v * 1e6) / 1e6}`).sort(comparar).join(';'))
  }
  return out
}

class Conjuntos {
  private readonly pai = new Map<string, string>()
  achar(x: string): string {
    let r = x
    while (this.pai.has(r) && this.pai.get(r) !== r) r = this.pai.get(r) as string
    this.pai.set(x, r)
    return r
  }
  unir(a: string, b: string): void {
    const ra = this.achar(a)
    const rb = this.achar(b)
    if (ra !== rb) this.pai.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
  }
}

export function planejarDepara(bk: BackupES, produtos: Map<string, ProdutoES>, prefixo: string, reg: Registro): ResultadoDepara {
  const fichas = assinaturasDeFicha(bk)
  const conj = new Conjuntos()
  const pares: [string, string][] = []
  const paras = new Set<string>()
  let tmEd = 0
  let edTm = 0
  for (const [deBruto, paraBruto] of bk.depara) {
    const de = sku(deBruto)
    const para = sku(paraBruto)
    if (!de || !para || !SKU_VALIDO.test(de) || !SKU_VALIDO.test(para) || de === para) {
      reg.aviso('apelido', (de ?? String(deBruto)).slice(0, 40), 'par de/para inválido ignorado')
      continue
    }
    pares.push([de, para])
    paras.add(para)
    conj.unir(de, para)
    if (de.startsWith('TM') && para.startsWith(prefixo)) tmEd++
    else if (de.startsWith(prefixo) && para.startsWith('TM')) edTm++
  }
  for (const s of produtos.keys()) conj.achar(s)

  const componentes = new Map<string, Set<string>>()
  for (const s of new Set([...produtos.keys(), ...pares.flat()])) {
    const r = conj.achar(s)
    if (!componentes.has(r)) componentes.set(r, new Set())
    componentes.get(r)?.add(s)
  }

  // Ordem de preferência do dono: prefixo principal (ED), depois quem é o PARA, depois alfabética.
  const preferencia = (a: string, b: string) =>
    Number(b.startsWith(prefixo)) - Number(a.startsWith(prefixo)) || Number(paras.has(b)) - Number(paras.has(a)) || comparar(a, b)

  const grupos: Grupo[] = []
  const principalDe = new Map<string, string>()
  const espelhos = new Set<string>()
  for (const membrosSet of componentes.values()) {
    const membros = [...membrosSet].sort(comparar)
    const noCadastro = membros.filter((m) => produtos.has(m))
    const paresDoGrupo = pares.filter(([de]) => membrosSet.has(de))
    if (!noCadastro.length) {
      for (const [de, para] of paresDoGrupo) reg.aviso('apelido', de, `de/para ${de}→${para} ignorado: nenhum dos dois está nos produtos do ES`)
      continue
    }
    const comFicha = noCadastro.filter((m) => fichas.has(m))
    if (new Set(comFicha.map((m) => fichas.get(m))).size > 1) {
      // Cadeia errada: produtos do cadastro com fichas diferentes. Não junta; cada um vira produto próprio.
      for (const m of noCadastro) {
        grupos.push({ principal: m, dono: m, apelidos: [] })
        principalDe.set(m, m)
      }
      for (const [de, para] of paresDoGrupo) {
        reg.problema('apelido', de, `de/para ${de}→${para} liga produtos com fichas diferentes (${comFicha.join(', ')}); não foi aplicado`)
      }
      continue
    }
    const dono = [...(comFicha.length ? comFicha : noCadastro)].sort(preferencia)[0]
    const comPrefixo = membros.filter((m) => m.startsWith(prefixo))
    const principal = dono.startsWith(prefixo) || !comPrefixo.length ? dono : comPrefixo[0]
    const apelidos = membros.filter((m) => m !== principal)
    grupos.push({ principal, dono, apelidos })
    for (const m of membros) principalDe.set(m, principal)
    if (principal !== dono) {
      reg.aviso('produto', principal, `no ES o cadastro estava no ${dono}; no Prodio o SKU principal é ${principal} e ${dono} vira apelido`)
    }
    for (const m of noCadastro) {
      if (m !== dono) reg.aviso('apelido', m, `${m} está nos produtos do ES, mas pelo de/para é apelido de ${principal}; não vira produto separado`)
    }
    const fichaDono = fichas.get(dono)
    for (const m of membros) {
      if (m === dono || !fichas.has(m)) continue
      espelhos.add(m)
      if (fichas.get(m) !== fichaDono) reg.aviso('produto', principal, `ficha espelhada de ${m} ignorada: vale a ficha de ${dono}`)
    }
  }
  grupos.sort((a, b) => comparar(a.principal, b.principal))

  let sentido: SentidoDepara = 'sem de/para'
  if (pares.length) sentido = tmEd && !edTm && tmEd === pares.length ? 'TM→ED' : edTm && !tmEd && edTm === pares.length ? 'ED→TM' : 'misto'
  return { grupos, principalDe, espelhos, sentido, pares: bk.depara.size }
}
