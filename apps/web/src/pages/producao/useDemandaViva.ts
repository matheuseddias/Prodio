// Relê a demanda dos pedidos enquanto a tela está aberta (Linha de hoje, Necessidade, Painel).
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../domain/store'

/** O robô grava pedidos a cada 5 minutos: a tela relê a demanda no mesmo ritmo enquanto está visível. */
const RELER_MS = 5 * 60_000

/** Relê demanda e conectores ao abrir a tela (se a leitura tem mais de 5 min) e a cada 5 min. */
export function useDemandaViva() {
  const { modo, demanda, recarregarFatias } = useStore()
  const [lendo, setLendo] = useState(false)
  const reler = useMemo(
    () => async () => {
      setLendo(true)
      try {
        await recarregarFatias(['demanda', 'connectors'])
      } finally {
        setLendo(false)
      }
    },
    [recarregarFatias],
  )
  const geradoEm = demanda.geradoEm
  useEffect(() => {
    if (modo !== 'supabase') return
    const velha = !geradoEm || Date.now() - Date.parse(geradoEm) > RELER_MS
    if (velha) void reler()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reler()
    }, RELER_MS)
    return () => window.clearInterval(id)
    // Só ao abrir a tela: a cada leitura `geradoEm` muda e reiniciaria o relógio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, reler])
  return { lendo, reler: modo === 'supabase' ? reler : undefined }
}
