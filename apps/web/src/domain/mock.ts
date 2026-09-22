import type {
  Bom,
  Channel,
  Connector,
  DailyPlanLine,
  Device,
  Label,
  Location,
  Material,
  Member,
  NfeInbound,
  Notification,
  Operator,
  OutboxItem,
  Product,
  PurchaseOrder,
  ScanEvent,
  StockMove,
  Supplier,
  Tenant,
  Unit,
} from './types'
import { diaISO as diaLocal, diaProducao } from './format'

const hoje = new Date()
/** Hora de virada do tenant de demonstração; o dia dos dados de exemplo sai dela. */
const HORA_VIRADA = '05:00'
const iso = (d: Date) => d.toISOString()
const diasAtras = (n: number, h = 9) => {
  const d = new Date(hoje)
  d.setDate(d.getDate() - n)
  d.setHours(h, 0, 0, 0)
  return iso(d)
}
const hojeAs = (h: number, m = 0) => {
  const d = new Date(hoje)
  d.setHours(h, m, 0, 0)
  return iso(d)
}
// Mesmo dia de produção que as telas usam para filtrar: com o dia em UTC os dados de exemplo
// desapareciam da madrugada até as 05:00.
const diaISO = diaProducao(HORA_VIRADA, hoje)
const diaCompacto = diaISO.replace(/-/g, '').slice(2)

export const tenant: Tenant = {
  id: 't1',
  nome: 'Eddias Home',
  cnpj: '44664451000107',
  regime: 'real',
  creditaImpostos: false,
  horaVirada: HORA_VIRADA,
  diasUteisMes: 22,
  margemProjecao: 0.1,
  diasCobertura: 15,
  margemAlvoPadrao: 0.2,
  exigirProjecaoParaImprimir: true,
  perfisEtiqueta: [
    { familia: 'Espelho', prefixo: 'EH', tipos: ['produto', 'montagem'], unidadesPorCaixa: 6, instrucaoMontagem: 'Fixar alça a 118 mm da borda · conferir lapidação' },
    { familia: 'Mousepad', prefixo: 'ED', tipos: ['produto'], unidadesPorCaixa: 20 },
    { familia: 'Bandeja', prefixo: 'EH', tipos: ['produto', 'caixa'], unidadesPorCaixa: 4 },
    { familia: 'Mesa', prefixo: 'ED', tipos: ['produto'], unidadesPorCaixa: 10 },
  ],
}

export const locations: Location[] = [
  { id: 'l1', nome: 'Galpão Vila Galvão', tipo: 'fabrica' },
  { id: 'l2', nome: 'Galpão Pedro de Souza', tipo: 'fabrica' },
  { id: 'l3', nome: 'Estamparia Silva (terceiro)', tipo: 'terceiro' },
]

export const units: Unit[] = [
  { code: 'un', nome: 'Unidade', tipo: 'unidade' },
  { code: 'm', nome: 'Metro', tipo: 'comprimento' },
  { code: 'm2', nome: 'Metro quadrado', tipo: 'area' },
  { code: 'kg', nome: 'Quilograma', tipo: 'peso' },
  { code: 'g', nome: 'Grama', tipo: 'peso' },
  { code: 'cx', nome: 'Caixa', tipo: 'unidade' },
  { code: 'rl', nome: 'Rolo', tipo: 'unidade' },
  { code: 'ct', nome: 'Cento', tipo: 'unidade' },
]

