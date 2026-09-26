// Insumos do ES → materials. Chave: SKU (maiúsculas, sem espaços). Saldo, créditos, alíquotas, setor e
// processo ficam de fora (saldo é ledger; o Prodio credita pelo XML).
import { cnpjDoNome, type ResultadoFornecedores } from './fornecedores'
import type { BackupES, FornecedorDoInsumoES } from './ler'
import { arred, ncm, SKU_VALIDO, sku, unidade, type CodigoUnidade, type UnidadeLida } from './normalizar'
import type { Registro } from './registro'
import type { InsumoImport } from './tipos'

export interface InsumoPlanejado {
  sku: string
  nome: string
  unidadeConsumo: CodigoUnidade
  fator: number
  aliqIcms?: number
  fornecedores: FornecedorDoInsumoES[]
  fornecedorPadrao?: string
}

export interface ResultadoInsumos {
  itens: InsumoImport[]
  porSku: Map<string, InsumoPlanejado>
  /** SKUs de insumo que existem no arquivo mas ficaram de fora por problema. */
  comProblema: Set<string>
  noArquivo: number
}

const MAX_QTD = 1e9
/** fator_conversao é numeric(14,6): o banco (import_catalog_validate) aceita até 1e8 e recusa o payload inteiro acima. */
const MAX_FATOR = 1e8

export function planejarInsumos(bk: BackupES, forn: ResultadoFornecedores, reg: Registro): ResultadoInsumos {
  const porSku = new Map<string, InsumoPlanejado>()
  const comProblema = new Set<string>()
  const itens: InsumoImport[] = []
  const tombs = bk.tombs.get('insumos')

  for (const i of bk.insumos) {
    const s = sku(i.sku)
    const linha = `linha ${i.indice + 1} de insumos`
    if (!s) {
      reg.problema('insumo', `(sem SKU) #${i.indice + 1}`, `insumo sem SKU (${linha}); fica de fora`, i.nome)
      continue
    }
    if (!SKU_VALIDO.test(s)) {
      reg.problema('insumo', s.slice(0, 40), 'SKU fora do formato aceito (letras, números e . _ / -, até 40)', i.nome)
      continue
    }
    if (porSku.has(s) || comProblema.has(s)) {
      reg.aviso('insumo', s, `SKU repetido no arquivo (${linha}); vale o primeiro`)
      continue
    }
    const problema = (m: string) => {
      reg.problema('insumo', s, m, i.nome)
      comProblema.add(s)
    }
    if (!i.nome) {
      problema('insumo sem nome; fica de fora')
      continue
    }
    const compraLida = unidade(i.unidade)
    const consumoLida = unidade(i.unidadeConsumo)
    if (i.unidade !== undefined && i.unidade !== '' && !compraLida) {
      problema(`unidade de compra "${String(i.unidade).slice(0, 20)}" não reconhecida (use un, m, m2, kg, g, cx, rl ou ct)`)
      continue
    }
    if (i.unidadeConsumo !== undefined && i.unidadeConsumo !== '' && !consumoLida) {
      problema(`unidade de consumo "${String(i.unidadeConsumo).slice(0, 20)}" não reconhecida (use un, m, m2, kg, g, cx, rl ou ct)`)
      continue
    }
    if (!compraLida && !consumoLida) {
      problema('insumo sem unidade; fica de fora')
      continue
    }
    const avisos: string[] = []
    let compra = compraLida as UnidadeLida | undefined
    // Formato de 31/05: sem unidadeConsumo, consumo = compra (embalagem lida como un).
    const consumo: CodigoUnidade = consumoLida?.codigo ?? (compra as UnidadeLida).codigo
    if (!compra) {
      compra = { codigo: consumo }
      avisos.push('sem unidade de compra no ES; usada a de consumo')
    }
    if (compra.aviso) avisos.push(compra.aviso)
    if (consumoLida?.aviso && consumoLida.aviso !== compra.aviso) avisos.push(consumoLida.aviso)

    const f = i.fatorConversao !== undefined && i.fatorConversao > 0 ? arred(i.fatorConversao, 6) : 1
    const fator = f > 0 && f < MAX_FATOR ? f : 1
    if (f >= MAX_FATOR) avisos.push(`fator de conversão ${f} fora da faixa aceita (até ${MAX_FATOR}); gravado 1, confira no Prodio`)
    if (compra.codigo === consumo && fator !== 1 && !compra.embalagem) {
      avisos.push(`compra e consumo em ${consumo} com fator ${fator}: confira o fator de conversão`)
    }

    const item: InsumoImport = { sku: s, nome: i.nome, unidade_compra: compra.codigo, unidade_consumo: consumo, fator_conversao: fator }
    const n = ncm(i.ncm)
    if (n.valor) item.ncm = n.valor
    else if (n.aviso) avisos.push(n.aviso)
    if (i.minimo !== undefined) {
      if (i.minimo >= 0 && i.minimo < MAX_QTD) item.minimo = arred(i.minimo, 4)
      else avisos.push('estoque mínimo inválido no ES; não enviado')
    }
    const custo = i.custoMedio !== undefined && i.custoMedio > 0 && i.custoMedio < MAX_QTD ? arred(i.custoMedio, 4) : 0
    if (custo > 0) item.custo_referencia = custo
    else avisos.push('sem custo no ES (custo médio zerado ou ausente); custo de referência não enviado')

    if (i.fornecedor) {
      const r = cnpjDoNome(forn, i.fornecedor)
      if (r.cnpj) {
        item.fornecedor_padrao_cnpj = r.cnpj
        const lead = forn.leadTimePorCnpj.get(r.cnpj)
        if (lead !== undefined) item.lead_time_dias = lead
      }
      if (r.aviso) avisos.push(r.cnpj ? r.aviso : `${r.aviso}; fornecedor padrão não enviado`)
    }
    const tomb = tombs?.get(s)
    if (tomb) avisos.push(`excluído no ES em ${tomb.slice(0, 10)}, mas ainda está no arquivo`)

    porSku.set(s, {
      sku: s,
      nome: i.nome,
      unidadeConsumo: consumo,
      fator,
      aliqIcms: i.aliqIcms,
      fornecedores: i.fornecedores,
      fornecedorPadrao: i.fornecedor,
    })
    itens.push(item)
    reg.ok('insumo', s, i.nome)
    for (const a of avisos) reg.aviso('insumo', s, a, i.nome)
  }
  itens.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
  return { itens, porSku, comProblema, noArquivo: bk.insumos.length }
}
