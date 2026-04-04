import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', 'public', 'samples')

function writeWav(path, samples, sampleRate = 44100) {
  mkdirSync(dirname(path), { recursive: true })
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  let o = 0
  buffer.write('RIFF', o); o += 4
  buffer.writeUInt32LE(36 + dataSize, o); o += 4
  buffer.write('WAVE', o); o += 4
  buffer.write('fmt ', o); o += 4
  buffer.writeUInt32LE(16, o); o += 4
  buffer.writeUInt16LE(1, o); o += 2
  buffer.writeUInt16LE(numChannels, o); o += 2
  buffer.writeUInt32LE(sampleRate, o); o += 4
  buffer.writeUInt32LE(byteRate, o); o += 4
  buffer.writeUInt16LE(blockAlign, o); o += 2
  buffer.writeUInt16LE(bitsPerSample, o); o += 2
  buffer.write('data', o); o += 4
  buffer.writeUInt32LE(dataSize, o); o += 4
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, o)
    o += 2
  }
  writeFileSync(path, buffer)
}

function genKick(sr, dur = 0.35) {
  const n = Math.floor(sr * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = Math.exp(-t * 12)
    const f0 = 180 * Math.exp(-t * 18) + 45
    const ph = 2 * Math.PI * f0 * t
    out[i] = env * 0.95 * Math.sin(ph)
  }
  return out
}

function genSnare(sr, dur = 0.2) {
  const n = Math.floor(sr * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = Math.exp(-t * 22)
    const noise = (Math.random() * 2 - 1) * 0.45
    const tone = 0.12 * Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 40)
    out[i] = env * (noise + tone)
  }
  return out
}

function genHihat(sr, dur = 0.08) {
  const n = Math.floor(sr * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const env = Math.exp(-t * 55)
    let s = 0
    for (const f of [8000, 10200, 12400]) {
      s += Math.sin(2 * Math.PI * f * t + i * 0.1) * 0.12
    }
    s += (Math.random() * 2 - 1) * 0.15
    out[i] = env * s
  }
  return out
}

function genClap(sr, dur = 0.25) {
  const n = Math.floor(sr * dur)
  const out = new Float32Array(n)
  const bursts = [0, 0.012, 0.024].map((off) => Math.floor(off * sr))
  for (let i = 0; i < n; i++) {
    const t = i / sr
    let v = 0
    for (const b of bursts) {
      if (i >= b) {
        const lt = (i - b) / sr
        v += (Math.random() * 2 - 1) * Math.exp(-lt * 35) * 0.35
      }
    }
    out[i] = Math.max(-1, Math.min(1, v)) * Math.exp(-t * 4)
  }
  return out
}

const kits = {
  'warehouse': { kickMul: 1, snareBright: 1 },
  'loft': { kickMul: 0.85, snareBright: 1.15 },
}

for (const [name, opts] of Object.entries(kits)) {
  const dir = join(root, name)
  const kick = genKick(44100)
  if (opts.kickMul !== 1) {
    for (let i = 0; i < kick.length; i++) kick[i] *= opts.kickMul
  }
  writeWav(join(dir, 'kick.wav'), kick)
  writeWav(join(dir, 'snare.wav'), genSnare(44100))
  writeWav(join(dir, 'hihat.wav'), genHihat(44100))
  const clap = genClap(44100)
  if (opts.snareBright > 1) {
    for (let i = 0; i < clap.length; i++) clap[i] *= 0.9
  }
  writeWav(join(dir, 'clap.wav'), clap)
}

console.log('Wrote sample kits to public/samples/')