export const products: Product[] = [
  { id: 'p1', sku: 'TM000076', nome: 'Espelho Redondo Adnet 40cm', familia: 'Espelho', atributos: { cor: 'Preto', tamanho: '40cm' }, ean: '7898676461347', ncm: '7009.91.00', status: 'ativo', aliases: ['ED000130'], temFicha: true, custoFicha: 10.71, pesoKg: 1.9, pesoCubadoKg: 2.4, precoVenda: {ch1: 129.9, ch2: 119.9} },
  { id: 'p2', sku: 'TM000073', nome: 'Espelho Redondo Adnet 50cm', familia: 'Espelho', atributos: { cor: 'Preto', tamanho: '50cm' }, ean: '7898676463402', ncm: '7009.91.00', status: 'ativo', aliases: ['ED000127'], temFicha: true, custoFicha: 16.14, pesoKg: 2.8, pesoCubadoKg: 3.6, precoVenda: {ch1: 169.9, ch2: 159.9} },
  { id: 'p3', sku: 'TM000079', nome: 'Espelho Redondo Adnet 60cm', familia: 'Espelho', atributos: { cor: 'Preto', tamanho: '60cm' }, status: 'ativo', aliases: ['ED000215'], temFicha: true, custoFicha: 24.9, pesoKg: 3.9, pesoCubadoKg: 5.1, precoVenda: {ch1: 229.9} },
  { id: 'p4', sku: 'TM000091', nome: 'Espelho Redondo Adnet 40cm', familia: 'Espelho', atributos: { cor: 'Caramelo', tamanho: '40cm' }, status: 'ativo', aliases: ['ED000240'], temFicha: true, custoFicha: 11.02, pesoKg: 1.9, pesoCubadoKg: 2.4, precoVenda: {ch1: 134.9} },
  { id: 'p5', sku: 'ED000001', nome: 'Mouse Pad Desk Pad 90x40', familia: 'Mousepad', atributos: { cor: 'Preto', tamanho: '90x40' }, ean: '7898676460951', ncm: '5603.94.10', status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.38, pesoKg: 0.45, pesoCubadoKg: 0.9, precoVenda: {ch1: 49.9, ch2: 44.9, ch3: 54.9} },
  { id: 'p6', sku: 'ED000008', nome: 'Mouse Pad Desk Pad 90x40', familia: 'Mousepad', atributos: { cor: 'Caramelo', tamanho: '90x40' }, status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.38, pesoKg: 0.45, pesoCubadoKg: 0.9, precoVenda: {ch1: 49.9, ch2: 44.9} },
  { id: 'p7', sku: 'ED000002', nome: 'Mouse Pad Desk Pad 90x40', familia: 'Mousepad', atributos: { cor: 'Grafite', tamanho: '90x40' }, status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.37, pesoKg: 0.45, pesoCubadoKg: 0.9, precoVenda: {ch1: 49.9} },
  { id: 'p8', sku: 'ED000010', nome: 'Mouse Pad 20x20', familia: 'Mousepad', atributos: { cor: 'Caramelo', tamanho: '20x20' }, status: 'ativo', aliases: [], temFicha: true, custoFicha: 0.82, pesoKg: 0.08, pesoCubadoKg: 0.2, precoVenda: {ch2: 14.9} },
  { id: 'p9', sku: 'TM000120', nome: 'Espelho Orgânico Nuvem 50cm', familia: 'Espelho', atributos: { cor: 'Off White', tamanho: '50cm' }, status: 'ativo', aliases: ['ED000376'], temFicha: false },
  { id: 'p10', sku: 'ED000707', nome: 'Kit Jogo Americano 4 peças', familia: 'Mesa', atributos: { cor: 'Preto' }, status: 'ativo', aliases: [], temFicha: false },
  { id: 'p11', sku: 'TM000200', nome: 'Bandeja Espelhada 30cm', familia: 'Bandeja', atributos: { cor: 'Dourado', tamanho: '30cm' }, status: 'inativo', aliases: [], temFicha: true, custoFicha: 9.4 },
]

export const suppliers: Supplier[] = [
  { id: 's1', nome: 'Vidros Guarulhos Ltda', cnpj: '12345678000190', regime: 'normal', leadTimeDias: 7, condicaoPagamento: [28, 42], contato: 'Marcos' },
  { id: 's2', nome: 'Montana Tecidos Sintéticos', cnpj: '23456789000101', regime: 'normal', leadTimeDias: 12, condicaoPagamento: [30, 60], contato: 'Renata' },
  { id: 's3', nome: 'Embalagens Paulista', cnpj: '34567890000112', regime: 'simples', leadTimeDias: 5, condicaoPagamento: [21], contato: 'Sérgio' },
  { id: 's4', nome: 'Promabonde Adesivos', cnpj: '45678901000123', regime: 'normal', leadTimeDias: 10, condicaoPagamento: [30], contato: 'Luciana' },
  { id: 's5', nome: 'Ferragens & Cia', cnpj: '56789012000134', regime: 'simples', leadTimeDias: 3, condicaoPagamento: [0], contato: 'Paulo' },
]

