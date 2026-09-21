// Fixtures XML importados com ?raw nos testes (Vite).
declare module '*.xml?raw' {
  const conteudo: string
  export default conteudo
}
