"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Siren } from "lucide-react";
import { instrumentById, SFX, type DataMsg, type Side } from "@syb/shared";
import { fmtPct, fmtPrice } from "@/lib/api";
import { playSfx } from "@/lib/sfx";

type Particle = { id: number; emoji: string; x: number; delay: number; size: number; drift: number };
type Banner = { id: number; side: Side; from: string; price: number };
type Toast = { id: number; from: string; side: Side; pct: number; points: number; quip: string };
type Alarm = { id: number; name: string; dir: "up" | "down"; pct: number; price: number };
export type FeedKind = "long" | "short" | "win" | "loss" | "alarm" | "sfx" | "hand";
export type FeedItem = { id: number; at: number; kind: FeedKind; who?: string; text: string };

let seq = 0;
const nextId = () => ++seq;

const GOOD = ["Kâhin ilan edildi", "Lambo yolda", "Mumu okudu", "Grafik ona çalışıyor"];
const BAD = ["REKT", "Likide oldu", "Duvara tosladı", "Mumun altında kaldı"];
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

/** All comedic effects of a room, driven by DataMsgs. */
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
  const log = (i: Omit<FeedItem, "id" | "at">) => setFeed((f) => [{ ...i, id: nextId(), at: Date.now() }, ...f].slice(0, 60));

  const handle = useCallback((m: DataMsg) => {
    events.current.push(Date.now());
    switch (m.t) {
      case "REACT": {
        const ps = Array.from({ length: 6 }, () => ({
          id: nextId(),
          emoji: m.emoji,
          x: 8 + Math.random() * 84,
          delay: Math.random() * 0.35,
          size: 22 + Math.random() * 22,
          drift: (Math.random() - 0.5) * 120,
        }));
        setParticles((p) => [...p, ...ps].slice(-120));
        later(3000, () => setParticles((p) => p.filter((x) => !ps.includes(x))));
        break;
      }
      case "SFX": {
        playSfx(m.id);
        const def = SFX.find((s) => s.id === m.id);
        log({ kind: "sfx", who: m.from, text: `${def?.emoji ?? ""} ${def?.label ?? m.id}` });
        break;
      }
      case "SHOUT": {
        playSfx(m.side === "LONG" ? "long" : "short");
        const b: Banner = { id: nextId(), side: m.side, from: m.from, price: m.price };
        setBanners((x) => [b, ...x].slice(0, 3));
        later(4000, () => setBanners((x) => x.filter((y) => y.id !== b.id)));
        log({ kind: m.side === "LONG" ? "long" : "short", who: m.from, text: `${m.side} @ ${fmtPrice(m.price)}` });
        break;
      }
      case "RESULT": {
        const good = m.pct > 0;
        playSfx(good ? "cash" : "rekt");
        const t: Toast = { id: nextId(), from: m.from, side: m.side, pct: m.pct, points: m.points, quip: pick(good ? GOOD : BAD) };
        setToasts((x) => [...x, t].slice(-4));
        later(6500, () => setToasts((x) => x.filter((y) => y.id !== t.id)));
        log({ kind: good ? "win" : "loss", who: m.from, text: `${m.side} ${fmtPct(m.pct)} · ${m.points > 0 ? "+" : ""}${m.points} puan · ${t.quip}` });
        break;
      }
      case "ALARM": {
        playSfx("siren");
        const inst = instrumentById(m.instrumentId);
        const a: Alarm = { id: nextId(), name: inst?.name ?? m.instrumentId, dir: m.dir, pct: m.pct, price: m.price };
        setAlarm(a);
        later(5000, () => setAlarm((cur) => (cur?.id === a.id ? null : cur)));
        log({ kind: "alarm", text: `${a.name} 1 dakikada ${fmtPct(m.pct)}` });
        break;
      }
      case "RAISE_HAND":
        if (m.up) log({ kind: "hand", who: m.from, text: "el kaldırdı" });
        break;
    }
  }, []);

  return { particles, banners, toasts, alarm, feed, chaosLevel, handle };
}

export function ChaosOverlay({ chaos }: { chaos: ReturnType<typeof useChaos> }) {
  const a = chaos.alarm;
  return (
    <>
      <div className="fx-layer" aria-hidden>
        {chaos.particles.map((p) => (
          <span
            key={p.id}
            className="particle"
            style={{ left: `${p.x}%`, animationDelay: `${p.delay}s`, fontSize: p.size, ["--drift" as string]: `${p.drift}px` }}
          >
            {p.emoji}
          </span>
        ))}
      </div>
      <div className="fx-banners" aria-live="polite">
        {chaos.banners.map((b) => (
          <div key={b.id} className={`trade-note ${b.side === "LONG" ? "long" : "short"}`}>
            <span className="tn-icon">{b.side === "LONG" ? <TrendingUp size={18} /> : <TrendingDown size={18} />}</span>
            <span className="tn-body">
              <b>{b.from}</b> <span className="tn-side">{b.side}</span> bağırdı
            </span>
            <span className="mono tn-price">@ {fmtPrice(b.price)}</span>
          </div>
        ))}
      </div>
      <div className="fx-toasts" aria-live="polite">
        {chaos.toasts.map((t) => (
          <div key={t.id} className={`pnl-toast ${t.pct > 0 ? "win" : "loss"}`}>
            <div className="pnl-top">
              <span>
                <b>{t.from}</b> · {t.side}
              </span>
              <span className="mono pnl-pct">{fmtPct(t.pct)}</span>
            </div>
            <div className="pnl-bottom">
              <span>{t.quip}</span>
              <span className="mono">
                {t.points > 0 ? "+" : ""}
                {t.points} puan
              </span>
            </div>
          </div>
        ))}
      </div>
      {a && (
        <div key={a.id} className={`alarm-frame ${a.dir}`} role="alert">
          <div className="alarm-strip">
            <Siren size={22} />
            <span>
              <b>{a.name}</b> 1 dakikada
            </span>
            <span className="mono alarm-pct">{fmtPct(a.pct)}</span>
            <span className="mono muted-strong">{fmtPrice(a.price)}</span>
          </div>
        </div>
      )}
    </>
  );
}
