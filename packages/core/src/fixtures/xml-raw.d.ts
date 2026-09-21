// Import de fixtures XML como texto (Vite/vitest `?raw`).
declare module '*.xml?raw' {
  const conteudo: string
  export default conteudo
}
