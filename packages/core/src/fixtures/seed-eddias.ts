// Fixture real (anonimizada) da Eddias: produtos, insumos e fichas do sistema anterior (SEED do App.jsx).
// custoMedio dos insumos = custo líquido do cadastro antigo; vendas do período de 15 dias.
import type { Bom, Material, Product } from '../tipos'

export const SEED_PERIODO_DIAS = 15
export const SEED_MARGEM = 0.1

export const SEED_PRODUTOS: Product[] = [
  {id: 'ED000001', sku: 'ED000001', nome: 'MousePad 90x40cm Sintetico - Preto', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676460951', status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.38},
  {id: 'ED000002', sku: 'ED000002', nome: 'MousePad 90x40cm Sintetico - Grafite', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676460968', status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.37},
  {id: 'ED000004', sku: 'ED000004', nome: 'MousePad 90x40cm Sintetico - Bordô', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676461019', status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.37},
  {id: 'ED000007', sku: 'ED000007', nome: 'MousePad 90x40cm Sintetico - Rosa Claro', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676461781', status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.37},
  {id: 'ED000008', sku: 'ED000008', nome: 'MousePad 90x40cm Sintetico - Caramelo', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676460944', status: 'ativo', aliases: [], temFicha: true, custoFicha: 7.38},
  {id: 'ED000009', sku: 'ED000009', nome: 'MousePad 20x20 Sintético - Azul Marinho', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676461293', status: 'ativo', aliases: [], temFicha: true, custoFicha: 0.82},
  {id: 'ED000010', sku: 'ED000010', nome: 'MousePad 20x20 Sintetico - Caramelo', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676461248', status: 'ativo', aliases: [], temFicha: true, custoFicha: 0.82},
  {id: 'ED000011', sku: 'ED000011', nome: 'MousePad 20x20 Sintetico - Grafite', familia: 'Mousepad', atributos: {}, ncm: '5603.94.10', ean: '7898676461286', status: 'ativo', aliases: [], temFicha: true, custoFicha: 0.95},
  {id: 'TM000073', sku: 'TM000073', nome: 'Espelho Redondo Adnet 50cm - Preto', familia: 'Espelho', atributos: {}, ncm: '7009.91.00', ean: '7898676463402', status: 'ativo', aliases: [], temFicha: true, custoFicha: 16.14},
  {id: 'TM000076', sku: 'TM000076', nome: 'Espelho Redondo Adnet 40cm - Preto', familia: 'Espelho', atributos: {}, ncm: '7009.91.00', ean: '7898676461347', status: 'ativo', aliases: [], temFicha: true, custoFicha: 10.71},
]

export const SEED_MATERIAIS: Material[] = [
  {id: 'MP0014', sku: 'MP0014', nome: 'Alpes Lama Azul Marinho', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 13.77, leadTimeDias: 7},
  {id: 'MP0009', sku: 'MP0009', nome: 'Alpes Lama Bordô', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 13.77, leadTimeDias: 7},
  {id: 'MP0003', sku: 'MP0003', nome: 'Alpes Lama Caramelo', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 13.77, leadTimeDias: 7},
  {id: 'MP0004', sku: 'MP0004', nome: 'Alpes Lama Grafite', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 13.77, leadTimeDias: 7},
  {id: 'MP0010', sku: 'MP0010', nome: 'Alpes Lama Rosa Claro', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 13.77, leadTimeDias: 7},
  {id: 'MP0064', sku: 'MP0064', nome: 'Caixa Embalagem Espelho 40cm', unidadeCompra: 'Un', unidadeConsumo: 'Un', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 2.54, leadTimeDias: 7},
  {id: 'MP0063', sku: 'MP0063', nome: 'Caixa Embalagem Espelho 50cm', unidadeCompra: 'Un', unidadeConsumo: 'Un', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 3.66, leadTimeDias: 7},
  {id: 'MP0078', sku: 'MP0078', nome: 'Chapa Espelho 3mm 3, 21x2, 4 Cortada ao meio com ST', unidadeCompra: 'm2', unidadeConsumo: 'm2', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 33.43, leadTimeDias: 7},
  {id: 'MP0072', sku: 'MP0072', nome: 'Cola Promabonde 793 Cx 100 Tubos', unidadeCompra: 'Caixa', unidadeConsumo: 'Caixa', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 411.51, leadTimeDias: 7},
  {id: 'MP0040', sku: 'MP0040', nome: 'MONTANA ROCKL PRETO', unidadeCompra: 'm2', unidadeConsumo: 'm2', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 29.53, leadTimeDias: 7},
  {id: 'MP0112', sku: 'MP0112', nome: 'MONTANA ROCKL PRETO 1.5', unidadeCompra: 'm2', unidadeConsumo: 'm2', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 32.35, leadTimeDias: 7},
  {id: 'MP0017', sku: 'MP0017', nome: 'Suede Leggero SH Preto', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 8.28, leadTimeDias: 7},
  {id: 'MP0018', sku: 'MP0018', nome: 'Suede Leggero SH Bege', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 8.28, leadTimeDias: 7},
  {id: 'MP0033', sku: 'MP0033', nome: 'Filamento PETG 1Kg (Preto)', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 51.31, leadTimeDias: 7},
  {id: 'MP0056', sku: 'MP0056', nome: 'PR-011565 DISCO 470X470X8', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 1.07, leadTimeDias: 7},
  {id: 'MP0059', sku: 'MP0059', nome: 'PR-011567 DISCO 370X370X8', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 0.52, leadTimeDias: 7},
  {id: 'MP0061', sku: 'MP0061', nome: 'PARAFUSO CHIPBOARD CAB CHATA PH 4, 0 X 40', unidadeCompra: 'CT', unidadeConsumo: 'CT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 10.47, leadTimeDias: 7},
  {id: 'MP0067', sku: 'MP0067', nome: 'BUCHA PLASTICA S6', unidadeCompra: 'CT', unidadeConsumo: 'CT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 2.04, leadTimeDias: 7},
  {id: 'MP0068', sku: 'MP0068', nome: 'EBF MONTAVE PRETO 1.7MM', unidadeCompra: 'MT', unidadeConsumo: 'MT', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 22.07, leadTimeDias: 7},
  {id: 'MP0117', sku: 'MP0117', nome: 'EBF MONTAVE CARAMELO 1.7MM', unidadeCompra: 'Un', unidadeConsumo: 'Un', fatorConversao: 1, minimo: 0, saldo: 0, custoMedio: 22.07, leadTimeDias: 7},
]

export const SEED_BOMS: Bom[] = [
  {
    productId: 'ED000002', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000002-1', tipo: 'insumo', materialId: 'MP0004', consumo: 0.3342857143, unidade: 'MT', perdaPct: 0},
      {id: 'ED000002-2', tipo: 'insumo', materialId: 'MP0017', consumo: 0.30857, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000004', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000004-1', tipo: 'insumo', materialId: 'MP0009', consumo: 0.3342857143, unidade: 'MT', perdaPct: 0},
      {id: 'ED000004-2', tipo: 'insumo', materialId: 'MP0017', consumo: 0.30857, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000007', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000007-1', tipo: 'insumo', materialId: 'MP0010', consumo: 0.3342857143, unidade: 'MT', perdaPct: 0},
      {id: 'ED000007-2', tipo: 'insumo', materialId: 'MP0018', consumo: 0.3342857143, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000009', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000009-1', tipo: 'insumo', materialId: 'MP0014', consumo: 0.03714285714, unidade: 'MT', perdaPct: 0},
      {id: 'ED000009-2', tipo: 'insumo', materialId: 'MP0017', consumo: 0.028, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000010', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000010-1', tipo: 'insumo', materialId: 'MP0003', consumo: 0.03714285714, unidade: 'MT', perdaPct: 0},
      {id: 'ED000010-2', tipo: 'insumo', materialId: 'MP0017', consumo: 0.03714285714, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000011', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000011-1', tipo: 'insumo', materialId: 'MP0004', consumo: 0.03714285714, unidade: 'MT', perdaPct: 0},
      {id: 'ED000011-2', tipo: 'insumo', materialId: 'MP0017', consumo: 0.03714285714, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000001', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000001-1', tipo: 'insumo', materialId: 'MP0068', consumo: 0.3342857143, unidade: 'MT', perdaPct: 0},
    ],
  },
  {
    productId: 'ED000008', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'ED000008-1', tipo: 'insumo', materialId: 'MP0117', consumo: 0.3342857143, unidade: 'Un', perdaPct: 0},
    ],
  },
  {
    productId: 'TM000073', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'TM000073-1', tipo: 'insumo', materialId: 'MP0056', consumo: 2, unidade: 'MT', perdaPct: 0},
      {id: 'TM000073-2', tipo: 'insumo', materialId: 'MP0040', consumo: 0.05, unidade: 'm2', perdaPct: 0},
      {id: 'TM000073-3', tipo: 'insumo', materialId: 'MP0072', consumo: 0.00025, unidade: 'Caixa', perdaPct: 0},
      {id: 'TM000073-4', tipo: 'insumo', materialId: 'MP0063', consumo: 1, unidade: 'Un', perdaPct: 0},
      {id: 'TM000073-5', tipo: 'insumo', materialId: 'MP0078', consumo: 0.25, unidade: 'm2', perdaPct: 0},
      {id: 'TM000073-6', tipo: 'insumo', materialId: 'MP0112', consumo: 0.002, unidade: 'm2', perdaPct: 0},
      {id: 'TM000073-7', tipo: 'insumo', materialId: 'MP0033', consumo: 0.00416, unidade: 'MT', perdaPct: 0},
      {id: 'TM000073-8', tipo: 'insumo', materialId: 'MP0061', consumo: 0.01, unidade: 'CT', perdaPct: 0},
      {id: 'TM000073-9', tipo: 'insumo', materialId: 'MP0067', consumo: 0.01, unidade: 'CT', perdaPct: 0},
    ],
  },
  {
    productId: 'TM000076', versao: 1, ativa: true, atualizadoEm: '2026-01-01T00:00:00Z',
    linhas: [
      {id: 'TM000076-1', tipo: 'insumo', materialId: 'MP0059', consumo: 2, unidade: 'MT', perdaPct: 0},
      {id: 'TM000076-2', tipo: 'insumo', materialId: 'MP0072', consumo: 0.00025, unidade: 'Caixa', perdaPct: 0},
      {id: 'TM000076-3', tipo: 'insumo', materialId: 'MP0064', consumo: 1, unidade: 'Un', perdaPct: 0},
      {id: 'TM000076-4', tipo: 'insumo', materialId: 'MP0078', consumo: 0.16, unidade: 'm2', perdaPct: 0},
      {id: 'TM000076-5', tipo: 'insumo', materialId: 'MP0112', consumo: 0.002, unidade: 'm2', perdaPct: 0},
      {id: 'TM000076-6', tipo: 'insumo', materialId: 'MP0040', consumo: 0.043, unidade: 'm2', perdaPct: 0},
      {id: 'TM000076-7', tipo: 'insumo', materialId: 'MP0033', consumo: 0.00416, unidade: 'MT', perdaPct: 0},
      {id: 'TM000076-8', tipo: 'insumo', materialId: 'MP0061', consumo: 0.01, unidade: 'CT', perdaPct: 0},
      {id: 'TM000076-9', tipo: 'insumo', materialId: 'MP0067', consumo: 0.01, unidade: 'CT', perdaPct: 0},
    ],
  },
]

export const SEED_VENDAS: { productId: string; nome: string; vendas: number }[] = [
  {productId: 'TM000076', nome: 'Espelho Adnet Redondo 40cm Preto', vendas: 1622},
  {productId: 'TM000073', nome: 'Espelho Adnet Redondo 50cm Preto', vendas: 1555},
  {productId: 'ED000001', nome: 'Mouse Pad Desk Pad 90x40cm Preto', vendas: 1015},
  {productId: 'ED000008', nome: 'Mouse Pad Desk Pad 90x40cm Caramelo', vendas: 523},
  {productId: 'ED000002', nome: 'Mouse Pad Desk Pad 90x40cm Grafite', vendas: 271},
  {productId: 'ED000010', nome: 'Mouse Pad 20x20 Caramelo', vendas: 110},
  {productId: 'ED000007', nome: 'Mouse Pad Desk Pad 90x40cm Rosa Claro', vendas: 82},
  {productId: 'ED000011', nome: 'Mouse Pad 20x20 Grafite', vendas: 75},
  {productId: 'ED000004', nome: 'Mousepad 90x40 Bordô', vendas: 73},
  {productId: 'ED000009', nome: 'Mouse Pad 20x20 Azul Marinho', vendas: 60},
  {productId: 'ED000707', nome: 'Kit Jogo Americano (sem ficha cadastrada)', vendas: 210},
]