export const materials: Material[] = [
  { id: 'm1', sku: 'MP0078', nome: 'Chapa espelho 3mm 3,21x2,4', unidadeCompra: 'un', unidadeConsumo: 'm2', fatorConversao: 7.7, ncm: '7009.91.00', minimo: 40, saldo: 61.4, custoMedio: 33.43, fornecedorPadraoId: 's1', leadTimeDias: 7 },
  { id: 'm2', sku: 'MP0040', nome: 'Montana Rockl Preto', unidadeCompra: 'rl', unidadeConsumo: 'm2', fatorConversao: 70, minimo: 30, saldo: 18.5, custoMedio: 29.53, fornecedorPadraoId: 's2', leadTimeDias: 12 },
  { id: 'm3', sku: 'MP0117', nome: 'EBF Montave Caramelo 1,7mm', unidadeCompra: 'rl', unidadeConsumo: 'm', fatorConversao: 50, minimo: 60, saldo: 122, custoMedio: 22.07, fornecedorPadraoId: 's2', leadTimeDias: 12 },
  { id: 'm4', sku: 'MP0068', nome: 'EBF Montave Preto 1,7mm', unidadeCompra: 'rl', unidadeConsumo: 'm', fatorConversao: 50, minimo: 80, saldo: 41, custoMedio: 22.07, fornecedorPadraoId: 's2', leadTimeDias: 12 },
  { id: 'm5', sku: 'MP0064', nome: 'Caixa embalagem espelho 40cm', unidadeCompra: 'cx', unidadeConsumo: 'un', fatorConversao: 25, minimo: 300, saldo: 875, custoMedio: 2.54, fornecedorPadraoId: 's3', leadTimeDias: 5 },
  { id: 'm6', sku: 'MP0063', nome: 'Caixa embalagem espelho 50cm', unidadeCompra: 'cx', unidadeConsumo: 'un', fatorConversao: 20, minimo: 200, saldo: 140, custoMedio: 3.66, fornecedorPadraoId: 's3', leadTimeDias: 5 },
  { id: 'm7', sku: 'MP0072', nome: 'Cola Promabonde 793 (cx 100 tubos)', unidadeCompra: 'cx', unidadeConsumo: 'cx', fatorConversao: 1, minimo: 2, saldo: 3.4, custoMedio: 411.51, fornecedorPadraoId: 's4', leadTimeDias: 10 },
  { id: 'm8', sku: 'MP0056', nome: 'Disco MDF 470x470x8', unidadeCompra: 'un', unidadeConsumo: 'un', fatorConversao: 1, minimo: 400, saldo: 1210, custoMedio: 1.07, fornecedorPadraoId: 's1', leadTimeDias: 7 },
  { id: 'm9', sku: 'MP0059', nome: 'Disco MDF 370x370x8', unidadeCompra: 'un', unidadeConsumo: 'un', fatorConversao: 1, minimo: 400, saldo: 380, custoMedio: 0.52, fornecedorPadraoId: 's1', leadTimeDias: 7 },
  { id: 'm10', sku: 'MP0061', nome: 'Parafuso chipboard 4,0x40', unidadeCompra: 'ct', unidadeConsumo: 'un', fatorConversao: 100, minimo: 2000, saldo: 6400, custoMedio: 0.1, fornecedorPadraoId: 's5', leadTimeDias: 3 },
  { id: 'm11', sku: 'MP0067', nome: 'Bucha plástica S6', unidadeCompra: 'ct', unidadeConsumo: 'un', fatorConversao: 100, minimo: 2000, saldo: 1900, custoMedio: 0.02, fornecedorPadraoId: 's5', leadTimeDias: 3 },
  { id: 'm12', sku: 'MP0017', nome: 'Suede Leggero Preto', unidadeCompra: 'rl', unidadeConsumo: 'm', fatorConversao: 50, minimo: 100, saldo: 260, custoMedio: 8.28, fornecedorPadraoId: 's2', leadTimeDias: 12 },
  { id: 'm13', sku: 'MP0033', nome: 'Filamento PETG 1kg Preto', unidadeCompra: 'un', unidadeConsumo: 'kg', fatorConversao: 1, minimo: 4, saldo: 6.2, custoMedio: 51.31, fornecedorPadraoId: 's5', leadTimeDias: 3 },
]

