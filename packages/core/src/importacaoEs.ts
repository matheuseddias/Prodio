// Importação do backup do Eddias Suprimentos (ES) para o Prodio: função pura que transforma o JSON do
// "Baixar backup completo" num plano (prévia local + payload de cadastro para a RPC import_catalog).
// Roda no navegador: o arquivo nunca sai dele; só o payload montado campo a campo vai ao banco.
// Importe por caminho (import { planejarImportacaoES } from '@prodio/core/importacaoEs') ou pelo barril.
import { conferirCustosFichas } from './importacaoEs/conferenciaCustos'
import { planejarDepara } from './importacaoEs/depara'
import { planejarFichas } from './importacaoEs/fichas'
import { planejarFornecedores } from './importacaoEs/fornecedores'
import { planejarInsumos } from './importacaoEs/insumos'
import { lerBackup, type BackupES } from './importacaoEs/ler'
import { dataDoNome, diasEntre, sku } from './importacaoEs/normalizar'
import { montarProdutos, validarProdutos } from './importacaoEs/produtos'
import { Registro } from './importacaoEs/registro'
import { planejarVinculos } from './importacaoEs/vinculos'
import {
  ENTIDADES_IMPORTACAO,
  type ContagemPlano,
  type EntidadeImportacao,
  type OpcoesImportacaoES,
  type PayloadImportacao,
  type PlanoImportacaoES,
} from './importacaoEs/tipos'

export * from './importacaoEs/tipos'
export { chavesDoPayload, juntarPrevia, lerResultadoImportacao, scriptLimpezaExemplo, temUsoReal } from './importacaoEs/previa'
export type { BackupES } from './importacaoEs/ler'

// Produtos do SEED do ES: quando a leitura da tabela falha, o ES cai nesta lista (backup inútil).
const SKUS_SEED_ES = ['ED000001', 'ED000002', 'ED000004', 'ED000007', 'ED000008', 'ED000009', 'ED000010', 'ED000011', 'TM000073', 'TM000076']

const payloadVazio = (): PayloadImportacao => ({ versao: 1, origem: 'es', fornecedores: [], insumos: [], produtos: [], vinculos: [], fichas: [] })
const contagemVazia = (): Record<EntidadeImportacao, ContagemPlano> =>
  Object.fromEntries(ENTIDADES_IMPORTACAO.map((e) => [e, { noArquivo: 0, entram: 0, avisos: 0, problemas: 0 }])) as Record<EntidadeImportacao, ContagemPlano>

function recusar(recusa: string, bk?: BackupES): PlanoImportacaoES {
  return {
    aceito: false,
    recusa,
    origem: { sentidoDepara: 'sem de/para', ignorado: bk?.ignorado ?? [] },
    avisosGerais: [],
    fornecedoresSemCnpj: [],
    payload: payloadVazio(),
    linhas: [],
    contagens: contagemVazia(),
  }
}

function ehSeed(bk: BackupES): boolean {
  const skus = new Set(bk.products.map((p) => sku(p.sku)))
  return bk.products.length === SKUS_SEED_ES.length && SKUS_SEED_ES.every((s) => skus.has(s))
}

/**
 * Lê o JSON cru do backup em lista branca (só cadastro, contagens e as chaves que acham CNPJ). É o que a tela
 * guarda para refazer a prévia com os CNPJs digitados: o objeto cru pode ser descartado logo depois.
 */
export function lerBackupES(bruto: unknown): BackupES | undefined {
  return lerBackup(bruto)
}

export function planejarImportacaoES(bruto: unknown, opcoes: OpcoesImportacaoES = {}): PlanoImportacaoES {
  return planejarBackupES(lerBackup(bruto), opcoes)
}

