// Contrato entre a tela de conectores e o worker.
//
// POR QUE ESTE TESTE EXISTE
// Os dois lados foram escritos em paralelo, a partir de um contrato combinado por escrito. Contrato
// escrito é onde integração morre: um lado manda `clientId`, o outro espera `client_id`, o
// TypeScript não vê nada (a fronteira é HTTP, não uma chamada de função) e ninguém descobre até o
// dono clicar em "Conectar" e levar um 400 com o nome de um campo.
//
// Então aqui o lado da interface é IMPORTADO (é código deste pacote) e o lado do worker é LIDO DO
// ARQUIVO. Ler o fonte é feio e é de propósito: é a única forma de prender os dois, já que
// apps/web e apps/worker compilam separados (um tem DOM, o outro tem os tipos do Cloudflare) e um
// import atravessando essa fronteira quebraria o `tsc --noEmit` dos dois. Renomear um campo, um
// caminho de rota ou um cabeçalho de qualquer um dos lados quebra este teste — que é exatamente o
// lugar onde a gente quer descobrir, e não no navegador do dono.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CAMPOS, OAUTH, TEM_ADAPTADOR, separar } from './ConectorCampos'
import type { Plataforma } from './ConectorMeta'

const RAIZ = fileURLToPath(new URL('../../../../..', import.meta.url))
const ler = (rel: string): string => readFileSync(`${RAIZ}${rel}`, 'utf8')

const FONTE = {
  roteador: ler('apps/worker/src/index.ts'),
  credenciais: ler('apps/worker/src/rotas/credenciais.ts'),
  adaptadores: ler('apps/worker/src/conectores/index.ts'),
  cors: ler('apps/worker/src/cors.ts'),
  clienteHttp: ler('apps/web/src/data/worker.ts'),
  chamadas: ler('apps/web/src/data/conectores.ts'),
}

const semComentarios = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const PLATAFORMAS = Object.keys(CAMPOS) as Plataforma[]
const COM_ADAPTADOR = PLATAFORMAS.filter((p) => TEM_ADAPTADOR[p])
const ID = '0f9d2c3e-1111-4222-8333-444455556666' // uuid minúsculo, como o Postgres devolve

// ---------------------------------------------------------------------------
// Leitura do lado do worker
// ---------------------------------------------------------------------------

/** A tabela ROTAS de apps/worker/src/index.ts, como RegExp de verdade. */
function rotasDoWorker(): { metodo: string; padrao: RegExp }[] {
  const uuid = /const UUID = '([^']+)'/.exec(FONTE.roteador)
  expect(uuid, 'apps/worker/src/index.ts precisa declarar `const UUID`').not.toBeNull()
  const saida: { metodo: string; padrao: RegExp }[] = []
  for (const m of FONTE.roteador.matchAll(/\{\s*metodo:\s*'([A-Z]+)',\s*padrao:\s*(.+?),\s*handler:/g)) {
    const [, metodo, bruto] = m
    const comConstrutor = /^new RegExp\(`(.+)`\)$/.exec(bruto)
    const literal = /^\/(.+)\/$/.exec(bruto)
    const corpo = comConstrutor ? comConstrutor[1].replaceAll('${UUID}', uuid![1]) : literal?.[1]
    expect(corpo, `padrão de rota não reconhecido: ${bruto}`).toBeTruthy()
    saida.push({ metodo, padrao: new RegExp(corpo!) })
  }
  return saida
}

const ROTAS = rotasDoWorker()
const casaNoWorker = (metodo: string, caminho: string): boolean => ROTAS.some((r) => r.metodo === metodo && r.padrao.test(caminho))

