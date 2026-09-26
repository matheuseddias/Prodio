// Resposta da RPC import_catalog, junção com o plano e idempotência do plano.
import { chavesDoPayload, juntarPrevia, lerResultadoImportacao, scriptLimpezaExemplo } from './previa'
import { planejar } from './fixtura'
import { ENTIDADES_IMPORTACAO, type EntidadeImportacao, type ResultadoImportacao } from './tipos'

const contagens = (f: (e: EntidadeImportacao) => Partial<Record<'novos' | 'atualizados' | 'iguais' | 'problemas', number>> = () => ({})) =>
  Object.fromEntries(ENTIDADES_IMPORTACAO.map((e) => [e, { novos: 0, atualizados: 0, iguais: 0, problemas: 0, ...f(e) }])) as ResultadoImportacao['contagens']
const resultado = (r: Partial<ResultadoImportacao> = {}): ResultadoImportacao => ({
  simulacao: true, exemplo: { produtos: 0, insumos: 0, fornecedores: 0 }, usoReal: { conectoresLigados: 0, pedidosReais: 0 }, contagens: contagens(), linhas: [],
  itensPedidoReligados: 0, ...r,
})
/** O mesmo resultado no formato que a RPC devolve (snake_case). */
const rpc = (r: ResultadoImportacao): Record<string, unknown> => ({
  simulacao: r.simulacao, exemplo: r.exemplo, uso_real: { conectores_ligados: r.usoReal.conectoresLigados, pedidos_reais: r.usoReal.pedidosReais },
  contagens: r.contagens, linhas: r.linhas, itens_pedido_religados: r.itensPedidoReligados,
})

describe('lerResultadoImportacao', () => {
  it('aceita o formato da RPC e descarta o que não conhece', () => {
    const r = resultado({ linhas: [{ entidade: 'produto', chave: 'ED1', situacao: 'atualizado', campos: ['nome'] }], usoReal: { conectoresLigados: 1, pedidosReais: 812 }, itensPedidoReligados: 37 })
    const bruto = { ...rpc(r), extra: 1 }
    expect(lerResultadoImportacao(JSON.parse(JSON.stringify(bruto)))).toEqual(r)
  })
  it.each([
    ['nulo', null],
    ['sem simulacao', { ...rpc(resultado()), simulacao: 'sim' }],
    ['contagem faltando', { ...rpc(resultado()), contagens: { fornecedor: { novos: 0, atualizados: 0, iguais: 0, problemas: 0 } } }],
    ['contagem negativa', { ...rpc(resultado()), contagens: contagens(() => ({ novos: -1 })) }],
    ['entidade desconhecida', rpc(resultado({ linhas: [{ entidade: 'usuario' as EntidadeImportacao, chave: 'x', situacao: 'novo' }] }))],
    ['situação desconhecida', rpc(resultado({ linhas: [{ entidade: 'produto', chave: 'x', situacao: 'apagado' as 'novo' }] }))],
    ['sem uso_real', { ...rpc(resultado()), uso_real: undefined }],
    ['uso_real sem pedidos', { ...rpc(resultado()), uso_real: { conectores_ligados: 0 } }],
    ['sem itens_pedido_religados', { ...rpc(resultado()), itens_pedido_religados: undefined }],
    ['itens_pedido_religados negativo', { ...rpc(resultado()), itens_pedido_religados: -1 }],
    ['itens_pedido_religados em texto', { ...rpc(resultado()), itens_pedido_religados: '3' }],
  ])('lança quando o formato não confere (%s)', (_, x) => {
    expect(() => lerResultadoImportacao(x)).toThrow(/formato inesperado/)
  })
})

describe('scriptLimpezaExemplo', () => {
  it('sem uso real serve o limpar_exemplo.sql; com conector ligado ou pedido real, só o seletivo', () => {
    expect(scriptLimpezaExemplo({ conectoresLigados: 0, pedidosReais: 0 })).toBe('supabase/dist/limpar_exemplo.sql')
    expect(scriptLimpezaExemplo({ conectoresLigados: 1, pedidosReais: 0 })).toBe('supabase/dist/limpar_so_exemplo.sql')
    expect(scriptLimpezaExemplo({ conectoresLigados: 0, pedidosReais: 3 })).toBe('supabase/dist/limpar_so_exemplo.sql')
  })
})

