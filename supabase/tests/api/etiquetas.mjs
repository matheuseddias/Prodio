// Parte (e): tamanhos de etiqueta pelo caminho real da tela (apps/web/src/data/tamanhosEtiqueta.ts, leituras.ts e
// escritasSistema.ts) contra o PostgREST: a empresa nasce com os três tamanhos de fábrica (os mesmos do core), a
// RPC save_label_size cria e valida com a mensagem do core, o perfil guarda o tamanho (label_size_id) pela gravação
// de Configurações, apagar o tamanho devolve o perfil ao padrão, e tamanho de outra empresa não entra no perfil.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const TENANT = '0a1a0000-0000-4000-8000-0000000e7a00'
const OUTRO = '0a1a0000-0000-4000-8000-0000000e7a01'

function exigir(condicao, oque) {
  if (!condicao) throw new Error(oque)
}

/** Devolve { falhas, feitos }. */
export async function exercitarEtiquetas({ clientes, seed, fontes, clienteDoTenant }) {
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
      falhas.push({ onde: 'supabase/tests/api/etiquetas.mjs', titulo, texto })
    }
  }
  const importar = (caminho) => import(pathToFileURL(join(fontes, caminho)).href)
  const [core, tamanhos, leituras, sistema, supaCtx] = await Promise.all([
    importar('packages/core/src/etiquetaTamanhos.ts'),
    importar('apps/web/src/data/tamanhosEtiqueta.ts'),
    importar('apps/web/src/data/leituras.ts'),
    importar('apps/web/src/data/escritasSistema.ts'),
    importar('apps/web/src/data/supabaseCtx.ts'),
  ])
  const sr = clientes.service_role
  const ctxDe = (tenant) => ({
    sb: clienteDoTenant(tenant),
    tenantId: () => tenant,
    estado: () => ({ tenant: { horaVirada: '05:00' }, labelSizes: [], locations: [], products: [], boms: [], materials: [], connectors: [], outbox: [] }),
    mapas: supaCtx.novosMapas(),
  })
  const ctx = ctxDe(TENANT)
  const estado = {}

  await passo('etiquetas: duas empresas novas (service role); o gatilho dá a cada uma os três tamanhos de fábrica', async () => {
    for (const [id, slug] of [[TENANT, 'api-etiquetas'], [OUTRO, 'api-etiquetas-outra']]) {
      const t = await sr.from('tenants').insert({ id, slug, nome: `Etiquetas ${slug}`, cnpj: '30303030000130' })
      exigir(!t.error, `tenants: ${t.error?.message}`)
      const m = await sr.from('memberships').insert({ tenant_id: id, user_id: seed.usuario, role: 'admin', accepted_at: new Date().toISOString() })
      exigir(!m.error, `memberships: ${m.error?.message}`)
    }
    const p = await sr.from('label_profiles').insert({ tenant_id: TENANT, familia: 'Espelho', prefixo: 'EH' })
    exigir(!p.error, `label_profiles: ${p.error?.message}`)
  })

  await passo('web: lerLabelSizes traz os tamanhos de fábrica iguais aos do core (60 × 40 padrão), sem os da outra empresa', async () => {
    const lista = await tamanhos.lerLabelSizes(ctx)
    const esperado = core.PRESETS_TAMANHO.map((t) => `${t.nome}|${t.larguraMm}|${t.alturaMm}|${t.margemMm}|${t.dpi}|${t.padrao}|${t.preset}`)
    exigir(JSON.stringify(lista.map((t) => `${t.nome}|${t.larguraMm}|${t.alturaMm}|${t.margemMm}|${t.dpi}|${t.padrao}|${t.preset}`)) === JSON.stringify(esperado), `tamanhos: ${JSON.stringify(lista)}`)
    const doOutro = await tamanhos.lerLabelSizes(ctxDe(OUTRO))
    exigir(doOutro.every((t) => !lista.some((x) => x.id === t.id)), 'a outra empresa enxerga os mesmos ids')
    estado.p60 = lista.find((t) => t.preset === '60x40')
    estado.doOutro = doOutro[0].id
  })

  await passo("web: saveLabelSize (rpc('save_label_size')) cria um rolo de 2 colunas e devolve a lista relida", async () => {
    const patch = await sistema.saveLabelSize(ctx, { id: 'novo-api', nome: 'Rolo 2 colunas', larguraMm: 40, alturaMm: 25, margemMm: 1.5, dpi: 300, orientacao: 'normal', colunas: 2, espacoColunasMm: 3, padrao: false })
    const rolo = patch.labelSizes?.find((t) => t.nome === 'Rolo 2 colunas')
    exigir(patch.labelSizes?.length === 4 && rolo, `lista: ${JSON.stringify(patch.labelSizes)}`)
    exigir(/^[0-9a-f-]{36}$/.test(rolo.id) && rolo.colunas === 2 && rolo.espacoColunasMm === 3 && rolo.dpi === 300 && rolo.margemMm === 1.5, `rolo: ${JSON.stringify(rolo)}`)
    estado.rolo = rolo
  })

  await passo('web: regra quebrada volta com a mensagem do core (validarTamanho)', async () => {
    const t = { id: 'novo-ruim', nome: 'Estreita', larguraMm: 9, alturaMm: 25, margemMm: 1, dpi: 203, orientacao: 'normal', colunas: 1, espacoColunasMm: 0, padrao: false }
    const doCore = core.validarTamanho(t)[0]
    try {
      await sistema.saveLabelSize(ctx, t)
      throw new Error('deveria recusar largura 9 mm')
    } catch (e) {
      exigir(e.message === doCore, `banco "${e.message}", core "${doCore}"`)
    }
  })

  await passo('web: setTenant grava o tamanho do perfil (label_size_id) e lerTenant devolve', async () => {
    const t = await leituras.lerTenant(ctx)
    const espelho = t.perfisEtiqueta.find((p) => p.familia === 'Espelho')
    exigir(espelho && espelho.tamanhoId === null, `perfil antes: ${JSON.stringify(espelho)}`)
    await sistema.setTenant(ctx, { ...t, perfisEtiqueta: t.perfisEtiqueta.map((p) => ({ ...p, tamanhoId: estado.rolo.id })) })
    const depois = await leituras.lerTenant(ctx)
    exigir(depois.perfisEtiqueta[0].tamanhoId === estado.rolo.id, `perfil depois: ${JSON.stringify(depois.perfisEtiqueta)}`)
    estado.tenant = depois
  })

  await passo('web: perfil com tamanho de outra empresa é recusado (FK composta)', async () => {
    try {
      await sistema.setTenant(ctx, { ...estado.tenant, perfisEtiqueta: estado.tenant.perfisEtiqueta.map((p) => ({ ...p, tamanhoId: estado.doOutro })) })
      throw new Error('o perfil aceitou tamanho da outra empresa')
    } catch (e) {
      exigir(!/aceitou/.test(e.message), e.message)
    }
    const ainda = await leituras.lerTenant(ctx)
    exigir(ainda.perfisEtiqueta[0].tamanhoId === estado.rolo.id, `perfil mudou: ${JSON.stringify(ainda.perfisEtiqueta)}`)
  })

  await passo("web: removeLabelSize (rpc('delete_label_size')) apaga e devolve o perfil ao padrão; o padrão não se apaga", async () => {
    const patch = await sistema.removeLabelSize(ctx, estado.rolo.id)
    exigir(patch.labelSizes?.length === 3, `lista: ${patch.labelSizes?.length}`)
    exigir(patch.tenant?.perfisEtiqueta[0].tamanhoId === null, `perfil: ${JSON.stringify(patch.tenant?.perfisEtiqueta)}`)
    try {
      await sistema.removeLabelSize(ctx, estado.p60.id)
      throw new Error('apagou o padrão')
    } catch (e) {
      exigir(/padrão não pode ser apagado/.test(e.message), e.message)
    }
  })

  await passo('web: marcar outro tamanho como padrão tira o padrão do 60 × 40', async () => {
    const lista = await tamanhos.lerLabelSizes(ctx)
    const p50 = lista.find((t) => t.preset === '50x30')
    const patch = await sistema.saveLabelSize(ctx, { ...p50, padrao: true })
    const padroes = patch.labelSizes.filter((t) => t.padrao).map((t) => t.preset)
    exigir(JSON.stringify(padroes) === '["50x30"]', `padrões: ${JSON.stringify(padroes)}`)
  })

  return { falhas, feitos }
}
