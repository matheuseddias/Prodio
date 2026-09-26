// Lógica pura da tela "Importar do ES" (Configurações). Sem React, para ter teste.
//
// Segurança do arquivo (docs/arquitetura.md, importacaoEs): o JSON cru só existe dentro de lerTextoBackup e
// sai de lá já em lista branca (lerBackupES). Nenhuma mensagem daqui cita conteúdo do arquivo — o erro do
// JSON.parse, por exemplo, traz um trecho do texto e por isso nunca é mostrado.
import { lerBackupES, type BackupES, type ContagemResultado, type EntidadeImportacao, type LinhaPrevia, type PreviaImportacao, type ResultadoImportacao } from '@prodio/core/importacaoEs'
import { digitos, documentoValido } from '@prodio/core/importacaoEs/normalizar'
import { perfilDaFamilia } from '@prodio/core/etiquetas'
import { cnpjFmt, num } from '../../domain/format'
import type { LabelProfile, Product, Supplier } from '../../domain/types'
import type { Tone } from '../../ui'

/** Maior arquivo aceito: o backup inteiro do ES (vendas e movimentações incluídas) fica bem abaixo disso. */
export const LIMITE_ARQUIVO_BYTES = 50 * 1024 * 1024
/** Linhas da tabela por vez ("mostrar mais"). */
export const LINHAS_POR_PAGINA = 100

export const ENTIDADES: { id: EntidadeImportacao; plural: string; curto: string }[] = [
  { id: 'fornecedor', plural: 'Fornecedores', curto: 'Fornecedores' },
  { id: 'insumo', plural: 'Insumos', curto: 'Insumos' },
  { id: 'produto', plural: 'Produtos', curto: 'Produtos' },
  { id: 'apelido', plural: 'Apelidos de SKU', curto: 'Apelidos' },
  { id: 'vinculo', plural: 'Vínculos insumo-fornecedor', curto: 'Vínculos' },
  { id: 'ficha', plural: 'Fichas técnicas', curto: 'Fichas' },
]
export const PLURAL: Record<EntidadeImportacao, string> = Object.fromEntries(ENTIDADES.map((e) => [e.id, e.plural])) as Record<EntidadeImportacao, string>

export const SITUACAO: Record<LinhaPrevia['situacao'], { rotulo: string; tom: Tone }> = {
  novo: { rotulo: 'Novo', tom: 'info' },
  atualizado: { rotulo: 'Atualiza', tom: 'accent' },
  igual: { rotulo: 'Igual', tom: 'neutral' },
  problema: { rotulo: 'Problema', tom: 'danger' },
}

/** Chave para exibir: CNPJ pontuado (planilha não vira 1,12E+13 e fica legível); SKU como está. */
export function chaveExibida(entidade: EntidadeImportacao, chave: string): string {
  // Fornecedor ainda sem CNPJ vem como "nome:<nome>": o nome já aparece na coluna ao lado.
  const doc = (c: string) => (/^\d+$/.test(c) ? cnpjFmt(c) : c.startsWith('nome:') ? 'sem CNPJ' : c)
  if (entidade === 'fornecedor') return doc(chave)
  if (entidade === 'vinculo') {
    const i = chave.lastIndexOf('|')
    return i < 0 ? chave : `${doc(chave.slice(0, i))} | ${chave.slice(i + 1)}`
  }
  return chave
}

const qtd = (n: number, um: string, varios: string) => `${num(n)} ${n === 1 ? um : varios}`

/** "2 novos · 1 atualizado · 0 iguais" (problemas à parte, a tela pinta de vermelho). */
export function resumoContagem(c: ContagemResultado): string {
  return `${qtd(c.novos, 'novo', 'novos')} · ${qtd(c.atualizados, 'atualizado', 'atualizados')} · ${qtd(c.iguais, 'igual', 'iguais')}`
}

// ---------------------------------------------------------------------------
// Arquivo
// ---------------------------------------------------------------------------

