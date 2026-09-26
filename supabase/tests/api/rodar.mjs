// Teste de API: as consultas reais da web e do worker contra um PostgREST de verdade.
// Chamado por supabase/tests/api.sh, que monta o banco descartável e sobe o PostgREST.
// Por quê: o cron do worker passou 24 h sem tocar em conector nenhum porque o select de
// Db.listarConectoresAtivos embutia tenants(slug, fuso) e o PostgREST respondia PGRST201 (há mais de
// uma relação connectors↔tenants: a FK direta e as tabelas connector_status_map/hub_stock_snapshots,
// que ele trata como junção). Os testes do worker usam Db falso e o db:test fala SQL direto: nenhum
// dos dois passa pelo PostgREST, então ninguém viu.
import { createHmac } from 'node:crypto'
import { createRequire, register } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extrairConsultas } from './extrair.mjs'
import { exercitarLeituras } from './leituras.mjs'
import { exercitarEscritas } from './escritas.mjs'

const URL_API = process.env.API_URL
const SEGREDO = process.env.API_JWT_SECRET
if (!URL_API || !SEGREDO) {
  console.error('api: rode por supabase/tests/api.sh (faltam API_URL e API_JWT_SECRET)')
  process.exit(2)
}
const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
// API_FONTES: outra cópia do código para varrer (ex.: um commit antigo exportado); padrão é este repo.
const FONTES = resolve(process.env.API_FONTES || REPO)

// Ids fixos de supabase/seed.sql e seed_compras.sql.
const SEED = {
  tenant: '11111111-1111-1111-1111-111111111111',
  usuario: '22222222-2222-2222-2222-222222222222', // admin do tenant (memberships)
  conector: '0d000000-0000-0000-0000-000000000001', // BaseLinker, nasce desconectado
  conectorDesconectado: '0d000000-0000-0000-0000-000000000002', // Bling, fica desconectado
  produto: 'a0000000-0000-0000-0000-000000000005',
  sku: 'ED000001',
  slug: 'eddias',
  fuso: 'America/Sao_Paulo',
}

function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const agora = Math.floor(Date.now() / 1000)
  const corpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', iat: agora, exp: agora + 3600, ...claims })}`
  return `${corpo}.${createHmac('sha256', SEGREDO).update(corpo).digest('base64url')}`
}
const chaveAnon = jwt({ role: 'anon' })
const chaveServico = jwt({ role: 'service_role' })
// Igual ao token que o custom_access_token_hook monta: tenant e papel em app_metadata.
const tokenUsuario = jwt({
  sub: SEED.usuario, role: 'authenticated', aud: 'authenticated', is_anonymous: false,
  app_metadata: { tenant_id: SEED.tenant, role: 'admin' },
})

// O Supabase publica o PostgREST em /rest/v1; aqui ele responde na raiz. Só o prefixo muda.
const fetchOriginal = globalThis.fetch
globalThis.fetch = (entrada, init) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  const prefixo = `${URL_API}/rest/v1`
  if (!url.startsWith(`${prefixo}/`)) return fetchOriginal(entrada, init)
  const nova = URL_API + url.slice(prefixo.length)
  return fetchOriginal(entrada instanceof Request ? new Request(nova, entrada) : nova, init)
}

// supabase-js é dependência da web e do worker; usamos a mesma instalação, sem dependência nova.
const { createClient } = createRequire(join(REPO, 'apps/web/package.json'))('@supabase/supabase-js')
const opcoes = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const clientes = {
  service_role: createClient(URL_API, chaveServico, opcoes),
  // Como a web depois do login (e o criarClienteUsuario do worker): anon key + JWT do usuário.
  authenticated: createClient(URL_API, chaveAnon, { ...opcoes, global: { headers: { Authorization: `Bearer ${tokenUsuario}` } } }),
}

const falhas = []

