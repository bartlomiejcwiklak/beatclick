import type { TrackDef } from '../config/presets'

const SCHEDULE_AHEAD = 0.12
const TICK_MS = 25

export function stepDurationSec(bpm: number): number {
  return (60 / bpm) / 4
}

export async function loadBuffers(
  ctx: AudioContext,
  presetId: string,
  tracks: TrackDef[],
): Promise<AudioBuffer[]> {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  const urls = tracks.map((t) => `${base}samples/${presetId}/${t.file}`)
  return Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load ${url}`)
      const ab = await res.arrayBuffer()
      return ctx.decodeAudioData(ab.slice(0))
    }),
  )
}

export type Transport = {
  stop: () => void
  getFirstBeatTime: () => number
}

export function startTransport(
  ctx: AudioContext,
  getBpm: () => number,
  getPattern: () => boolean[][],
  getBuffers: () => (AudioBuffer | null)[],
  getStepCount: () => number,
  getSwing: () => number,
  output: AudioNode = ctx.destination,
  onStep?: (step: number, scheduledTime: number) => void,
): Transport {
  let nextNoteTime = ctx.currentTime + 0.08
  const firstBeatTime = nextNoteTime
  let stepIndex = 0
  let stopped = false

  const tick = () => {
    if (stopped) return
    const dur = stepDurationSec(getBpm())
    const stepCount = Math.max(1, Math.floor(getStepCount()))
    const swing = Math.min(100, Math.max(0, getSwing())) / 100
    const swingOffset = dur * 0.4 * swing
    const buffers = getBuffers()

    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const step = stepIndex % stepCount
      const pattern = getPattern()

      onStep?.(step, nextNoteTime)

      const g = ctx.createGain()
      g.gain.value = 0.88
      g.connect(output)

      pattern.forEach((row, trackIdx) => {
        if (!row[step]) return
        const buf = buffers[trackIdx]
        if (!buf) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(g)
        src.start(nextNoteTime)
      })

      const isEvenStep = stepIndex % 2 === 0
      nextNoteTime += isEvenStep ? dur - swingOffset : dur + swingOffset
      stepIndex += 1
    }
  }

  const id = window.setInterval(tick, TICK_MS)
  tick()

  return {
    stop: () => {
      stopped = true
      window.clearInterval(id)
    },
    getFirstBeatTime: () => firstBeatTime,
  }
}

export function playOneShot(
  ctx: AudioContext,
  buffer: AudioBuffer | null,
  gain = 0.92,
  output: AudioNode = ctx.destination,
): void {
  if (!buffer) return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g)
  g.connect(output)
  const t = ctx.currentTime
  src.start(t)
}

export function playheadFromTime(
  ctx: AudioContext,
  transportStart: number,
  bpm: number,
): number {
  const dur = stepDurationSec(bpm)
  if (dur <= 0) return 0
  const t = ctx.currentTime - transportStart
  if (t < 0) return 0
  return Math.floor(t / dur) % 16
}
