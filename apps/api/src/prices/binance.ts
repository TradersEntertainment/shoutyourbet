import { INSTRUMENTS } from "@syb/shared";
import { hub, type PriceProvider } from "./hub.js";

/** Binance public miniTicker stream — free, no API key. */
export const binanceProvider: PriceProvider = {
  name: "binance",
  start() {
    const crypto = INSTRUMENTS.filter((i) => i.binance);
    const bySymbol = new Map(crypto.map((i) => [i.binance!.toUpperCase(), i.id]));
    const streams = crypto.map((i) => `${i.binance}@miniTicker`).join("/");
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    const connect = (attempt = 0) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        attempt = 0;
        console.log("[binance] connected");
      };
      ws.onmessage = (ev) => {
        try {
          const { data } = JSON.parse(String(ev.data));
          const id = bySymbol.get(data.s);
          if (!id) return;
          const price = Number(data.c);
          const open = Number(data.o);
          hub.publish({ instrumentId: id, price, change24h: ((price - open) / open) * 100, ts: data.E ?? Date.now() });
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        const wait = Math.min(30_000, 1000 * 2 ** attempt);
        console.warn(`[binance] closed, reconnecting in ${wait}ms`);
        setTimeout(() => connect(attempt + 1), wait);
      };
      ws.onerror = () => ws.close();
    };
    connect();
  },
};