/** Planeja a partir do backup já lido por lerBackupES (mesmo resultado de planejarImportacaoES sobre o cru). */
export function planejarBackupES(bk: BackupES | undefined, opcoes: OpcoesImportacaoES = {}): PlanoImportacaoES {
  if (!bk || !bk.temSecoes.products || !bk.temSecoes.insumos) {
    return recusar('Este arquivo não é um backup do ES: faltam as seções de produtos e insumos. Use o "Baixar backup completo" das Configurações do ES.')
  }
  if (!bk.products.length) return recusar('O backup não tem nenhum produto. Refaça o backup no ES (F5, esperar carregar e baixar sem editar nada).', bk)
  if (ehSeed(bk)) {
    return recusar('O backup traz só os produtos de exemplo do ES (a leitura das tabelas falhou quando ele foi gerado). Refaça o backup no ES depois de apertar F5.', bk)
  }
  const prefixo = (opcoes.prefixoPrincipal ?? 'ED').toUpperCase()
  const reg = new Registro()
  const forn = planejarFornecedores(bk, opcoes, reg)
  const ins = planejarInsumos(bk, forn, reg)
  const prod = validarProdutos(bk, reg)
  const dp = planejarDepara(bk, prod.validos, prefixo, reg)
  const fichas = planejarFichas(bk, dp, ins, prod.comProblema, reg)
  const cmvPorSku = new Map<string, number>()
  for (const g of dp.grupos) {
    const cmv = prod.validos.get(g.dono)?.cmv
    if (cmv !== undefined && cmv > 0 && cmv < 1e9) cmvPorSku.set(g.principal, cmv)
  }
  conferirCustosFichas(fichas.itens, ins, cmvPorSku, reg)
  const produtos = montarProdutos(bk, dp, prod.validos, fichas, reg)
  const vinc = planejarVinculos(bk, forn, ins, reg)
  for (const g of dp.grupos) reg.nomear('ficha', g.principal, prod.validos.get(g.dono)?.nome ?? g.principal)
  const payload: PayloadImportacao = { versao: 1, origem: 'es', fornecedores: forn.itens, insumos: ins.itens, produtos, vinculos: vinc.itens, fichas: fichas.itens }

  // Origem: data do backup pelo nome do arquivo; sem ela, a movimentação mais recente (o backup é no mínimo dessa data).
  const dataArquivo = dataDoNome(opcoes.nomeArquivo) ?? bk.maiorDataMov
  const idadeDias = dataArquivo && opcoes.hoje ? diasEntre(dataArquivo, opcoes.hoje) : undefined
  const ignorado = [...bk.ignorado]
  const comSaldo = bk.insumos.filter((i) => i.temSaldo).length
  if (comSaldo) ignorado.push({ secao: 'Saldo de estoque dos insumos (vem do inventário no Prodio)', itens: comSaldo })
  const comEstoque = bk.products.filter((p) => p.temEstoque).length
  if (comEstoque) ignorado.push({ secao: 'Estoque de produto acabado (é da Base)', itens: comEstoque })

  const avisosGerais: string[] = []
  if (!dataDoNome(opcoes.nomeArquivo) && dataArquivo) avisosGerais.push(`Data do backup estimada pela última movimentação (${dataArquivo}): o nome do arquivo não traz a data.`)
  if (idadeDias !== undefined && idadeDias > 2) {
    avisosGerais.push(`O backup tem ${idadeDias} dias. Se o cadastro mudou no ES desde então, baixe um backup novo antes de importar.`)
  }
  if (!bk.insumos.length) avisosGerais.push('O backup não tem insumos. Refaça o backup no ES (F5, esperar carregar e baixar sem editar nada).')
  if (!bk.bom.length) avisosGerais.push('O backup não tem fichas técnicas. Refaça o backup no ES (F5, esperar carregar e baixar sem editar nada).')
  if (dp.sentido === 'ED→TM') avisosGerais.push(`O de/para está no sentido antigo (ED→TM). A importação usa ${prefixo} como SKU principal mesmo assim.`)
  if (dp.sentido === 'misto') avisosGerais.push(`O de/para mistura os dois sentidos. Cada grupo foi resolvido pelos dados; o SKU principal é o ${prefixo}.`)
  if (forn.semCnpj.length) avisosGerais.push(`${forn.semCnpj.length} fornecedor(es) sem CNPJ: digite o CNPJ na prévia ou eles ficam de fora.`)

  const linhas = reg.todas()
  const contagens = contagemVazia()
  const entram: Record<EntidadeImportacao, number> = {
    fornecedor: payload.fornecedores.length,
    insumo: payload.insumos.length,
    produto: payload.produtos.length,
    apelido: payload.produtos.reduce((a, p) => a + p.apelidos.length, 0),
    vinculo: payload.vinculos.length,
    ficha: payload.fichas.length,
  }
  const noArquivo: Record<EntidadeImportacao, number> = {
    fornecedor: forn.noArquivo,
    insumo: ins.noArquivo,
    produto: bk.products.length,
    apelido: dp.pares,
    vinculo: vinc.noArquivo,
    ficha: fichas.noArquivo,
  }
  for (const e of ENTIDADES_IMPORTACAO) {
    contagens[e].noArquivo = noArquivo[e]
    contagens[e].entram = entram[e]
  }
  for (const l of linhas) {
    if (l.situacao === 'aviso') contagens[l.entidade].avisos++
    if (l.situacao === 'problema') contagens[l.entidade].problemas++
  }
  return {
    aceito: true,
    origem: { dataArquivo, idadeDias, sentidoDepara: dp.sentido, ignorado },
    avisosGerais,
    fornecedoresSemCnpj: forn.semCnpj,
    payload,
    linhas,
    contagens,
  }
}