/** Confere nome e tamanho antes de ler (o conteúdo ainda não foi aberto). */
export function conferirArquivo(f: { name: string; size: number }): string | undefined {
  if (!/\.json$/i.test(f.name)) return 'Escolha o arquivo .json que o ES baixou (backup-suprimentos-AAAAMMDD-HHMM.json).'
  if (f.size === 0) return 'O arquivo está vazio. Baixe o backup de novo no ES.'
  if (f.size > LIMITE_ARQUIVO_BYTES) return 'O arquivo passa de 50 MB: não parece o backup do ES. Confira se escolheu o arquivo certo.'
  return undefined
}

export type Leitura = { ok: true; backup: BackupES } | { ok: false; motivo: string }

/** Texto do arquivo → backup em lista branca. O objeto cru morre aqui dentro. */
export function lerTextoBackup(texto: string): Leitura {
  let bruto: unknown
  try {
    bruto = JSON.parse(texto.replace(/^﻿/, ''))
  } catch {
    return { ok: false, motivo: 'O arquivo não é um JSON válido. Baixe o backup de novo no ES e escolha o .json sem abrir nem editar o arquivo.' }
  }
  const backup = lerBackupES(bruto)
  if (!backup) return { ok: false, motivo: 'Este arquivo não é um backup do ES. Use o "Baixar backup completo" das Configurações do ES.' }
  return { ok: true, backup }
}

// ---------------------------------------------------------------------------
// CNPJ
// ---------------------------------------------------------------------------

/** Fornecedores do Prodio por nome, para casar na reimportação quem não tem CNPJ no ES. */
export function cnpjPorNome(suppliers: Supplier[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>
  for (const s of suppliers) {
    const d = digitos(s.cnpj)
    if (s.nome && d) out[s.nome] = d
  }
  return out
}

/** CNPJ (ou CPF) digitado na prévia: vazio = fica de fora; inválido = erro com o motivo. */
export function conferirCnpjDigitado(v: string): { cnpj?: string; erro?: string } {
  const d = digitos(v)
  if (!d) return {}
  if (d.length !== 14 && d.length !== 11) return { erro: 'CNPJ tem 14 dígitos (ou CPF, 11).' }
  if (!documentoValido(d)) return { erro: 'Dígito verificador não confere.' }
  return { cnpj: d }
}

/** Só os CNPJs válidos entram no plano; os outros ficam de fora (e continuam na lista). */
export function cnpjsValidos(digitados: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [nome, v] of Object.entries(digitados)) {
    const c = conferirCnpjDigitado(v).cnpj
    if (c) out[nome] = c
  }
  return out
}

// ---------------------------------------------------------------------------
// Tabela da prévia
// ---------------------------------------------------------------------------

export type Filtro = 'atencao' | 'novo' | 'atualizado' | 'igual' | 'todos'
export const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'atencao', rotulo: 'Problemas e avisos' },
  { id: 'novo', rotulo: 'Novos' },
  { id: 'atualizado', rotulo: 'Atualizados' },
  { id: 'igual', rotulo: 'Iguais' },
  { id: 'todos', rotulo: 'Todos' },
]

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarLinhas(linhas: LinhaPrevia[], entidade: EntidadeImportacao, filtro: Filtro, busca: string): LinhaPrevia[] {
  const q = semAcento(busca.trim())
  const qDigitos = /^[\d./-]+$/.test(busca.trim()) ? digitos(busca) : ''
  return linhas.filter((l) => {
    if (l.entidade !== entidade) return false
    if (filtro === 'atencao' && !(l.situacao === 'problema' || l.temAviso)) return false
    if (filtro !== 'atencao' && filtro !== 'todos' && l.situacao !== filtro) return false
    if (!q) return true
    if (qDigitos && l.chave.includes(qDigitos)) return true
    return semAcento(l.chave).includes(q) || semAcento(l.nome ?? '').includes(q)
  })
}

