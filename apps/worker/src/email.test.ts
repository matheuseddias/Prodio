import PostalMime from 'postal-mime'
import XML_COMPRA from '../../../packages/core/src/fixtures/nfe-compra-5102.xml?raw'
import type { Db } from './db'
import { extrairXmls, processarEmail, resolverSlug } from './email'
import { silenciarLog } from './log'
import { lerZip } from './zip'

silenciarLog(true)

async function deflateRaw(dados: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const w = cs.writable.getWriter()
  void w.write(dados as Uint8Array<ArrayBuffer>)
  void w.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

// Monta um ZIP mínimo (stored ou deflate) só para o teste.
async function criarZip(entradas: { nome: string; dados: Uint8Array; deflate?: boolean }[]): Promise<Uint8Array> {
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const enc = new TextEncoder()
  for (const e of entradas) {
    const nome = enc.encode(e.nome)
    const dados = e.deflate ? await deflateRaw(e.dados) : e.dados
    const local = new Uint8Array(30 + nome.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(8, e.deflate ? 8 : 0, true)
    dv.setUint32(18, dados.length, true)
    dv.setUint32(22, e.dados.length, true)
    dv.setUint16(26, nome.length, true)
    local.set(nome, 30)
    partes.push(local, dados)
    const cd = new Uint8Array(46 + nome.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, e.deflate ? 8 : 0, true)
    cv.setUint32(20, dados.length, true)
    cv.setUint32(24, e.dados.length, true)
    cv.setUint16(28, nome.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nome, 46)
    central.push(cd)
    offset += local.length + dados.length
  }
  const tamCentral = central.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entradas.length, true)
  ev.setUint16(10, entradas.length, true)
  ev.setUint32(12, tamCentral, true)
  ev.setUint32(16, offset, true)
  const total = offset + tamCentral + 22
  const saida = new Uint8Array(total)
  let pos = 0
  for (const p of [...partes, ...central, eocd]) {
    saida.set(p, pos)
    pos += p.length
  }
  return saida
}

const b64 = (b: Uint8Array | string) => btoa(String.fromCharCode(...(typeof b === 'string' ? new TextEncoder().encode(b) : b)))

function emailBruto(anexos: { nome: string; tipo: string; conteudo: Uint8Array | string }[]): string {
  const partes = anexos.map(
    (a) => `--xyz\r\nContent-Type: ${a.tipo}; name="${a.nome}"\r\nContent-Disposition: attachment; filename="${a.nome}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.conteudo)}\r\n`,
  )
  return `From: fornecedor@exemplo.com.br\r\nTo: xml@eddias.prodio.app\r\nSubject: NF-e 123\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="xyz"\r\n\r\n--xyz\r\nContent-Type: text/plain\r\n\r\nSegue a nota.\r\n${partes.join('')}--xyz--\r\n`
}

describe('resolverSlug', () => {
  it('extrai o slug do destinatário xml@<slug>.prodio.app', () => {
    expect(resolverSlug('xml@eddias.prodio.app')).toBe('eddias')
    expect(resolverSlug('XML@Fabrica-2.prodio.app')).toBe('fabrica-2')
    expect(resolverSlug('nfe@eddias.prodio.app')).toBeNull()
    expect(resolverSlug('xml@prodio.app')).toBeNull()
    expect(resolverSlug('xml@eddias.outro.app')).toBeNull()
  })
})

describe('lerZip', () => {
  it('lê entradas stored e deflate, filtrando por nome', async () => {
    const zip = await criarZip([
      { nome: 'a.xml', dados: new TextEncoder().encode('<a/>') },
      { nome: 'b.xml', dados: new TextEncoder().encode('<b>' + 'x'.repeat(500) + '</b>'), deflate: true },
      { nome: 'c.pdf', dados: new Uint8Array([1, 2, 3]) },
    ])
    const entradas = await lerZip(zip, (n) => n.endsWith('.xml'))
    expect(entradas.map((e) => e.nome)).toEqual(['a.xml', 'b.xml'])
    expect(new TextDecoder().decode(entradas[0].dados)).toBe('<a/>')
    expect(new TextDecoder().decode(entradas[1].dados)).toBe('<b>' + 'x'.repeat(500) + '</b>')
  })
})

describe('extrairXmls', () => {
  it('pega .xml direto, .xml dentro de .zip e ignora PDF', async () => {
    const zip = await criarZip([{ nome: 'lote/nota2.xml', dados: new TextEncoder().encode('<nfeProc/>'), deflate: true }])
    const email = await PostalMime.parse(
      emailBruto([
        { nome: 'nota1.xml', tipo: 'application/xml', conteudo: '<nfeProc/>' },
        { nome: 'lote.zip', tipo: 'application/zip', conteudo: zip },
        { nome: 'danfe.pdf', tipo: 'application/pdf', conteudo: new Uint8Array([1]) },
      ]),
    )
    const xmls = await extrairXmls(email)
    expect(xmls.map((x) => x.nome)).toEqual(['nota1.xml', 'lote/nota2.xml'])
    expect(xmls[1].xml).toBe('<nfeProc/>')
  })
})

describe('processarEmail', () => {
  function dbFalso(tenant: { id: string; slug: string; fuso: string } | null) {
    return {
      tenantPorSlug: vi.fn(async () => tenant),
      salvarXml: vi.fn(async (t: string, chave: string) => `${t}/${chave}.xml`),
      upsertNfeInbound: vi.fn(async () => 'nfe-uuid'),
    } as unknown as Db & { tenantPorSlug: ReturnType<typeof vi.fn>; salvarXml: ReturnType<typeof vi.fn>; upsertNfeInbound: ReturnType<typeof vi.fn> }
  }

  it('grava a NF-e válida com origem email e ignora XML que não é nota', async () => {
    const db = dbFalso({ id: 't1', slug: 'eddias', fuso: 'America/Sao_Paulo' })
    const raw = emailBruto([
      { nome: 'nota.xml', tipo: 'text/xml', conteudo: XML_COMPRA },
      { nome: 'lixo.xml', tipo: 'text/xml', conteudo: '<outro/>' },
    ])
    const r = await processarEmail('xml@eddias.prodio.app', 'fornecedor@exemplo.com.br', raw, db)
    expect(r).toMatchObject({ slug: 'eddias', tenantId: 't1', recebidas: 2, gravadas: 1, ignoradas: 1 })
    expect(db.salvarXml).toHaveBeenCalledTimes(1)
    const [tenantId, nfe, itens] = db.upsertNfeInbound.mock.calls[0] as [string, Record<string, unknown>, unknown[]]
    expect(tenantId).toBe('t1')
    expect(nfe.origem).toBe('email')
    expect(nfe.status).toBe('pendente')
    expect(String(nfe.chave)).toHaveLength(44)
    expect(nfe.xml_path).toBe(`t1/${nfe.chave}.xml`)
    expect(itens.length).toBeGreaterThan(0)
  })

  it('rejeita destinatário sem tenant', async () => {
    const db = dbFalso(null)
    const r = await processarEmail('xml@ninguem.prodio.app', 'x@y', emailBruto([]), db)
    expect(r.motivo).toMatch(/não existe/)
    expect(db.upsertNfeInbound).not.toHaveBeenCalled()
  })
})
