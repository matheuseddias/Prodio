import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/** Folha inferior (bottom sheet) simples para o celular. */
export default function Sheet({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full flex-col rounded-t-3xl border-t border-slate-800 bg-slate-950 text-slate-100" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-slate-700" />
        <header className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-[18px] font-semibold">{titulo}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-12 w-12 place-items-center rounded-full text-slate-400 active:bg-slate-800">
            <X size={22} />
          </button>
        </header>
        <div className="overflow-y-auto px-4 pb-6">{children}</div>
      </div>
    </div>
  )
}
