// Parte (b): o Db REAL do worker (apps/worker/src/db.ts, importado sem build) contra o PostgREST, com
// service role, na ordem em que o cron e as rotas usam. Nada de Db falso: foi o Db falso dos testes do
// worker que deixou o PGRST201 de listarConectoresAtivos/getConector passar (cron mudo em produção).
// Cada passo confere o efeito no banco, não só a ausência de erro.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

// Métodos do Db que ficam de fora, e por quê (impresso no resumo).
const FORA = {
  upsertNfeInbound: 'RPC upsert_nfe_inbound recebe o XML já interpretado pelo core; não é worker_* nem cron',
  salvarXml: 'Storage (balde nfe-xml), não é PostgREST',
}
const INTERNOS = new Set(['constructor', 'rpc'])

function igual(veio, esperado, oque) {
  if (!isDeepStrictEqual(veio, esperado)) throw new Error(`${oque}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}
function mesmoInstante(a, b, oque) {
  if (!a || new Date(a).getTime() !== new Date(b).getTime()) throw new Error(`${oque}: esperado ${b}, veio ${a}`)
}
function exigir(condicao, oque) {
  if (!condicao) throw new Error(oque)
}

/** Devolve { falhas, feitos, semPasso }. */
export async function exercitarEscritas({ Db, env, seed, fontes }) {
  const textoDb = readFileSync(join(fontes, 'apps/worker/src/db.ts'), 'utf8').split('\n')
  const linhaDe = (metodo) => {
    const i = textoDb.findIndex((l) => new RegExp(`^\\s*(?:(?:private|protected|public|static|async)\\s+)*${metodo}\\s*[(<]`).test(l))
    return i < 0 ? '?' : i + 1
  }
  const db = new Db(env)
  const sb = db.sb
  const T = seed.tenant
  const C = seed.conector
  const falhas = []
  const usados = new Set()

  // Método que sumiu do Db reprova ("db.x is not a function"), nunca vira "pulado".
  const passo = async (metodos, titulo, fn) => {
    for (const m of metodos) usados.add(m)
    try {
      await fn()
      console.log(`  ok      ${titulo}`)
    } catch (e) {
      const achados = metodos.filter((m) => linhaDe(m) !== '?')
      const onde = (achados.length ? achados : metodos).map((m) => `apps/worker/src/db.ts:${linhaDe(m)} (${m})`).join(', ')
      const texto = e instanceof Error ? e.message : String(e)
      const codigo = e?.codigo ? ` [${e.codigo}]` : ''
      const dica = e?.dica ? ` | dica: ${e.dica}` : ''
      console.log(`  FALHOU  ${titulo}\n          ${onde}\n          ${texto}${codigo}${dica}`)
      falhas.push({ onde, titulo, texto })
    }
  }
  const conector = async (id) => {
    const r = await sb.from('connectors').select('status, ultimo_erro, ultimo_sync').eq('id', id).single()
    if (r.error) throw new Error(`leitura de conferência: ${r.error.message}`)
    return r.data
  }
  const temTenant = (linha, oque) => {
    const json = JSON.stringify(linha)
    exigir(json.includes(`"${seed.slug}"`) && json.includes(`"${seed.fuso}"`), `${oque}: a linha não traz slug e fuso do tenant (o cron precisa do fuso): ${json}`)
  }

  await passo(['marcarStatusConector'], 'marcarStatusConector → conectado (UPDATE connectors)', async () => {
    await db.marcarStatusConector(C, T, 'conectado', null)
    igual((await conector(C)).status, 'conectado', 'status')
  })
  await passo(['listarConectoresAtivos', 'tenantsPorId'], 'listarConectoresAtivos (o cron de 5 min começa aqui)', async () => {
    const linha = (await db.listarConectoresAtivos()).find((c) => c.id === C)
    exigir(linha, 'o conector conectado não veio na lista')
    temTenant(linha, 'listarConectoresAtivos')
    // Sem ultimo_erro na linha, o cron não sabe que tem de tirar o aviso de listagem do cartão.
    exigir('ultimo_erro' in linha, `listarConectoresAtivos: a linha não traz ultimo_erro: ${JSON.stringify(linha)}`)
  })
  await passo(['getConector'], 'getConector (callback do OAuth e webhook do Bling)', async () => {
    const linha = await db.getConector(C)
    exigir(linha?.id === C, 'getConector não achou o conector')
    temTenant(linha, 'getConector')
  })
  await passo(['tenantPorSlug'], 'tenantPorSlug', async () => {
    igual((await db.tenantPorSlug(seed.slug))?.id, T, 'tenant')
  })
  await passo(['setCredentials', 'getCredentials'], 'setCredentials + getCredentials (worker_set/get_credentials, pgcrypto do stub)', async () => {
    const cred = { api_token: 'token-de-teste', warehouse_id: 'bl_1' }
    await db.setCredentials(T, C, cred)
    igual(await db.getCredentials(C), cred, 'credencial decifrada')
  })

  const em1 = new Date(Date.now() - 60_000).toISOString()
  const cursor1 = { date_confirmed_from: 1758800000 }
  await passo(['marcarPulso', 'getSyncState'], 'marcarPulso cria sync_state (upsert on_conflict=connector_id, INSERT)', async () => {
    await db.marcarPulso(C, T, em1)
    const s = await db.getSyncState(C)
    mesmoInstante(s?.last_run_at, em1, 'last_run_at')
    igual(s.runs, 0, 'runs (pulso não conta rodada)')
  })
  await passo(['gravarCursor'], 'gravarCursor (upsert só do cursor)', async () => {
    await db.gravarCursor(C, T, cursor1)
    const s = await db.getSyncState(C)
    igual(s?.cursor, cursor1, 'cursor')
    mesmoInstante(s.last_run_at, em1, 'last_run_at preservado')
  })
  await passo(['marcarPulso'], 'marcarPulso de novo (upsert, caminho do UPDATE)', async () => {
    const em2 = new Date().toISOString()
    await db.marcarPulso(C, T, em2)
    const s = await db.getSyncState(C)
    mesmoInstante(s?.last_run_at, em2, 'last_run_at')
    igual(s.cursor, cursor1, 'cursor preservado')
  })

  const pedido = {
    external_id: 'api-teste:1', external_status: '1', confirmed_at: new Date().toISOString(), updated_at_external: null, total: 99.9,
    raw: { teste: true }, itens: [{ sku_externo: 'ED000001', quantidade: 2, preco: 49.95 }],
  }
  await passo(['upsertOrders'], 'upsertOrders duas vezes (worker_upsert_orders, idempotente)', async () => {
    igual(await db.upsertOrders(T, C, [pedido]), 1, 'pedidos gravados')
    igual(await db.upsertOrders(T, C, [{ ...pedido, raw: undefined }]), 1, 'pedidos regravados')
    const r = await sb.from('orders').select('significado, raw, order_items(sku_externo, product_id, quantidade)').eq('connector_id', C).eq('external_id', pedido.external_id)
    exigir(!r.error, `conferência: ${r.error?.message}`)
    igual(r.data.length, 1, 'linhas em orders')
    igual(r.data[0].raw, pedido.raw, 'raw mantido quando o pedido volta sem raw')
    igual(r.data[0].order_items.length, 1, 'itens')
    exigir(r.data[0].order_items[0].product_id, 'o SKU ED000001 não foi ligado ao produto')
  })
  const cursor2 = { date_confirmed_from: 1758800100 }
  await passo(['setSyncState'], 'setSyncState ok (worker_set_sync_state)', async () => {
    const antes = (await db.getSyncState(C))?.runs ?? 0
    await db.setSyncState(C, cursor2, true)
    const s = await db.getSyncState(C)
    igual(s.runs, antes + 1, 'runs')
    igual(s.cursor, cursor2, 'cursor')
    exigir(s.last_ok_at, 'last_ok_at vazio')
    const c = await conector(C)
    igual([c.status, c.ultimo_erro], ['conectado', null], 'status/ultimo_erro')
    exigir(c.ultimo_sync, 'ultimo_sync vazio')
  })
  await passo(['setSyncState'], 'setSyncState falha (cursor nulo mantém o anterior)', async () => {
    await db.setSyncState(C, null, false, 'falha de teste')
    igual((await db.getSyncState(C))?.cursor, cursor2, 'cursor')
    const c = await conector(C)
    igual([c.status, c.ultimo_erro], ['erro', 'falha de teste'], 'status/ultimo_erro')
  })
  await passo(['marcarRodadaManual'], 'marcarRodadaManual ok e falha (botão Sincronizar agora)', async () => {
    await db.marcarRodadaManual(C, T, true)
    let c = await conector(C)
    igual([c.status, c.ultimo_erro], ['conectado', null], 'depois do ok')
    await db.marcarRodadaManual(C, T, false, 'erro manual de teste')
    c = await conector(C)
    igual([c.status, c.ultimo_erro], ['erro', 'erro manual de teste'], 'depois da falha')
  })
  await passo(['marcarCredencialNova'], 'marcarCredencialNova (callback do OAuth)', async () => {
    await db.marcarCredencialNova(C, T)
    const c = await conector(C)
    igual([c.status, c.ultimo_erro], ['conectado', null], 'status/ultimo_erro')
  })
  await passo(['marcarRodadaManual'], 'marcarRodadaManual não ressuscita conector desconectado', async () => {
    await db.marcarRodadaManual(seed.conectorDesconectado, T, true)
    igual((await conector(seed.conectorDesconectado)).status, 'desconectado', 'status')
  })
  // Aviso no cartão quando a listagem do cron falha, e a limpeza quando ela volta (jobs/avisoListagem.ts).
  await passo(['listarConectoresParaAviso'], 'listarConectoresParaAviso', async () => {
    const linha = (await db.listarConectoresParaAviso()).find((c) => c.id === C)
    igual(linha && [linha.tenant_id, linha.status], [T, 'conectado'], 'conector na lista')
  })
  await passo(['avisarNoCartao'], 'avisarNoCartao (só ultimo_erro, sem mexer em status nem em desconectado)', async () => {
    await db.avisarNoCartao(C, T, 'aviso de teste')
    const c = await conector(C)
    igual([c.status, c.ultimo_erro], ['conectado', 'aviso de teste'], 'status/ultimo_erro')
    await db.avisarNoCartao(seed.conectorDesconectado, T, 'aviso de teste')
    igual((await conector(seed.conectorDesconectado)).ultimo_erro, null, 'ultimo_erro do desconectado')
  })
  await passo(['limparAvisoNoCartao'], 'limparAvisoNoCartao (like prefixo%: só o aviso sai, status intacto)', async () => {
    await db.limparAvisoNoCartao(C, T, 'cron:')
    igual((await conector(C)).ultimo_erro, 'aviso de teste', 'texto sem o prefixo fica')
    await db.avisarNoCartao(C, T, 'cron: aviso de teste')
    await db.limparAvisoNoCartao(C, T, 'cron:')
    const c = await conector(C)
    igual([c.status, c.ultimo_erro], ['conectado', null], 'status/ultimo_erro')
  })

  await passo(['claimOutbox', 'applyOutboxResult', 'requeueOutbox'], 'claimOutbox + applyOutboxResult + requeueOutbox (worker_claim_outbox / worker_apply_outbox_result)', async () => {
    // Fixture: dois itens na fila, inseridos com o service role (quem enfileira de verdade é enqueue_outbox).
    for (const chave of ['api-teste:1', 'api-teste:2']) {
      const r = await sb.from('integration_outbox').insert({ tenant_id: T, connector_id: C, product_id: seed.produto, delta: 3, dedupe_key: chave })
      exigir(!r.error, `fixture da fila: ${r.error?.message}`)
    }
    const lote = await db.claimOutbox(C, 1)
    igual(lote.length, 1, 'lotes')
    igual([lote[0].sku, lote[0].delta, lote[0].ids.length], [seed.sku, 3, 1], 'lote')
    await db.applyOutboxResult(lote[0].ids, true)
    const lote2 = await db.claimOutbox(C, 10)
    await db.requeueOutbox(lote2.flatMap((l) => l.ids))
    const r = await sb.from('integration_outbox').select('dedupe_key, status, tentativas').eq('connector_id', C).order('dedupe_key')
    igual(r.data?.map((l) => [l.dedupe_key, l.status, l.tentativas]), [['api-teste:1', 'aplicado', 1], ['api-teste:2', 'pendente', 0]], 'fila')
  })
  await passo(['upsertHubStock', 'snapshotsHub'], 'upsertHubStock + snapshotsHub (worker_upsert_hub_stock)', async () => {
    igual(await db.upsertHubStock(T, C, [{ sku: seed.sku, saldo: 7 }]), 1, 'linhas')
    igual((await db.snapshotsHub(T, C)).find((s) => s.product_id === seed.produto)?.saldo_hub, 7, 'saldo_hub')
  })
  await passo(['recordAudit'], 'recordAudit (worker_record_audit)', async () => {
    const id = await db.recordAudit(T, C, [{ sku: seed.sku, prodio: 5, hub: 7 }])
    exigir(/^[0-9a-f-]{36}$/.test(String(id)), `id da auditoria: ${id}`)
  })
  await passo(['listarProdutos'], 'listarProdutos', async () => {
    exigir((await db.listarProdutos(T)).some((p) => p.sku === seed.sku), `${seed.sku} não veio`)
  })
  await passo(['bipadoPorProduto'], 'bipadoPorProduto', async () => {
    exigir((await db.bipadoPorProduto(T, new Date().toISOString().slice(0, 10))) instanceof Map, 'não devolveu Map')
  })

  const metodos = Object.getOwnPropertyNames(Db.prototype).filter((m) => typeof Db.prototype[m] === 'function' && !INTERNOS.has(m))
  const semPasso = metodos.filter((m) => !usados.has(m)).map((m) => `${m}: ${FORA[m] ?? 'método novo no Db, sem passo neste teste (acrescente em supabase/tests/api/escritas.mjs)'}`)
  return { falhas, feitos: metodos.filter((m) => usados.has(m)).length, semPasso }
}
