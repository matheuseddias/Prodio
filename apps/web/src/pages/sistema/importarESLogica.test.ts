// Lógica da tela "Importar do ES": leitura do arquivo sem vazar conteúdo, CNPJ digitado, filtros, CSV,
// textos de confirmação, comparação prévia × gravação, famílias sem perfil e detalhe dos campos.
import { juntarPrevia, planejarBackupES, type LinhaPrevia, type ResultadoImportacao } from '@prodio/core/importacaoEs'
import { backupSintetico, HOJE, NOME_ARQUIVO, planejar } from '@prodio/core/importacaoEs/fixtura'
import { describe, expect, it } from 'vitest'
import type { Product } from '../../domain/types'
import { importarEmMemoria } from '../../data/importacaoMemoria'
import { detalharCampos, nomeDaChave } from './importarESDetalhe'
import {
  chaveExibida,
  cnpjPorNome,
  cnpjsValidos,
  conferirArquivo,
  conferirCnpjDigitado,
  csvPrevia,
  familiasSemPerfil,
  filtrarLinhas,
  instrucoesExemplo,
  lerTextoBackup,
  mudouDesdeAPrevia,
  origemDosPedidos,
  resumoContagem,
  rotuloImportar,
  textoConfirmacao,
  textoItensReligados,
} from './importarESLogica'

const vazio = () => ({ suppliers: [], materials: [], products: [], boms: [], vinculos: [] })
const ops = () => {
  let n = 0
  return { novoId: () => `id-${++n}`, agora: '2026-09-26T12:00:00.000Z', unidades: ['un', 'm', 'm2', 'kg', 'g', 'cx', 'rl', 'ct'] }
}

describe('arquivo', () => {
  it('confere extensão, vazio e tamanho antes de abrir', () => {
    expect(conferirArquivo({ name: 'backup-suprimentos-20260924-1810.json', size: 10 })).toBeUndefined()
    expect(conferirArquivo({ name: 'BACKUP.JSON', size: 10 })).toBeUndefined()
    expect(conferirArquivo({ name: 'planilha.xlsx', size: 10 })).toMatch(/\.json/)
    expect(conferirArquivo({ name: 'a.json', size: 0 })).toMatch(/vazio/)
    expect(conferirArquivo({ name: 'a.json', size: 51 * 1024 * 1024 })).toMatch(/50 MB/)
  })

  it('lê o backup e devolve só a leitura em lista branca (sem senha, sem config)', () => {
    const r = lerTextoBackup(JSON.stringify(backupSintetico()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const texto = JSON.stringify(r.backup, (_k, v: unknown) => (v instanceof Map ? [...v.entries()] : v))
    for (const s of ['nao-copiar', 'Empresa Exemplo Ltda (fictícia)', 'usuario.ficticio@exemplo.invalid']) expect(texto).not.toContain(s)
    expect(planejarBackupES(r.backup, { nomeArquivo: NOME_ARQUIVO, hoje: HOJE })).toEqual(planejar())
  })

  it('JSON quebrado: mensagem fixa, sem trecho do arquivo (o erro do JSON.parse cita o conteúdo)', () => {
    const r = lerTextoBackup('{"users":[{"senha":"segredo-no-arquivo"}], quebrado')
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/não é um JSON válido/) })
    expect(JSON.stringify(r)).not.toContain('segredo')
  })

  it('JSON que não é objeto não é backup; BOM do Windows no começo é aceito', () => {
    expect(lerTextoBackup('[1,2]')).toMatchObject({ ok: false, motivo: expect.stringMatching(/não é um backup do ES/) })
    expect(lerTextoBackup(`﻿${JSON.stringify(backupSintetico())}`).ok).toBe(true)
  })
})

describe('CNPJ', () => {
  it('fornecedores do Prodio por nome, em dígitos', () => {
    expect(cnpjPorNome([{ id: 's', nome: 'Vidros', cnpj: '11.222.333/0001-81', regime: 'normal', leadTimeDias: 0, condicaoPagamento: [0] }])).toEqual({ Vidros: '11222333000181' })
  })
  it('CNPJ digitado: vazio fica de fora, dígito errado é recusado, pontuação é aceita', () => {
    expect(conferirCnpjDigitado('')).toEqual({})
    expect(conferirCnpjDigitado('11.444.777/0001-61')).toEqual({ cnpj: '11444777000161' })
    expect(conferirCnpjDigitado('11.444.777/0001-62').erro).toMatch(/verificador/)
    expect(conferirCnpjDigitado('123').erro).toMatch(/14 dígitos/)
    expect(cnpjsValidos({ A: '11444777000161', B: '11444777000162', C: '' })).toEqual({ A: '11444777000161' })
  })
})

