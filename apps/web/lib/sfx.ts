"use client";
/**
 * Tiny WebAudio synth for the soundboard — no audio files, no licensing.
 * Replace with real samples (e.g. /public/sfx/<id>.mp3) later.
 */
let ctx: AudioContext | null = null;
let muted = false;
export const setSfxMuted = (m: boolean) => (muted = m);
export const isSfxMuted = () => muted;

function ac() {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; at?: number; to?: number; vol?: number } = {}) {
  const c = ac();
  const t = c.currentTime + (opts.at ?? 0);
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? "square";
  o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  g.gain.setValueAtTime(opts.vol ?? 0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, at = 0, vol = 0.2) {
  const c = ac();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.random();
  const src = c.createBufferSource();
  const g = c.createGain();
  src.buffer = buf;
  g.gain.setValueAtTime(vol, c.currentTime + at);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + dur);
  src.connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}

const SOUNDS: Record<string, () => void> = {
  horn: () => {
    tone(330, 0.35, { type: "sawtooth" });
    tone(415, 0.35, { type: "sawtooth" });
    tone(330, 0.5, { type: "sawtooth", at: 0.4 });
    tone(415, 0.5, { type: "sawtooth", at: 0.4 });
  },
  rekt: () => {
    tone(600, 0.25, { type: "square", to: 300 });
    tone(450, 0.25, { type: "square", at: 0.25, to: 220 });
    tone(300, 0.8, { type: "square", at: 0.5, to: 60 });
  },
  moon: () => {
    noise(1.2, 0, 0.15);
    tone(200, 1.2, { type: "sawtooth", to: 1800, vol: 0.1 });
  },
  cash: () => {
    noise(0.08, 0, 0.3);
    tone(2600, 0.5, { type: "sine", at: 0.1, vol: 0.2 });
    tone(3300, 0.6, { type: "sine", at: 0.15, vol: 0.15 });
  },
  cry: () => {
    for (let i = 0; i < 3; i++) tone(700, 0.35, { type: "triangle", at: i * 0.4, to: 450, vol: 0.2 });
  },
  applause: () => {
    for (let i = 0; i < 14; i++) noise(0.05, i * 0.08 + Math.random() * 0.04, 0.25);
  },
  siren: () => {
    for (let i = 0; i < 3; i++) {
      tone(600, 0.3, { type: "sawtooth", at: i * 0.6, to: 1200, vol: 0.08 });
      tone(1200, 0.3, { type: "sawtooth", at: i * 0.6 + 0.3, to: 600, vol: 0.08 });
    }
  },
  boing: () => tone(150, 0.5, { type: "sine", to: 600, vol: 0.3 }),
  long: () => {
    tone(440, 0.12, { type: "square" });
    tone(660, 0.25, { type: "square", at: 0.12 });
  },
  short: () => {
    tone(660, 0.12, { type: "square" });
    tone(330, 0.25, { type: "square", at: 0.12 });
  },
};

export function playSfx(id: string) {
  if (muted) return;
  try {
    SOUNDS[id]?.();
  } catch {
    /* audio blocked until user gesture */
  }
}
