// Gancho de resolução do Node para importar o Db real (apps/worker/src/db.ts) sem build.
// O worker importa módulos irmãos sem extensão ('./log', '../conectores'), como pede o bundler do
// wrangler; o Node exige a extensão. Aqui só completamos '.ts' / '/index.ts' quando falta.
export async function resolve(especificador, contexto, proximo) {
  try {
    return await proximo(especificador, contexto)
  } catch (erro) {
    const relativo = /^\.\.?\//.test(especificador)
    const semExtensao = !/\.[cm]?[jt]sx?$/.test(especificador)
    if (!relativo || !semExtensao || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(erro?.code)) throw erro
    for (const sufixo of ['.ts', '.tsx', '/index.ts']) {
      try {
        return await proximo(especificador + sufixo, contexto)
      } catch {
        // tenta o próximo sufixo
      }
    }
    throw erro
  }
}