describe('tabela da prévia', () => {
  const l = (x: Partial<LinhaPrevia>): LinhaPrevia => ({ entidade: 'insumo', chave: 'MP1', situacao: 'igual', campos: [], mensagens: [], temAviso: false, ...x })
  const linhas = [
    l({ chave: 'MP1', nome: 'Chapa de Espelho', situacao: 'novo' }),
    l({ chave: 'MP2', nome: 'Alça', situacao: 'igual', temAviso: true }),
    l({ chave: 'MP3', nome: 'Feltro', situacao: 'problema' }),
    l({ chave: 'MP4', nome: 'Cola', situacao: 'atualizado' }),
    l({ entidade: 'fornecedor', chave: '11222333000181', nome: 'Vidraçaria', situacao: 'novo' }),
  ]
  const chaves = (x: LinhaPrevia[]) => x.map((y) => y.chave)

  it('padrão mostra problemas e avisos; os outros filtros pela situação', () => {
    expect(chaves(filtrarLinhas(linhas, 'insumo', 'atencao', ''))).toEqual(['MP2', 'MP3'])
    expect(chaves(filtrarLinhas(linhas, 'insumo', 'novo', ''))).toEqual(['MP1'])
    expect(chaves(filtrarLinhas(linhas, 'insumo', 'todos', ''))).toHaveLength(4)
  })
  it('busca por SKU, por nome sem acento e por CNPJ com pontuação', () => {
    expect(chaves(filtrarLinhas(linhas, 'insumo', 'todos', 'alca'))).toEqual(['MP2'])
    expect(chaves(filtrarLinhas(linhas, 'insumo', 'todos', 'mp4'))).toEqual(['MP4'])
    expect(chaves(filtrarLinhas(linhas, 'fornecedor', 'todos', '11.222.333/0001'))).toEqual(['11222333000181'])
  })
  it('CSV: só chave, nome, situação e mensagem; ; e aspas escapados; nada vira fórmula', () => {
    const csv = csvPrevia([l({ chave: 'MP1', nome: '=HYPERLINK("x")', situacao: 'problema', mensagens: ['a; b', 'c'] }), l({ chave: 'MP2', nome: 'Alça', temAviso: true })])
    const [cab, um, dois] = csv.trim().split('\r\n')
    expect(cab).toBe('entidade;chave;nome;situacao;mensagem')
    expect(um).toBe(`Insumos;MP1;"'=HYPERLINK(""x"")";Problema;"a; b | c"`)
    expect(dois).toBe('Insumos;MP2;Alça;Igual (com aviso);')
    // CNPJ pontuado: a planilha não transforma em 1,12E+13
    expect(csvPrevia([l({ entidade: 'vinculo', chave: '11222333000181|MP9001' })]).split('\r\n')[1]).toBe('Vínculos insumo-fornecedor;11.222.333/0001-81 | MP9001;;Igual;')
  })
  it('chave para exibir e resumo das contagens no singular e no plural', () => {
    expect(chaveExibida('fornecedor', '11222333000181')).toBe('11.222.333/0001-81')
    expect(chaveExibida('insumo', 'MP9001')).toBe('MP9001')
    expect(chaveExibida('fornecedor', 'nome:Tecidos Modelo')).toBe('sem CNPJ')
    expect(chaveExibida('vinculo', 'nome:Tecidos Modelo|MP9002')).toBe('sem CNPJ | MP9002')
    expect(resumoContagem({ novos: 1, atualizados: 2, iguais: 1, problemas: 0 })).toBe('1 novo · 2 atualizados · 1 igual')
    expect(resumoContagem({ novos: 0, atualizados: 1, iguais: 1200, problemas: 3 })).toBe('0 novos · 1 atualizado · 1.200 iguais')
  })
})

