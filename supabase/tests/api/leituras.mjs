// Parte (a): cada select achado no código roda com limit=1 como service_role e como authenticated.
// Qualquer erro do PostgREST reprova (PGRST201 embed ambíguo, 42703 coluna, 42P01 tabela, PGRST200
// relação inexistente…). Resposta vazia por RLS não é erro.
// Além das colunas do select, confere as colunas dos filtros (col=is.null, vale para qualquer tipo)
// e do order: coluna de filtro inexistente derruba a consulta em produção do mesmo jeito.

// Consulta que só roda com service role (o Db do worker): 42501 como authenticated é esperado.
const SO_SERVICE_ROLE = new Set(['apps/worker/src/db.ts'])

function montar(sb, c) {
  let q = sb.from(c.tabela).select(c.colunas, c.count ? { count: c.count } : undefined)
  for (const coluna of c.filtros) q = q.is(coluna, null)
  for (const o of c.ordens) q = q.order(o.coluna, { ascending: o.ascendente })
  return q.limit(1)
}

function descrever(erro) {
  const partes = [`${erro.code ?? 'sem código'} ${erro.message ?? ''}`.trim()]
  if (erro.hint) partes.push(`dica: ${erro.hint}`)
  if (erro.details && typeof erro.details === 'string') partes.push(`detalhe: ${erro.details.slice(0, 300)}`)
  return partes.join(' | ')
}

/** clientes: { service_role, authenticated } (supabase-js). Devolve { falhas, avisos, requisicoes }. */
export async function exercitarLeituras(clientes, consultas) {
  const falhas = []
  const avisos = []
  let requisicoes = 0
  for (const c of consultas) {
    const onde = `${c.arquivo}:${c.linha}`
    const erros = []
    for (const [papel, sb] of Object.entries(clientes)) {
      const q = montar(sb, c)
      const url = decodeURIComponent(`${q.url.pathname}${q.url.search}`)
      requisicoes++
      let r
      try {
        r = await q
      } catch (e) {
        r = { error: { code: 'REDE', message: e instanceof Error ? e.message : String(e) } }
      }
      if (!r.error) continue
      if (papel === 'authenticated' && r.error.code === '42501' && SO_SERVICE_ROLE.has(c.arquivo)) {
        avisos.push(`${onde} ${c.tabela}: 42501 como authenticated (consulta só do service role, esperado)`)
        continue
      }
      erros.push({ papel, url, texto: descrever(r.error) })
    }
    const extra = c.aposEscrita ? ` (retorno do ${c.aposEscrita}, conferido como leitura)` : ''
    if (erros.length === 0) {
      console.log(`  ok      ${onde}  ${c.tabela}${extra}`)
      continue
    }
    console.log(`  FALHOU  ${onde}  ${c.tabela}${extra}`)
    for (const e of erros) {
      console.log(`          [${e.papel}] GET ${e.url}`)
      console.log(`          ${e.texto}`)
    }
    falhas.push({ onde, tabela: c.tabela, erros })
  }
  return { falhas, avisos, requisicoes }
}