export const boms: Bom[] = [
  { productId: 'p1', versao: 3, ativa: true, atualizadoEm: diasAtras(12), linhas: [
    { id: 'b1', tipo: 'insumo', materialId: 'm9', consumo: 2, unidade: 'un', perdaPct: 0 },
    { id: 'b2', tipo: 'insumo', materialId: 'm1', consumo: 0.16, unidade: 'm2', perdaPct: 8 },
    { id: 'b3', tipo: 'insumo', materialId: 'm2', consumo: 0.043, unidade: 'm2', perdaPct: 5 },
    { id: 'b4', tipo: 'insumo', materialId: 'm7', consumo: 0.00025, unidade: 'cx', perdaPct: 0 },
    { id: 'b5', tipo: 'insumo', materialId: 'm5', consumo: 1, unidade: 'un', perdaPct: 0 },
    { id: 'b6', tipo: 'insumo', materialId: 'm10', consumo: 1, unidade: 'un', perdaPct: 0 },
    { id: 'b7', tipo: 'insumo', materialId: 'm11', consumo: 1, unidade: 'un', perdaPct: 0 },
    { id: 'b8', tipo: 'insumo', materialId: 'm13', consumo: 0.00416, unidade: 'kg', perdaPct: 0 },
  ] },
  { productId: 'p2', versao: 2, ativa: true, atualizadoEm: diasAtras(30), linhas: [
    { id: 'b9', tipo: 'insumo', materialId: 'm8', consumo: 2, unidade: 'un', perdaPct: 0 },
    { id: 'b10', tipo: 'insumo', materialId: 'm1', consumo: 0.25, unidade: 'm2', perdaPct: 8 },
    { id: 'b11', tipo: 'insumo', materialId: 'm2', consumo: 0.05, unidade: 'm2', perdaPct: 5 },
    { id: 'b12', tipo: 'insumo', materialId: 'm7', consumo: 0.00025, unidade: 'cx', perdaPct: 0 },
    { id: 'b13', tipo: 'insumo', materialId: 'm6', consumo: 1, unidade: 'un', perdaPct: 0 },
    { id: 'b14', tipo: 'insumo', materialId: 'm10', consumo: 1, unidade: 'un', perdaPct: 0 },
    { id: 'b15', tipo: 'insumo', materialId: 'm11', consumo: 1, unidade: 'un', perdaPct: 0 },
  ] },
  { productId: 'p5', versao: 1, ativa: true, atualizadoEm: diasAtras(60), linhas: [
    { id: 'b16', tipo: 'insumo', materialId: 'm4', consumo: 0.334, unidade: 'm', perdaPct: 3 },
    { id: 'b17', tipo: 'insumo', materialId: 'm12', consumo: 0.309, unidade: 'm', perdaPct: 3 },
  ] },
  { productId: 'p6', versao: 1, ativa: true, atualizadoEm: diasAtras(60), linhas: [
    { id: 'b18', tipo: 'insumo', materialId: 'm3', consumo: 0.334, unidade: 'm', perdaPct: 3 },
    { id: 'b19', tipo: 'insumo', materialId: 'm12', consumo: 0.309, unidade: 'm', perdaPct: 3 },
  ] },
]

export const dailyPlan: DailyPlanLine[] = [
  { productId: 'p1', demandaDia: 74, projetado: 80, impresso: 80, bipado: 63, carteira: 58, saldoHub: 212 },
  { productId: 'p2', demandaDia: 71, projetado: 70, impresso: 70, bipado: 70, carteira: 49, saldoHub: 96 },
  { productId: 'p3', demandaDia: 22, projetado: 25, impresso: 25, bipado: 11, carteira: 30, saldoHub: 14 },
  { productId: 'p4', demandaDia: 18, projetado: 18, impresso: 0, bipado: 0, carteira: 12, saldoHub: 140 },
  { productId: 'p5', demandaDia: 46, projetado: 50, impresso: 50, bipado: 42, carteira: 31, saldoHub: 388 },
  { productId: 'p6', demandaDia: 24, projetado: 24, impresso: 24, bipado: 24, carteira: 9, saldoHub: 120 },
  { productId: 'p7', demandaDia: 12, projetado: 12, impresso: 12, bipado: 5, carteira: 3, saldoHub: 77 },
  { productId: 'p8', demandaDia: 5, projetado: 0, impresso: 0, bipado: 0, carteira: 0, saldoHub: 260 },
]

const mkSerial = (prefix: string, sku: string, seq: number) =>
  `${prefix}${sku}${diaCompacto}${String(seq).padStart(4, '0')}`

export const labels: Label[] = []
for (const line of dailyPlan) {
  const p = products.find((x) => x.id === line.productId)!
  const prefix = p.familia === 'Espelho' ? 'EH' : 'ED'
  for (let i = 1; i <= line.impresso; i++) {
    labels.push({ serial: mkSerial(prefix, p.sku, i), productId: p.id, tipo: 'unidade', quantidade: 1, status: 'impressa', dia: diaISO, seq: i })
  }
}

