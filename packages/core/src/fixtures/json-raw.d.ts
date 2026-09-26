// Import de fixtures JSON como texto (Vite/vitest `?raw`): o teste faz JSON.parse e ganha uma cópia nova.
declare module '*.json?raw' {
  const conteudo: string
  export default conteudo
}
