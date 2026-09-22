// NF-e de entrada no Tiny (Olist). Fica fora de tiny.ts por causa do limite de 400 linhas
// por arquivo. A v3 não filtra nota por chave de acesso: o jeito é varrer as notas de
// entrada da janela e casar pela chave (só dígitos), parando na página em que ela aparece.
import { log } from '../log'
import { numero, type NfeEncontrada } from './tipos'
import {
  MAPA_TINY,
  dataTiny,
  extrairXmlTiny,
  itensDaNotaTiny,
  soDigitos,
  type NotaTinyDetalhe,
  type NotaTinyLista,
} from './tinyMapa'

export interface OpcoesChamadaTiny {
  query?: Record<string, string>
  corpo?: unknown
  repetivel?: boolean
}

// O tanto do adaptador de que esta busca precisa (facilita o teste isolado).
export interface ClienteTiny {
  chamar<T>(metodo: string, caminho: string, opts?: OpcoesChamadaTiny): Promise<T>
  requisitar(metodo: string, caminho: string, opts: OpcoesChamadaTiny): Promise<string>
  listar<T>(caminho: string, query: Record<string, string>, opts?: { maxPaginas?: number; parar?: (lote: T[]) => boolean }): Promise<T[]>
}

// numero() devolve 0 para campo ausente; número/série de NF-e ausentes é melhor omitir.
export const inteiroOuNada = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = numero(v)
  return n > 0 ? n : undefined
}

export async function buscarNfeTiny(
  api: ClienteTiny,
  chave: string,
  ctx: { agora: number; fuso: string; dias: number },
): Promise<NfeEncontrada | null> {
  const alvo = soDigitos(chave)
  if (alvo.length !== 44) return null
  const combina = (n: NotaTinyLista) => soDigitos(n.chaveAcesso) === alvo
  const notas = await api.listar<NotaTinyLista>(
    MAPA_TINY.rotas.notas,
    {
      [MAPA_TINY.query.notaTipo]: MAPA_TINY.valores.notaEntrada,
      [MAPA_TINY.query.notaDataInicial]: dataTiny(new Date(ctx.agora - ctx.dias * 86400_000), ctx.fuso),
      [MAPA_TINY.query.notaDataFinal]: dataTiny(new Date(ctx.agora), ctx.fuso),
    },
    { parar: (lote) => lote.some(combina) }, // achou nesta página: não pagina o resto da janela
  )
  const achada = notas.find(combina)
  if (!achada) return null
  const n = await api.chamar<NotaTinyDetalhe>('GET', MAPA_TINY.rotas.nota(achada.id))
  return {
    externalId: String(achada.id),
    chave: alvo,
    numero: inteiroOuNada(n.numero ?? achada.numero),
    serie: inteiroOuNada(n.serie ?? achada.serie),
    emitente: n.fornecedor?.nome ?? n.contato?.nome ?? n.cliente?.nome,
    xml: await xmlDaNotaTiny(api, achada.id),
    itens: itensDaNotaTiny(n),
    raw: n,
  }
}

async function xmlDaNotaTiny(api: ClienteTiny, id: string | number): Promise<string | undefined> {
  try {
    return extrairXmlTiny(await api.requisitar('GET', MAPA_TINY.rotas.notaXml(id), {}))
  } catch (e) {
    // Sem XML a NF-e ainda serve (itens vêm do detalhe): não derruba a busca.
    log('warn', 'tiny.nfe.semXml', { nota: String(id), erro: e instanceof Error ? e.message : String(e) })
    return undefined
  }
}