const operadores = ['Thiago', 'Sérgio', 'Lucas']
export const scans: ScanEvent[] = []
let scanSeq = 1
for (const line of dailyPlan) {
  const p = products.find((x) => x.id === line.productId)!
  const prefix = p.familia === 'Espelho' ? 'EH' : 'ED'
  for (let i = 1; i <= line.bipado; i++) {
    const h = 7 + Math.floor((i / Math.max(line.bipado, 1)) * 8)
    const m = (i * 7) % 60
    scans.push({
      id: `sc${scanSeq++}`,
      serial: mkSerial(prefix, p.sku, i),
      productId: p.id,
      operador: operadores[i % operadores.length],
      dispositivo: i % 3 === 0 ? 'Tablet doca' : 'Celular linha 1',
      etapa: 'final',
      tipo: 'produzido',
      quantidade: 1,
      em: hojeAs(h, m),
      competencia: diaISO,
      sincronizado: !(line.productId === 'p3' && i > 8),
    })
  }
}

export const stockMoves: StockMove[] = [
  { id: 'mv1', materialId: 'm1', tipo: 'entrada_nfe', delta: 38.5, custoUnit: 33.43, ref: 'NF-e 48211', por: 'Lucas', em: diasAtras(6, 10) },
  { id: 'mv2', materialId: 'm1', tipo: 'baixa_producao', delta: -22.3, ref: 'Fechamento', por: 'sistema', em: diasAtras(5, 18) },
  { id: 'mv3', materialId: 'm1', tipo: 'baixa_producao', delta: -24.1, ref: 'Fechamento', por: 'sistema', em: diasAtras(4, 18) },
  { id: 'mv4', materialId: 'm1', tipo: 'perda', delta: -1.2, motivo: 'Quebra', por: 'Thiago', em: diasAtras(3, 14) },
  { id: 'mv5', materialId: 'm1', tipo: 'ajuste', delta: 2.4, motivo: 'Conciliação de chapas', por: 'Encarregada', em: diasAtras(2, 17) },
  { id: 'mv6', materialId: 'm1', tipo: 'baixa_producao', delta: -19.8, ref: 'Fechamento', por: 'sistema', em: diasAtras(1, 18) },
  { id: 'mv7', materialId: 'm2', tipo: 'baixa_producao', delta: -6.9, ref: 'Fechamento', por: 'sistema', em: diasAtras(1, 18) },
  { id: 'mv8', materialId: 'm6', tipo: 'baixa_producao', delta: -70, ref: 'Fechamento', por: 'sistema', em: diasAtras(1, 18) },
  { id: 'mv9', materialId: 'm4', tipo: 'entrada_nfe', delta: 100, custoUnit: 22.07, ref: 'NF-e 9102', por: 'Lucas', em: diasAtras(9, 11) },
  { id: 'mv10', materialId: 'm4', tipo: 'baixa_producao', delta: -16.7, ref: 'Fechamento', por: 'sistema', em: diasAtras(1, 18) },
  { id: 'mv11', materialId: 'm9', tipo: 'baixa_producao', delta: -160, ref: 'Fechamento', por: 'sistema', em: diasAtras(1, 18) },
  { id: 'mv12', materialId: 'm11', tipo: 'estorno', delta: 100, ref: 'Estorno mv-old', por: 'Encarregada', em: diasAtras(2, 9) },
]

