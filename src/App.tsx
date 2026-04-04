import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  loadBuffers,
  playheadFromTime,
  playOneShot,
  startTransport,
} from "./audio/engine";
import { PRESETS, TRACKS } from "./config/presets";

const initialPattern = (): boolean[][] =>
  TRACKS.map(() => Array.from({ length: 16 }, () => false));

type BgParticle = {
  id: number;
  left: number;
  top: number;
  size: number;
  hue: number;
  dur: number;
  burstX: number;
  burstY: number;
};

function columnShadeBefore(step: number): string {
  if (step % 4 === 0) {
    return "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-yellow-400/15";
  }
  if (step % 4 === 2) {
    return "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-yellow-400/8";
  }
  return "";
}

function columnShadeStepCell(step: number): string {
  if (step % 4 === 0) return "bg-yellow-400/10";
  if (step % 4 === 2) return "bg-yellow-400/5";
  return "";
}

function previewSlotFromKey(e: KeyboardEvent): number | null {
  if (e.code.startsWith("Digit")) {
    const n = Number.parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 4) return n - 1;
  }
  if (e.code.startsWith("Numpad")) {
    const n = Number.parseInt(e.code.slice(6), 10);
    if (n >= 1 && n <= 4) return n - 1;
  }
  if (e.key >= "1" && e.key <= "4") {
    return Number.parseInt(e.key, 10) - 1;
  }
  return null;
}

function HeaderLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <h1 className="text-3xl font-bold tracking-tight text-yellow-400 sm:text-4xl">
        Pulse Grid
      </h1>
    );
  }
  return (
    <img
      src="/logo.png"
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
      className="mx-auto block h-auto w-auto max-h-24 max-w-[min(100%,22rem)] object-contain object-center sm:max-h-32"
    />
  );
}

