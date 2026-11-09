/**
 * Lightweight server-side speech detector for talk-to-earn.
 *
 * Feed mono 16-bit PCM (any chunk size). Every second of audio it decides
 * "was this person actually talking?" using cheap, hard-to-fake-by-accident cues:
 *  - activity: enough 20 ms blocks above a loudness floor (silence doesn't count)
 *  - zero-crossing rate in the voiced range (white noise / hiss is far above it)
 *  - syllabic modulation: speech loudness rises and falls several times a second,
 *    so the block-to-block envelope varies a lot; steady tones, hum and noise don't.
 *
 * It is a filter against idle/open mics and trivial cheats (tone generators, noise),
 * not proof of a human — that's why earning also requires real listeners in the room.
 */
export interface WindowVerdict {
  talking: boolean;
  activeRatio: number;
  modulation: number;
  zcr: number;
  /** spread of zero-crossing rate across voiced blocks (vowels vs. consonants) */
  zcrSpread: number;
  /** share of voiced blocks with near-identical zero-crossing rate (fixed pitch = machine) */
  zcrConcentration: number;
  db: number;
}

export interface AnalyzerOptions {
  sampleRate?: number;
  /** block is "active" above this loudness (dBFS) */
  activeDb?: number;
  minActiveRatio?: number;
  minModulation?: number;
  zcrRange?: [number, number];
  minZcrSpread?: number;
  maxZcrConcentration?: number;
}

const DEFAULTS = { sampleRate: 16000, activeDb: -45, minActiveRatio: 0.3, minModulation: 0.45, zcrRange: [0.015, 0.28] as [number, number], minZcrSpread: 0.25, maxZcrConcentration: 0.4 };

export class SpeechAnalyzer {
  private o: typeof DEFAULTS;
  private blockLen: number;
  private carry: Int16Array = new Int16Array(0);
  private blocks: { rms: number; zcr: number }[] = [];
  /** verdict per completed 1 s window */
  readonly windows: WindowVerdict[] = [];

  constructor(opts: AnalyzerOptions = {}) {
    this.o = { ...DEFAULTS, ...opts } as typeof DEFAULTS;
    this.blockLen = Math.round(this.o.sampleRate * 0.02);
  }

  /** Push PCM; returns verdicts for windows completed by this chunk. */
  push(pcm: Int16Array): WindowVerdict[] {
    const data = this.carry.length ? concat(this.carry, pcm) : pcm;
    let off = 0;
    const out: WindowVerdict[] = [];
    while (off + this.blockLen <= data.length) {
      this.blocks.push(blockFeatures(data, off, this.blockLen));
      off += this.blockLen;
      if (this.blocks.length === 50) {
        const v = this.decide(this.blocks);
        this.windows.push(v);
        out.push(v);
        this.blocks = [];
      }
    }
    this.carry = data.slice(off);
    return out;
  }

  private decide(blocks: { rms: number; zcr: number }[]): WindowVerdict {
    const toDb = (r: number) => 20 * Math.log10(Math.max(r, 1e-9));
    const active = blocks.filter((b) => toDb(b.rms) > this.o.activeDb);
    const activeRatio = active.length / blocks.length;
    const rms = blocks.map((b) => b.rms);
    const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
    const sd = Math.sqrt(rms.reduce((a, b) => a + (b - mean) ** 2, 0) / rms.length);
    const modulation = mean > 0 ? sd / mean : 0;
    const zcr = active.length ? active.reduce((a, b) => a + b.zcr, 0) / active.length : 0;
    const zsd = active.length ? Math.sqrt(active.reduce((a, b) => a + (b.zcr - zcr) ** 2, 0) / active.length) : 0;
    const zcrSpread = zcr > 0 ? zsd / zcr : 0;
    const sortedZ = active.map((b) => b.zcr).sort((a, b) => a - b);
    const med = sortedZ[Math.floor(sortedZ.length / 2)] ?? 0;
    const zcrConcentration = med > 0 ? sortedZ.filter((z) => Math.abs(z - med) / med < 0.04).length / sortedZ.length : 0;
    const talking =
      activeRatio >= this.o.minActiveRatio &&
      modulation >= this.o.minModulation &&
      zcr >= this.o.zcrRange[0] &&
      zcr <= this.o.zcrRange[1] &&
      zcrSpread >= this.o.minZcrSpread &&
      zcrConcentration <= this.o.maxZcrConcentration;
    return { talking, activeRatio, modulation, zcr, zcrSpread, zcrConcentration, db: toDb(mean) };
  }

  get talkingSeconds() {
    return this.windows.filter((w) => w.talking).length;
  }
}

function blockFeatures(d: Int16Array, off: number, n: number) {
  let sum = 0;
  let crossings = 0;
  let prev = d[off];
  for (let i = off; i < off + n; i++) {
    const x = d[i];
    sum += x * x;
    if ((x >= 0) !== (prev >= 0)) crossings++;
    prev = x;
  }
  return { rms: Math.sqrt(sum / n) / 32768, zcr: crossings / n };
}

function concat(a: Int16Array, b: Int16Array) {
  const out = new Int16Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Downmix + resample any Int16 PCM to mono 16 kHz (linear interpolation, good enough for VAD). */
export function toMono16k(data: Int16Array, sampleRate: number, channels: number): Int16Array {
  const frames = Math.floor(data.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += data[i * channels + c];
    mono[i] = s / channels;
  }
  if (sampleRate === 16000) return Int16Array.from(mono, (x) => Math.round(x));
  const ratio = sampleRate / 16000;
  const n = Math.floor(frames / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = Math.round((mono[j] ?? 0) * (1 - f) + (mono[j + 1] ?? mono[j] ?? 0) * f);
  }
  return out;
}