/** Um `Record<string, string[]>` declarado no fonte do worker (CHAVES_PERMITIDAS, SO_EM_CONFIG). */
function listasPorPlataforma(src: string, nome: string): Record<string, string[]> {
  const bloco = new RegExp(`${nome}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src)
  expect(bloco, `não achei ${nome} no fonte do worker`).not.toBeNull()
  const saida: Record<string, string[]> = {}
  for (const l of bloco![1].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
    saida[l[1]] = [...l[2].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  return saida
}

const CHAVES_PERMITIDAS = listasPorPlataforma(FONTE.credenciais, 'CHAVES_PERMITIDAS')
// SO_EM_CONFIG é declarado numa linha só: a regex de bloco acima não serve.
const SO_EM_CONFIG = listasPorPlataforma(FONTE.credenciais.replace(/const SO_EM_CONFIG[^=]*=\s*\{(.*)\}/, 'SO_EM_CONFIG_BLOCO = {\n$1\n}'), 'SO_EM_CONFIG_BLOCO')

/** Plataformas que a fábrica de adaptadores do worker realmente sabe montar. */
const PLATAFORMAS_DO_WORKER = [...FONTE.adaptadores.matchAll(/case '(\w+)':/g)].map((m) => m[1])

/** Caminhos que a interface monta para o worker (apps/web/src/data/conectores.ts). */
function caminhosDaInterface(): string[] {
  const modelos = [...FONTE.chamadas.matchAll(/chamarWorker<[^>]*>\(\s*`([^`]+)`/g)].map((m) => m[1])
  expect(modelos.length, 'nenhuma chamada ao worker encontrada em data/conectores.ts').toBeGreaterThan(0)
  const saida: string[] = []
  for (const modelo of modelos) {
    const comId = modelo.replaceAll('${connectorId}', ID)
    if (comId.includes('${plataforma}')) saida.push(...OAUTH.map((p) => comId.replaceAll('${plataforma}', p)))
    else saida.push(comId)
  }
  return saida
}

// ---------------------------------------------------------------------------

describe('contrato: caminhos das rotas', () => {
  it('todo caminho que a interface monta casa com o roteador do worker', () => {
    const caminhos = caminhosDaInterface()
    // Guarda contra a regex acima passar a achar nada e o teste virar vácuo.
    expect(caminhos).toEqual(expect.arrayContaining([`/connectors/${ID}/credentials`, `/connectors/${ID}/test`, `/connectors/${ID}/tiny/oauth/start`]))
    for (const caminho of caminhos) expect(casaNoWorker('POST', caminho), `o worker não tem POST ${caminho}`).toBe(true)
  })

  it('a interface só usa POST nessas rotas (o cliente manda POST por padrão)', () => {
    expect(semComentarios(FONTE.chamadas)).not.toMatch(/metodo:\s*'GET'/)
  })

  it('o uuid do roteador é minúsculo — o mesmo que o Postgres devolve', () => {
    expect(casaNoWorker('POST', `/connectors/${ID.toUpperCase()}/test`), 'uuid em maiúsculas daria 404 silencioso').toBe(false)
    expect(casaNoWorker('POST', `/connectors/${ID}/test`)).toBe(true)
  })

  it('as plataformas com OAuth são as mesmas dos dois lados', () => {
    const noWorker = new Set<string>()
    for (const r of ROTAS) {
      // RegExp.source escapa a barra (`a/b` vira `a\/b`), venha o padrão de literal ou de new RegExp.
      const m = /\(([a-z|]+)\)\/oauth\//.exec(r.padrao.source.replaceAll('\\/', '/'))
      if (m) for (const p of m[1].split('|')) noWorker.add(p)
    }
    expect([...noWorker].sort(), 'plataforma com OAuth no worker que a tela não oferece (ou o contrário)').toEqual([...OAUTH].sort())
  })
})

describe('contrato: nomes dos campos de credencial', () => {
  // O corpo que a tela manda em POST /connectors/:id/credentials, plataforma por plataforma.
  const corpoEnviado = (p: Plataforma) => separar(p, Object.fromEntries(CAMPOS[p].map((c) => [c.chave, `valor-${c.chave}`])), 'credencial')

  it.each(COM_ADAPTADOR)('%s: todo campo que a tela manda é aceito pelo worker', (p) => {
    const permitidas = CHAVES_PERMITIDAS[p]
    expect(permitidas, `CHAVES_PERMITIDAS não conhece ${p}`).toBeTruthy()
    for (const chave of Object.keys(corpoEnviado(p))) {
      // filtrarPayload devolve 400 `campo "X" não é aceito para Y` para qualquer chave de fora.
      expect(permitidas, `a tela manda "${chave}" e o worker recusaria`).toContain(chave)
    }
  })

  it('baselinker manda o token, e o token é o que o worker exige', () => {
    expect(Object.keys(corpoEnviado('baselinker'))).toEqual(['token'])
  })

  it('tiny manda client_id e client_secret (o app do Tiny é do próprio cliente)', () => {
    expect(Object.keys(corpoEnviado('tiny')).sort()).toEqual(['client_id', 'client_secret'])
  })

  it('bling não manda credencial nenhuma: o app é do Prodio e o segredo está no env do worker', () => {
    // A modal pula o passo de credencial quando não há campo preenchido; se um campo aparecesse
    // aqui, ela chamaria a rota e o worker responderia 400 "nenhuma credencial informada".
    expect(corpoEnviado('bling')).toEqual({})
    expect(CHAVES_PERMITIDAS.bling, 'o callback do OAuth ainda grava os tokens do Bling por aqui').toContain('access_token')
  })

  it('endereçamento do BaseLinker mora em connectors.config, e só lá', () => {
    const config = Object.keys(separar('baselinker', { inventory_id: '42', warehouse_id: 'bl_1', token: 't' }, 'config'))
    expect(config.sort()).toEqual(['inventory_id', 'warehouse_id'])
    for (const chave of config) {
      // Se voltar a ser aceito como credencial, existem dois lugares para a mesma informação — e o
      // que for gravado cifrado nunca vai ser lido (o adaptador lê de row.config).
      expect(CHAVES_PERMITIDAS.baselinker, `${chave} não pode ser credencial`).not.toContain(chave)
      expect(SO_EM_CONFIG.baselinker, `o worker precisa recusar ${chave} explicando onde ele mora`).toContain(chave)
    }
  })

  it('a tela só oferece plataformas que o worker sabe montar', () => {
    expect([...COM_ADAPTADOR].sort()).toEqual([...PLATAFORMAS_DO_WORKER].sort())
    for (const p of PLATAFORMAS) if (!TEM_ADAPTADOR[p]) expect(PLATAFORMAS_DO_WORKER).not.toContain(p)
  })
})

describe('contrato: cabeçalhos (o preflight barra o que não estiver na lista)', () => {
  it('a interface não manda nenhum cabeçalho fora de Access-Control-Allow-Headers', () => {
    const permitidos = /CABECALHOS_PERMITIDOS\s*=\s*'([^']+)'/.exec(FONTE.cors)
    expect(permitidos, 'não achei CABECALHOS_PERMITIDOS em apps/worker/src/cors.ts').not.toBeNull()
    const lista = permitidos![1].split(',').map((s) => s.trim().toLowerCase())

    // Nomes com cara de cabeçalho HTTP usados como chave no cliente. CONSTANTE_ASSIM do TypeScript
    // também casa com "capitalizado", então nome todo em maiúsculas e sem hífen fica de fora.
    const ehCabecalho = (n: string) => n.includes('-') || n !== n.toUpperCase()
    const usados = new Set(
      [...semComentarios(FONTE.clienteHttp).matchAll(/(?<![\w$])'?([A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)'?\s*:/g)].map((m) => m[1]).filter(ehCabecalho).map((n) => n.toLowerCase()),
    )
    expect([...usados].sort(), 'o cliente precisa continuar mandando o token no Authorization').toContain('authorization')
    for (const h of usados) {
      // Um x-client-info ou x-request-id novo aqui faz o preflight recusar a chamada inteira no
      // navegador do dono — e o erro que ele vê é "falha de rede", que não aponta para isto.
      expect(lista, `o worker precisa liberar "${h}" em CABECALHOS_PERMITIDOS`).toContain(h)
    }
  })

  it('o token vai no header, nunca em cookie (o worker não manda Allow-Credentials)', () => {
    expect(semComentarios(FONTE.clienteHttp)).not.toMatch(/credentials:\s*'include'/)
    expect(semComentarios(FONTE.cors)).not.toMatch(/Allow-Credentials/)
  })
})