describe('confirmação e resultado', () => {
  const plano = planejar()
  const primeira = importarEmMemoria(vazio(), plano.payload, ops())
  const previa = juntarPrevia(plano, primeira.resultado)

  it('texto da confirmação com as contagens da prévia', () => {
    expect(textoConfirmacao(previa)).toBe('Vão entrar 28 novos e 0 atualizações. Nada é apagado e o que não está no arquivo fica como está. Reimportar o mesmo arquivo não duplica.')
    const comProblema = { contagens: { ...previa.contagens, insumo: { ...previa.contagens.insumo, problemas: 1 } } }
    expect(textoConfirmacao(comProblema)).toContain('1 item com problema fica de fora.')
  })

  it('produto inativo no ES inativa o do Prodio: a confirmação não promete "nada é inativado" e conta quem muda', () => {
    const linhas = [
      { entidade: 'produto' as const, chave: 'ED900001', situacao: 'atualizado' as const, campos: ['nome', 'status'], mensagens: [], temAviso: false },
      { entidade: 'produto' as const, chave: 'ED900002', situacao: 'atualizado' as const, campos: ['nome'], mensagens: [], temAviso: false },
    ]
    const texto = textoConfirmacao({ contagens: previa.contagens, linhas })
    expect(texto).not.toContain('inativado')
    expect(texto).toContain('1 produto muda de status (ativo/inativo) para ficar como no ES.')
  })

  it('contagens da gravação diferentes das da prévia: o catálogo mudou no meio', () => {
    const r: ResultadoImportacao = primeira.resultado
    expect(mudouDesdeAPrevia(r, structuredClone(r))).toBe(false)
    const outra = structuredClone(r)
    outra.contagens.produto.novos--
    outra.contagens.produto.iguais++
    expect(mudouDesdeAPrevia(r, outra)).toBe(true)
  })

  it('famílias sem perfil de etiqueta, com o prefixo que vão usar', () => {
    const skus = plano.payload.produtos.map((p) => p.sku)
    const products = primeira.catalogo.products
    expect(familiasSemPerfil(skus, products, [{ familia: 'espelho ', prefixo: 'EH', tipos: ['produto'], unidadesPorCaixa: 1 }]).map((f) => f.familia)).toEqual(['3D', 'Bandeja', 'Kit', 'Mousepad'])
    const comCuringa = familiasSemPerfil(skus, products, [{ familia: '*', prefixo: 'XX', tipos: ['produto'], unidadesPorCaixa: 1 }])
    expect(comCuringa.every((f) => f.prefixo === 'XX')).toBe(true)
    expect(familiasSemPerfil(['OUTRO'], products, [])).toEqual([])
  })
})

describe('itens de pedido religados', () => {
  it('origem dos pedidos: o único conector ligado dá o nome; nenhum ou vários, texto genérico', () => {
    expect(origemDosPedidos([{ plataforma: 'baselinker', status: 'conectado' }, { plataforma: 'bling', status: 'desconectado' }])).toBe('da Base')
    expect(origemDosPedidos([{ plataforma: 'baselinker', status: 'erro' }])).toBe('da Base')
    expect(origemDosPedidos([{ plataforma: 'bling', status: 'conectado' }])).toBe('do Bling')
    expect(origemDosPedidos([{ plataforma: 'baselinker', status: 'conectado' }, { plataforma: 'tiny', status: 'conectado' }])).toBe('dos conectores')
    expect(origemDosPedidos([{ plataforma: 'baselinker', status: 'desconectado' }])).toBe('dos conectores')
  })

  it('texto da prévia e do resultado, no singular e no plural; zero não aparece', () => {
    expect(textoItensReligados(37, 'da Base')).toBe('37 itens de pedido da Base passam a apontar para produtos importados.')
    expect(textoItensReligados(1, 'da Base')).toBe('1 item de pedido da Base passa a apontar para um produto importado.')
    expect(textoItensReligados(1200, 'dos conectores')).toBe('1.200 itens de pedido dos conectores passam a apontar para produtos importados.')
    expect(textoItensReligados(0, 'da Base')).toBeUndefined()
  })

  it('a confirmação e o botão contam os itens religados', () => {
    const plano = planejar()
    const previa = juntarPrevia(plano, { ...importarEmMemoria(vazio(), plano.payload, ops()).resultado, itensPedidoReligados: 3 })
    expect(textoConfirmacao(previa, 'da Base')).toBe(
      'Vão entrar 28 novos e 0 atualizações. 3 itens de pedido da Base passam a apontar para produtos importados. Nada é apagado e o que não está no arquivo fica como está. Reimportar o mesmo arquivo não duplica.',
    )
    expect(rotuloImportar(previa)).toBe('Importar 28 alterações')
    expect(rotuloImportar({ totalGravacoes: 0, itensPedidoReligados: 3 })).toBe('Religar 3 itens de pedido')
    expect(rotuloImportar({ totalGravacoes: 1, itensPedidoReligados: 0 })).toBe('Importar 1 alteração')
    expect(rotuloImportar(null)).toBe('Importar 0 alterações')
  })
})