export default function App() {
  const [pattern, setPattern] = useState(initialPattern);
  const [bpm, setBpm] = useState(120);
  const [masterVolume, setMasterVolume] = useState(80);
  const [bpmDraft, setBpmDraft] = useState("120");
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [beatFlash, setBeatFlash] = useState({ gen: 0, col: 0 });
  const [bgParticles, setBgParticles] = useState<BgParticle[]>([]);
  const [mutedTracks, setMutedTracks] = useState<boolean[]>(
    TRACKS.map(() => false),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buffersReady, setBuffersReady] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const buffersRef = useRef<(AudioBuffer | null)[]>(TRACKS.map(() => null));
  const transportRef = useRef<ReturnType<typeof startTransport> | null>(null);
  const transportStartRef = useRef(0);
  const rafRef = useRef(0);
  const playingRef = useRef(false);
  const lastStepRef = useRef(-1);
  const dragPaintRef = useRef<{
    active: boolean;
    value: boolean;
    last: string | null;
  }>({ active: false, value: true, last: null });
  const nextParticleIdRef = useRef(1);
  const particleTimersRef = useRef<number[]>([]);

  const bpmRef = useRef(bpm);
  const masterVolumeRef = useRef(masterVolume);
  const patternRef = useRef(pattern);
  const mutedTracksRef = useRef(mutedTracks);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);
  useEffect(() => {
    masterVolumeRef.current = masterVolume;
    const ctx = ctxRef.current;
    const master = masterGainRef.current;
    if (!ctx || !master) return;
    master.gain.setTargetAtTime(
      Math.pow(masterVolume / 100, 1.2),
      ctx.currentTime,
      0.012,
    );
  }, [masterVolume]);
  useEffect(() => {
    setBpmDraft(String(bpm));
  }, [bpm]);

  const commitBpm = useCallback(() => {
    const stripped = bpmDraft.replace(/\D/g, "");
    if (stripped === "") {
      setBpmDraft(String(bpm));
      return;
    }
    const n = Number.parseInt(stripped, 10);
    const clamped = Math.min(220, Math.max(40, n));
    setBpm(clamped);
    setBpmDraft(String(clamped));
  }, [bpmDraft, bpm]);
  useEffect(() => {
    patternRef.current = pattern;
  }, [pattern]);
  useEffect(() => {
    mutedTracksRef.current = mutedTracks;
  }, [mutedTracks]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const ensureCtx = useCallback(async (resume = true) => {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!ctxRef.current) {
      ctxRef.current = new Ctx();
    }
    const ctx = ctxRef.current;
    if (!masterGainRef.current) {
      const master = ctx.createGain();
      master.gain.value = Math.pow(masterVolumeRef.current / 100, 1.2);
      master.connect(ctx.destination);
      masterGainRef.current = master;
    }
    if (resume && ctx.state === "suspended") await ctx.resume();
    return ctx;
  }, []);

  const loadKit = useCallback(async () => {
    try {
      const ctx = await ensureCtx(false);
      setLoadError(null);
      setBuffersReady(false);
      const buffers = await loadBuffers(ctx, presetId, TRACKS);
      buffersRef.current = buffers;
      setBuffersReady(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load samples");
      buffersRef.current = TRACKS.map(() => null);
      setBuffersReady(false);
    }
  }, [ensureCtx, presetId]);

  const toggleMute = useCallback((trackIndex: number) => {
    setMutedTracks((current) =>
      current.map((isMuted, index) =>
        index === trackIndex ? !isMuted : isMuted,
      ),
    );
  }, []);

  const getPlaybackBuffers = useCallback(
    () =>
      buffersRef.current.map((buffer, index) =>
        mutedTracksRef.current[index] ? null : buffer,
      ),
    [],
  );

  const stopPlayback = useCallback(() => {
    transportRef.current?.stop();
    transportRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setPlaying(false);
    setPlayhead(0);
    setBeatFlash({ gen: 0, col: 0 });
    lastStepRef.current = -1;
  }, []);

  const resetSequence = useCallback(() => {
    stopPlayback();
    setPattern(initialPattern());
  }, [stopPlayback]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadKit();
    }, 0);
    return () => window.clearTimeout(t);
  }, [presetId, loadKit]);

  useEffect(() => {
    if (!playing) {
      lastStepRef.current = -1;
      return;
    }
    lastStepRef.current = -1;
    const loop = () => {
      const ctx = ctxRef.current;
      if (!ctx || !playingRef.current) return;
      const ph = playheadFromTime(
        ctx,
        transportStartRef.current,
        bpmRef.current,
      );
      if (ph !== lastStepRef.current) {
        lastStepRef.current = ph;
        setBeatFlash((prev) => ({ gen: prev.gen + 1, col: ph }));
      }
      setPlayhead(ph);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      stopPlayback();
      return;
    }
    setLoadError(null);
    try {
      const ctx = await ensureCtx();
      if (!buffersRef.current.every(Boolean)) {
        await loadKit();
      }
      if (!buffersRef.current.every(Boolean)) {
        setLoadError("Samples are not ready");
        return;
      }

      const transport = startTransport(
        ctx,
        () => bpmRef.current,
        () => patternRef.current,
        getPlaybackBuffers,
        masterGainRef.current ?? ctx.destination,
      );
      transportRef.current = transport;
      transportStartRef.current = transport.getFirstBeatTime();
      setPlaying(true);
      setPlayhead(0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Audio failed to start");
    }
  }, [ensureCtx, loadKit, playing, stopPlayback]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "SELECT" ||
        t.isContentEditable
      )
        return;

      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
        return;
      }

      const previewSlot = previewSlotFromKey(e);
      if (previewSlot !== null) {
        e.preventDefault();
        void ensureCtx().then((ctx) => {
          const buffer = buffersRef.current[previewSlot] ?? null;
          playOneShot(
            ctx,
            mutedTracksRef.current[previewSlot] ? null : buffer,
            0.92,
            masterGainRef.current ?? ctx.destination,
          );
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, ensureCtx]);

  const setStepValue = (trackIndex: number, step: number, value: boolean) => {
    setPattern((p) => {
      if (p[trackIndex]?.[step] === value) return p;
      const next = p.map((row) => [...row]);
      const row = next[trackIndex];
      if (!row) return p;
      row[step] = value;
      return next;
    });
  };

  const beginDragPaint = (trackIndex: number, step: number, isOn: boolean) => {
    const value = !isOn;
    dragPaintRef.current = {
      active: true,
      value,
      last: `${trackIndex}:${step}`,
    };
    setStepValue(trackIndex, step, value);
  };

  const continueDragPaint = (trackIndex: number, step: number) => {
    if (!dragPaintRef.current.active) return;
    const key = `${trackIndex}:${step}`;
    if (dragPaintRef.current.last === key) return;
    dragPaintRef.current.last = key;
    setStepValue(trackIndex, step, dragPaintRef.current.value);
  };

  useEffect(() => {
    const stopDrag = () => {
      dragPaintRef.current.active = false;
      dragPaintRef.current.last = null;
    };
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    return () => {
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
    };
  }, []);

  useEffect(() => {
    if (!playing || beatFlash.gen === 0) return;
    const activeRows = pattern
      .map((row, idx) => (row[beatFlash.col] ? idx : -1))
      .filter((idx) => idx >= 0);
    if (activeRows.length === 0) return;

    const colCenter = ((beatFlash.col + 0.5) / 16) * 100;
    const count = Math.min(18, activeRows.length * 3 + 2);
    const spawned: BgParticle[] = Array.from({ length: count }, () => {
      const row =
        activeRows[Math.floor(Math.random() * activeRows.length)] ?? 0;
      return {
        id: nextParticleIdRef.current++,
        left: colCenter + (Math.random() * 16 - 8),
        top: 34 + row * 12 + (Math.random() * 8 - 4),
        size: 5 + Math.random() * 7,
        hue: 44 + Math.random() * 10,
        dur: 640 + Math.random() * 360,
        burstX: Math.random(),
        burstY: Math.random(),
      };
    });

    setBgParticles((prev) => [...prev, ...spawned]);
    spawned.forEach((p) => {
      const tid = window.setTimeout(() => {
        setBgParticles((prev) => prev.filter((x) => x.id !== p.id));
      }, p.dur + 90);
      particleTimersRef.current.push(tid);
    });
  }, [beatFlash, pattern, playing]);

  useEffect(() => {
    return () => {
      particleTimersRef.current.forEach((id) => window.clearTimeout(id));
      particleTimersRef.current = [];
    };
  }, []);

  return (
    <div className="relative isolate min-h-dvh overflow-x-hidden bg-black text-yellow-50">
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        {bgParticles.map((p) => (
          <span
            key={p.id}
            className="bg-firework-dot"
            style={
              {
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                animationDuration: `${p.dur}ms`,
                background: `radial-gradient(circle at 35% 30%, rgba(255, 252, 210, 0.98) 0%, hsla(${p.hue}, 100%, 60%, 0.88) 48%, rgba(250, 204, 21, 0) 78%)`,
                boxShadow: `0 0 10px hsla(${p.hue}, 100%, 65%, 0.72), 0 0 24px hsla(${p.hue}, 100%, 55%, 0.35)`,
                ["--burst-x" as any]: String(p.burstX),
                ["--burst-y" as any]: String(p.burstY),
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-3 pb-10 pt-8 sm:px-5 sm:pt-12">
        <header className="mb-6 sm:mb-8">
          <p className="sr-only">
            Drum step sequencer. Space to play or stop. Keys 1 through 4 preview
            the four sample slots when loaded.
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
                if (e.key === "Enter") {
                  e.currentTarget.blur();
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
                stopPlayback();
                setPresetId(e.target.value);
              }}
              className="cursor-pointer border-2 border-yellow-600 bg-black px-3 py-2 text-sm font-medium text-yellow-400 outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              {PRESETS.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  className="bg-black text-yellow-400"
                >
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-yellow-500">
            <span className="font-semibold text-yellow-600">Master</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="Master volume"
              value={masterVolume}
              onChange={(e) => setMasterVolume(Number(e.target.value))}
              className="h-2 w-28 cursor-pointer accent-yellow-400 sm:w-32"
            />
            <span className="w-8 text-right text-xs font-bold tabular-nums text-yellow-500">
              {masterVolume}
            </span>
          </label>

          <button
            type="button"
            onClick={() => void resetSequence()}
            className="inline-flex min-w-[7rem] items-center justify-center border-2 border-yellow-700 bg-black px-5 py-2.5 text-sm font-bold tracking-wide uppercase text-yellow-500 hover:border-yellow-500 hover:text-yellow-400"
          >
            Reset
          </button>

          <button
            type="button"
            onClick={() => void togglePlay()}
            className={`inline-flex min-w-[7rem] items-center justify-center border-2 px-5 py-2.5 text-sm font-bold tracking-wide uppercase ${
              playing
                ? "border-yellow-400 bg-black text-yellow-400 hover:bg-neutral-950"
                : "border-yellow-400 bg-yellow-400 text-black hover:bg-yellow-300"
            }`}
          >
            {playing ? "Stop" : "Play"}
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
                    className={`text-[9px] font-bold tabular-nums sm:text-[10px] ${playing && playhead === step ? "text-yellow-400" : "text-yellow-800"}`}
                  >
                    {step + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-[1] mt-px flex flex-col gap-px">
            {TRACKS.map((track, trackIndex) => {
              const row = pattern[trackIndex] ?? [];
              const isMuted = mutedTracks[trackIndex] ?? false;
              return (
                <div
                  key={track.id}
                  className="flex min-w-0 items-stretch gap-2 sm:gap-3"
                >
                  <div className="flex w-11 shrink-0 flex-col items-end justify-center gap-1 sm:w-16">
                    <span
                      className={`truncate text-[10px] font-bold uppercase leading-tight sm:text-xs ${isMuted ? 'text-yellow-800 line-through' : 'text-yellow-600'}`}
                    >
                      {track.label}
                    </span>
                    <button
                      type="button"
                      aria-pressed={isMuted}
                      aria-label={`${track.label} ${isMuted ? 'unmute' : 'mute'}`}
                      onClick={() => toggleMute(trackIndex)}
                      className={`rounded border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide transition sm:text-[10px] ${isMuted ? 'border-yellow-400 bg-yellow-400 text-black' : 'border-yellow-700 bg-black text-yellow-600 hover:border-yellow-500 hover:text-yellow-500'}`}
                    >
                      {isMuted ? 'Muted' : 'Mute'}
                    </button>
                  </div>
                  <div className="grid min-w-0 flex-1 grid-cols-[repeat(16,minmax(0,1fr))] gap-px bg-yellow-950/40">
                    {Array.from({ length: 16 }, (_, step) => {
                      const on = row[step] ?? false;
                      const isPlayhead = playing && playhead === step;
                      const hitFlash =
                        on && beatFlash.col === step ? beatFlash.gen : 0;
                      return (
                        <button
                          key={step}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${track.label}, step ${step + 1}, ${on ? "on" : "off"}`}
                          data-hit-flash={hitFlash}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            beginDragPaint(trackIndex, step, on);
                          }}
                          onPointerEnter={() =>
                            continueDragPaint(trackIndex, step)
                          }
                          className={[
                            "relative isolate aspect-square min-h-0 w-full min-w-0 overflow-visible border-0 bg-black transition-colors duration-100",
                            on ? "" : columnShadeBefore(step),
                            "focus-visible:z-[2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-yellow-400 focus-visible:outline-offset-[-2px]",
                            on ? "pad-hit-active pad-on" : "",
                            isMuted ? 'opacity-50' : '',
                            on ? "bg-yellow-400" : "hover:bg-neutral-950",
                            isPlayhead && !on
                              ? "z-[1] outline outline-2 outline-yellow-400 outline-offset-[-2px]"
                              : "",
                            isPlayhead && on
                              ? "z-[1] outline outline-2 outline-black outline-offset-[-2px]"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {on && hitFlash !== 0 && (
                            <span
                              className="pointer-events-none absolute inset-0 z-[2] pad-hit-particles"
                              aria-hidden="true"
                            >
                              <span className="pad-hit-particle pad-hit-particle-a" />
                              <span className="pad-hit-particle pad-hit-particle-b" />
                              <span className="pad-hit-particle pad-hit-particle-c" />
                              <span className="pad-hit-particle pad-hit-particle-d" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="mt-8 pb-1 text-center text-xs text-yellow-700 sm:mt-10">
          <p>Made by @ohhbaro</p>
          <p>
            View the source on{" "}
            <a
              href="https://github.com/bartlomiejcwiklak/beatclick/tree/main"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-yellow-500 underline decoration-yellow-700/70 underline-offset-2 hover:text-yellow-300"
            >
              Github
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
