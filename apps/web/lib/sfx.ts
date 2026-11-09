"use client";
/**
 * Soundboard playback. Plays /sfx/<id>.mp3 (generated samples);
 * falls back to a tiny WebAudio synth if the file can't be played.
 */
const listeners = new Set<(m: boolean) => void>();
let muted = false;
try {
  muted = localStorage.getItem("syb.sfxMuted") === "1";
} catch {}

export const isSfxMuted = () => muted;
export function setSfxMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("syb.sfxMuted", m ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l(m));
}
export function onSfxMuted(l: (m: boolean) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const VOLUME: Record<string, number> = { siren: 0.5, long: 0.6, short: 0.6 };
const cache = new Map<string, HTMLAudioElement>();

export function playSfx(id: string) {
  if (muted || typeof window === "undefined") return;
  let base = cache.get(id);
  if (!base) {
    base = new Audio(`/sfx/${id}.mp3`);
    base.preload = "auto";
    cache.set(id, base);
  }
  // clone so overlapping plays (chaos!) don't cut each other off
  const a = base.cloneNode(true) as HTMLAudioElement;
  a.volume = VOLUME[id] ?? 0.8;
  a.play().catch(() => synth(id));
}

/** Warm the cache so the first click isn't delayed. */
export function preloadSfx(ids: string[]) {
  if (typeof window === "undefined") return;
  for (const id of ids) {
    if (cache.has(id)) continue;
    const a = new Audio(`/sfx/${id}.mp3`);
    a.preload = "auto";
    cache.set(id, a);
  }
}

// ---------- fallback synth ----------
let ctx: AudioContext | null = null;
function tone(freq: number, dur: number, at = 0, to?: number, type: OscillatorType = "square") {
  ctx ??= new AudioContext();
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function synth(id: string) {
  try {
    if (id === "long" || id === "moon" || id === "cash") (tone(440, 0.12), tone(660, 0.25, 0.12));
    else if (id === "siren") for (let i = 0; i < 3; i++) tone(600, 0.3, i * 0.6, 1200, "sawtooth");
    else (tone(660, 0.12), tone(330, 0.3, 0.12));
  } catch {}
}
