// Converte o NfeParsed do core no payload da RPC upsert_nfe_inbound(p_tenant_id, p_nfe, p_itens).
// Colunas conforme docs/schema.md (0007 · nfe_inbound e nfe_inbound_items).
import type { NfeParsed } from '@prodio/core'

export type OrigemNfe = 'upload' | 'email' | 'erp' | 'dfe' | 'sem_xml'

export interface PayloadNfe {
  nfe: Record<string, unknown>
  itens: Record<string, unknown>[]
}

export function mapearNfe(n: NfeParsed, origem: OrigemNfe, xmlPath: string | null): PayloadNfe {
  const nfe = {
    chave: n.chave,
    numero: n.numero,
    serie: n.serie,
    cnpj_emitente: n.emitente.cnpj,
    emitente: n.emitente.nome,
    emissao: n.emissao,
    valor_total: n.totais.vNF,
    valor_frete: n.totais.vFrete,
    valor_desconto: n.totais.vDesc,
    valor_outros: n.totais.vOutro + n.totais.vSeg,
    origem,
    status: n.situacao === 'cancelada' || n.situacao === 'denegada' || n.classificacao === 'ignorar' ? 'ignorada' : 'pendente',
    motivo_ignorada:
      n.situacao === 'cancelada' ? 'NF-e cancelada' : n.situacao === 'denegada' ? 'NF-e denegada' : n.classificacao === 'ignorar' ? 'nota de saída do próprio emitente' : null,
    xml_path: xmlPath,
    cstat: n.cStat ?? null,
    fin_nfe: n.finNFe,
    raw: {
      modelo: n.modelo,
      natOp: n.natOp,
      tpNF: n.tpNF,
      situacao: n.situacao,
      emitente: n.emitente,
      destinatario: n.destinatario,
      dhEmi: n.dhEmi,
      totais: n.totais,
      classificacao: n.classificacao,
      avisos: n.avisos,
    },
  }
  const itens = n.itens.map((it) => ({
    n_item: it.nItem,
    c_prod: it.cProd,
    x_prod: it.xProd,
    ncm: it.ncm,
    cfop: it.cfop,
    u_com: it.uCom,
    q_com: it.qCom,
    v_un_com: it.vUnCom,
    v_prod: it.vProd,
    u_trib: it.uTrib,
    q_trib: it.qTrib,
    v_icms: it.icms.vICMS,
    v_icms_st: it.icms.vICMSST,
    v_ipi: it.ipi.v,
    v_pis: it.pis.v,
    v_cofins: it.cofins.v,
    v_ibs: it.ibs.v,
    v_cbs: it.cbs.v,
    classificacao: it.classificacao,
  }))
  return { nfe, itens }
}
