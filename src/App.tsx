import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { loadBuffers, playheadFromTime, startTransport } from './audio/engine'
import { PRESETS, TRACKS } from './config/presets'

const initialPattern = (): boolean[][] =>
  TRACKS.map(() => Array.from({ length: 16 }, () => false))

/** Quarter starts vs eighths: flat yellow tint, no gradients. */
function columnShadeBefore(step: number): string {
  if (step % 4 === 0) {
    return 'before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-yellow-400/15'
  }
  if (step % 4 === 2) {
    return 'before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-yellow-400/8'
  }
  return ''
}

function columnShadeStepCell(step: number): string {
  if (step % 4 === 0) return 'bg-yellow-400/10'
  if (step % 4 === 2) return 'bg-yellow-400/5'
  return ''
}

function HeaderLogo() {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <h1 className="text-3xl font-bold tracking-tight text-yellow-400 sm:text-4xl">
        Pulse Grid
      </h1>
    )
  }
  return (
    <img
      src="/logo.png"
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
      className="mx-auto block h-auto w-auto max-h-24 max-w-[min(100%,22rem)] object-contain object-center sm:max-h-32"
    />
  )
}

export default function App() {
  const [pattern, setPattern] = useState(initialPattern)
  const [bpm, setBpm] = useState(120)
  const [bpmDraft, setBpmDraft] = useState('120')
  const [presetId, setPresetId] = useState(PRESETS[0]!.id)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [beatFlash, setBeatFlash] = useState({ gen: 0, col: 0 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [buffersReady, setBuffersReady] = useState(false)

  const ctxRef = useRef<AudioContext | null>(null)
  const buffersRef = useRef<(AudioBuffer | null)[]>(
    TRACKS.map(() => null),
  )
  const transportRef = useRef<ReturnType<typeof startTransport> | null>(null)
  const transportStartRef = useRef(0)
  const rafRef = useRef(0)
  const playingRef = useRef(false)
  const lastStepRef = useRef(-1)

  const bpmRef = useRef(bpm)
  const patternRef = useRef(pattern)
  const presetRef = useRef(presetId)

  useEffect(() => {
    bpmRef.current = bpm
  }, [bpm])
  useEffect(() => {
    setBpmDraft(String(bpm))
  }, [bpm])

  const commitBpm = useCallback(() => {
    const stripped = bpmDraft.replace(/\D/g, '')
    if (stripped === '') {
      setBpmDraft(String(bpm))
      return
    }
    const n = Number.parseInt(stripped, 10)
    const clamped = Math.min(220, Math.max(40, n))
    setBpm(clamped)
    setBpmDraft(String(clamped))
  }, [bpmDraft, bpm])
  useEffect(() => {
    patternRef.current = pattern
  }, [pattern])
  useEffect(() => {
    presetRef.current = presetId
  }, [presetId])
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  const ensureCtx = useCallback(async () => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!ctxRef.current) {
      ctxRef.current = new Ctx()
    }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }, [])

  const loadKit = useCallback(async () => {
    try {
      const ctx = await ensureCtx()
      setLoadError(null)
      setBuffersReady(false)
      const buffers = await loadBuffers(ctx, presetRef.current, TRACKS)
      buffersRef.current = buffers
      setBuffersReady(true)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load samples')
      buffersRef.current = TRACKS.map(() => null)
      setBuffersReady(false)
    }
  }, [ensureCtx])

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadKit()
    }, 0)
    return () => window.clearTimeout(t)
  }, [presetId, loadKit])

  const stopPlayback = useCallback(() => {
    transportRef.current?.stop()
    transportRef.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    setPlaying(false)
    setPlayhead(0)
    setBeatFlash({ gen: 0, col: 0 })
    lastStepRef.current = -1
  }, [])

  useEffect(() => {
    if (!playing) {
      lastStepRef.current = -1
      return
    }
    lastStepRef.current = -1
    const loop = () => {
      const ctx = ctxRef.current
      if (!ctx || !playingRef.current) return
      const ph = playheadFromTime(
        ctx,
        transportStartRef.current,
        bpmRef.current,
      )
      if (ph !== lastStepRef.current) {
        lastStepRef.current = ph
        setBeatFlash((prev) => ({ gen: prev.gen + 1, col: ph }))
      }
      setPlayhead(ph)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing])

  const togglePlay = useCallback(async () => {
    if (playing) {
      stopPlayback()
      return
    }
    setLoadError(null)
    try {
      const ctx = await ensureCtx()
      if (!buffersRef.current.every(Boolean)) {
        await loadKit()
      }
      if (!buffersRef.current.every(Boolean)) {
        setLoadError('Samples are not ready')
        return
      }

      const transport = startTransport(
        ctx,
        () => bpmRef.current,
        () => patternRef.current,
        () => buffersRef.current,
      )
      transportRef.current = transport
      transportStartRef.current = transport.getFirstBeatTime()
      setPlaying(true)
      setPlayhead(0)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Audio failed to start')
    }
  }, [ensureCtx, loadKit, playing, stopPlayback])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable) return
      e.preventDefault()
      void togglePlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay])

  const toggleStep = (trackIndex: number, step: number) => {
    setPattern((p) => {
      const next = p.map((row) => [...row])
      const row = next[trackIndex]
      if (!row) return p
      row[step] = !row[step]
      return next
    })
  }

  const rootStyle = { '--bpm': String(bpm) } as CSSProperties

  return (
    <div
      style={rootStyle}
      className="relative isolate min-h-dvh overflow-x-hidden bg-black text-yellow-50"
    >
      <div className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-3 pb-10 pt-8 sm:px-5 sm:pt-12">
        <header className="mb-6 sm:mb-8">
          <p className="sr-only">
            Drum step sequencer. Press Space to play or stop.
          </p>
          <HeaderLogo />
        </header>

        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <label className="flex items-baseline gap-2 text-sm text-yellow-500">
            <span className="font-semibold tracking-wide text-yellow-600">
              BPM
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              aria-label="Beats per minute"
              value={bpmDraft}
              onChange={(e) => setBpmDraft(e.target.value)}
              onBlur={() => commitBpm()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              className="w-[4.25rem] border-2 border-yellow-500 bg-black py-2 text-center text-lg font-bold tabular-nums tracking-tight text-yellow-400 outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black sm:w-[4.5rem] sm:text-xl"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-yellow-500">
            <span className="font-semibold text-yellow-600">Kit</span>
            <select
              value={presetId}
              onChange={(e) => {
                stopPlayback()
                setPresetId(e.target.value)
              }}
              className="cursor-pointer border-2 border-yellow-600 bg-black px-3 py-2 text-sm font-medium text-yellow-400 outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id} className="bg-black text-yellow-400">
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void togglePlay()}
            className={`inline-flex min-w-[7rem] items-center justify-center border-2 px-5 py-2.5 text-sm font-bold tracking-wide uppercase ${
              playing
                ? 'border-yellow-400 bg-black text-yellow-400 hover:bg-neutral-950'
                : 'border-yellow-400 bg-yellow-400 text-black hover:bg-yellow-300'
            }`}
          >
            {playing ? 'Stop' : 'Play'}
          </button>
        </div>

        {!buffersReady && !loadError && (
          <p className="mt-4 text-center text-xs text-yellow-700">
            Loading samples…
          </p>
        )}
        {loadError && (
          <p className="mt-4 text-center text-sm text-yellow-200" role="alert">
            {loadError}
          </p>
        )}

        <div
          className="relative mx-auto mt-6 w-full max-w-full flex-1 sm:mt-8"
          role="region"
          aria-label="Pattern grid"
        >
          <div className="relative z-[1] flex min-w-0 gap-2 sm:gap-3">
            <div className="w-11 shrink-0 sm:w-16" aria-hidden="true" />
            <div className="grid min-w-0 flex-1 grid-cols-[repeat(16,minmax(0,1fr))] gap-px bg-yellow-950/40">
              {Array.from({ length: 16 }, (_, step) => (
                <div
                  key={step}
                  className={`flex aspect-square max-h-5 min-h-0 items-center justify-center bg-black sm:max-h-6 ${columnShadeStepCell(step)}`}
                >
                  <span
                    className={`text-[9px] font-bold tabular-nums sm:text-[10px] ${playing && playhead === step ? 'text-yellow-400' : 'text-yellow-800'}`}
                  >
                    {step + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-[1] mt-px flex flex-col gap-px">
            {TRACKS.map((track, trackIndex) => {
              const row = pattern[trackIndex] ?? []
              return (
                <div
                  key={track.id}
                  className="flex min-w-0 items-stretch gap-2 sm:gap-3"
                >
                  <div className="flex w-11 shrink-0 items-center justify-end sm:w-16">
                    <span className="truncate text-[10px] font-bold uppercase leading-tight text-yellow-600 sm:text-xs">
                      {track.label}
                    </span>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-[repeat(16,minmax(0,1fr))] gap-px bg-yellow-950/40">
                    {Array.from({ length: 16 }, (_, step) => {
                      const on = row[step] ?? false
                      const isPlayhead = playing && playhead === step
                      const hitFlash =
                        on && beatFlash.col === step ? beatFlash.gen : 0
                      return (
                        <button
                          key={step}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${track.label}, step ${step + 1}, ${on ? 'on' : 'off'}`}
                          data-hit-flash={hitFlash}
                          onClick={() => toggleStep(trackIndex, step)}
                          className={[
                            'relative isolate aspect-square min-h-0 w-full min-w-0 overflow-visible border-0 bg-black transition-colors duration-100',
                            on ? '' : columnShadeBefore(step),
                            'focus-visible:z-[2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400 focus-visible:outline-offset-[-2px]',
                            on ? 'pad-hit-active' : '',
                            on
                              ? 'bg-yellow-400'
                              : 'hover:bg-neutral-950',
                            isPlayhead && !on
                              ? 'z-[1] outline outline-2 outline-yellow-400 outline-offset-[-2px]'
                              : '',
                            isPlayhead && on
                              ? 'z-[1] outline outline-2 outline-black outline-offset-[-2px]'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
