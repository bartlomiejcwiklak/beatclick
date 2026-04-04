import { useCallback, useEffect, useRef, useState } from 'react'
import { loadBuffers, playheadFromTime, startTransport } from './audio/engine'
import { PRESETS, TRACKS } from './config/presets'

const initialPattern = (): boolean[][] =>
  TRACKS.map(() => Array.from({ length: 16 }, () => false))

export default function App() {
  const [pattern, setPattern] = useState(initialPattern)
  const [bpm, setBpm] = useState(120)
  const [presetId, setPresetId] = useState(PRESETS[0]!.id)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
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

  const bpmRef = useRef(bpm)
  const patternRef = useRef(pattern)
  const presetRef = useRef(presetId)

  useEffect(() => {
    bpmRef.current = bpm
  }, [bpm])
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
  }, [])

  useEffect(() => {
    if (!playing) return
    const loop = () => {
      const ctx = ctxRef.current
      if (!ctx || !playingRef.current) return
      const ph = playheadFromTime(
        ctx,
        transportStartRef.current,
        bpmRef.current,
      )
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

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-slate-100">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-3 pb-10 pt-8 sm:px-5 sm:pt-12">
        <header className="mb-8 text-center sm:mb-10">
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.22em] text-teal-400/90">
            Step sequencer
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Pulse Grid
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Each row is an instrument; sixteen steps across. Press{' '}
            <kbd className="rounded border border-slate-600 bg-slate-800/80 px-1.5 py-0.5 font-mono text-xs text-slate-300">
              Space
            </kbd>{' '}
            to play. WAV kits:{' '}
            <code className="text-slate-300">public/samples/&lt;preset&gt;/</code>.
          </p>
        </header>

        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <span className="sr-only">BPM</span>
            <span aria-hidden className="w-8 text-right font-mono text-slate-500">
              BPM
            </span>
            <input
              type="range"
              min={60}
              max={180}
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-slate-800 accent-teal-400 sm:w-44"
            />
            <input
              type="number"
              min={60}
              max={180}
              value={bpm}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (!Number.isFinite(v)) return
                setBpm(Math.min(180, Math.max(60, Math.round(v))))
              }}
              className="w-14 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-center font-mono text-sm text-white tabular-nums outline-none ring-teal-400/40 focus:ring-2"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-400">
            Kit
            <select
              value={presetId}
              onChange={(e) => {
                stopPlayback()
                setPresetId(e.target.value)
              }}
              className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 outline-none ring-teal-400/30 focus:ring-2"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void togglePlay()}
            className={`inline-flex min-w-[7rem] items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold tracking-wide transition ${
              playing
                ? 'bg-rose-500/90 text-white shadow-lg shadow-rose-500/20 hover:bg-rose-400'
                : 'bg-teal-500 text-slate-950 shadow-lg shadow-teal-500/25 hover:bg-teal-400'
            }`}
          >
            {playing ? 'Stop' : 'Play'}
          </button>
        </div>

        {!buffersReady && !loadError && (
          <p className="mt-4 text-center text-xs text-slate-500">Loading samples…</p>
        )}
        {loadError && (
          <p className="mt-4 text-center text-sm text-rose-400" role="alert">
            {loadError}
          </p>
        )}

        <div
          className="mx-auto mt-6 w-full max-w-full flex-1 sm:mt-8"
          role="region"
          aria-label="Pattern grid"
        >
          <div className="flex min-w-0 gap-1.5 sm:gap-2">
            <div
              className="w-11 shrink-0 sm:w-16"
              aria-hidden="true"
            />
            <div className="grid min-w-0 flex-1 grid-cols-[repeat(16,minmax(0,1fr))] gap-0.5 sm:gap-1">
              {Array.from({ length: 16 }, (_, step) => (
                <div
                  key={step}
                  className="flex aspect-square max-h-5 min-h-0 items-center justify-center sm:max-h-6"
                >
                  <span className="text-[9px] font-mono tabular-nums text-slate-600 sm:text-[10px]">
                    {step + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-1 flex flex-col gap-1.5 sm:gap-2">
            {TRACKS.map((track, trackIndex) => {
              const row = pattern[trackIndex] ?? []
              return (
                <div
                  key={track.id}
                  className="flex min-w-0 items-stretch gap-1.5 sm:gap-2"
                >
                  <div className="flex w-11 shrink-0 items-center justify-end sm:w-16">
                    <span className="truncate text-[10px] font-medium leading-tight text-slate-400 sm:text-xs">
                      {track.label}
                    </span>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-[repeat(16,minmax(0,1fr))] gap-0.5 sm:gap-1">
                    {Array.from({ length: 16 }, (_, step) => {
                      const on = row[step] ?? false
                      const isPlayhead = playing && playhead === step
                      return (
                        <button
                          key={step}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${track.label}, step ${step + 1}, ${on ? 'on' : 'off'}`}
                          onClick={() => toggleStep(trackIndex, step)}
                          className={[
                            'relative aspect-square min-h-0 w-full min-w-0 rounded-md border transition-all duration-150 sm:rounded-lg',
                            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-400',
                            on
                              ? 'border-teal-400/45 bg-gradient-to-br from-teal-500/30 to-emerald-600/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                              : 'border-slate-700/80 bg-slate-900/55 hover:border-slate-600 hover:bg-slate-800/70',
                            isPlayhead
                              ? 'z-[1] ring-1 ring-amber-400/95 ring-offset-1 ring-offset-slate-950 sm:ring-2 sm:ring-offset-2'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {on && (
                            <span
                              className="pointer-events-none absolute inset-0.5 rounded-sm bg-teal-400/20 blur-[2px] sm:inset-1 sm:rounded-md"
                              aria-hidden
                            />
                          )}
                        </button>
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
