"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { instrumentById, type DataMsg } from "@syb/shared";
import { fmtPct, fmtPrice } from "@/lib/api";
import { playSfx } from "@/lib/sfx";
import { SFX } from "@syb/shared";

type Particle = { id: number; emoji: string; x: number; delay: number; size: number };
type Banner = { id: number; text: string; kind: "long" | "short" };
type Toast = { id: number; text: string; good: boolean };
type Alarm = { id: number; text: string; dir: "up" | "down" };
export type FeedItem = { id: number; at: number; text: string };

let seq = 0;
const nextId = () => ++seq;

const RESULT_GOOD = ["Kâhin ilan edildi", "Lambo yolda", "Mum okudu", "Grafik ona çalışıyor"];
const RESULT_BAD = ["REKT oldu", "likide oldu", "duvara tosladı", "mumun altında kaldı"];
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

/** All the comedic visual effects of a room, driven by DataMsgs. */
export function useChaos() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const events = useRef<number[]>([]);
  const [chaosLevel, setChaosLevel] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      events.current = events.current.filter((e) => now - e < 10_000);
      setChaosLevel(Math.min(100, events.current.length * 6));
    }, 500);
    return () => clearInterval(t);
  }, []);

  const later = (ms: number, fn: () => void) => setTimeout(fn, ms);
  const log = (text: string) => setFeed((f) => [{ id: nextId(), at: Date.now(), text }, ...f].slice(0, 40));

  const handle = useCallback((m: DataMsg) => {
    events.current.push(Date.now());
    switch (m.t) {
      case "REACT": {
        const ps = Array.from({ length: 7 }, () => ({
          id: nextId(),
          emoji: m.emoji,
          x: Math.random() * 92,
          delay: Math.random() * 0.4,
          size: 24 + Math.random() * 28,
        }));
        setParticles((p) => [...p, ...ps].slice(-150));
        later(3200, () => setParticles((p) => p.filter((x) => !ps.includes(x))));
        break;
      }
      case "SFX": {
        playSfx(m.id);
        const def = SFX.find((s) => s.id === m.id);
        log(`${def?.emoji ?? "🔊"} ${m.from}: ${def?.label ?? m.id}`);
        break;
      }
      case "SHOUT": {
        const kind = m.side === "LONG" ? "long" : "short";
        playSfx(kind);
        const b = { id: nextId(), kind, text: `${m.side === "LONG" ? "🐂" : "🐻"} ${m.from}: ${m.side}!!! @ ${fmtPrice(m.price)}` } as Banner;
        setBanners((x) => [...x, b].slice(-4));
        later(3000, () => setBanners((x) => x.filter((y) => y.id !== b.id)));
        log(`${m.side === "LONG" ? "🐂" : "🐻"} ${m.from} ${m.side} bağırdı @ ${fmtPrice(m.price)}`);
        break;
      }
      case "RESULT": {
        const good = m.pct > 0;
        const text = `${good ? "🎯" : "💀"} ${m.from}'in ${m.side}'u ${fmtPct(m.pct)} → ${pick(good ? RESULT_GOOD : RESULT_BAD)} (${m.points > 0 ? "+" : ""}${m.points} puan)`;
        playSfx(good ? "cash" : "rekt");
        const t = { id: nextId(), text, good };
        setToasts((x) => [...x, t].slice(-4));
        later(6000, () => setToasts((x) => x.filter((y) => y.id !== t.id)));
        log(text);
        break;
      }
      case "ALARM": {
        playSfx("siren");
        const inst = instrumentById(m.instrumentId);
        const text = `🚨 ${inst?.name ?? m.instrumentId} 1 dakikada ${fmtPct(m.pct)}! ${m.dir === "up" ? "🚀🚀🚀" : "🩸🩸🩸"}`;
        const a = { id: nextId(), text, dir: m.dir };
        setAlarm(a);
        later(4500, () => setAlarm((cur) => (cur?.id === a.id ? null : cur)));
        log(text);
        break;
      }
      case "RAISE_HAND":
        if (m.up) log(`✋ ${m.from} el kaldırdı`);
        break;
    }
  }, []);

  return { particles, banners, toasts, alarm, feed, chaosLevel, handle };
}

export function ChaosOverlay({ chaos }: { chaos: ReturnType<typeof useChaos> }) {
  return (
    <>
      <div className="overlay" aria-hidden>
        {chaos.particles.map((p) => (
          <span key={p.id} className="particle" style={{ left: `${p.x}%`, animationDelay: `${p.delay}s`, fontSize: p.size }}>
            {p.emoji}
          </span>
        ))}
        <div className="banners">
          {chaos.banners.map((b) => (
            <div key={b.id} className={`banner ${b.kind}`}>
              {b.text}
            </div>
          ))}
        </div>
        <div className="toasts">
          {chaos.toasts.map((t) => (
            <div key={t.id} className={`toast ${t.good ? "good" : "bad"}`}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
      {chaos.alarm && (
        <div key={chaos.alarm.id} className={`alarm ${chaos.alarm.dir}`} role="alert">
          <div className="alarm-text">{chaos.alarm.text}</div>
        </div>
      )}
    </>
  );
}