describe('juntarPrevia', () => {
  const plano = planejar()
  const noPayload = chavesDoPayload(plano).size

  it('primeira importação: tudo novo, nada bloqueia', () => {
    const linhas = [...chavesDoPayload(plano)].map((k) => {
      const [entidade, chave] = k.split('\u0000')
      return { entidade: entidade as EntidadeImportacao, chave, situacao: 'novo' as const }
    })
    const previa = juntarPrevia(plano, resultado({ linhas }))
    expect(previa.totalGravacoes).toBe(noPayload)
    expect(previa.podeGravar).toBe(true)
    expect(previa.contagens.insumo).toMatchObject({ novos: 8, iguais: 0, problemas: 0, avisos: 4 })
    expect(previa.linhas.find((l) => l.chave === 'MP9001')).toMatchObject({ nome: 'Chapa Espelho 3mm 3,21x2,40 (exemplo)', situacao: 'novo', temAviso: true })
  })

  it('idempotência: servidor sem nenhuma mudança → tudo igual, nada a gravar, botão desligado', () => {
    const previa = juntarPrevia(plano, resultado({ contagens: contagens((e) => ({ iguais: plano.contagens[e].entram })) }))
    expect(previa.totalGravacoes).toBe(0)
    expect(previa.podeGravar).toBe(false)
    expect(previa.bloqueios).toEqual(['Nenhuma alteração a gravar: o Prodio já está igual ao arquivo.'])
    for (const e of ENTIDADES_IMPORTACAO) expect(previa.contagens[e]).toMatchObject({ novos: 0, atualizados: 0, iguais: plano.contagens[e].entram })
  })

  it('problema do servidor vence; campos e mensagens são somados; aviso do servidor marca a linha', () => {
    const previa = juntarPrevia(plano, resultado({
      linhas: [
        { entidade: 'produto', chave: 'ED900003', situacao: 'problema', mensagem: 'o SKU ED900003 é apelido de X no Prodio' },
        { entidade: 'insumo', chave: 'MP9003', situacao: 'atualizado', campos: ['nome', 'minimo'] },
        { entidade: 'vinculo', chave: '11222333000181|MP9001', situacao: 'aviso', mensagem: 'código já é do insumo MPX' },
        { entidade: 'vinculo', chave: '11222333000181|MP9001', situacao: 'novo' },
      ],
    }))
    expect(previa.linhas.find((l) => l.chave === 'ED900003' && l.entidade === 'produto')).toMatchObject({ situacao: 'problema', mensagens: ['o SKU ED900003 é apelido de X no Prodio'] })
    expect(previa.linhas.find((l) => l.chave === 'MP9003')).toMatchObject({ situacao: 'atualizado', campos: ['nome', 'minimo'] })
    expect(previa.linhas.find((l) => l.chave === '11222333000181|MP9001')).toMatchObject({ situacao: 'novo', temAviso: true })
    expect(previa.contagens.produto).toMatchObject({ problemas: 1, iguais: 4 })
  })

  it('dados de exemplo no Prodio bloqueiam a gravação; sem uso real, o caminho é o limpar_exemplo.sql', () => {
    const previa = juntarPrevia(plano, resultado({ exemplo: { produtos: 11, insumos: 13, fornecedores: 5 }, linhas: [{ entidade: 'produto', chave: 'ED900001', situacao: 'novo' }] }))
    expect(previa.podeGravar).toBe(false)
    expect(previa.bloqueios[0]).toContain('11 produtos, 13 insumos, 5 fornecedores')
    expect(previa.bloqueios[0]).toContain('rode supabase/dist/limpar_exemplo.sql')
    expect(previa.bloqueios[0]).not.toContain('limpar_so_exemplo')
  })

  it('dados de exemplo com conector ligado ou pedido real: aponta o limpar_so_exemplo.sql e avisa para não usar o outro', () => {
    const ex = { produtos: 11, insumos: 13, fornecedores: 5 }
    const com = juntarPrevia(plano, resultado({ exemplo: ex, usoReal: { conectoresLigados: 1, pedidosReais: 812 } }))
    expect(com.podeGravar).toBe(false)
    expect(com.bloqueios[0]).toContain('1 conector ligado, 812 pedidos reais')
    expect(com.bloqueios[0]).toContain('rode supabase/dist/limpar_so_exemplo.sql')
    expect(com.bloqueios[0]).toContain('Não use limpar_exemplo.sql')
    const soPedidos = juntarPrevia(plano, resultado({ exemplo: ex, usoReal: { conectoresLigados: 0, pedidosReais: 1 } }))
    expect(soPedidos.bloqueios[0]).toContain('0 conectores ligados, 1 pedido real')
    expect(soPedidos.bloqueios[0]).toContain('limpar_so_exemplo.sql')
  })

  it('catálogo igual, mas com itens de pedido a religar: há o que gravar', () => {
    const iguais = contagens((e) => ({ iguais: plano.contagens[e].entram }))
    const previa = juntarPrevia(plano, resultado({ contagens: iguais, itensPedidoReligados: 4 }))
    expect(previa.totalGravacoes).toBe(0)
    expect(previa.itensPedidoReligados).toBe(4)
    expect(previa.bloqueios).toEqual([])
    expect(previa.podeGravar).toBe(true)
    expect(juntarPrevia(plano, resultado({ contagens: iguais })).itensPedidoReligados).toBe(0)
  })

  it('linha só de aviso fora do payload (vínculo de fornecedor fora do cadastro) não conta como igual', () => {
    const previa = juntarPrevia(plano, resultado())
    const fora = previa.linhas.find((l) => l.chave.startsWith('nome:Casa do Parafuso'))
    expect(fora).toMatchObject({ situacao: 'igual', temAviso: true })
    expect(previa.contagens.vinculo.iguais).toBe(6)
  })
})

describe('plano determinístico (base da idempotência)', () => {
  it('o mesmo arquivo gera o mesmo payload, byte a byte', () => {
    expect(JSON.stringify(planejar().payload)).toBe(JSON.stringify(planejar().payload))
  })
  it('reimportar com o Prodio já preenchido (CNPJ achado pelo nome no Prodio) não muda o payload', () => {
    const primeiro = planejar((b) => {
      b.fornecedores[1].cnpj = ''
    })
    const cnpjPorNomeNoProdio = Object.fromEntries(primeiro.payload.fornecedores.map((f) => [f.nome, f.cnpj]))
    const segundo = planejar(
      (b) => {
        b.fornecedores[1].cnpj = ''
        b.kaminoForn = {}
      },
      { cnpjPorNomeNoProdio },
    )
    expect(segundo.payload).toEqual(primeiro.payload)
  })
  it('a ordem das seções no arquivo não muda o payload', () => {
    const invertido = planejar((b) => {
      b.insumos.reverse()
      b.fornecedores.reverse()
      b.products.reverse()
    })
    const normal = planejar()
    expect(invertido.payload.insumos).toEqual(normal.payload.insumos)
    expect(invertido.payload.produtos).toEqual(normal.payload.produtos)
    expect(invertido.payload.fornecedores).toEqual(normal.payload.fornecedores)
    expect(invertido.payload.vinculos).toEqual(normal.payload.vinculos)
  })
})
