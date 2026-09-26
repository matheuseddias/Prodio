// Parte (d): a demanda dos pedidos pelo caminho real da tela (apps/web/src/data/demanda.ts e escritasProducao.ts)
// contra o PostgREST: rpc('demand_summary') e rpc('sales_by_day') com o JWT da empresa, a mesma regra do core
// (resumirPedidos: cancelado conta, 'ignorar' não), a janela e a cobertura do tenant lidas por lerTenant, a
// sugestão entrando no plano pela set_daily_plan sem sobrescrever o que já está lá, e o resumo passando de 1.000
// produtos sem corte (é um jsonb só: o teto de linhas do PostgREST não se aplica).
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const TENANT = '0a1a0000-0000-4000-8000-0000000de3a0'
const LOCAL = '0a1a0000-0000-4000-8000-0000000de3a1'
const CONECTOR = '0a1a0000-0000-4000-8000-0000000de3a2'

function exigir(condicao, oque) {
  if (!condicao) throw new Error(oque)
}

/** Devolve { falhas, feitos }. */
export async function exercitarDemanda({ clientes, seed, fontes, clienteDoTenant }) {
  const falhas = []
  let feitos = 0
  const passo = async (titulo, fn) => {
    try {
      await fn()
      feitos++
      console.log(`  ok      ${titulo}`)
    } catch (e) {
      const texto = e instanceof Error ? e.message : String(e)
      console.log(`  FALHOU  ${titulo}\n          ${texto}`)
      falhas.push({ onde: 'supabase/tests/api/demanda.mjs', titulo, texto })
    }
  }
  const importar = (caminho) => import(pathToFileURL(join(fontes, caminho)).href)
  const [core, demanda, leituras, producao, supaCtx] = await Promise.all([
    importar('packages/core/src/planejamento.ts'),
    importar('apps/web/src/data/demanda.ts'),
    importar('apps/web/src/data/leituras.ts'),
    importar('apps/web/src/data/escritasProducao.ts'),
    importar('apps/web/src/data/supabaseCtx.ts'),
  ])
  const sr = clientes.service_role
  const ctx = {
    sb: clienteDoTenant(TENANT),
    tenantId: () => TENANT,
    estado: () => ({ tenant: { horaVirada: '05:00' }, locations: [{ id: LOCAL, nome: 'Fábrica', tipo: 'fabrica' }], products: [], boms: [], materials: [], connectors: [], outbox: [] }),
    mapas: supaCtx.novosMapas(),
  }
  const agora = Date.now()
  const antes = (h) => new Date(agora - h * 3_600_000).toISOString()
  const ids = {}

  await passo('demanda: empresa com pedidos de todo tipo (service role: tenant, admin, local, produtos, conector e pedidos)', async () => {
    const t = await sr.from('tenants').insert({ id: TENANT, slug: 'api-demanda', nome: 'Demanda API', cnpj: '20202020000120' })
    exigir(!t.error, `tenants: ${t.error?.message}`)
    const m = await sr.from('memberships').insert({ tenant_id: TENANT, user_id: seed.usuario, role: 'admin', accepted_at: new Date().toISOString() })
    exigir(!m.error, `memberships: ${m.error?.message}`)
    const l = await sr.from('locations').insert({ id: LOCAL, tenant_id: TENANT, nome: 'Fábrica', kind: 'fabrica' })
    exigir(!l.error, `locations: ${l.error?.message}`)
    const p = await sr.from('products').insert([{ tenant_id: TENANT, sku: 'PA', nome: 'Produto A', familia: 'F' }, { tenant_id: TENANT, sku: 'PB', nome: 'Produto B', familia: 'F' }]).select('id, sku')
    exigir(!p.error, `products: ${p.error?.message}`)
    for (const x of p.data) ids[x.sku] = x.id
    const c = await sr.from('connectors').insert({ id: CONECTOR, tenant_id: TENANT, plataforma: 'baselinker', nome: 'Base', status: 'conectado' })
    exigir(!c.error, `connectors: ${c.error?.message}`)
    const pedidos = [
      { external_id: 'd1', significado: 'demanda', confirmed_at: antes(1), itens: [['PA', 2]] },
      { external_id: 'd2', significado: 'cancelado', confirmed_at: antes(72), itens: [['PA', 3]] },
      { external_id: 'd3', significado: 'ignorar', confirmed_at: antes(48), itens: [['PA', 100]] },
      { external_id: 'd4', significado: null, confirmed_at: antes(120), itens: [['ZZ', 4], ['PB', 1]] },
    ]
    for (const x of pedidos) {
      const o = await sr.from('orders').insert({ tenant_id: TENANT, connector_id: CONECTOR, external_id: x.external_id, significado: x.significado, confirmed_at: x.confirmed_at }).select('id').single()
      exigir(!o.error, `orders: ${o.error?.message}`)
      x.id = o.data.id
      const i = await sr.from('order_items').insert(x.itens.map(([sku, q]) => ({ tenant_id: TENANT, order_id: o.data.id, sku_externo: sku, product_id: ids[sku] ?? null, quantidade: q })))
      exigir(!i.error, `order_items: ${i.error?.message}`)
    }
    ids.pedidos = pedidos
  })

  await passo("web: lerDemanda (rpc('demand_summary')) conta cancelado e sem significado, tira 'ignorar', e bate com o core", async () => {
    const d = await demanda.lerDemanda(ctx)
    exigir(d.disponivel, 'a demanda deveria estar disponível (a RPC falhou?)')
    exigir(d.dias === 14 && d.pedidos === 3 && d.pedidos24h === 1 && d.unidades === 10, `resumo: ${JSON.stringify({ dias: d.dias, pedidos: d.pedidos, p24: d.pedidos24h, un: d.unidades })}`)
    const vendido = Object.fromEntries(d.produtos.map((p) => [p.productId, p.vendido]))
    exigir(vendido[ids.PA] === 5 && vendido[ids.PB] === 1, `vendido: ${JSON.stringify(vendido)}`)
    exigir(d.semProduto.linhas === 1 && d.skusSemProduto[0]?.sku === 'ZZ', `sem produto: ${JSON.stringify(d.skusSemProduto)}`)
    exigir(Math.abs(Date.parse(d.ultimoPedido) - Date.parse(antes(1))) < 1000, `ultimoPedido: ${d.ultimoPedido}`)
    const noCore = core.resumirPedidos(
      ids.pedidos.map((x) => ({ id: x.id, confirmadoEm: x.confirmed_at, significado: x.significado, itens: x.itens.map(([sku, q]) => ({ sku, productId: ids[sku] ?? null, quantidade: q })) })),
      { dias: 14, agora },
    )
    exigir(noCore.pedidos === d.pedidos && noCore.unidades === d.unidades && noCore.pedidos24h === d.pedidos24h, `core e banco divergem: core ${noCore.pedidos}/${noCore.unidades}, banco ${d.pedidos}/${d.unidades}`)
  })

  await passo("web: lerVendasPorDia (rpc('sales_by_day')) — 14 dias até hoje, mesma regra", async () => {
    const dias = await demanda.lerVendasPorDia(ctx, 14)
    exigir(dias.length === 14, `dias: ${dias.length}`)
    exigir(dias.reduce((a, x) => a + x.unidades, 0) === 10, `unidades: ${JSON.stringify(dias)}`)
    const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    exigir(dias[13].dia === hojeSP, `último dia ${dias[13].dia}, esperado ${hojeSP}`)
  })

  await passo('web: lerTenant traz a janela da média e a cobertura do acabado', async () => {
    const t = await leituras.lerTenant(ctx)
    exigir(t.diasDemanda === 14 && t.diasCoberturaAcabado === 3, `tenant: ${JSON.stringify({ d: t.diasDemanda, c: t.diasCoberturaAcabado })}`)
  })

  await passo("web: adicionarAoPlano grava pela set_daily_plan e não sobrescreve o que já está no plano", async () => {
    const linha = (productId, projetado) => ({ productId, demandaDia: 1, projetado, impresso: 0, bipado: 0, carteira: 0, saldoHub: 0 })
    let p = await producao.adicionarAoPlano(ctx, [linha(ids.PA, 7), linha(ids.PB, 2)])
    const plano = () => Object.fromEntries(p.dailyPlan.map((l) => [l.productId, l.projetado]))
    exigir(plano()[ids.PA] === 7 && plano()[ids.PB] === 2, `primeira gravação: ${JSON.stringify(plano())}`)
    p = await producao.adicionarAoPlano(ctx, [linha(ids.PA, 50)])
    exigir(plano()[ids.PA] === 7, `a segunda sugestão sobrescreveu o plano: ${JSON.stringify(plano())}`)
  })

  await passo('web: resumo com mais de 1.000 produtos vendidos vem inteiro (jsonb, sem o teto do PostgREST)', async () => {
    const N = 1100
    const p = await sr.from('products').insert(Array.from({ length: N }, (_, i) => ({ tenant_id: TENANT, sku: `CARGA${String(i).padStart(4, '0')}`, nome: 'Produto de carga', familia: 'F' }))).select('id')
    exigir(!p.error && p.data.length === N, `products: ${p.error?.message ?? p.data.length}`)
    const o = await sr.from('orders').insert({ tenant_id: TENANT, connector_id: CONECTOR, external_id: 'carga', significado: 'demanda', confirmed_at: antes(2) }).select('id').single()
    exigir(!o.error, `orders: ${o.error?.message}`)
    const i = await sr.from('order_items').insert(p.data.map((x) => ({ tenant_id: TENANT, order_id: o.data.id, sku_externo: 'x', product_id: x.id, quantidade: 1 })))
    exigir(!i.error, `order_items: ${i.error?.message}`)
    const d = await demanda.lerDemanda(ctx)
    exigir(d.produtos.length === N + 2, `produtos no resumo: ${d.produtos.length} (esperado ${N + 2})`)
  })

  return { falhas, feitos }
}
