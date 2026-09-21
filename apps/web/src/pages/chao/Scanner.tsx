import { Camera, CameraOff, Keyboard } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../ui'

// Tipagem mínima do BarcodeDetector (ainda não está no lib.dom do TS).
interface DetectedBarcode {
  rawValue: string
  format: string
}
interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function getDetectorCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
  return typeof w.BarcodeDetector === 'function' ? w.BarcodeDetector : null
}

interface Props {
  formats: string[]
  onRead: (valor: string) => void
  active?: boolean
  placeholder?: string
  hint?: string
  /** Máscara aplicada ao que está sendo digitado (apenas visual). */
  mask?: (v: string) => string
  /** Só numérico no campo de digitação. */
  numeric?: boolean
  className?: string
}

/**
 * Leitor de código: câmera com BarcodeDetector quando existir, e sempre um campo
 * de digitação focado para leitores Bluetooth/HID (que digitam e enviam Enter).
 */
export default function Scanner({ formats, onRead, active = true, placeholder = 'Digite ou use o leitor…', hint, mask, numeric, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  }, [onRead])
  const [suporte] = useState(() => getDetectorCtor() !== null && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia)
  const [camStatus, setCamStatus] = useState<'off' | 'ligando' | 'on' | 'negada'>(() => (suporte && active ? 'ligando' : 'off'))
  const [texto, setTexto] = useState('')
  const fmtKey = formats.join('|')

  // Câmera + detecção
  useEffect(() => {
    if (!suporte || !active) return
    const Ctor = getDetectorCtor()
    if (!Ctor) return
    let stream: MediaStream | null = null
    let timer = 0
    let cancelado = false
    let ultimo = ''
    let ultimoEm = 0
    const detector = new Ctor({ formats: fmtKey.split('|') })
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        const v = videoRef.current
        if (!v) return
        v.srcObject = s
        v.play().catch(() => {})
        setCamStatus('on')
        timer = window.setInterval(async () => {
          const vid = videoRef.current
          if (!vid || vid.readyState < 2) return
          try {
            const codes = await detector.detect(vid)
            const c = codes[0]
            if (!c?.rawValue) return
            const agora = Date.now()
            if (c.rawValue === ultimo && agora - ultimoEm < 2500) return
            ultimo = c.rawValue
            ultimoEm = agora
            onReadRef.current(c.rawValue)
          } catch {
            /* frame inválido; ignora */
          }
        }, 250)
      })
      .catch(() => setCamStatus('negada'))
    return () => {
      cancelado = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      setCamStatus('off')
    }
  }, [suporte, active, fmtKey])

  // Mantém o campo focado (leitor HID digita + Enter)
  useEffect(() => {
    if (!active) return
    const foco = () => inputRef.current?.focus()
    foco()
    const id = window.setInterval(() => {
      const el = document.activeElement
      const tag = el?.tagName
      if (!el || el === document.body || (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'BUTTON')) foco()
    }, 1500)
    return () => window.clearInterval(id)
  }, [active])

  const confirmar = () => {
    const v = texto.trim()
    if (!v) return
    setTexto('')
    onRead(v)
  }

  return (
    <div className={cx('space-y-3', className)}>
      {suporte ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
          {/* Mira */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[46%] w-[78%]">
              {['top-0 left-0 border-t-4 border-l-4 rounded-tl-lg', 'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg'].map((c) => (
                <span key={c} className={cx('absolute h-7 w-7 border-teal-300', c)} />
              ))}
              {camStatus === 'on' && <span className="absolute left-2 right-2 top-1/2 h-0.5 bg-red-400/80 shadow-[0_0_8px_rgba(248,113,113,0.9)]" />}
            </div>
          </div>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center">
            <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] text-slate-200">
              {camStatus === 'ligando' && 'Ligando a câmera…'}
              {camStatus === 'on' && 'Aponte para o código'}
              {camStatus === 'negada' && 'Câmera negada — use o campo abaixo'}
              {camStatus === 'off' && 'Câmera desligada'}
            </span>
          </div>
          {camStatus === 'negada' && (
            <div className="absolute inset-0 grid place-items-center bg-slate-900/80">
              <CameraOff size={40} className="text-slate-500" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">
          <Camera size={22} className="mt-0.5 shrink-0" />
          <div className="text-[15px] leading-snug">
            <div className="font-semibold">Leitor da câmera não disponível neste navegador</div>
            <div className="text-[13px] text-amber-200/80">Use um leitor Bluetooth ou digite o código abaixo.</div>
          </div>
        </div>
      )}

      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <Keyboard size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={inputRef}
            value={mask ? mask(texto) : texto}
            onChange={(e) => setTexto(numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmar()
              }
            }}
            inputMode={numeric ? 'numeric' : 'text'}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={placeholder}
            className="h-14 w-full rounded-xl border border-slate-700 bg-slate-900 pl-10 pr-3 font-mono text-[16px] text-slate-100 placeholder:text-slate-500 focus:border-teal-400 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={confirmar}
          disabled={!texto.trim()}
          className="h-14 min-w-[72px] rounded-xl bg-teal-500 px-4 text-[15px] font-semibold text-slate-950 active:bg-teal-400 disabled:opacity-40"
        >
          OK
        </button>
      </div>
      {hint && <div className="text-[12px] text-slate-500">{hint}</div>}
    </div>
  )
}
