// Feedback sonoro (Web Audio) e tátil (vibração) para o chão de fábrica.

let ctx: AudioContext | null = null
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, inicio: number, duracao: number, tipo: OscillatorType = 'square') {
  const ac = audio()
  if (!ac) return
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = tipo
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, ac.currentTime + inicio)
  gain.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + inicio + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + inicio + duracao)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(ac.currentTime + inicio)
  osc.stop(ac.currentTime + inicio + duracao + 0.02)
}

export function vibrar(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch {
    /* ignore */
  }
}

/** Beep curto e agudo. */
export function beepOk() {
  try {
    tone(1760, 0, 0.09)
  } catch {
    /* ignore */
  }
  vibrar(40)
}

/** Dois beeps graves. */
export function beepErro() {
  try {
    tone(220, 0, 0.16, 'sawtooth')
    tone(220, 0.22, 0.16, 'sawtooth')
  } catch {
    /* ignore */
  }
  vibrar([80, 60, 80])
}

/** Aviso neutro (um beep médio). */
export function beepAviso() {
  try {
    tone(660, 0, 0.12, 'triangle')
  } catch {
    /* ignore */
  }
  vibrar(60)
}
