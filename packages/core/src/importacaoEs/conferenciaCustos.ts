// Conferência de custo das fichas na prévia: com os custos de referência que vão ao Prodio, quanto cada ficha
// custa por unidade do produto e qual linha puxa o custo. Só avisa (nada fica de fora): o custo é a conta da
// ficha do ES, e o aviso diz o que conferir lá (fator de conversão, valor da NF-e, consumo). Pega o caso da
// bobina cobrada por unidade: uma linha que sozinha passa do CMV do produto ou engole as outras.
import { reais } from './custos'
import type { ResultadoInsumos } from './insumos'
import { arred } from './normalizar'
import type { Registro } from './registro'
import type { FichaImport, LinhaFichaImport } from './tipos'

/** Uma linha que sozinha custa mais que isso × o CMV do produto no ES. */
export const LINHA_X_CMV = 2
/** A ficha inteira custa mais que isso × o CMV do produto no ES. */
export const FICHA_X_CMV = 3
/** Uma linha que custa mais que isso × a soma das outras (fichas com MIN_LINHAS_DOMINA linhas ou mais). */
export const LINHA_DOMINA = 10
const MIN_LINHAS_DOMINA = 3

const vezes = (r: number): string => (r >= 10 ? String(Math.round(r)) : r.toFixed(1).replace('.', ','))
const qtd = (v: number): string => String(arred(v, 6)).replace('.', ',')

interface CustoLinha {
  ref: string
  linha: LinhaFichaImport
  unitario: number
  total: number
  semCusto: boolean
}

/**
 * Avisa, por ficha do payload, custo suspeito. `cmvPorSku`: CMV do ES por SKU principal (só os > 0); é também
 * o custo de um componente sem ficha no payload, como no custoProduto do ES.
 */
export function conferirCustosFichas(fichas: FichaImport[], ins: ResultadoInsumos, cmvPorSku: Map<string, number>, reg: Registro): void {
  const porSku = new Map(fichas.map((f) => [f.produto_sku, f]))
  const memo = new Map<string, number>()
  const custoProduto = (s: string, caminho: Set<string>): number => {
    const pronto = memo.get(s)
    if (pronto !== undefined) return pronto
    const ficha = porSku.get(s)
    if (!ficha) return cmvPorSku.get(s) ?? 0
    if (caminho.has(s)) return 0
    caminho.add(s)
    const c = linhasComCusto(ficha, caminho).reduce((a, l) => a + l.total, 0)
    caminho.delete(s)
    memo.set(s, c)
    return c
  }
  const linhasComCusto = (ficha: FichaImport, caminho: Set<string>): CustoLinha[] =>
    ficha.linhas.map((l) => {
      if (l.tipo === 'produto') {
        const ref = l.componente_sku ?? '?'
        const unitario = custoProduto(ref, caminho)
        return { ref, linha: l, unitario, total: l.consumo * unitario, semCusto: false }
      }
      const ref = l.insumo_sku ?? '?'
      const custo = ins.porSku.get(ref)?.custo
      return { ref, linha: l, unitario: custo ?? 0, total: l.consumo * (custo ?? 0), semCusto: custo === undefined }
    })

  for (const ficha of fichas) {
    const sku = ficha.produto_sku
    const linhas = linhasComCusto(ficha, new Set([sku]))
    const total = linhas.reduce((a, l) => a + l.total, 0)
    const cmv = cmvPorSku.get(sku) ?? 0
    let marcou = false
    for (const l of linhas) {
      if (l.semCusto) {
        reg.aviso('ficha', sku, `${l.ref}: insumo sem custo no ES; a linha entra com custo zero no custo da ficha`)
        continue
      }
      const outras = total - l.total
      let motivo: string | undefined
      if (cmv > 0 && l.total > LINHA_X_CMV * cmv) motivo = `é ${vezes(l.total / cmv)}× o CMV do ES (${reais(cmv, 2)})`
      else if (linhas.length >= MIN_LINHAS_DOMINA && outras > 0 && l.total > LINHA_DOMINA * outras) motivo = `é ${vezes(l.total / outras)}× a soma das outras linhas (${reais(outras, 2)})`
      if (!motivo) continue
      marcou = true
      const conta = `${qtd(l.linha.consumo)} ${l.linha.unidade} × ${reais(l.unitario)}/${l.linha.unidade}`
      const conferir = l.linha.tipo === 'produto' ? 'confira a ficha do componente' : 'confira no ES o fator de conversão, o valor da NF-e e o consumo'
      reg.aviso('ficha', sku, `${l.ref}: ${reais(l.total, 2)} por unidade do produto (${conta}) ${motivo}; ${conferir}`)
    }
    if (!marcou && cmv > 0 && total > FICHA_X_CMV * cmv) {
      reg.aviso('ficha', sku, `custo pela ficha (${reais(total, 2)}) é ${vezes(total / cmv)}× o CMV do ES (${reais(cmv, 2)}); confira os custos e os consumos das linhas`)
    }
  }
}
