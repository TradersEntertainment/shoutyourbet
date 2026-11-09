import { randomUUID } from "node:crypto";
import type { LeaderRow, Side } from "@syb/shared";
import { pool, q } from "./db.js";

export interface Shout {
  id: string;
  room: string;
  identity: string;
  wallet?: string | null;
  name: string;
  instrumentId: string;
  side: Side;
  entryPrice: number;
  createdAt: number;
  resolveAt: number;
  resolved?: { exitPrice: number; pct: number; points: number };
}
type Resolution = NonNullable<Shout["resolved"]>;

interface ShoutRepo {
  add(s: Omit<Shout, "id">): Promise<Shout>;
  due(now: number): Promise<Shout[]>;
  resolve(id: string, r: Resolution, reward: number): Promise<void>;
  leaderboard(room?: string): Promise<LeaderRow[]>;
}

const dayStart = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

class MemoryShouts implements ShoutRepo {
  private shouts: Shout[] = [];
  async add(s: Omit<Shout, "id">) {
    const shout = { ...s, id: randomUUID() };
    this.shouts.push(shout);
    return shout;
  }
  async due(now: number) {
    return this.shouts.filter((s) => !s.resolved && s.resolveAt <= now);
  }
  async resolve(id: string, r: Resolution) {
    const s = this.shouts.find((x) => x.id === id);
    if (s) s.resolved = r;
  }
  async leaderboard(room?: string) {
    const since = dayStart().getTime();
    const rows = new Map<string, LeaderRow>();
    for (const s of this.shouts) {
      if (!s.resolved) continue;
      if (room ? s.room !== room : s.createdAt < since) continue;
      const key = s.wallet ?? s.identity;
      const r = rows.get(key) ?? { identity: key, name: s.name, points: 0, wins: 0, losses: 0, worstPct: 0 };
      r.name = s.name;
      r.points += s.resolved.points;
      if (s.resolved.pct > 0) r.wins++;
      else r.losses++;
      r.worstPct = Math.min(r.worstPct, s.resolved.pct);
      rows.set(key, r);
    }
    return [...rows.values()].sort((a, b) => b.points - a.points).slice(0, 20);
  }
}

class PgShouts implements ShoutRepo {
  async add(s: Omit<Shout, "id">) {
    const id = randomUUID();
    await q(
      `insert into shouts (id, room, identity, wallet, name, instrument_id, side, entry_price, created_at, resolve_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),to_timestamp($10/1000.0))`,
      [id, s.room, s.identity, s.wallet ?? null, s.name, s.instrumentId, s.side, s.entryPrice, s.createdAt, s.resolveAt],
    );
    return { ...s, id };
  }
  async due(now: number) {
    const rows = await q(
      `select id, room, identity, wallet, name, instrument_id, side, entry_price,
              extract(epoch from created_at)*1000 created_at, extract(epoch from resolve_at)*1000 resolve_at
       from shouts where exit_price is null and resolve_at <= to_timestamp($1/1000.0) limit 500`,
      [now],
    );
    return rows.map((r) => ({
      id: r.id, room: r.room, identity: r.identity, wallet: r.wallet, name: r.name, instrumentId: r.instrument_id,
      side: r.side, entryPrice: r.entry_price, createdAt: Number(r.created_at), resolveAt: Number(r.resolve_at),
    }));
  }
  async resolve(id: string, r: Resolution, reward: number) {
    await q("update shouts set exit_price=$2, pct=$3, points=$4, reward=$5 where id=$1", [id, r.exitPrice, r.pct, r.points, Math.round(reward * 1e6)]);
  }
  async leaderboard(room?: string) {
    const rows = await q(
      `select coalesce(wallet, identity) identity, (array_agg(name order by created_at desc))[1] name,
              sum(points)::int points, count(*) filter (where pct > 0)::int wins, count(*) filter (where pct <= 0)::int losses,
              least(min(pct), 0) worst_pct, bool_or(wallet is not null) has_wallet
       from shouts where points is not null and ${room ? "room = $1" : "created_at >= $1"}
       group by 1 order by 3 desc limit 20`,
      [room ?? dayStart()],
    );
    return rows.map((r) => ({ identity: r.identity, name: r.name, points: r.points, wins: r.wins, losses: r.losses, worstPct: r.worst_pct, wallet: r.has_wallet ? r.identity : undefined }));
  }
}

export const shouts: ShoutRepo = pool ? new PgShouts() : new MemoryShouts();
