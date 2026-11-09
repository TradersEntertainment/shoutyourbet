import { INSTRUMENTS } from "@syb/shared";
import { hub, type PriceProvider } from "./hub.js";

/** MOCK_VOLATILITY=5 makes prices swing 5x harder (demos, recordings). */
const VOL = Number(process.env.MOCK_VOLATILITY ?? 1) || 1;

/**
 * Random walk with occasional pumps/dumps so alarms & chaos happen in dev.
 */
export const mockProvider: PriceProvider = {
  name: "mock",
  start() {
    const state = new Map(INSTRUMENTS.map((i) => [i.id, { price: i.mockPrice, open: i.mockPrice, drift: 0 }]));
    setInterval(() => {
      for (const inst of INSTRUMENTS) {
        const s = state.get(inst.id)!;
        // a "whale" shows up roughly every ~3 minutes per instrument
        if (Math.random() < 1 / 180) s.drift = (Math.random() < 0.5 ? -1 : 1) * inst.alarmPct * 0.12;
        s.drift *= 0.93;
        const noise = (Math.random() - 0.5) * inst.alarmPct * 0.04 * VOL;
        s.price *= 1 + (s.drift + noise) / 100;
        hub.publish({
          instrumentId: inst.id,
          price: s.price,
          change24h: ((s.price - s.open) / s.open) * 100,
          ts: Date.now(),
          delayed: false,
        });
      }
    }, 1000);
  },
};
