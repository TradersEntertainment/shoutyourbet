import type { PriceTick } from "@syb/shared";

type Listener = (t: PriceTick) => void;

/** Latest prices + a short history per instrument (for alarms & scoring). */
class PriceHub {
  private latest = new Map<string, PriceTick>();
  private history = new Map<string, { ts: number; price: number }[]>();
  private listeners = new Set<Listener>();
  /** history kept for alarm windows */
  readonly keepMs = 5 * 60_000;

  publish(t: PriceTick) {
    this.latest.set(t.instrumentId, t);
    const h = this.history.get(t.instrumentId) ?? [];
    h.push({ ts: t.ts, price: t.price });
    while (h.length && h[0].ts < t.ts - this.keepMs) h.shift();
    this.history.set(t.instrumentId, h);
    for (const l of this.listeners) l(t);
  }

  get(id: string) {
    return this.latest.get(id);
  }
  snapshot() {
    return [...this.latest.values()];
  }
  /** Price ~windowMs ago (oldest point inside the window). */
  priceAgo(id: string, windowMs: number) {
    const h = this.history.get(id);
    if (!h?.length) return undefined;
    const cutoff = Date.now() - windowMs;
    return h.find((p) => p.ts >= cutoff)?.price;
  }
  /** Downsampled recent history for sparklines: ~points samples over keepMs. */
  sparkline(points = 40) {
    const out: Record<string, number[]> = {};
    for (const [id, h] of this.history) {
      if (!h.length) continue;
      const step = Math.max(1, Math.floor(h.length / points));
      out[id] = h.filter((_, i) => i % step === 0).map((p) => p.price);
      out[id].push(h[h.length - 1].price);
    }
    return out;
  }
  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const hub = new PriceHub();

export interface PriceProvider {
  name: string;
  start(): void;
}
