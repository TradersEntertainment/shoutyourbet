import { hub } from "./prices/index.js";
import { broadcast } from "./livekit.js";
import { store } from "./store.js";

/** Basis points of the move in your direction, +10 bonus for being right, -5 for being wrong. */
export function score(side: "LONG" | "SHORT", entry: number, exit: number) {
  const raw = ((exit - entry) / entry) * 100;
  const pct = side === "LONG" ? raw : -raw;
  const points = Math.round(pct * 100) + (pct > 0 ? 10 : -5);
  return { pct, points };
}

export function startScoring() {
  setInterval(() => {
    for (const s of store.dueShouts(Date.now())) {
      const exit = hub.get(s.instrumentId)?.price;
      if (!exit) continue;
      const { pct, points } = score(s.side, s.entryPrice, exit);
      s.resolved = { exitPrice: exit, pct, points };
      void broadcast(s.room, { t: "RESULT", side: s.side, pct, points, from: s.name, instrumentId: s.instrumentId });
    }
  }, 5_000);
}
