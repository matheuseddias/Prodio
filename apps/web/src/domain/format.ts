export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const num = (v: number, casas = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

export const pct = (v: number) => `${Math.round(v * 100)}%`

export const dataBR = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR')
}

export const horaBR = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export const dataHoraBR = (iso: string) => `${dataBR(iso)} ${horaBR(iso)}`

export const relativo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return `há ${d} d`
}

export const cnpjFmt = (c: string) =>
  c.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

export const chaveFmt = (chave: string) => chave.replace(/(\d{4})(?=\d)/g, '$1 ')

export const hojeISO = () => new Date().toISOString().slice(0, 10)
