// Classifica a expressão cron recebida em scheduled() (wrangler.toml [triggers]).
export type TipoCron = 'sync' | 'auditor' | 'desconhecido'

export function classificarCron(expressao: string | undefined): TipoCron {
  const campos = String(expressao ?? '').trim().split(/\s+/)
  if (campos.length !== 5) return 'desconhecido'
  const [minuto, hora] = campos
  // "*/5 * * * *" (ou qualquer passo de minutos) é o ciclo curto de sincronização.
  if (minuto.startsWith('*/') || minuto === '*') return 'sync'
  // "0 3 * * *": minuto e hora fixos, uma vez por dia = auditor.
  if (/^\d+$/.test(minuto) && /^\d+$/.test(hora)) return 'auditor'
  return 'desconhecido'
}
