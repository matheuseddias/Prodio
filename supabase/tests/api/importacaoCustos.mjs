// Parte (c), custos: reimportar o backup do ES depois da correção do custo de referência conserta o que a regra
// antiga gravou em produção. A empresa recebe o payload da regra ANTIGA (fixtures/payload-es-custos-antigo.json,
// custo médio do ES: Bolha Inflável cobrada por rolo, insumos sem custo); depois o core de hoje planeja o mesmo
// backup (fixtures/backup-es-custos.json) e a tela simula e grava pelo PostgREST. Confere a prévia (só
// custo_referencia "atualizado"), a gravação e o que a web lê depois: custo do insumo e custo da ficha.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const TENANT = '0a1a0000-0000-4000-8000-0000000c0575'
const UNIDADES = [['un', 'unidade'], ['m', 'comprimento'], ['m2', 'area'], ['kg', 'peso'], ['g', 'peso'], ['cx', 'unidade'], ['rl', 'unidade'], ['ct', 'unidade']]
const CORRIGIDOS = ['MP9101', 'MP9133', 'MP9140', 'MP9145', 'MP9163', 'MP9172']

function exigir(condicao, oque) {
  if (!condicao) throw new Error(oque)
}

/** passo(titulo, fn) é o do importacao.mjs; core e web são os módulos já importados lá. */
export async function exercitarCustos({ clientes, seed, fontes, clienteDoTenant, passo, core, web }) {
  const ficha = await import(pathToFileURL(join(fontes, 'packages/core/src/ficha.ts')).href)
  const fixture = (nome) => JSON.parse(readFileSync(join(fontes, 'packages/core/src/fixtures', nome), 'utf8'))
  const antigo = fixture('payload-es-custos-antigo.json')
  const plano = core.planejarImportacaoES(fixture('backup-es-custos.json'), { nomeArquivo: 'backup-suprimentos-20260925-1800.json', hoje: '2026-09-26' })
  const sr = clientes.service_role
  const rpc = async (payload, dryRun) => {
    const r = await clientes.authenticated.rpc('import_catalog', { p_tenant_id: TENANT, p_payload: payload, p_dry_run: dryRun })
    exigir(!r.error, `rpc import_catalog: ${r.error?.code} ${r.error?.message}`)
    return core.lerResultadoImportacao(r.data)
  }
  const ctx = { sb: clienteDoTenant(TENANT), tenantId: () => TENANT, estado: () => ({ tenant: { horaVirada: '05:00' }, locations: [] }), mapas: web.ctx.novosMapas() }
  const custoDaFicha = async (sku) => {
    const [materiais, boms] = await Promise.all([web.leituras.lerMaterials(ctx), web.leituras.lerBoms(ctx)])
    const p = await sr.from('products').select('id').eq('tenant_id', TENANT).eq('sku', sku).single()
    exigir(!p.error, `produto ${sku}: ${p.error?.message}`)
    return { custo: ficha.custoProduto(p.data.id, { boms, materiais }), materiais }
  }

  await passo('custos: empresa com o cadastro gravado pela regra antiga (custo médio do ES)', async () => {
    const t = await sr.from('tenants').insert({ id: TENANT, slug: 'api-custos', nome: 'Custos API', cnpj: '19191919000119' })
    exigir(!t.error, `tenants: ${t.error?.message}`)
    const m = await sr.from('memberships').insert({ tenant_id: TENANT, user_id: seed.usuario, role: 'admin', accepted_at: new Date().toISOString() })
    exigir(!m.error, `memberships: ${m.error?.message}`)
    const u = await sr.from('units').insert(UNIDADES.map(([code, kind]) => ({ tenant_id: TENANT, code, nome: code, kind })))
    exigir(!u.error, `units: ${u.error?.message}`)
    const r = await rpc(antigo, false)
    exigir(r.contagens.insumo.novos === 8 && r.contagens.ficha.novos === 3, `gravação antiga: ${JSON.stringify(r.contagens)}`)
    const { custo } = await custoDaFicha('ED900124')
    exigir(Math.abs(custo - 1615.15) < 0.01, `ficha do espelho 60 com a regra antiga: ${custo}`)
  })
  await passo('custos: a prévia da reimportação mostra "atualizado" só em custo_referencia', async () => {
    exigir(plano.aceito, `plano: ${plano.recusa}`)
    const previa = core.juntarPrevia(plano, await rpc(plano.payload, true))
    const mudou = previa.linhas.filter((l) => l.situacao !== 'igual')
    const texto = mudou.map((l) => `${l.entidade}:${l.chave}:${l.situacao}:${l.campos.join('+')}`).join(' ')
    exigir(texto === CORRIGIDOS.map((s) => `insumo:${s}:atualizado:custo_referencia`).join(' '), `prévia: ${texto}`)
    exigir(previa.podeGravar && previa.totalGravacoes === CORRIGIDOS.length, `podeGravar ${previa.podeGravar}, gravações ${previa.totalGravacoes}`)
    exigir(previa.linhas.find((l) => l.chave === 'MP9145')?.mensagens.some((m) => m.includes('está por rl, não por un')), 'aviso do custo médio legado da Bolha')
  })
  await passo('custos: gravar conserta; a web lê o custo por unidade de consumo e a ficha volta ao custo de espelho', async () => {
    const r = await web.catalogo.importarCatalogo(ctx, plano.payload, false)
    exigir(r.contagens.insumo.atualizados === CORRIGIDOS.length && r.contagens.ficha.atualizados === 0 && r.contagens.produto.atualizados === 0, `gravação: ${JSON.stringify(r.contagens)}`)
    const { custo, materiais } = await custoDaFicha('ED900124')
    const custos = Object.fromEntries(materiais.map((m) => [m.sku, m.custoMedio]))
    exigir(custos.MP9145 === 4.0079 && custos.MP9140 === 20.5354 && custos.MP9163 === 4.3905 && custos.MP9190 === 0, `custos lidos pela web: ${JSON.stringify(custos)}`)
    exigir(Math.abs(custo - 36.23) < 0.01, `ficha do espelho 60 depois da correção: ${custo}`)
    const de_novo = core.juntarPrevia(plano, await rpc(plano.payload, false))
    exigir(de_novo.totalGravacoes === 0, `reimportar de novo: ${JSON.stringify(de_novo.contagens)}`)
  })
}
