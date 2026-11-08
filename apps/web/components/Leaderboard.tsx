"use client";
import { useEffect, useState } from "react";
import type { LeaderRow } from "@syb/shared";
import { api } from "@/lib/api";

export function Leaderboard({ room }: { room?: string }) {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.leaderboard(room).then((r) => alive && setRows(r)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [room]);

  const rekt = [...rows].sort((a, b) => a.worstPct - b.worstPct)[0];
  return (
    <section className="card">
      <h3>🏆 {room ? "Oda Kâhinleri" : "Günün Kâhinleri"}</h3>
      {rows.length === 0 ? (
        <p className="muted">Henüz kimse puanlanmadı. LONG/SHORT bağır, sonucu bekle.</p>
      ) : (
        <ol className="leader">
          {rows.slice(0, 8).map((r) => (
            <li key={r.identity}>
              <span>{r.name}</span>
              <span className={r.points >= 0 ? "up" : "down"}>
                {r.points} <small>({r.wins}✅ {r.losses}❌)</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {rekt && rekt.worstPct < 0 && (
        <p className="rekt">
          💀 Günün REKT'i: <b>{rekt.name}</b> ({rekt.worstPct.toFixed(2)}%)
        </p>
      )}
    </section>
  );
}
