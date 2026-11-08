"use client";
import { useState } from "react";

/** TradingView free widget (iframe embed) — visual only. */
export function TVChart({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(true);
  const src =
    `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}` +
    `&interval=5&theme=dark&style=1&locale=tr&hidesidetoolbar=1&hide_top_toolbar=0&saveimage=0&toolbarbg=0f1115`;
  return (
    <section className="card chart">
      <button className="link" onClick={() => setOpen((o) => !o)}>
        📈 Grafik {open ? "▲ gizle" : "▼ göster"}
      </button>
      {open && <iframe title="TradingView chart" src={src} loading="lazy" allowFullScreen />}
    </section>
  );
}