describe('dados de exemplo: qual limpeza rodar', () => {
  const exemplo = { produtos: 11, insumos: 13, fornecedores: 5 }

  it('sem conector ligado nem pedido real: limpar_exemplo.sql', () => {
    const i = instrucoesExemplo({ exemplo, usoReal: { conectoresLigados: 0, pedidosReais: 0 } })
    expect(i.titulo).toBe('Há dados de exemplo no Prodio (11 produtos, 13 insumos, 5 fornecedores). Eles precisam sair antes da importação.')
    expect(i.script).toBe('supabase/dist/limpar_exemplo.sql')
    expect(i.passos.join(' ')).toContain('cole o conteúdo de supabase/dist/limpar_exemplo.sql e rode')
  })

  it('com conector ligado ou pedido real: limpar_so_exemplo.sql, e o aviso de não usar o outro', () => {
    const i = instrucoesExemplo({ exemplo, usoReal: { conectoresLigados: 1, pedidosReais: 812 } })
    expect(i.script).toBe('supabase/dist/limpar_so_exemplo.sql')
    const texto = i.passos.join(' ')
    expect(texto).toContain('1 conector ligado, 812 pedidos reais')
    expect(texto).toContain('cole o conteúdo de supabase/dist/limpar_so_exemplo.sql e rode')
    expect(texto).toContain('Não use o limpar_exemplo.sql')
    // O limpar_exemplo.sql mantém a empresa, os usuários e os aparelhos: o que ele apaga são os dados.
    expect(texto).not.toContain('empresa inteira')
    expect(texto).toContain('ele apaga todos os dados da empresa, não só o exemplo')
    // A trava do seletivo também para em De-Para de SKU feito na tela do conector num produto do exemplo.
    expect(texto).toContain('De-Para de SKU')
    expect(texto).toContain('religa pelo apelido e pelo SKU')
    expect(texto).not.toContain('cole o conteúdo de supabase/dist/limpar_exemplo.sql')
    expect(instrucoesExemplo({ exemplo, usoReal: { conectoresLigados: 0, pedidosReais: 1 } }).script).toBe('supabase/dist/limpar_so_exemplo.sql')
  })
})

describe('detalhe dos campos', () => {
  const plano = planejar()
  const cat = importarEmMemoria(vazio(), plano.payload, ops()).catalogo

  it('mostra o valor novo e o atual do campo que muda', () => {
    const atual = { ...cat, materials: cat.materials.map((m) => (m.sku === 'MP9003' ? { ...m, nome: 'Alça antiga', minimo: 3 } : m)) }
    const d = detalharCampos({ entidade: 'insumo', chave: 'MP9003', campos: ['nome', 'minimo'] }, plano.payload, atual)
    expect(d[0]).toEqual({ campo: 'nome', rotulo: 'Nome', novo: plano.payload.insumos.find((i) => i.sku === 'MP9003')?.nome, atual: 'Alça antiga' })
    expect(d[1].rotulo).toBe('Estoque mínimo')
    expect(d[1].atual).toBe('3,00 un')
  })

  it('ficha: número de linhas; vínculo: só o valor do arquivo; campo desconhecido não quebra', () => {
    const p = cat.products.find((x) => x.sku === 'ED900001') as Product
    const semLinha = { ...cat, boms: cat.boms.map((b) => (b.productId === p.id ? { ...b, linhas: b.linhas.slice(0, 2) } : b)) }
    expect(detalharCampos({ entidade: 'ficha', chave: 'ED900001', campos: ['linhas'] }, plano.payload, semLinha)).toEqual([{ campo: 'linhas', rotulo: 'Linhas da ficha', novo: '6 linhas', atual: '2 linhas' }])
    expect(detalharCampos({ entidade: 'vinculo', chave: '11222333000181|MP9001', campos: ['codigo_fornecedor'] }, plano.payload, cat)[0]).toMatchObject({ novo: 'CH3MM-321240', atual: undefined })
    expect(detalharCampos({ entidade: 'produto', chave: 'ED900001', campos: ['xyz'] }, plano.payload, cat)).toEqual([{ campo: 'xyz', rotulo: 'xyz', novo: undefined, atual: undefined }])
  })

  it('nome para exibir a partir do payload', () => {
    expect(nomeDaChave('apelido', 'TM900002', plano.payload)).toBe('apelido de ED900001')
    expect(nomeDaChave('vinculo', '11222333000181|MP9001', plano.payload)).toContain('Vidraçaria Exemplo Ltda')
  })
})
