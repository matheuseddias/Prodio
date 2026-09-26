// Ponta a ponta da importação do ES com o backup sintético (dados inventados; ver fixtures/backup-es-sintetico.json).
// O payload gerado vira fixture do teste de banco (supabase/tests/0013_import_catalog.test.sql) por snapshot.
import { ENTIDADES_IMPORTACAO, planejarImportacaoES } from './importacaoEs'
import { backupSintetico, HOJE, jsonUmItemPorLinha, mensagensDe, planejar, situacaoDe } from './importacaoEs/fixtura'

describe('planejarImportacaoES · backup sintético', () => {
  const plano = planejar()

  it('aceita o backup e gera o payload estável (fixture do teste de banco)', async () => {
    expect(plano.aceito).toBe(true)
    await expect(jsonUmItemPorLinha(plano.payload)).toMatchFileSnapshot('./fixtures/payload-es-sintetico.json')
  })

  it('conta o que tem no arquivo e o que entra por entidade', () => {
    const resumo = Object.fromEntries(ENTIDADES_IMPORTACAO.map((e) => [e, [plano.contagens[e].noArquivo, plano.contagens[e].entram]]))
    expect(resumo).toEqual({
      fornecedor: [3, 3],
      insumo: [8, 8],
      produto: [5, 5],
      apelido: [1, 1],
      vinculo: [6, 6],
      ficha: [6, 5],
    })
    expect(Object.values(plano.contagens).every((c) => c.problemas === 0)).toBe(true)
  })

  it('origem: data pelo nome do arquivo, idade, sentido TM→ED e seções que ficam de fora', () => {
    expect(plano.origem.dataArquivo).toBe('2026-09-24')
    expect(plano.origem.idadeDias).toBe(2)
    expect(plano.origem.sentidoDepara).toBe('TM→ED')
    const secoes = plano.origem.ignorado.map((s) => s.secao)
    expect(secoes).toContain('Usuários do ES (e senhas)')
    expect(secoes).toContain('Ordens de compra')
    expect(plano.origem.ignorado.find((s) => s.secao.startsWith('Saldo de estoque dos insumos'))?.itens).toBe(7)
    expect(plano.avisosGerais).toEqual([])
  })

  it('backup velho gera aviso geral; sem data no nome, estima pela última movimentação', () => {
    const velho = planejar(undefined, { hoje: '2026-10-10' })
    expect(velho.origem.idadeDias).toBe(16)
    expect(velho.avisosGerais.some((a) => a.includes('16 dias'))).toBe(true)
    const semNome = planejarImportacaoES(backupSintetico(), { hoje: HOJE })
    expect(semNome.origem.dataArquivo).toBe('2026-09-24')
    expect(semNome.avisosGerais.some((a) => a.includes('estimada pela última movimentação'))).toBe(true)
  })

  it('fornecedor sem CNPJ no cadastro é resolvido pelo kaminoForn, com aviso', () => {
    const f = plano.payload.fornecedores.find((x) => x.nome === 'Tecidos Modelo Ind. e Com.')
    expect(f?.cnpj).toBe('12345678000195')
    expect(mensagensDe(plano, 'fornecedor', '12345678000195')).toContain('CNPJ achado nas notas')
  })

  it('de/para TM→ED: ED é o principal, TM vira apelido e a ficha espelhada do TM é ignorada', () => {
    const ed = plano.payload.produtos.find((p) => p.sku === 'ED900001')
    expect(ed?.apelidos).toEqual(['TM900002'])
    expect(plano.payload.produtos.some((p) => p.sku === 'TM900002')).toBe(false)
    expect(mensagensDe(plano, 'produto', 'ED900001').some((m) => m.includes('ficha espelhada de TM900002 ignorada'))).toBe(true)
    expect(plano.payload.fichas.some((f) => f.produto_sku === 'TM900002')).toBe(false)
  })

  it('TM que sobrou no formato legado de 9 campos entra como produto próprio, inativo, com EAN numérico', () => {
    const tm = plano.payload.produtos.find((p) => p.sku === 'TM900001')
    expect(tm).toMatchObject({ status: 'inativo', ean: '2000000000091', familia: 'Bandeja', atributos: { cor: 'Dourado', tamanho: '30cm' } })
    expect(tm?.custo_manual).toBeUndefined() // tem ficha: o custo vem dela
  })

  it('ficha com componente fabricado (pino 3D) e kit (2× mousepad + saco)', () => {
    const espelho = plano.payload.fichas.find((f) => f.produto_sku === 'ED900001')
    expect(espelho?.linhas[0]).toEqual({ tipo: 'produto', componente_sku: 'ED900002', consumo: 2, unidade: 'un', perda_pct: 0 })
    const kit = plano.payload.fichas.find((f) => f.produto_sku === 'ED900004')
    expect(kit?.linhas.map((l) => [l.tipo, l.componente_sku ?? l.insumo_sku, l.consumo])).toEqual([
      ['produto', 'ED900003', 2],
      ['insumo', 'MP9008', 1],
    ])
  })

  it('todas as linhas de ficha vão com perda_pct 0 (o consumo do ES já inclui a perda)', () => {
    const perdas = plano.payload.fichas.flatMap((f) => f.linhas.map((l) => l.perda_pct))
    expect(perdas.length).toBeGreaterThan(0)
    expect(new Set(perdas)).toEqual(new Set([0]))
  })

  it('avisos das fichas: unidade desatualizada, consumo editado à mão, linha zerada e linhas somadas', () => {
    expect(situacaoDe(plano, 'ficha', 'ED900001')).toBe('aviso')
    expect(mensagensDe(plano, 'ficha', 'ED900001').some((m) => m.includes('unidade da linha estava desatualizada'))).toBe(true)
    expect(mensagensDe(plano, 'ficha', 'ED900003').some((m) => m.includes('consumo editado à mão'))).toBe(true)
    const tm = mensagensDe(plano, 'ficha', 'TM900001')
    expect(tm.some((m) => m.includes('consumo zero descartada'))).toBe(true)
    expect(tm.some((m) => m.includes('linhas repetidas somadas'))).toBe(true)
    const linhasTm = plano.payload.fichas.find((f) => f.produto_sku === 'TM900001')?.linhas
    expect(linhasTm?.map((l) => [l.insumo_sku, l.consumo])).toEqual([
      ['MP9001', 0.0707],
      ['MP9005', 0.02],
    ])
  })

  it('linhas da prévia levam nome e as fichas o nome do produto', () => {
    expect(plano.linhas.find((l) => l.entidade === 'insumo' && l.chave === 'MP9001')?.nome).toBe('Chapa Espelho 3mm 3,21x2,40 (exemplo)')
    expect(plano.linhas.find((l) => l.entidade === 'ficha' && l.chave === 'ED900003')?.nome).toBe('MousePad 90x40cm Sintético - Preto')
  })
})

