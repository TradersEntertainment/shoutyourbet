import { INSTRUMENTS } from "@syb/shared";
import { hub, type PriceProvider } from "./hub.js";

/**
 * Indices via Yahoo Finance's public chart endpoint (unofficial, delayed).
 * Swap for Finnhub / Twelve Data by implementing another PriceProvider.
 */
export const yahooProvider: PriceProvider = {
  name: "yahoo",
  start() {
    const indices = INSTRUMENTS.filter((i) => i.yahoo);
    const poll = async () => {
      for (const inst of indices) {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo!)}?interval=1m&range=1d`,
            { headers: { "User-Agent": "Mozilla/5.0 shoutyourbet" } },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: any = await res.json();
          const meta = json.chart?.result?.[0]?.meta;
          const price = Number(meta?.regularMarketPrice);
          const prev = Number(meta?.chartPreviousClose ?? meta?.previousClose);
          if (!price) continue;
          hub.publish({
            instrumentId: inst.id,
            price,
            change24h: prev ? ((price - prev) / prev) * 100 : 0,
            ts: Date.now(),
            delayed: true,
          });
        } catch (e) {
          console.warn(`[yahoo] ${inst.id} failed: ${String(e)}`);
        }
      }
    };
    poll();
    setInterval(poll, 60_000);
  },
};