export function contarAtencao(linhas: LinhaPrevia[], entidade: EntidadeImportacao): number {
  return linhas.filter((l) => l.entidade === entidade && (l.situacao === 'problema' || l.temAviso)).length
}

// ---------------------------------------------------------------------------
// Relatório CSV (gerado no navegador, só chave, nome, situação e mensagem)
// ---------------------------------------------------------------------------

/** Célula de CSV (;) com aspas e sem virar fórmula no Excel (=, +, -, @ no começo). */
function celula(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[;"\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

export function csvPrevia(linhas: LinhaPrevia[]): string {
  const cab = ['entidade', 'chave', 'nome', 'situacao', 'mensagem']
  const corpo = linhas.map((l) => {
    const situacao = SITUACAO[l.situacao].rotulo + (l.temAviso && l.situacao !== 'problema' ? ' (com aviso)' : '')
    return [PLURAL[l.entidade], chaveExibida(l.entidade, l.chave), l.nome ?? '', situacao, l.mensagens.join(' | ')].map(celula).join(';')
  })
  return [cab.join(';'), ...corpo].join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------
// Confirmação e resultado
// ---------------------------------------------------------------------------

export function totais(p: Pick<PreviaImportacao, 'contagens'>): { novos: number; atualizados: number; problemas: number; iguais: number } {
  const t = { novos: 0, atualizados: 0, problemas: 0, iguais: 0 }
  for (const c of Object.values(p.contagens)) {
    t.novos += c.novos
    t.atualizados += c.atualizados
    t.problemas += c.problemas
    t.iguais += c.iguais
  }
  return t
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * O status do produto vem do ES (ativo/inativo): um produto ativo no Prodio e inativo no ES é inativado. Por
 * isso a confirmação não promete "nada é inativado" — diz o que fica como está e conta quem muda de status.
 */
export function textoConfirmacao(p: Pick<PreviaImportacao, 'contagens'> & Partial<Pick<PreviaImportacao, 'linhas'>>): string {
  const t = totais(p)
  const problemas = t.problemas ? ` ${plural(t.problemas, 'item com problema fica', 'itens com problema ficam')} de fora.` : ''
  const nStatus = (p.linhas ?? []).filter((l) => l.entidade === 'produto' && l.situacao === 'atualizado' && l.campos.includes('status')).length
  const status = nStatus ? ` ${plural(nStatus, 'produto muda', 'produtos mudam')} de status (ativo/inativo) para ficar como no ES.` : ''
  return `Vão entrar ${plural(t.novos, 'novo', 'novos')} e ${plural(t.atualizados, 'atualização', 'atualizações')}.${problemas}${status} Nada é apagado e o que não está no arquivo fica como está. Reimportar o mesmo arquivo não duplica.`
}

/** A gravação contou diferente da prévia: alguém mexeu no cadastro entre uma e outra. */
export function mudouDesdeAPrevia(previa: ResultadoImportacao, gravacao: ResultadoImportacao): boolean {
  return JSON.stringify(previa.contagens) !== JSON.stringify(gravacao.contagens)
}

/**
 * Famílias dos produtos importados sem perfil de etiqueta próprio, com o prefixo que vão usar (o do perfil
 * "*" do tenant, ou o padrão do core). Mesma comparação do perfilDaFamilia: sem espaços nas pontas e sem caixa.
 */
export function familiasSemPerfil(skus: string[], products: Product[], perfis: LabelProfile[]): { familia: string; prefixo: string }[] {
  const alvo = new Set(skus)
  const chave = (f: string) => f.trim().toLowerCase()
  const comPerfil = new Set(perfis.filter((p) => p.familia !== '*').map((p) => chave(p.familia)))
  const familias = new Map<string, string>()
  for (const p of products) if (alvo.has(p.sku) && p.familia && !comPerfil.has(chave(p.familia)) && !familias.has(chave(p.familia))) familias.set(chave(p.familia), p.familia)
  return [...familias.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((familia) => ({ familia, prefixo: perfilDaFamilia(perfis, familia).prefixo }))
}
