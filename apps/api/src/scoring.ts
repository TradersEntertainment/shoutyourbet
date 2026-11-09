import { hub } from "./prices/index.js";
import { broadcast } from "./livekit.js";
import { shouts } from "./shouts.js";
import { economyEnabled } from "./env.js";
import { creditReward } from "./economy.js";

/** Basis points of the move in your direction, +10 bonus for being right, -5 for being wrong. */
export function score(side: "LONG" | "SHORT", entry: number, exit: number) {
  const raw = ((exit - entry) / entry) * 100;
  const pct = side === "LONG" ? raw : -raw;
  const points = Math.round(pct * 100) + (pct > 0 ? 10 : -5);
  return { pct, points };
}

let running = false;
export function startScoring() {
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const s of await shouts.due(Date.now())) {
        const exit = hub.get(s.instrumentId)?.price;
        if (!exit) continue;
        const { pct, points } = score(s.side, s.entryPrice, exit);
        let reward = 0;
        if (s.wallet && economyEnabled()) reward = await creditReward(s.wallet, s.id, points).catch((e) => (console.warn("[reward]", String(e)), 0));
        await shouts.resolve(s.id, { exitPrice: exit, pct, points }, reward);
        void broadcast(s.room, { t: "RESULT", side: s.side, pct, points, from: s.name, instrumentId: s.instrumentId, reward });
      }
    } catch (e) {
      console.warn("[scoring]", String(e));
    } finally {
      running = false;
    }
  }, 5_000);
}