export const purchaseOrders: PurchaseOrder[] = [
  { id: 'oc1', numero: 1041, supplierId: 's1', status: 'aberta', criadaEm: diasAtras(6), entregaPrevista: diaISO, condicaoPagamento: [28, 42], itens: [
    { id: 'oci1', materialId: 'm1', unidadeCompra: 'un', fator: 7.7, qtd: 12, qtdRecebida: 0, preco: 257.4, ipiPct: 10 },
    { id: 'oci2', materialId: 'm9', unidadeCompra: 'un', fator: 1, qtd: 800, qtdRecebida: 0, preco: 0.52, ipiPct: 0 },
  ] },
  { id: 'oc2', numero: 1042, supplierId: 's3', status: 'aberta', criadaEm: diasAtras(4), entregaPrevista: diaISO, condicaoPagamento: [21], itens: [
    { id: 'oci3', materialId: 'm6', unidadeCompra: 'cx', fator: 20, qtd: 30, qtdRecebida: 0, preco: 73.2, ipiPct: 15 },
  ] },
  { id: 'oc3', numero: 1039, supplierId: 's2', status: 'parcial', criadaEm: diasAtras(14), entregaPrevista: diasAtras(2).slice(0, 10), condicaoPagamento: [30, 60], itens: [
    { id: 'oci4', materialId: 'm2', unidadeCompra: 'rl', fator: 70, qtd: 3, qtdRecebida: 1, preco: 2067.1, ipiPct: 0 },
    { id: 'oci5', materialId: 'm4', unidadeCompra: 'rl', fator: 50, qtd: 4, qtdRecebida: 4, preco: 1103.5, ipiPct: 10 },
  ] },
  { id: 'oc4', numero: 1043, supplierId: 's5', status: 'aberta', criadaEm: diasAtras(1), entregaPrevista: diasAtras(-2).slice(0, 10), condicaoPagamento: [0], itens: [
    { id: 'oci6', materialId: 'm11', unidadeCompra: 'ct', fator: 100, qtd: 40, qtdRecebida: 0, preco: 2.31, ipiPct: 0 },
  ] },
  { id: 'oc5', numero: 1035, supplierId: 's4', status: 'recebida', criadaEm: diasAtras(25), entregaPrevista: diasAtras(12).slice(0, 10), condicaoPagamento: [30], itens: [
    { id: 'oci7', materialId: 'm7', unidadeCompra: 'cx', fator: 1, qtd: 3, qtdRecebida: 3, preco: 553, ipiPct: 0 },
  ] },
  { id: 'oc6', numero: 1030, supplierId: 's2', status: 'cancelada', criadaEm: diasAtras(40), condicaoPagamento: [30, 60], itens: [
    { id: 'oci8', materialId: 'm12', unidadeCompra: 'rl', fator: 50, qtd: 2, qtdRecebida: 0, preco: 414, ipiPct: 0 },
  ] },
]

export const nfes: NfeInbound[] = [
  { chave: '35260912345678000190550010000482111000482119', numero: 48211, serie: 1, cnpjEmitente: '12345678000190', emitente: 'Vidros Guarulhos Ltda', supplierId: 's1', emissao: diasAtras(1), valorTotal: 3504.8, origem: 'email', status: 'pendente', poIds: ['oc1'], itens: [
    { nItem: 1, cProd: 'CH3MM-321', xProd: 'CHAPA ESPELHO 3MM 3210X2400', ncm: '70099100', cfop: '5401', uCom: 'PC', qCom: 12, vUnCom: 257.4, vProd: 3088.8, materialId: 'm1', fator: 7.7, qtdConsumo: 92.4 },
    { nItem: 2, cProd: 'MDF370', xProd: 'DISCO MDF 370X370X8MM', ncm: '44111400', cfop: '5102', uCom: 'UN', qCom: 800, vUnCom: 0.52, vProd: 416, materialId: 'm9', fator: 1, qtdConsumo: 800 },
  ] },
  { chave: '35260934567890000112550010000091020000091025', numero: 9102, serie: 1, cnpjEmitente: '34567890000112', emitente: 'Embalagens Paulista', supplierId: 's3', emissao: diasAtras(0), valorTotal: 2196, origem: 'upload', status: 'pendente', poIds: ['oc2'], itens: [
    { nItem: 1, cProd: 'CX-ESP-50', xProd: 'CAIXA PAPELAO ESPELHO 50', ncm: '48191000', cfop: '5102', uCom: 'CX', qCom: 30, vUnCom: 73.2, vProd: 2196, materialId: 'm6', fator: 20, qtdConsumo: 600 },
  ] },
  { chave: '35260923456789000101550020000007740000007741', numero: 774, serie: 2, cnpjEmitente: '23456789000101', emitente: 'Montana Tecidos Sintéticos', supplierId: 's2', emissao: diasAtras(2), valorTotal: 4134.2, origem: 'erp', status: 'pendente', poIds: ['oc3'], itens: [
    { nItem: 1, cProd: 'ROCKL-PT', xProd: 'TECIDO SINTETICO ROCKL PRETO 1,40', ncm: '59031000', cfop: '6102', uCom: 'RL', qCom: 2, vUnCom: 2067.1, vProd: 4134.2, materialId: undefined, fator: undefined },
  ] },
  { chave: '35260956789012000134550010000120330000120338', numero: 12033, serie: 1, cnpjEmitente: '56789012000134', emitente: 'Ferragens & Cia', supplierId: 's5', emissao: diasAtras(0), valorTotal: 92.4, origem: 'sem_xml', status: 'aguardando_xml', poIds: ['oc4'], itens: [] },
  { chave: '35260945678901000123550010000031100000031104', numero: 3110, serie: 1, cnpjEmitente: '45678901000123', emitente: 'Promabonde Adesivos', supplierId: 's4', emissao: diasAtras(13), valorTotal: 1659, origem: 'email', status: 'recebida', poIds: ['oc5'], itens: [
    { nItem: 1, cProd: '793-CX100', xProd: 'ADESIVO PROMABONDE 793 CX 100', ncm: '35069190', cfop: '5102', uCom: 'CX', qCom: 3, vUnCom: 553, vProd: 1659, materialId: 'm7', fator: 1, qtdConsumo: 3 },
  ] },
  { chave: '35260912345678000190550010000481900000481905', numero: 48190, serie: 1, cnpjEmitente: '12345678000190', emitente: 'Vidros Guarulhos Ltda', supplierId: 's1', emissao: diasAtras(3), valorTotal: 120, origem: 'email', status: 'ignorada', poIds: [], itens: [
    { nItem: 1, cProd: 'SERV-CORTE', xProd: 'REMESSA PARA CONSERTO', ncm: '70099100', cfop: '5915', uCom: 'UN', qCom: 1, vUnCom: 120, vProd: 120 },
  ] },
]

