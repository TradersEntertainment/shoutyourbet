import { env } from "../env.js";
import { binanceProvider } from "./binance.js";
import { mockProvider } from "./mock.js";
import { yahooProvider } from "./yahoo.js";

export { hub } from "./hub.js";

export function startPrices() {
  const providers = env.priceMode === "live" ? [binanceProvider, yahooProvider] : [mockProvider];
  for (const p of providers) {
    console.log(`[prices] starting ${p.name}`);
    p.start();
  }
}
