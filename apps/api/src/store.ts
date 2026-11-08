import { randomUUID } from "node:crypto";
import { INSTRUMENTS, officialRoomName, type LeaderRow, type RoomInfo, type RoomMode, type Side } from "@syb/shared";

export interface Shout {
  id: string;
  room: string;
  identity: string;
  name: string;
  instrumentId: string;
  side: Side;
  entryPrice: number;
  createdAt: number;
  resolveAt: number;
  resolved?: { exitPrice: number; pct: number; points: number };
}

interface UserRoom extends Omit<RoomInfo, "participants"> {
  hostIdentity: string;
  hostKey: string;
}

/**
 * In-memory store. Same shape as supabase/schema.sql so it can be swapped
 * for a Supabase-backed implementation later.
 */
class MemoryStore {
  private userRooms = new Map<string, UserRoom>();
  shouts: Shout[] = [];
  reports: { room: string; target: string; reporter: string; reason: string; at: number }[] = [];

  officialRooms(): Omit<RoomInfo, "participants">[] {
    return INSTRUMENTS.map((i) => ({
      name: officialRoomName(i.id),
      title: `${i.emoji} ${i.name} Kaos Odası`,
      instrumentId: i.id,
      mode: "open" as RoomMode,
      official: true,
      createdAt: 0,
    }));
  }

  listRooms(): Omit<RoomInfo, "participants">[] {
    const user = [...this.userRooms.values()].map(({ hostKey: _k, hostIdentity: _h, ...r }) => r);
    return [...this.officialRooms(), ...user];
  }

  getRoom(name: string) {
    return this.listRooms().find((r) => r.name === name);
  }

  roomsForInstrument(instrumentId: string) {
    return this.listRooms().filter((r) => r.instrumentId === instrumentId).map((r) => r.name);
  }

  createRoom(input: { title: string; instrumentId: string; mode: RoomMode; hostIdentity: string; hostName: string }) {
    const name = `u-${randomUUID().slice(0, 8)}`;
    const hostKey = randomUUID();
    this.userRooms.set(name, {
      name,
      title: input.title,
      instrumentId: input.instrumentId,
      mode: input.mode,
      official: false,
      createdBy: input.hostName,
      createdAt: Date.now(),
      hostIdentity: input.hostIdentity,
      hostKey,
    });
    return { name, hostKey };
  }

  isHost(room: string, identity: string, hostKey?: string) {
    const r = this.userRooms.get(room);
    return Boolean(r && r.hostIdentity === identity && hostKey && r.hostKey === hostKey);
  }

  /** Remove user rooms that have been empty for a while (called by janitor). */
  dropRoom(name: string) {
    this.userRooms.delete(name);
  }
  userRoomNames() {
    return [...this.userRooms.values()].map((r) => ({ name: r.name, createdAt: r.createdAt }));
  }

  addShout(s: Omit<Shout, "id">) {
    const shout = { ...s, id: randomUUID() };
    this.shouts.push(shout);
    return shout;
  }

  dueShouts(now: number) {
    return this.shouts.filter((s) => !s.resolved && s.resolveAt <= now);
  }

  /** Leaderboard; room=undefined -> global for today (UTC). */
  leaderboard(room?: string): LeaderRow[] {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const rows = new Map<string, LeaderRow>();
    for (const s of this.shouts) {
      if (!s.resolved) continue;
      if (room ? s.room !== room : s.createdAt < dayStart.getTime()) continue;
      const r = rows.get(s.identity) ?? { identity: s.identity, name: s.name, points: 0, wins: 0, losses: 0, worstPct: 0 };
      r.name = s.name;
      r.points += s.resolved.points;
      if (s.resolved.pct > 0) r.wins++;
      else r.losses++;
      r.worstPct = Math.min(r.worstPct, s.resolved.pct);
      rows.set(s.identity, r);
    }
    return [...rows.values()].sort((a, b) => b.points - a.points).slice(0, 20);
  }
}

export const store = new MemoryStore();
