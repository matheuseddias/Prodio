// Parte (c): a importação do ES pelo caminho real da tela — o core (packages/core/src/importacaoEs.ts) planeja o
// backup sintético e o cliente autenticado chama rpc('import_catalog') no PostgREST, como a web faz. Confere o
// formato da resposta com o lerResultadoImportacao do próprio core (o contrato entre banco e tela), a simulação,
// a gravação, a reimportação sem mudanças, a trava dos dados de exemplo (55000) e o payload inválido (22023).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const TENANT = '0a1a0000-0000-4000-8000-00000000c0de'
const UNIDADES = [['un', 'unidade'], ['m', 'comprimento'], ['m2', 'area'], ['kg', 'peso'], ['g', 'peso'], ['cx', 'unidade'], ['rl', 'unidade'], ['ct', 'unidade']]

function exigir(condicao, oque) {
  if (!condicao) throw new Error(oque)
}

/** clientes: { service_role, authenticated }; clienteDoTenant(t): authenticated com a claim da empresa t. Devolve { falhas, feitos }. */
export async function exercitarImportacao({ clientes, seed, fontes, clienteDoTenant }) {
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
      falhas.push({ onde: 'supabase/tests/api/importacao.mjs', titulo, texto })
    }
  }
  const core = await import(pathToFileURL(join(fontes, 'packages/core/src/importacaoEs.ts')).href)
  const backup = JSON.parse(readFileSync(join(fontes, 'packages/core/src/fixtures/backup-es-sintetico.json'), 'utf8'))
  const plano = core.planejarImportacaoES(backup, { nomeArquivo: 'backup-suprimentos-20260924-1810.json', hoje: '2026-09-26' })
  const sr = clientes.service_role
  const rpc = (tenant, payload, dryRun) => clientes.authenticated.rpc('import_catalog', { p_tenant_id: tenant, p_payload: payload, p_dry_run: dryRun })
  const resultado = async (tenant, dryRun) => {
    const r = await rpc(tenant, plano.payload, dryRun)
    exigir(!r.error, `rpc import_catalog: ${r.error?.code} ${r.error?.message}`)
    return core.lerResultadoImportacao(r.data)
  }

  await passo('empresa nova sem exemplo para importar (service role: tenant, admin e unidades)', async () => {
    const t = await sr.from('tenants').insert({ id: TENANT, slug: 'api-importacao', nome: 'Importação API', cnpj: '11222333000181' })
    exigir(!t.error, `tenants: ${t.error?.message}`)
    const m = await sr.from('memberships').insert({ tenant_id: TENANT, user_id: seed.usuario, role: 'admin', accepted_at: new Date().toISOString() })
    exigir(!m.error, `memberships: ${m.error?.message}`)
    const u = await sr.from('units').insert(UNIDADES.map(([code, kind]) => ({ tenant_id: TENANT, code, nome: code, kind })))
    exigir(!u.error, `units: ${u.error?.message}`)
  })
  await passo("rpc('import_catalog') simula: formato do contrato, nada gravado", async () => {
    const r = await resultado(TENANT, true)
    exigir(r.simulacao === true, 'simulacao deveria ser true')
    const previa = core.juntarPrevia(plano, r)
    exigir(previa.podeGravar && previa.totalGravacoes === 28, `prévia: ${JSON.stringify(previa.contagens)}`)
    const c = await sr.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT)
    exigir(c.count === 0, `a simulação gravou ${c.count} produtos`)
  })
  await passo("rpc('import_catalog') grava e a reimportação não muda nada", async () => {
    const r = await resultado(TENANT, false)
    exigir(r.contagens.ficha.novos === 5 && r.contagens.produto.novos === 5, `gravação: ${JSON.stringify(r.contagens)}`)
    const f = await sr.from('v_bom_active').select('product_sku, component_sku, perda_pct').eq('tenant_id', TENANT)
    exigir(!f.error && f.data.length === 12, `fichas gravadas: ${f.error?.message ?? f.data.length}`)
    exigir(f.data.every((l) => Number(l.perda_pct) === 0), 'perda_pct deveria ser 0')
    const de_novo = core.juntarPrevia(plano, await resultado(TENANT, false))
    exigir(de_novo.totalGravacoes === 0 && !de_novo.podeGravar, `reimportação: ${JSON.stringify(de_novo.contagens)}`)
  })
  // A camada de dados da web de verdade (apps/web/src/data): o mesmo código que a tela chama, contra o PostgREST.
  const web = {
    catalogo: await import(pathToFileURL(join(fontes, 'apps/web/src/data/importacaoCatalogo.ts')).href),
    leituras: await import(pathToFileURL(join(fontes, 'apps/web/src/data/leituras.ts')).href),
    ctx: await import(pathToFileURL(join(fontes, 'apps/web/src/data/supabaseCtx.ts')).href),
  }
  const sbTenant = clienteDoTenant(TENANT)
  const ctxWeb = {
    sb: sbTenant,
    tenantId: () => TENANT,
    estado: () => ({ tenant: { horaVirada: '05:00' }, locations: [] }),
    mapas: web.ctx.novosMapas(),
  }
  await passo('web: importarCatalogo (data/importacaoCatalogo.ts) simula a reimportação sem nada a gravar', async () => {
    const r = await web.catalogo.importarCatalogo(ctxWeb, plano.payload, true)
    exigir(r.simulacao === true, 'simulacao deveria ser true')
    const previa = core.juntarPrevia(plano, r)
    exigir(previa.totalGravacoes === 0 && !previa.podeGravar, `prévia: ${JSON.stringify(previa.contagens)}`)
  })
  await passo('web: leituras do catálogo depois da importação (ordem estável, em lotes)', async () => {
    const [fornecedores, insumos, fichas] = await Promise.all([web.leituras.lerSuppliers(ctxWeb), web.leituras.lerMaterials(ctxWeb), web.leituras.lerBoms(ctxWeb)])
    const produtos = await web.leituras.lerProducts(ctxWeb, { boms: fichas, materials: insumos, precos: await web.leituras.lerPrecos(ctxWeb) })
    exigir(fornecedores.length === 3 && insumos.length === 8 && produtos.length === 5 && fichas.length === 5, `lidos: ${fornecedores.length}/${insumos.length}/${produtos.length}/${fichas.length}`)
    exigir(fichas.reduce((a, f) => a + f.linhas.length, 0) === 12, 'linhas de ficha lidas')
    exigir(produtos.find((p) => p.sku === 'ED900001')?.aliases?.includes('TM900002'), 'apelido TM900002 do ED900001')
  })
  await passo('web: leitura paginada passa do teto de 1.000 linhas do PostgREST (db-max-rows)', async () => {
    const N = 1200
    const f = await sr.from('suppliers').insert(Array.from({ length: N }, (_, i) => ({ tenant_id: TENANT, nome: `Fornecedor de carga ${String(i).padStart(4, '0')}`, cnpj: `99${String(i).padStart(12, '0')}` })))
    exigir(!f.error, `suppliers: ${f.error?.message}`)
    const m = await sr.from('materials').insert(Array.from({ length: N }, (_, i) => ({ tenant_id: TENANT, sku: `CARGA${String(i).padStart(4, '0')}`, nome: 'Insumo de carga', unidade_compra: 'un', unidade_consumo: 'un', fator_conversao: 1 })))
    exigir(!m.error, `materials: ${m.error?.message}`)
    const cru = await sbTenant.from('suppliers').select('id').eq('tenant_id', TENANT)
    exigir(!cru.error && cru.data.length === 1000, `sem paginar deveria cortar em 1.000 (veio ${cru.error?.message ?? cru.data.length}): o teste não provaria nada`)
    const fornecedores = await web.leituras.lerSuppliers(ctxWeb)
    exigir(fornecedores.length === N + 3 && new Set(fornecedores.map((x) => x.id)).size === N + 3, `lerSuppliers: ${fornecedores.length} (esperado ${N + 3}, sem repetir)`)
    const insumos = await web.leituras.lerMaterials(ctxWeb)
    exigir(insumos.length === N + 8 && new Set(insumos.map((x) => x.id)).size === N + 8, `lerMaterials: ${insumos.length} (esperado ${N + 8}, sem repetir)`)
  })
  await passo('tenant com dados de exemplo: simula com a contagem e recusa a gravação (55000)', async () => {
    const r = await resultado(seed.tenant, true)
    exigir(r.exemplo.produtos === 11, `exemplo: ${JSON.stringify(r.exemplo)}`)
    const g = await rpc(seed.tenant, plano.payload, false)
    exigir(g.error?.code === '55000', `esperado 55000, veio ${g.error?.code ?? 'sucesso'}`)
  })
  await passo('payload com chave desconhecida: 22023', async () => {
    const g = await rpc(TENANT, { ...plano.payload, usuarios: [] }, true)
    exigir(g.error?.code === '22023', `esperado 22023, veio ${g.error?.code ?? 'sucesso'}`)
  })
  return { falhas, feitos }
}
