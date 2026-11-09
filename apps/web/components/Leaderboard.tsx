"use client";
import { useEffect, useState } from "react";
import { Trophy, Skull } from "lucide-react";
import type { LeaderRow } from "@syb/shared";
import { api } from "@/lib/api";

export function Leaderboard({ room, title }: { room?: string; title?: string }) {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.leaderboard(room).then((r) => alive && setRows(r)).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [room]);

  const rekt = [...rows].sort((a, b) => a.worstPct - b.worstPct)[0];
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <Trophy size={15} /> {title ?? (room ? "Oda kâhinleri" : "Günün kâhinleri")}
        </h3>
      </header>
      {rows.length === 0 ? (
        <p className="empty">Henüz puanlanan tahmin yok. LONG/SHORT bağır, sonucu bekle.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Trader</th>
              <th className="r">K/Z</th>
              <th className="r">Puan</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r, i) => (
              <tr key={r.identity}>
                <td className={`rank r${i + 1}`}>{i + 1}</td>
                <td className="ellipsis">{r.name}</td>
                <td className="r mono muted">
                  {r.wins}/{r.losses}
                </td>
                <td className={`r mono ${r.points >= 0 ? "up" : "down"}`}>{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rekt && rekt.worstPct < 0 && (
        <div className="rekt-card">
          <Skull size={16} />
          <span>
            Günün REKT'i <b>{rekt.name}</b>
          </span>
          <span className="mono down">{rekt.worstPct.toFixed(2)}%</span>
        </div>
      )}
    </section>
  );
}
