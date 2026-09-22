// Variáveis do worker (wrangler secret put). Ver README.md.
export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  // Só para validar o JWT do usuário em rotas acionadas por ele (RLS vale): nunca escreve nada.
  SUPABASE_ANON_KEY: string
  // Chave simétrica que cifra connector_credentials (pgp_sym_encrypt). Só o worker conhece.
  CREDENTIALS_KEY: string
  // App OAuth do Bling (global). Um tenant pode sobrescrever com client_id/client_secret nas credenciais.
  BLING_CLIENT_ID?: string
  BLING_CLIENT_SECRET?: string
  // App OAuth do Tiny (Olist). O app do Tiny é privado por seller: normalmente o client_id/
  // client_secret vem das credenciais do conector; estes só valem como fallback global.
  TINY_CLIENT_ID?: string
  TINY_CLIENT_SECRET?: string
  // URL pública do worker, usada no redirect_uri do OAuth (ex.: https://worker.prodio.app).
  PUBLIC_URL?: string
}
