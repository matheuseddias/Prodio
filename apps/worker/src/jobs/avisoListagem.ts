// O que o cron faz quando nem a lista de conectores ele consegue ler (Db.listarConectoresAtivos).
//
// Até 26/09/2026 esse caso só virava uma linha `sync.listar` no log, e o robô ficou parado sem
// nenhum sinal na tela: a listagem pedia `tenants(slug, fuso)` em embed e o PostgREST respondia
// PGRST201. Sem a lista não há conector onde gravar o motivo — então se tenta uma leitura mínima
// (id, tenant, status) e, se ela vier, o motivo vai para `ultimo_erro` de cada conector ativo.
//
// DECISÕES
// • Só `ultimo_erro`, status intacto (Db.avisarNoCartao): 'erro' faria enqueue_outbox parar de
//   enfileirar o estoque produzido enquanto o aviso estivesse lá, e esse saldo não volta depois.
// • Prefixo `cron:`. Com status 'conectado', um `ultimo_erro` qualquer é lido pelo cartão como
//   "houve uma falha antes, e a conexão voltou" — o oposto da verdade. O prefixo faz a tela
//   (apps/web/src/pages/sistema/ConectorSituacao.ts) dizer "O robô não está rodando" com esta frase.
//   O contrato entre os dois lados é preso em apps/web/src/pages/sistema/contrato.test.ts.
// • O aviso sai sozinho, assim que a listagem volta: o cron o apaga do cartão logo depois do pulso,
//   ANTES da rodada (limparAvisoDeListagem). Esperar o fim da rodada (worker_set_sync_state) não
//   basta: uma rodada que morre no meio (CPU do plano) deixaria a tela dizendo que o robô nem lista
//   os conectores, por cima do diagnóstico pelo pulso.
// • Texto fixo com o código do PostgREST, e nada mais do erro: `connectors` é legível por qualquer
//   membro do tenant, inclusive o tablet do chão de fábrica. Detalhe e dica ficam no log.
import { camposDoErro, type ConectorRow, type Db } from '../db'
import { log, mensagemErro } from '../log'

export const PREFIXO_AVISO_CRON = 'cron:'

/** Código de erro que pode ir para a tela: curto e só com letras, dígitos e sublinhado. */
function codigoSeguro(e: unknown): string | null {
  const c = camposDoErro(e).codigo
  return c && /^[A-Za-z0-9_]{1,16}$/.test(c) ? c : null
}

// Em minúscula e sem ponto final, como todo `ultimo_erro` (a tela aplica comoFrase).
export function avisoDeListagem(e: unknown): string {
  const codigo = codigoSeguro(e)
  return (
    `${PREFIXO_AVISO_CRON} o robô não conseguiu ler a lista de conectores no banco${codigo ? ` (código ${codigo})` : ''} e não sincronizou nenhum deles. ` +
    'Até isso ser corrigido, os pedidos só entram pelo botão "Sincronizar agora". O detalhe está nos logs do worker, evento sync.listar'
  )
}

// Devolve quantos cartões receberam o aviso. Nunca lança: é o caminho de falha de um caminho de falha.
export async function avisarFalhaDeListagem(db: Pick<Db, 'listarConectoresParaAviso' | 'avisarNoCartao'>, e: unknown): Promise<number> {
  const texto = avisoDeListagem(e)
  let linhas: Awaited<ReturnType<Db['listarConectoresParaAviso']>>
  try {
    linhas = await db.listarConectoresParaAviso()
  } catch (e2) {
    log('error', 'sync.listar.aviso', { etapa: 'ler', erro: mensagemErro(e2), ...camposDoErro(e2) })
    return 0
  }
  let avisados = 0
  for (const l of linhas) {
    if (l.ultimo_erro === texto) continue // já está no cartão; regravar só encheria o audit_log
    try {
      await db.avisarNoCartao(l.id, l.tenant_id, texto)
      avisados++
    } catch (e2) {
      log('error', 'sync.listar.aviso', { etapa: 'gravar', connector: l.id, tenant: l.tenant_id, erro: mensagemErro(e2), ...camposDoErro(e2) })
    }
  }
  log('warn', 'sync.listar.aviso', { conectores: linhas.length, avisados })
  return avisados
}

// A listagem voltou a funcionar: tira o aviso deste cartão. Só quando é mesmo o aviso (o `like` do
// Db confere de novo no banco) e sem lançar: é limpeza, a rodada segue de qualquer jeito.
export async function limparAvisoDeListagem(row: ConectorRow, db: Pick<Db, 'limparAvisoNoCartao'>): Promise<void> {
  if (!row.ultimo_erro?.startsWith(PREFIXO_AVISO_CRON)) return
  try {
    await db.limparAvisoNoCartao(row.id, row.tenant_id, PREFIXO_AVISO_CRON)
  } catch (e) {
    log('error', 'sync.listar.limpar', { connector: row.id, tenant: row.tenant_id, erro: mensagemErro(e), ...camposDoErro(e) })
  }
}
