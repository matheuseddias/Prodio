// Ponto de entrada do pacote de domínio. Cada módulo é puro: sem React, sem banco, sem rede.
export * from './tipos'
export * from './ficha'
export * from './unidades'
export * from './tributos'
export * from './custeio'
export * from './projecao'
export * from './necessidade'
export * from './etiquetas'
export * from './nfe'
// nfeXml fica fora do barril de propósito: traz fast-xml-parser e só roda no servidor.
// Importe por caminho: import { parseNfeXml } from '@prodio/core/nfeXml'
export * from './precificacao'
// Importação do backup do Eddias Suprimentos (ES): plano puro, sem dependência. Também por caminho:
// import { planejarImportacaoES } from '@prodio/core/importacaoEs'
export * from './importacaoEs'
