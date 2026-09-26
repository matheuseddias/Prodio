// Segurança da importação: nada do arquivo além do cadastro sai do navegador. O backup sintético traz um
// usuário falso com senha, dados da empresa, contas do Kamino, uma devolução com comprador e o e-mail de quem
// gerou a OC — nenhum desses valores pode aparecer no plano, e o payload só pode ter as chaves da lista branca.
import { lerBackupES, planejarBackupES, planejarImportacaoES } from '../importacaoEs'
import { HOJE, NOME_ARQUIVO, backupSintetico, planejar } from './fixtura'

const SENSIVEIS = [
  'nao-copiar', // users[].senha
  'usuario.ficticio@exemplo.invalid', // users[].email e ordens[].geradoEmail
  'Usuário Fictício de Teste', // users[].nome, movs[].por, ordens[].geradoPor
  'Empresa Exemplo Ltda (fictícia)', // config.empresa
  'compras@exemplo.invalid',
  '000.000.000.000',
  'Rua Fictícia',
  'Pessoa Física Fictícia', // kaminoContas[].pessoa
  'adiantamento',
  'VIDRACARIA EXEMPLO LTDA', // kaminoMP / notasImportadas[].fornecedor
  'Cliente Fictício', // movs[].comprador
  'PED-TESTE-1',
  'NFe00000000000000000000000000000000000000000000', // chave da NF-e
  'Espelho redondo de exemplo com alça', // products[].descricao
  'https://exemplo.invalid/fotos', // products[].foto
]

const CHAVES = {
  topo: ['versao', 'origem', 'fornecedores', 'insumos', 'produtos', 'vinculos', 'fichas'],
  fornecedores: ['cnpj', 'nome', 'regime', 'lead_time_dias', 'condicao_pagamento', 'contato'],
  insumos: ['sku', 'nome', 'ncm', 'unidade_compra', 'unidade_consumo', 'fator_conversao', 'minimo', 'custo_referencia', 'fornecedor_padrao_cnpj', 'lead_time_dias'],
  produtos: ['sku', 'nome', 'familia', 'atributos', 'ean', 'ncm', 'status', 'peso_kg', 'peso_cubado_kg', 'custo_manual', 'apelidos'],
  vinculos: ['fornecedor_cnpj', 'insumo_sku', 'codigo_fornecedor', 'unidade_compra', 'fator', 'preco', 'aliq_icms', 'inteiro'],
  fichas: ['produto_sku', 'linhas'],
  linhas: ['tipo', 'insumo_sku', 'componente_sku', 'consumo', 'unidade', 'perda_pct', 'calc'],
  calc: ['tipo', 'partes', 'larguraRoloM', 'perda'],
  partes: ['nome', 'qtd', 'largCm', 'altCm', 'compCm', 'pesoG', 'un'],
  atributos: ['categoria', 'cor', 'divisao', 'formato', 'grupo_corte', 'lapidado', 'linha', 'material', 'tamanho'],
}
const soChaves = (o: object, permitidas: string[]) => expect(Object.keys(o).filter((k) => !permitidas.includes(k))).toEqual([])

