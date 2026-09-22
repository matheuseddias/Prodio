// Guarda contra a causa da tela branca de 2026-09: dois arquivos na mesma pasta cujos nomes só
// diferem por maiúsculas/minúsculas ou por extensão (Etiquetas.tsx + etiquetas.ts). Em macOS e
// Windows o sistema de arquivos ignora a caixa e o Vite testa '.ts' antes de '.tsx', então
// `import './Etiquetas'` carrega o módulo errado e a rota inteira morre — só na máquina de quem
// desenvolve, nunca no CI (Linux). Este teste falha antes disso chegar no navegador de alguém.
/// <reference types="node" />
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RAIZ = fileURLToPath(new URL('../../..', import.meta.url))
const IGNORAR = new Set(['node_modules', 'dist', '.git', '.wrangler', 'coverage', '.vite', 'build'])
const PASTAS = ['apps', 'packages', 'supabase']

/** `pages/producao/Etiquetas.tsx` e `pages/producao/etiquetas.ts` colidem: mesma pasta, mesmo nome sem caixa nem extensão. */
function colisoes(dir: string, caminho = ''): string[] {
  const achados: string[] = []
  const porNome = new Map<string, string[]>()
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(item.name) || item.name.startsWith('.')) continue
    const rel = caminho ? `${caminho}/${item.name}` : item.name
    if (item.isDirectory()) {
      achados.push(...colisoes(`${dir}/${item.name}`, rel))
      continue
    }
    const base = item.name.replace(/\.[^.]+$/, '').toLowerCase()
    porNome.set(base, [...(porNome.get(base) ?? []), item.name])
  }
  for (const [, arquivos] of porNome) {
    if (arquivos.length > 1) achados.push(`${caminho}: ${arquivos.sort().join(' + ')}`)
  }
  return achados
}

describe('nomes de arquivo', () => {
  it('não têm dois módulos que só diferem por caixa ou extensão na mesma pasta', () => {
    const achados = PASTAS.flatMap((p) => colisoes(`${RAIZ}${p}`, p))
    expect(achados, 'renomeie um dos arquivos: em macOS/Windows o import resolve para o módulo errado').toEqual([])
  })
})
