// Fila offline de bipes (modo Supabase): enfileira no IndexedDB, faz replay em ordem quando há rede,
// trata "já bipado" como sucesso e mantém o contador real de pendentes.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ehErroDeRede, mensagemErro } from '../data/erros'
import * as fila from '../data/filaBipes'
import type { Patch, Repo } from '../data/repo'

const MAX_TENTATIVAS = 5

export function useFilaBipes(repo: Repo, ativo: boolean, aplicarPatch: (p: Patch) => void, avisar: (texto: string) => void) {
  const [pendentes, setPendentes] = useState(0)
  const drenando = useRef(false)
  const refs = useRef({ aplicarPatch, avisar })
  useEffect(() => {
    refs.current = { aplicarPatch, avisar }
  }, [aplicarPatch, avisar])

  const drenar = useCallback(async () => {
    if (!ativo || drenando.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    drenando.current = true
    let processados = 0
    try {
      for (const b of fila.pendentes()) {
        try {
          const r = await repo.registerScan(b.serial, { clientEventId: b.clientEventId, operador: b.operador ?? '', dispositivo: b.dispositivo ?? '' })
          if (!r.valor.ok && r.valor.motivo === 'sem_operador') {
            refs.current.avisar('Entre com o PIN para sincronizar os bipes pendentes.')
            break
          }
          await fila.remover(b.clientEventId)
          processados++
          if (!r.valor.ok && r.valor.motivo !== 'ja_bipado') {
            await fila.desmarcarLido(b.serial)
            refs.current.avisar(`Bipe …${b.serial.slice(-10)} rejeitado pelo servidor: ${r.valor.motivo ?? 'motivo desconhecido'}.`)
          }
        } catch (e) {
          if (ehErroDeRede(e)) break
          if ((b.tentativas ?? 0) + 1 >= MAX_TENTATIVAS) {
            await fila.remover(b.clientEventId)
            await fila.desmarcarLido(b.serial)
            refs.current.avisar(`Bipe …${b.serial.slice(-10)} descartado após ${MAX_TENTATIVAS} tentativas: ${mensagemErro(e)}`)
            processados++
          } else {
            await fila.marcarTentativa(b)
            break
          }
        }
      }
    } finally {
      drenando.current = false
      setPendentes(fila.contarPendentes())
    }
    if (processados > 0) {
      try {
        refs.current.aplicarPatch(await repo.recarregar(['scans', 'dailyPlan', 'labels', 'outbox', 'materials', 'stockMoves']))
      } catch (e) {
        refs.current.avisar(mensagemErro(e))
      }
    }
  }, [repo, ativo])

  useEffect(() => {
    if (!ativo) return
    let vivo = true
    void fila.carregarFila().then(() => {
      if (!vivo) return
      setPendentes(fila.contarPendentes())
      void fila.limparLidosAntigos(new Date().toISOString().slice(2, 10).replace(/-/g, ''))
      void drenar()
    })
    const on = () => void drenar()
    window.addEventListener('online', on)
    const id = window.setInterval(on, 30_000)
    return () => {
      vivo = false
      window.removeEventListener('online', on)
      window.clearInterval(id)
    }
  }, [ativo, drenar])

  const enfileirar = useCallback(
    async (b: fila.BipePendente) => {
      await fila.enfileirar(b)
      setPendentes(fila.contarPendentes())
      void drenar()
    },
    [drenar],
  )

  return { pendentes, drenar, enfileirar, lidos: fila.seriaisLidos }
}