describe('planejarImportacaoES · recusas', () => {
  it('recusa o que não é backup do ES', () => {
    for (const x of [null, 42, 'texto', [], { products: [] }, { insumos: [] }]) {
      const p = planejarImportacaoES(x)
      expect(p.aceito).toBe(false)
      expect(p.payload.produtos).toEqual([])
    }
  })
  it('recusa backup sem produtos', () => {
    const p = planejar((b) => {
      b.products = []
    })
    expect(p.aceito).toBe(false)
    expect(p.recusa).toMatch(/nenhum produto/)
  })
  it('recusa backup que caiu no SEED do ES (10 SKUs fixos)', () => {
    const seed = ['ED000001', 'ED000002', 'ED000004', 'ED000007', 'ED000008', 'ED000009', 'ED000010', 'ED000011', 'TM000073', 'TM000076']
    const p = planejar((b) => {
      b.products = seed.map((sku) => ({ sku, nome: `Produto ${sku}` }))
    })
    expect(p.aceito).toBe(false)
    expect(p.recusa).toMatch(/exemplo do ES/)
  })
  it('backup sem insumos e sem fichas: aceita, com aviso forte', () => {
    const p = planejar((b) => {
      b.insumos = []
      b.bom = []
    })
    expect(p.aceito).toBe(true)
    expect(p.avisosGerais.some((a) => a.includes('não tem insumos'))).toBe(true)
    expect(p.avisosGerais.some((a) => a.includes('não tem fichas técnicas'))).toBe(true)
  })
})
