// Tradução de erros do Supabase/PostgREST/Auth para mensagens em português.

interface ErroParecido {
  code?: string
  message?: string
  details?: string
  hint?: string
  status?: number
  name?: string
}

const AUTH: Array<[RegExp, string]> = [
  [/invalid login credentials/i, 'E-mail ou senha inválidos.'],
  [/email not confirmed/i, 'E-mail ainda não confirmado. Veja sua caixa de entrada.'],
  [/user not found/i, 'Usuário não encontrado.'],
  [/rate limit|too many requests|over_email_send_rate_limit/i, 'Muitas tentativas. Aguarde um minuto e tente de novo.'],
  [/signups not allowed|signup.*disabled/i, 'Cadastro por convite: peça acesso ao administrador da empresa.'],
  [/anonymous sign-ins are disabled/i, 'Login anônimo desativado no projeto. Ative em Auth > Providers.'],
  [/invalid.*email/i, 'E-mail inválido.'],
  [/password.*(short|least)/i, 'Senha muito curta.'],
  [/refresh_token_not_found|invalid refresh token/i, 'Sessão expirada. Entre de novo.'],
  [/otp.*expired|token has expired/i, 'Link expirado. Peça um novo.'],
]

const CODIGOS: Record<string, string> = {
  '42501': 'Sem permissão para esta operação.',
  '23505': 'Já existe um registro com esses dados.',
  '23503': 'Registro referenciado por outro cadastro; não é possível concluir.',
  '23502': 'Campo obrigatório em branco.',
  '23514': 'Valor fora do permitido.',
  '22P02': 'Formato de dado inválido.',
  '42883': 'Função ainda não existe no banco (migration pendente).',
  '42P01': 'Tabela ainda não existe no banco (migration pendente).',
  PGRST116: 'Registro não encontrado.',
  PGRST301: 'Sessão inválida. Entre de novo.',
  PGRST202: 'RPC não encontrada no banco (migration pendente).',
}

export function mensagemErro(e: unknown, fallback = 'Não foi possível concluir. Tente de novo.'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e
  const err = e as ErroParecido
  const msg = err.message ?? ''
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a rede.'
  if (err.name === 'AbortError') return 'Operação cancelada.'
  for (const [re, txt] of AUTH) if (re.test(msg)) return txt
  if (err.code && CODIGOS[err.code]) {
    // Erros de negócio (P0001/22023) já vêm em português do próprio banco.
    return CODIGOS[err.code]
  }
  if (err.code === 'P0001' || err.code === '22023' || err.code === '28000') return msg || fallback
  if (err.status === 401 || err.status === 403) return 'Sem permissão. Entre de novo ou peça acesso ao administrador.'
  if (msg) return msg
  return fallback
}

export function ehErroDeRede(e: unknown): boolean {
  const msg = (e as ErroParecido)?.message ?? ''
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg) || (typeof navigator !== 'undefined' && !navigator.onLine)
}

/** Lança com mensagem em português quando a resposta do PostgREST traz erro. */
export function checar<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Error(mensagemErro(res.error))
  return res.data
}
