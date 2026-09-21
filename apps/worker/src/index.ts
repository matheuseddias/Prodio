// Ponto de entrada do worker. Rotas e crons são preenchidos nas fatias seguintes.
export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
  CREDENTIALS_KEY: string
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return new Response('ok')
    return new Response('not found', { status: 404 })
  },
  async scheduled(): Promise<void> {
    // preenchido pelas fatias de conectores
  },
} satisfies ExportedHandler<Env>
