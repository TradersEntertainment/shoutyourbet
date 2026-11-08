import { INSTRUMENTS } from "@syb/shared";
import { hub } from "./prices/index.js";
import { broadcast } from "./livekit.js";
import { store } from "./store.js";

const WINDOW_MS = 60_000;
const COOLDOWN_MS = 120_000;
const lastFired = new Map<string, number>();

export async function fireAlarm(instrumentId: string, pct: number, price: number) {
  lastFired.set(instrumentId, Date.now());
  const msg = { t: "ALARM" as const, instrumentId, dir: pct >= 0 ? ("up" as const) : ("down" as const), pct, price };
  console.log(`[alarm] ${instrumentId} ${pct.toFixed(2)}%`);
  await Promise.all(store.roomsForInstrument(instrumentId).map((r) => broadcast(r, msg)));
  return msg;
}

/** Fires an ALARM into every room of an instrument on a sharp move. */
export function startAlarms() {
  hub.subscribe((t) => {
    const inst = INSTRUMENTS.find((i) => i.id === t.instrumentId);
    if (!inst) return;
    if (Date.now() - (lastFired.get(inst.id) ?? 0) < COOLDOWN_MS) return;
    const then = hub.priceAgo(inst.id, WINDOW_MS);
    if (!then) return;
    const pct = ((t.price - then) / then) * 100;
    if (Math.abs(pct) >= inst.alarmPct) void fireAlarm(inst.id, pct, t.price);
  });
}
