// Log estruturado: uma linha JSON por evento, fácil de filtrar no painel da Cloudflare.
export type Nivel = 'debug' | 'info' | 'warn' | 'error'

let silencioso = false
export function silenciarLog(valor: boolean): void {
  silencioso = valor
}

export function log(nivel: Nivel, evento: string, campos: Record<string, unknown> = {}): void {
  if (silencioso) return
  const linha = JSON.stringify({ t: new Date().toISOString(), nivel, evento, ...campos })
  if (nivel === 'error') console.error(linha)
  else if (nivel === 'warn') console.warn(linha)
  else console.log(linha)
}

export function mensagemErro(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