console.log(`api: PostgREST em ${URL_API}; código de ${FONTES}`)
const visivel = await clientes.authenticated.from('tenants').select('id').eq('id', SEED.tenant)
if (visivel.error || visivel.data?.length !== 1) {
  const texto = visivel.error?.message ?? 'o usuário do seed não enxerga o próprio tenant (RLS/claims do JWT de teste)'
  console.log(`  FALHOU  pré-condição: authenticated lê o tenant do seed — ${texto}`)
  falhas.push({ onde: 'supabase/tests/api/rodar.mjs', texto })
}

console.log('\n(a) selects do código, limit=1, como service_role e como authenticated')
console.log('    (filtros do código viram col=is.null e o order é mantido: só nomes de tabela, coluna e relação importam)')
const { consultas, puladas, escritas } = extrairConsultas(FONTES)
// Guarda contra o extrator não achar nada (pasta errada, AST que mudou) e (a) passar no vácuo.
const achadas = (prefixo) => consultas.filter((c) => c.arquivo.startsWith(prefixo))
const minimos = [['apps/web/src/', 10], ['apps/worker/src/db.ts', 5]]
for (const [prefixo, minimo] of minimos) {
  if (achadas(prefixo).length >= minimo) continue
  const texto = `o extrator achou ${achadas(prefixo).length} select(s) em ${prefixo} (mínimo ${minimo}): a parte (a) não estaria testando nada`
  console.log(`  FALHOU  ${texto}`)
  falhas.push({ onde: 'supabase/tests/api/extrair.mjs', texto })
}
if (!achadas('apps/worker/src/db.ts').some((c) => c.tabela === 'connectors')) {
  const texto = 'o select de connectors do Db do worker (a listagem do cron) não foi achado'
  console.log(`  FALHOU  ${texto}`)
  falhas.push({ onde: 'supabase/tests/api/extrair.mjs', texto })
}
const leituras = await exercitarLeituras(clientes, consultas)
falhas.push(...leituras.falhas)

console.log('\n(b) escritas e RPCs do worker pelo Db real (apps/worker/src/db.ts), com service role')
let escritasDb = { falhas: [], feitos: 0, semPasso: [] }
try {
  register('./resolver-ts.mjs', import.meta.url)
  const { Db } = await import(pathToFileURL(join(FONTES, 'apps/worker/src/db.ts')).href)
  const env = { SUPABASE_URL: URL_API, SUPABASE_SERVICE_KEY: chaveServico, SUPABASE_ANON_KEY: chaveAnon, CREDENTIALS_KEY: 'chave-local-do-teste-de-api-0123456789abcdef' }
  escritasDb = await exercitarEscritas({ Db, env, seed: SEED, fontes: FONTES })
} catch (e) {
  const texto = `não consegui importar ou instanciar o Db: ${e instanceof Error ? e.message : String(e)}`
  console.log(`  FALHOU  apps/worker/src/db.ts\n          ${texto}`)
  escritasDb.falhas.push({ onde: 'apps/worker/src/db.ts', texto })
}
falhas.push(...escritasDb.falhas)

console.log('\nresumo')
console.log(`  selects exercitados: ${consultas.length} (${leituras.requisicoes} requisições: service_role + authenticated)`)
console.log(`  selects pulados por serem dinâmicos: ${puladas.length}`)
for (const p of puladas) console.log(`    - ${p.arquivo}:${p.linha} ${p.motivo}`)
for (const a of leituras.avisos) console.log(`  aviso: ${a}`)
console.log(`  escritas diretas da web e do worker achadas no código: ${escritas.length}; as do worker são exercitadas em (b), as da web não`)
console.log(`  métodos do Db exercitados em (b): ${escritasDb.feitos}`)
for (const s of escritasDb.semPasso) console.log(`    - fora de (b): ${s}`)

if (falhas.length > 0) {
  console.log(`\napi: ${falhas.length} falha(s)`)
  for (const f of falhas) console.log(`  - ${f.onde}${f.tabela ? ` (${f.tabela})` : ''}${f.titulo ? ` ${f.titulo}` : ''}`)
  process.exit(1)
}
