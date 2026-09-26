// Aplica o integration_outbox: worker_claim_outbox -> pushFinishedStock agrupado por SKU (dry_run do config)
// -> worker_apply_outbox_result. Freio: na primeira falha do conector, o item falho vai a 'erro' e o restante
// do lote volta a 'pendente' para a próxima rodada.
import type { Env } from '../env'
import { camposDoErro, type ConectorRow, type Db, type LoteOutbox } from '../db'
import { montarConector } from '../conectores'
import { redigirSegredos } from '../conectores/mensagens'
import { ehUnsupported, type ResultadoPush } from '../conectores/tipos'
import { log, mensagemErro } from '../log'
import { desativarSeSemCredenciais } from './semCredenciais'
import type { MontarConector } from './syncPedidos'

export interface ResumoOutbox {
  conectores: number
  aplicados: number
  erros: number
  devolvidos: number
}

// Decide o destino de cada linha do lote a partir dos resultados (que param na primeira falha).
export function classificarResultados(lote: LoteOutbox[], resultados: ResultadoPush[], dryRun: boolean) {
  const aplicados: number[] = []
  const devolvidos: number[] = []
  let falha: { ids: number[]; erro: string } | null = null
  const porSku = new Map(resultados.map((r) => [r.sku, r]))
  for (const linha of lote) {
    const r: ResultadoPush | undefined = falha ? undefined : porSku.get(linha.sku)
    if (!r) {
      devolvidos.push(...linha.ids)
      continue
    }
    if (!r.ok) {
      falha = { ids: linha.ids, erro: r.erro ?? 'falha ao aplicar estoque' }
      continue
    }
    // Dry run não consome o outbox: quando o admin desligar, os deltas ainda serão aplicados.
    if (dryRun) devolvidos.push(...linha.ids)
    else aplicados.push(...linha.ids)
  }
  return { aplicados, devolvidos, falha }
}

// `connectors.ultimo_erro` e `integration_outbox.erro` são legíveis por qualquer membro do tenant
// (inclusive o tablet anônimo do chão de fábrica), e o log fica guardado no painel da Cloudflare.
// Alguns adaptadores embutem pedaço da resposta crua da plataforma na mensagem de erro, então o texto
// passa pelo mesmo filtro de segredos do sync (docs/arquitetura.md §5). Sem a credencial em mãos não
// há o que procurar: aí vai uma frase fixa, e o detalhe cru não sai.
async function semSegredos(row: ConectorRow, db: Pick<Db, 'getCredentials'>, texto: string): Promise<string> {
  try {
    return redigirSegredos(texto, await db.getCredentials(row.id))
  } catch {
    return 'a plataforma recusou o envio de estoque (não foi possível ler a credencial para mostrar o detalhe)'
  }
}

export async function aplicarOutboxConector(row: ConectorRow, db: Db, montar: MontarConector): Promise<Omit<ResumoOutbox, 'conectores'>> {
  const parcial = { aplicados: 0, erros: 0, devolvidos: 0 }
  const config = (row.config ?? {}) as { push_estoque?: boolean; dry_run?: boolean }
  if (!config.push_estoque) return parcial
  const lote = await db.claimOutbox(row.id)
  if (lote.length === 0) return parcial
  const todos = lote.flatMap((l) => l.ids)
  let conector
  try {
    conector = await montar(row)
  } catch (e) {
    await db.requeueOutbox(todos)
    throw e
  }
  if (!conector.capacidades.pushEstoque) {
    await db.applyOutboxResult(todos, false, 'plataforma não suporta envio de estoque')
    return { ...parcial, erros: todos.length }
  }
  const dryRun = Boolean(config.dry_run)
  let resultados: ResultadoPush[]
  try {
    const r = await conector.pushFinishedStock(lote.map((l) => ({ sku: l.sku, delta: l.delta })), { dryRun })
    if (ehUnsupported(r)) {
      await db.applyOutboxResult(todos, false, 'plataforma não suporta envio de estoque')
      return { ...parcial, erros: todos.length }
    }
    resultados = r
  } catch (e) {
    // Falha antes de tocar em qualquer produto (ex.: catálogo, token): nada foi aplicado, tudo volta.
    await db.requeueOutbox(todos)
    throw e
  }
  const { aplicados, devolvidos, falha } = classificarResultados(lote, resultados, dryRun)
  await db.applyOutboxResult(aplicados, true, null)
  if (falha) {
    falha.erro = await semSegredos(row, db, falha.erro)
    await db.applyOutboxResult(falha.ids, false, falha.erro)
  }
  await db.requeueOutbox(devolvidos)
  parcial.aplicados = aplicados.length
  parcial.devolvidos = devolvidos.length
  parcial.erros = falha ? falha.ids.length : 0
  log(falha ? 'warn' : 'info', 'outbox.lote', { connector: row.id, tenant: row.tenant_id, dryRun, ...parcial, erro: falha?.erro })
  return parcial
}

export async function aplicarOutbox(env: Env, db: Db, montar: MontarConector = (row) => montarConector(row, env, db)): Promise<ResumoOutbox> {
  const resumo: ResumoOutbox = { conectores: 0, aplicados: 0, erros: 0, devolvidos: 0 }
  let conectores: ConectorRow[]
  try {
    conectores = await db.listarConectoresAtivos()
  } catch (e) {
    // O aviso no cartão é do sync (mesma rodada, mesma listagem); aqui fica o log com o código.
    log('error', 'outbox.listar', { erro: mensagemErro(e), ...camposDoErro(e) })
    return resumo
  }
  for (const row of conectores) {
    resumo.conectores++
    try {
      const p = await aplicarOutboxConector(row, db, montar)
      resumo.aplicados += p.aplicados
      resumo.erros += p.erros
      resumo.devolvidos += p.devolvidos
    } catch (e) {
      // Sem credencial nenhuma: desativa (o lote já voltou para 'pendente' e espera a reconexão).
      if (await desativarSeSemCredenciais(row, db, e)) continue
      const erro = await semSegredos(row, db, mensagemErro(e))
      log('error', 'outbox.falha', { connector: row.id, tenant: row.tenant_id, erro })
      try {
        await db.setSyncState(row.id, null, false, `outbox: ${erro}`)
      } catch (e2) {
        log('error', 'outbox.gravarErro', { connector: row.id, erro: mensagemErro(e2) })
      }
    }
  }
  log('info', 'outbox.resumo', { ...resumo })
  return resumo
}
