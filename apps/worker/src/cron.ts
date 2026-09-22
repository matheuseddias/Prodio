// Classifica a expressão cron recebida em scheduled() (wrangler.toml [triggers]).
//
// POR QUE ISTO NÃO DEVOLVE MAIS "não sei": um cron que dispara e não roda job nenhum não deixa
// sintoma em lugar nenhum. Nada muda no banco, nada muda na tela do dono, e o único vestígio é uma
// linha de `warn` que só aparece para quem estiver com `wrangler tail` aberto no minuto certo. Numa
// fábrica isso é um turno inteiro de pedidos não lidos sem ninguém perceber — exatamente o sintoma
// que o cartão do conector passou a existir para não deixar acontecer.
//
// A regra passou a ser: na dúvida, roda o ciclo curto (sync de pedidos + outbox). Ele é idempotente
// (upsert por chave única, docs/arquitetura.md §2 regra 6) e custa uma chamada de API a mais.
// Rodar demais é barato; ficar em silêncio não é. Quem chama avisa no log que foi palpite.
export type TipoCron = 'sync' | 'auditor'

// As duas expressões que estão em wrangler.toml, casadas por texto: o caminho normal não depende
// de heurística nenhuma. Mexeu no wrangler.toml, mexa aqui — e o teste cobre as duas listas juntas.
const CONFIGURADOS: Record<string, TipoCron> = {
  '*/5 * * * *': 'sync',
  '0 3 * * *': 'auditor',
}

export interface CronClassificado {
  tipo: TipoCron
  /** false quando a expressão não é nenhuma das conhecidas e `tipo` é o palpite seguro. */
  reconhecida: boolean
}

export function classificarCron(expressao: string | undefined): CronClassificado {
  const texto = String(expressao ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  const configurado = CONFIGURADOS[texto]
  if (configurado) return { tipo: configurado, reconhecida: true }
  const campos = texto ? texto.split(' ') : []
  if (campos.length === 5) {
    const [minuto, hora] = campos
    // "*/5 * * * *" (ou qualquer passo de minutos) é o ciclo curto de sincronização.
    if (minuto.startsWith('*/') || minuto === '*') return { tipo: 'sync', reconhecida: true }
    // "0 3 * * *": minuto e hora fixos, uma vez por dia = auditor.
    if (/^\d+$/.test(minuto) && /^\d+$/.test(hora)) return { tipo: 'auditor', reconhecida: true }
  }
  return { tipo: 'sync', reconhecida: false }
}
