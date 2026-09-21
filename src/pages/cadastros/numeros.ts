/** "1.234,56" | "1234.56" | "1234,5" → number (NaN se inválido) */
export function parseNumBR(raw: string): number {
  const s = raw.trim()
  if (!s) return NaN
  let t = s
  if (s.includes(',')) t = s.replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN
  return Number(t)
}
