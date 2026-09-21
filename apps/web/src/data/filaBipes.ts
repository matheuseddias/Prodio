// Fila offline de bipes em IndexedDB: enfileira, faz replay em ordem ao voltar a rede e guarda o
// conjunto de seriais já lidos neste aparelho para responder "já bipado" sem rede.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface BipePendente {
  clientEventId: string
  serial: string
  em: string
  operador?: string
  dispositivo?: string
  tentativas?: number
}

interface FilaDB extends DBSchema {
  bipes: { key: string; value: BipePendente; indexes: { em: string } }
  lidos: { key: string; value: { serial: string; em: string } }
}

let db: Promise<IDBPDatabase<FilaDB>> | null = null
function abrir(): Promise<IDBPDatabase<FilaDB>> | null {
  if (typeof indexedDB === 'undefined') return null
  if (!db) {
    db = openDB<FilaDB>('prodio-bipes', 1, {
      upgrade(d) {
        const b = d.createObjectStore('bipes', { keyPath: 'clientEventId' })
        b.createIndex('em', 'em')
        d.createObjectStore('lidos', { keyPath: 'serial' })
      },
    }).catch((e) => {
      db = null
      throw e
    })
  }
  return db
}

// Espelho em memória: responde na hora e continua funcionando se o IndexedDB estiver bloqueado.
const memBipes = new Map<string, BipePendente>()
const memLidos = new Set<string>()
let carregado = false

export async function carregarFila(): Promise<void> {
  if (carregado) return
  carregado = true
  try {
    const d = await abrir()
    if (!d) return
    for (const b of await d.getAllFromIndex('bipes', 'em')) memBipes.set(b.clientEventId, b)
    for (const l of await d.getAll('lidos')) memLidos.add(l.serial)
  } catch (e) {
    console.warn('[prodio] fila de bipes indisponível:', e)
  }
}

export async function enfileirar(b: BipePendente): Promise<void> {
  memBipes.set(b.clientEventId, b)
  memLidos.add(b.serial)
  try {
    const d = await abrir()
    if (!d) return
    const tx = d.transaction(['bipes', 'lidos'], 'readwrite')
    await Promise.all([tx.objectStore('bipes').put(b), tx.objectStore('lidos').put({ serial: b.serial, em: b.em }), tx.done])
  } catch (e) {
    console.warn('[prodio] não gravou na fila:', e)
  }
}

export async function remover(clientEventId: string): Promise<void> {
  memBipes.delete(clientEventId)
  try {
    const d = await abrir()
    if (d) await d.delete('bipes', clientEventId)
  } catch {
    /* espelho em memória já removeu */
  }
}

export async function marcarTentativa(b: BipePendente): Promise<void> {
  const novo = { ...b, tentativas: (b.tentativas ?? 0) + 1 }
  memBipes.set(b.clientEventId, novo)
  try {
    const d = await abrir()
    if (d) await d.put('bipes', novo)
  } catch {
    /* ignora */
  }
}

/** Pendentes em ordem de leitura. */
export function pendentes(): BipePendente[] {
  return [...memBipes.values()].sort((a, b) => a.em.localeCompare(b.em))
}
export const contarPendentes = (): number => memBipes.size
export const foiLido = (serial: string): boolean => memLidos.has(serial)
export const seriaisLidos = (): Set<string> => memLidos

export async function marcarLido(serial: string): Promise<void> {
  memLidos.add(serial)
  try {
    const d = await abrir()
    if (d) await d.put('lidos', { serial, em: new Date().toISOString() })
  } catch {
    /* ignora */
  }
}

export async function desmarcarLido(serial: string): Promise<void> {
  memLidos.delete(serial)
  try {
    const d = await abrir()
    if (d) await d.delete('lidos', serial)
  } catch {
    /* ignora */
  }
}

/** Limpa seriais lidos de dias anteriores (o serial carrega AAMMDD: só faz sentido no dia). */
export async function limparLidosAntigos(diaCompacto: string): Promise<void> {
  try {
    const d = await abrir()
    if (!d) return
    for (const l of await d.getAll('lidos')) {
      if (!l.serial.includes(diaCompacto)) {
        memLidos.delete(l.serial)
        await d.delete('lidos', l.serial)
      }
    }
  } catch {
    /* ignora */
  }
}
