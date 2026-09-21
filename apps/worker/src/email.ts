// Email Routing: xml@<slug>.prodio.app recebe XMLs de NF-e (anexo .xml ou .zip). Resolve o tenant pelo slug,
// roda o parser do core, guarda o XML no Storage e chama upsert_nfe_inbound (service role, origem 'email').
import PostalMime, { type Email } from 'postal-mime'
import { NfeParseError, parseNfeXml } from '@prodio/core'
import type { Env } from './env'
import { Db } from './db'
import { log, mensagemErro } from './log'
import { mapearNfe } from './nfe-mapa'
import { lerZip } from './zip'

export const REGEX_DESTINO = /^xml@([a-z0-9][a-z0-9-]*)\.prodio\.app$/i

export function resolverSlug(destinatario: string): string | null {
  const m = REGEX_DESTINO.exec(destinatario.trim().toLowerCase())
  return m ? m[1] : null
}

export interface XmlAnexo {
  nome: string
  xml: string
}

const paraBytes = (c: ArrayBuffer | Uint8Array | string): Uint8Array =>
  typeof c === 'string' ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c)
const decodificar = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '')
const pareceXml = (texto: string): boolean => texto.trimStart().startsWith('<')

// Anexos .xml diretos e .xml dentro de .zip. Ignora o resto (PDF, imagens, assinaturas).
export async function extrairXmls(email: Email): Promise<XmlAnexo[]> {
  const saida: XmlAnexo[] = []
  for (const a of email.attachments ?? []) {
    const nome = (a.filename ?? '').toLowerCase()
    const mime = (a.mimeType ?? '').toLowerCase()
    const bytes = paraBytes(a.content)
    if (nome.endsWith('.zip') || mime === 'application/zip' || mime === 'application/x-zip-compressed') {
      try {
        for (const e of await lerZip(bytes, (n) => n.toLowerCase().endsWith('.xml'))) {
          const xml = decodificar(e.dados)
          if (pareceXml(xml)) saida.push({ nome: e.nome, xml })
        }
      } catch (e) {
        log('warn', 'email.zip', { anexo: a.filename, erro: mensagemErro(e) })
      }
      continue
    }
    if (nome.endsWith('.xml') || mime === 'application/xml' || mime === 'text/xml') {
      const xml = decodificar(bytes)
      if (pareceXml(xml)) saida.push({ nome: a.filename ?? 'anexo.xml', xml })
    }
  }
  return saida
}

export interface ResultadoEmail {
  slug: string | null
  tenantId: string | null
  recebidas: number
  gravadas: number
  ignoradas: number
  motivo?: string
}

export async function processarEmail(destinatario: string, remetente: string, raw: ReadableStream<Uint8Array> | Uint8Array | string, db: Db): Promise<ResultadoEmail> {
  const slug = resolverSlug(destinatario)
  const resultado: ResultadoEmail = { slug, tenantId: null, recebidas: 0, gravadas: 0, ignoradas: 0 }
  if (!slug) return { ...resultado, motivo: 'destinatário fora do padrão xml@<slug>.prodio.app' }
  const tenant = await db.tenantPorSlug(slug)
  if (!tenant) return { ...resultado, motivo: `tenant "${slug}" não existe` }
  resultado.tenantId = tenant.id
  const email = await PostalMime.parse(raw)
  const xmls = await extrairXmls(email)
  resultado.recebidas = xmls.length
  for (const { nome, xml } of xmls) {
    try {
      const parsed = parseNfeXml(xml)
      const caminho = await db.salvarXml(tenant.id, parsed.chave, xml)
      const payload = mapearNfe(parsed, 'email', caminho)
      await db.upsertNfeInbound(tenant.id, payload.nfe, payload.itens)
      resultado.gravadas++
      log('info', 'email.nfe', { tenant: tenant.id, chave: parsed.chave, itens: parsed.itens.length, anexo: nome, de: remetente })
    } catch (e) {
      resultado.ignoradas++
      const nivel = e instanceof NfeParseError ? 'info' : 'error'
      log(nivel, 'email.nfe.ignorada', { tenant: tenant.id, anexo: nome, de: remetente, erro: mensagemErro(e) })
    }
  }
  return resultado
}

export async function email(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const db = new Db(env)
  try {
    const r = await processarEmail(message.to, message.from, message.raw, db)
    if (r.motivo) {
      log('warn', 'email.rejeitado', { para: message.to, de: message.from, motivo: r.motivo })
      message.setReject(r.motivo)
      return
    }
    log('info', 'email.processado', { para: message.to, de: message.from, ...r })
  } catch (e) {
    log('error', 'email.falha', { para: message.to, de: message.from, erro: mensagemErro(e) })
    message.setReject('falha temporária ao processar; tente de novo')
  }
}
