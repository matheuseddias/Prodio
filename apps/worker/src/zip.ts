// Leitor mínimo de ZIP (métodos stored e deflate) para anexos de e-mail com XMLs.
// Lê o diretório central; não depende de biblioteca. Entradas cifradas ou zip64 são ignoradas.
const ASSINATURA_EOCD = 0x06054b50
const ASSINATURA_CENTRAL = 0x02014b50
const ASSINATURA_LOCAL = 0x04034b50

export interface EntradaZip {
  nome: string
  dados: Uint8Array
}

async function inflateRaw(dados: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const escritor = ds.writable.getWriter()
  void escritor.write(dados as Uint8Array<ArrayBuffer>)
  void escritor.close()
  const buf = await new Response(ds.readable).arrayBuffer()
  return new Uint8Array(buf)
}

export async function lerZip(arquivo: Uint8Array, filtro: (nome: string) => boolean = () => true): Promise<EntradaZip[]> {
  const dv = new DataView(arquivo.buffer, arquivo.byteOffset, arquivo.byteLength)
  // Fim do diretório central: procura de trás para frente (comentário pode ter até 64 KiB).
  let eocd = -1
  for (let i = arquivo.length - 22; i >= Math.max(0, arquivo.length - 22 - 65_535); i--) {
    if (dv.getUint32(i, true) === ASSINATURA_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP inválido: diretório central não encontrado')
  const total = dv.getUint16(eocd + 10, true)
  let pos = dv.getUint32(eocd + 16, true)
  const saida: EntradaZip[] = []
  const decoder = new TextDecoder()
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(pos, true) !== ASSINATURA_CENTRAL) throw new Error('ZIP inválido: entrada do diretório central')
    const flags = dv.getUint16(pos + 8, true)
    const metodo = dv.getUint16(pos + 10, true)
    const tamComp = dv.getUint32(pos + 20, true)
    const tamNome = dv.getUint16(pos + 28, true)
    const tamExtra = dv.getUint16(pos + 30, true)
    const tamComent = dv.getUint16(pos + 32, true)
    const offsetLocal = dv.getUint32(pos + 42, true)
    const nome = decoder.decode(arquivo.subarray(pos + 46, pos + 46 + tamNome))
    pos += 46 + tamNome + tamExtra + tamComent
    const cifrada = (flags & 0x1) !== 0
    if (cifrada || nome.endsWith('/') || !filtro(nome)) continue
    if (dv.getUint32(offsetLocal, true) !== ASSINATURA_LOCAL) throw new Error(`ZIP inválido: cabeçalho local de ${nome}`)
    const nomeLocal = dv.getUint16(offsetLocal + 26, true)
    const extraLocal = dv.getUint16(offsetLocal + 28, true)
    const inicio = offsetLocal + 30 + nomeLocal + extraLocal
    const bruto = arquivo.subarray(inicio, inicio + tamComp)
    if (metodo === 0) saida.push({ nome, dados: bruto })
    else if (metodo === 8) saida.push({ nome, dados: await inflateRaw(bruto) })
    // outros métodos: ignora
  }
  return saida
}
