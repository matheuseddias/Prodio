// Leitura paginada do PostgREST.
//
// O Supabase corta toda resposta em 1.000 linhas (db-max-rows) sem dar erro: a leitura volta "certa",
// só que pela metade. Com o catálogo do ES importado (~3.000 linhas de ficha), a tela de fichas ficaria
// truncada — e salvar uma ficha cortada ativa uma versão com linhas a menos. Por isso as leituras de
// cadastro vêm em lotes, com ordem estável (sem ela, o offset pula ou repete linhas entre um lote e outro).
import { checar } from './erros'

/** Tamanho do lote: o teto do Supabase. Maior que o db-max-rows do servidor, o lote vem cortado e a leitura para cedo. */
export const TAMANHO_LOTE = 1000
/** Trava contra laço infinito (resposta que nunca diminui): 500 lotes = 500 mil linhas. */
const MAX_LOTES = 500

/** O que o supabase-js devolve de um select (a tipagem das linhas fica com quem chama, como nas outras leituras). */
type RespostaLote = { data: unknown; error: unknown }

/**
 * Lê todas as linhas pedindo `montar(de, ate)` (inclusivos, como o `.range()` do supabase-js) até vir um
 * lote menor que `tamanho`. `montar` precisa ordenar por uma chave única (ou terminar numa: `id`).
 */
export async function lerTudo<T>(montar: (de: number, ate: number) => PromiseLike<RespostaLote>, tamanho = TAMANHO_LOTE): Promise<T[]> {
  if (!Number.isInteger(tamanho) || tamanho < 1) throw new Error('lerTudo: tamanho do lote inválido')
  const saida: T[] = []
  for (let lote = 0; lote < MAX_LOTES; lote++) {
    const de = lote * tamanho
    const linhas = (checar(await montar(de, de + tamanho - 1)) ?? []) as T[]
    if (!Array.isArray(linhas)) throw new Error('Resposta do banco em formato inesperado (esperava uma lista).')
    saida.push(...linhas)
    if (linhas.length < tamanho) return saida
  }
  throw new Error(`Leitura grande demais (mais de ${MAX_LOTES * tamanho} linhas). Avise o suporte do Prodio.`)
}