export const connectors: Connector[] = [
  { id: 'c1', plataforma: 'baselinker', nome: 'Base.com (BaseLinker)', status: 'conectado', ultimoSync: diasAtras(0, hoje.getHours()), cursor: 'date_confirmed_from=…', pedidos24h: 412, outboxPendentes: 3, capacidades: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: true, nfeCompra: false } },
  { id: 'c2', plataforma: 'bling', nome: 'Bling', status: 'desconectado', capacidades: { pedidos: true, webhooks: true, catalogo: true, pushEstoque: true, pushCatalogo: true, nfeCompra: true } },
  { id: 'c3', plataforma: 'tiny', nome: 'Tiny / Olist', status: 'desconectado', capacidades: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: true, pushCatalogo: true, nfeCompra: true } },
  { id: 'c4', plataforma: 'omie', nome: 'Omie', status: 'desconectado', capacidades: { pedidos: true, webhooks: true, catalogo: true, pushEstoque: true, pushCatalogo: true, nfeCompra: true } },
  { id: 'c5', plataforma: 'magis5', nome: 'Magis5', status: 'desconectado', capacidades: { pedidos: true, webhooks: false, catalogo: true, pushEstoque: false, pushCatalogo: true, nfeCompra: false } },
]

export const outbox: OutboxItem[] = [
  { id: 'ob1', connectorId: 'c1', productId: 'p1', delta: 12, status: 'pendente', em: hojeAs(14, 5) },
  { id: 'ob2', connectorId: 'c1', productId: 'p3', delta: 3, status: 'pendente', em: hojeAs(14, 6) },
  { id: 'ob3', connectorId: 'c1', productId: 'p5', delta: 8, status: 'pendente', em: hojeAs(14, 7) },
  { id: 'ob4', connectorId: 'c1', productId: 'p2', delta: 20, status: 'aplicado', em: hojeAs(13, 0) },
  { id: 'ob5', connectorId: 'c1', productId: 'p7', delta: 5, status: 'erro', em: hojeAs(12, 30), erro: 'SKU não encontrado no inventário 24384' },
]

export const members: Member[] = [
  { id: 'u1', nome: 'Matheus Moreno', email: 'matheus@eddias.com.br', papel: 'admin', ultimoAcesso: hojeAs(8, 12) },
  { id: 'u2', nome: 'Gabrielle', email: 'gabrielle@eddias.com.br', papel: 'compras', ultimoAcesso: diasAtras(1, 16) },
  { id: 'u3', nome: 'Encarregada · Linha', email: 'producao@eddias.com.br', papel: 'producao', localId: 'l1', ultimoAcesso: hojeAs(7, 40) },
  { id: 'u4', nome: 'Contabilidade', email: 'contador@exemplo.com.br', papel: 'leitura', ultimoAcesso: diasAtras(7) },
]

export const devices: Device[] = [
  { id: 'd1', nome: 'Celular linha 1', localId: 'l1', registradoEm: diasAtras(40), ultimoBipe: hojeAs(14, 41), pendentesOffline: 0 },
  { id: 'd2', nome: 'Tablet doca', localId: 'l1', registradoEm: diasAtras(40), ultimoBipe: hojeAs(11, 3), pendentesOffline: 3 },
  { id: 'd3', nome: 'Celular linha 2', localId: 'l2', registradoEm: diasAtras(12), ultimoBipe: diasAtras(1, 17), pendentesOffline: 0 },
]

