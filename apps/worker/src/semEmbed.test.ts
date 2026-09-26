// Nenhum `.select` do worker pode usar embed do PostgREST (`tabela(colunas)`).
//
// POR QUE: até 26/09/2026 Db.listarConectoresAtivos pedia `tenants(slug, fuso)` junto de connectors,
// e o PostgREST respondia PGRST201 ("more than one relationship was found"): connector_status_map e
// hub_stock_snapshots têm FK para as duas tabelas com as colunas dentro da PK e contam como junção.
// O cron, o envio de estoque e o auditor nunca chegaram a conector nenhum, e nenhum teste viu,
// porque todos usam um Db falso. Este teste lê o FONTE e reprova parênteses em qualquer string
// passada a `.select` — inclusive por constante do mesmo arquivo. Hint `!fk` também tem parênteses
// e também é reprovado: prende a consulta ao nome gerado da FK, e renomeá-la derruba o cron.

// Os tipos do worker são os do Cloudflare, sem os do Node: o `node:fs` entra por import dinâmico.
interface Fs {
  readdirSync(caminho: string, opcoes: { recursive: true }): string[]
  readFileSync(caminho: string, codificacao: 'utf8'): string
}
const nomeFs = 'node:fs'
const fs = (await import(/* @vite-ignore */ nomeFs)) as Fs
const DIR = decodeURIComponent(new URL('.', (import.meta as unknown as { url: string }).url).pathname)

// Comentário de linha só quando `//` abre a linha ou vem depois de espaço: URL dentro de string
// ('https://…') fica.
const semComentarios = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')

interface Violacao {
  arquivo: string
  trecho: string
}

/** Todas as chamadas `.select(...)` do fonte, com o texto das colunas (ou null se não deu para ler). */
function selectsDoFonte(fonte: string): { argumento: string; colunas: string | null }[] {
  const src = semComentarios(fonte)
  const saida: { argumento: string; colunas: string | null }[] = []
  const chamada = /\.select\(\s*(?:(['"`])((?:\\.|(?!\1)[^\\])*)\1|([A-Za-z_$][\w$]*)|\))/g
  for (const m of src.matchAll(chamada)) {
    if (m[1]) {
      saida.push({ argumento: m[0], colunas: m[2] })
    } else if (m[3]) {
      // Constante do mesmo arquivo: `const X = '...'`.
      const def = new RegExp(`const\\s+${m[3]}\\s*(?::[^=]+)?=\\s*(['"\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`).exec(src)
      saida.push({ argumento: m[0], colunas: def ? def[2] : null })
    } else {
      saida.push({ argumento: m[0], colunas: '*' }) // .select() sem argumento
    }
  }
  return saida
}

function violacoes(arquivo: string, fonte: string): Violacao[] {
  return selectsDoFonte(fonte)
    .filter((s) => s.colunas === null || s.colunas.includes('('))
    .map((s) => ({ arquivo, trecho: s.colunas === null ? `${s.argumento} (colunas fora de uma string ou constante deste arquivo)` : s.colunas }))
}

function fontesDoWorker(): { arquivo: string; fonte: string }[] {
  return fs
    .readdirSync(DIR, { recursive: true })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((arquivo) => ({ arquivo, fonte: fs.readFileSync(`${DIR}${arquivo}`, 'utf8') }))
}

describe('nenhum embed do PostgREST no worker', () => {
  it('nenhum .select de apps/worker/src tem parênteses', () => {
    const fontes = fontesDoWorker()
    // Guarda contra a leitura achar nada e o teste passar no vácuo.
    const todos = fontes.flatMap((f) => selectsDoFonte(f.fonte))
    expect(fontes.map((f) => f.arquivo)).toContain('db.ts')
    expect(todos.length).toBeGreaterThanOrEqual(8)
    expect(todos.map((s) => s.colunas)).toContain('id, tenant_id, plataforma, nome, status, config, ultimo_erro')
    expect(fontes.flatMap((f) => violacoes(f.arquivo, f.fonte))).toEqual([])
  })

  it('o detector pega o embed de volta, em todas as formas', () => {
    const casos = [
      `sb.from('connectors').select('id, tenant_id, plataforma, nome, status, config, tenants(slug, fuso)')`,
      `sb.from('connectors')\n  .select(\n    "id, tenants!connectors_tenant_id_fkey(slug)"\n  )`,
      'sb.from("x").select(`id, itens:order_items(sku)`)',
      `const COLS = 'id, tenants(fuso)'\nsb.from('connectors').select(COLS).eq('id', id)`,
      `sb.from('connectors').select(colunasDeOutroArquivo)`,
    ]
    for (const c of casos) expect(violacoes('x.ts', c), c).toHaveLength(1)
    // O que é permitido continua passando, e comentário não conta.
    const ok = [
      `sb.from('tenants').select('id, slug, fuso').in('id', ids)`,
      `const COLS = 'id, nome'\nsb.from('c').select(COLS)`,
      `sb.from('c').select().eq('id', 1)`,
      `// antes: .select('id, tenants(slug, fuso)')\nsb.from('c').select('id')`,
      `const url = 'https://x.supabase.co'; sb.from('c').select('id')`,
    ]
    for (const c of ok) expect(violacoes('x.ts', c), c).toEqual([])
  })
})
