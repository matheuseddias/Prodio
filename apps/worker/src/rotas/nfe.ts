// POST /nfe/xml — upload de XML pelo usuário (multipart ou text/xml) com Authorization: Bearer <JWT>.
// A gravação em nfe_inbound é feita COMO O USUÁRIO (anon key + JWT, RLS e assert_member valem);
// só o arquivo vai para o Storage via service role, e só depois que a RPC do usuário passou.
import type { NfeParsed } from '@prodio/core'
import { NfeParseError, parseNfeXml } from '@prodio/core/nfeXml'
import type { Env } from '../env'
import { Db } from '../db'
import { log, mensagemErro } from '../log'
import { mapearNfe } from '../nfe-mapa'
import { ErroRota, erro, exigirUsuario, json, tratarErro } from './util'

const MAX_BYTES = 2 * 1024 * 1024

export async function lerXmlDaRequisicao(req: Request): Promise<{ xml: string; tenantId: string | null }> {
  const tipo = (req.headers.get('Content-Type') ?? '').toLowerCase()
  const url = new URL(req.url)
  let tenantId = url.searchParams.get('tenant_id')
  let xml = ''
  if (tipo.startsWith('multipart/form-data')) {
    const form = await req.formData()
    tenantId = (form.get('tenant_id') as string | null) ?? tenantId
    let arquivo: File | null = null
    for (const chave of ['xml', 'arquivo', 'file']) {
      const v = form.get(chave)
      if (v && typeof v !== 'string') {
        arquivo = v
        break
      }
    }
    if (!arquivo) for (const v of form.values()) if (typeof v !== 'string') arquivo = v
    if (!arquivo) throw new ErroRota(400, 'envie o XML no campo "xml"')
    if (arquivo.size > MAX_BYTES) throw new ErroRota(413, 'XML maior que 2 MB')
    xml = await arquivo.text()
  } else {
    xml = await req.text()
    if (xml.length > MAX_BYTES) throw new ErroRota(413, 'XML maior que 2 MB')
  }
  xml = xml.replace(/^﻿/, '').trim()
  if (!xml.startsWith('<')) throw new ErroRota(400, 'corpo não é XML')
  return { xml, tenantId }
}

export async function rotaNfeXml(req: Request, env: Env, db = new Db(env)): Promise<Response> {
  try {
    const u = exigirUsuario(req, env)
    const { xml, tenantId: doCorpo } = await lerXmlDaRequisicao(req)
    const tenantId = doCorpo ?? u.tenantId
    if (!tenantId) return erro(400, 'tenant não identificado: entre em um tenant ou informe tenant_id')
    let parsed: NfeParsed
    try {
      parsed = parseNfeXml(xml)
    } catch (e) {
      if (e instanceof NfeParseError) return erro(422, e.message)
      throw e
    }
    const caminho = `${tenantId}/${parsed.chave}.xml`
    const payload = mapearNfe(parsed, 'upload', caminho)
    const r = await u.sb.rpc('upsert_nfe_inbound', { p_tenant_id: tenantId, p_nfe: payload.nfe, p_itens: payload.itens })
    if (r.error) {
      const status = r.error.code === '42501' ? 403 : 422
      return erro(status, r.error.message)
    }
    try {
      await db.salvarXml(tenantId, parsed.chave, xml)
    } catch (e) {
      log('error', 'nfe.storage', { tenant: tenantId, chave: parsed.chave, erro: mensagemErro(e) })
      return erro(502, 'nota registrada, mas o XML não foi guardado; envie de novo')
    }
    log('info', 'nfe.upload', { tenant: tenantId, chave: parsed.chave, itens: parsed.itens.length, user: u.userId })
    return json({ ok: true, nfe_id: r.data ?? null, chave: parsed.chave, numero: parsed.numero, serie: parsed.serie, itens: parsed.itens.length, status: payload.nfe.status, avisos: parsed.avisos })
  } catch (e) {
    return tratarErro(e)
  }
}
