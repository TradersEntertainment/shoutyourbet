import { fmtPct } from "@/lib/api";

export function Change({ v, pill = false }: { v?: number; pill?: boolean }) {
  if (v == null) return <span className="muted mono">—</span>;
  const cls = v >= 0 ? "up" : "down";
  return <span className={`mono ${cls} ${pill ? `chg-pill ${cls}-bg` : ""}`}>{fmtPct(v)}</span>;
}
