"use client";

/** TradingView free widget (iframe embed) — visual only. */
export function TVChart({ symbol }: { symbol: string }) {
  const src =
    `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}` +
    `&interval=5&theme=dark&style=1&locale=tr&hidesidetoolbar=1&saveimage=0&toolbarbg=12161c&backgroundColor=%2312161c`;
  return <iframe className="tv" title="TradingView grafiği" src={src} loading="lazy" allowFullScreen />;
}