export const operators: Operator[] = [
  { id: 'op1', nome: 'Thiago', pin: '1234' },
  { id: 'op2', nome: 'Sérgio', pin: '2345' },
  { id: 'op3', nome: 'Lucas', pin: '3456' },
]

export const notifications: Notification[] = [
  { id: 'n1', tipo: 'minimo', texto: 'Montana Rockl Preto cruzou o mínimo (18,5 m² de 30)', em: hojeAs(9, 2), lida: false },
  { id: 'n2', tipo: 'minimo', texto: 'Caixa embalagem espelho 50cm cruzou o mínimo (140 de 200)', em: diasAtras(1, 18), lida: false },
  { id: 'n3', tipo: 'oc_atrasada', texto: 'OC 1039 (Montana) atrasada há 2 dias, 1 de 3 rolos recebidos', em: diasAtras(1, 8), lida: false },
  { id: 'n4', tipo: 'nfe', texto: 'NF-e 774 (Montana) tem 1 item sem De-Para', em: diasAtras(2, 11), lida: true },
  { id: 'n5', tipo: 'conector', texto: 'Base.com: 1 item do outbox com erro (SKU ED000002)', em: hojeAs(12, 31), lida: false },
  { id: 'n6', tipo: 'cadastro', texto: 'Espelho Orgânico Nuvem 50cm vendeu 34 un e não tem ficha', em: diasAtras(0, 6), lida: true },
]

export const vendas14d: { dia: string; unidades: number }[] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(hoje)
  d.setDate(d.getDate() - (13 - i))
  const dow = d.getDay()
  const base = dow === 0 || dow === 6 ? 180 : 320
  return { dia: diaLocal(d), unidades: base + ((i * 37) % 90) }
})

export const producao14d: { dia: string; projetado: number; produzido: number }[] = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(hoje)
  d.setDate(d.getDate() - (13 - i))
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return { dia: diaLocal(d), projetado: 0, produzido: 0 }
  const projetado = 260 + ((i * 23) % 60)
  const produzido = i === 13 ? 215 : projetado - 20 + ((i * 11) % 45)
  return { dia: diaLocal(d), projetado, produzido }
})

// Canais de venda: presets editáveis pelo cliente. Valores são de referência e devem ser conferidos.
export const channels: Channel[] = [
  { id: 'ch1', nome: 'Mercado Livre · Clássico', preset: 'mercadolivre', ativo: true, comissaoPct: 12, taxaFixa: 6, taxaFixaAbaixoDe: 79, freteVendedor: [{ ateKg: 0.3, valor: 0 }, { ateKg: 0.5, valor: 21.9 }, { ateKg: 1, valor: 23.9 }, { ateKg: 2, valor: 25.9 }, { ateKg: 3, valor: 27.9 }, { ateKg: 5, valor: 33.9 }, { ateKg: 9, valor: 51.9 }], freteGratisAcimaDe: 79, impostoVendaPct: 6, adsPct: 3, parcelamentoPct: 0, outrosPct: 0, observacao: 'Reputação verde. Confira a tabela vigente de Custo dos Envios.' },
  { id: 'ch2', nome: 'Shopee', preset: 'shopee', ativo: true, comissaoPct: 20, taxaFixa: 4, freteVendedor: [], impostoVendaPct: 6, adsPct: 2, parcelamentoPct: 0, outrosPct: 0, observacao: 'Comissão + programa de frete grátis. Taxa fixa por item vendido.' },
  { id: 'ch3', nome: 'Amazon · FBA', preset: 'amazon', ativo: true, comissaoPct: 15, taxaFixa: 0, freteVendedor: [{ ateKg: 0.5, valor: 14.9 }, { ateKg: 1, valor: 17.9 }, { ateKg: 2, valor: 21.9 }, { ateKg: 5, valor: 29.9 }], impostoVendaPct: 6, adsPct: 4, parcelamentoPct: 0, outrosPct: 0, observacao: 'Tarifa FBA por peso faturável.' },
  { id: 'ch4', nome: 'TikTok Shop', preset: 'tiktok', ativo: false, comissaoPct: 8, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 6, adsPct: 5, parcelamentoPct: 0, outrosPct: 0 },
  { id: 'ch5', nome: 'Atacado · loja própria', preset: 'atacado', ativo: true, comissaoPct: 0, taxaFixa: 0, freteVendedor: [], impostoVendaPct: 6, adsPct: 0, parcelamentoPct: 2.5, outrosPct: 1, observacao: 'Cliente retira. Parcelamento no cartão.' },
]