describe('lista branca: campos sensíveis nunca chegam ao plano', () => {
  const plano = planejar()
  const texto = JSON.stringify(plano)

  it.each(SENSIVEIS)('"%s" não aparece em lugar nenhum do plano', (v) => {
    expect(texto).not.toContain(v)
  })

  it('o fixture tem mesmo os campos sensíveis (senão o teste não prova nada)', () => {
    const cru = JSON.stringify(backupSintetico())
    for (const v of SENSIVEIS) expect(cru).toContain(v)
  })

  it('o payload só tem as chaves do contrato, em todos os níveis', () => {
    const p = plano.payload
    soChaves(p, CHAVES.topo)
    p.fornecedores.forEach((f) => soChaves(f, CHAVES.fornecedores))
    p.insumos.forEach((i) => soChaves(i, CHAVES.insumos))
    p.produtos.forEach((x) => {
      soChaves(x, CHAVES.produtos)
      soChaves(x.atributos, CHAVES.atributos)
      expect(Object.values(x.atributos).every((v) => typeof v === 'string')).toBe(true)
    })
    p.vinculos.forEach((v) => soChaves(v, CHAVES.vinculos))
    p.fichas.forEach((f) => {
      soChaves(f, CHAVES.fichas)
      f.linhas.forEach((l) => {
        soChaves(l, CHAVES.linhas)
        if (!l.calc) return
        soChaves(l.calc, CHAVES.calc)
        l.calc.partes.forEach((pt) => soChaves(pt, CHAVES.partes))
      })
    })
  })

  it('usuários, config e ledger só entram como contagem no "fica de fora"', () => {
    const usuarios = plano.origem.ignorado.find((s) => s.secao.startsWith('Usuários'))
    expect(usuarios).toEqual({ secao: 'Usuários do ES (e senhas)', itens: 1 })
    expect(plano.payload.insumos.some((i) => 'saldo' in i)).toBe(false)
  })

  it('um campo novo desconhecido no backup não passa para o payload', () => {
    const b = backupSintetico()
    b.products[0].token = 'segredo-que-nao-pode-sair'
    b.fornecedores[0].senha = 'outro-segredo'
    b.insumos[0].fornecedores[0].apiKey = 'mais-um-segredo'
    b.bom[1].calc.partes[0].segredo = 'calc-segredo'
    const t = JSON.stringify(planejarImportacaoES(b))
    for (const v of ['segredo-que-nao-pode-sair', 'outro-segredo', 'mais-um-segredo', 'calc-segredo']) expect(t).not.toContain(v)
  })
})

// A tela guarda o backup lido (lerBackupES) para refazer a prévia com os CNPJs digitados, e descarta o cru.
// Então o que ela guarda também tem de estar limpo, e replanejar a partir dele tem de dar o mesmo plano.
describe('backup lido em lista branca (o que a tela guarda entre uma prévia e outra)', () => {
  /** JSON que também percorre Map (JSON.stringify de um Map vira {} e esconderia o conteúdo). */
  const tudo = (x: unknown): string => JSON.stringify(x, (_k, v: unknown) => (v instanceof Map ? [...v.entries()] : v))

  it.each(SENSIVEIS)('"%s" não aparece no backup lido', (v) => {
    const bk = lerBackupES(backupSintetico())
    expect(bk).toBeDefined()
    expect(tudo(bk)).not.toContain(v)
  })

  it('planejar a partir do backup lido dá o mesmo plano que a partir do cru, quantas vezes for', () => {
    const opcoes = { nomeArquivo: NOME_ARQUIVO, hoje: HOJE }
    const bk = lerBackupES(backupSintetico())
    const direto = planejarImportacaoES(backupSintetico(), opcoes)
    expect(planejarBackupES(bk, opcoes)).toEqual(direto)
    expect(planejarBackupES(bk, opcoes)).toEqual(direto)
  })

  it('replanejar com um CNPJ digitado usa o mesmo backup lido sem precisar do arquivo', () => {
    const semCnpj = (b: ReturnType<typeof backupSintetico>) => {
      b.fornecedores[1].cnpj = ''
      b.kaminoForn = {}
      b.notasImportadas = []
    }
    const cru = backupSintetico()
    semCnpj(cru)
    const bk = lerBackupES(cru)
    const antes = planejarBackupES(bk, { nomeArquivo: NOME_ARQUIVO, hoje: HOJE })
    expect(antes.fornecedoresSemCnpj.length).toBeGreaterThan(0)
    const nome = antes.fornecedoresSemCnpj[0].nome
    const cnpjManual = { [nome]: '11444777000161' }
    const depois = planejarBackupES(bk, { nomeArquivo: NOME_ARQUIVO, hoje: HOJE, cnpjManual })
    const cru2 = backupSintetico()
    semCnpj(cru2)
    expect(depois).toEqual(planejarImportacaoES(cru2, { nomeArquivo: NOME_ARQUIVO, hoje: HOJE, cnpjManual }))
    expect(depois.payload.fornecedores.some((f) => f.cnpj === '11444777000161')).toBe(true)
  })

  it('o que não é objeto não é backup', () => {
    expect(lerBackupES('texto')).toBeUndefined()
    expect(planejarBackupES(undefined).aceito).toBe(false)
  })
})
