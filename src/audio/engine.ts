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
  const urls = tracks.map((t) => `/samples/${presetId}/${t.file}`)
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
): Transport {
  let nextNoteTime = ctx.currentTime + 0.08
  const firstBeatTime = nextNoteTime
  let stepIndex = 0
  let stopped = false

  const tick = () => {
    if (stopped) return
    const dur = stepDurationSec(getBpm())
    const buffers = getBuffers()

    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const step = stepIndex % 16
      const pattern = getPattern()

      const g = ctx.createGain()
      g.gain.value = 0.88
      g.connect(ctx.destination)

      pattern.forEach((row, trackIdx) => {
        if (!row[step]) return
        const buf = buffers[trackIdx]
        if (!buf) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(g)
        src.start(nextNoteTime)
      })

      nextNoteTime += dur
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
): void {
  if (!buffer) return
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g)
  g.connect(ctx.destination)
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
