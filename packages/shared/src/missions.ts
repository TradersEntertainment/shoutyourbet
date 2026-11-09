/**
 * Talk missions: fixed daily schedule (Türkiye time). Mics that can't talk "anytime"
 * (Sıradan, Nadir, Ender) only earn inside an active mission, in the mission's room.
 * Change the schedule here and redeploy.
 */
import { officialRoomName } from "./rooms";

/** Türkiye has been on fixed UTC+3 since 2016 (no DST). */
export const TR_OFFSET_MS = 3 * 3600_000;

export interface MissionTemplate {
  id: string;
  title: string;
  /** "HH:MM" Türkiye time */
  start: string;
  end: string;
  instrumentId: string;
  /** verified talk needed to complete (seconds) */
  targetSec: number;
  /** $SPEAK bonus on completion */
  bonus: number;
  /** 0 = Sunday … 6 = Saturday (Türkiye day); omitted = every day */
  days?: number[];
}

const WEEKDAYS = [1, 2, 3, 4, 5];

export const MISSIONS: MissionTemplate[] = [
  { id: "bist-open", title: "BIST açılış seansı", start: "10:00", end: "11:00", instrumentId: "BIST", targetSec: 300, bonus: 10, days: WEEKDAYS },
  { id: "us-open", title: "ABD açılışı", start: "16:30", end: "17:30", instrumentId: "NDX", targetSec: 300, bonus: 10, days: WEEKDAYS },
  { id: "btc-evening", title: "BTC akşam kaosu", start: "21:00", end: "22:00", instrumentId: "BTC", targetSec: 300, bonus: 15 },
  { id: "night-crypto", title: "Gece kripto", start: "23:00", end: "23:45", instrumentId: "ETH", targetSec: 300, bonus: 10 },
];

export interface MissionInstance extends MissionTemplate {
  room: string;
  /** Türkiye day key, e.g. 2026-11-09 */
  day: string;
  startAt: number;
  endAt: number;
  status: "upcoming" | "active" | "ended";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Türkiye calendar day for an instant: "YYYY-MM-DD". Daily limits and mission progress reset on this. */
export function dayKey(now: number = Date.now()) {
  const d = new Date(now + TR_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Epoch ms of 00:00 Türkiye time on the day containing `now`. */
export function trDayStart(now: number = Date.now()) {
  const d = new Date(now + TR_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - TR_OFFSET_MS;
}

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h * 60 + m) * 60_000;
};

/** All missions scheduled for the Türkiye day containing `now`, with their status. */
export function missionsForDay(now: number = Date.now()): MissionInstance[] {
  const start = trDayStart(now);
  const weekday = new Date(start + TR_OFFSET_MS).getUTCDay();
  return MISSIONS.filter((m) => !m.days || m.days.includes(weekday)).map((m) => {
    const startAt = start + hm(m.start);
    const endAt = start + hm(m.end);
    return {
      ...m,
      room: officialRoomName(m.instrumentId),
      day: dayKey(now),
      startAt,
      endAt,
      status: now < startAt ? "upcoming" : now < endAt ? "active" : "ended",
    };
  });
}

/** The mission running right now in `room`, if any. */
export const activeMissionForRoom = (room: string, now: number = Date.now()) =>
  missionsForDay(now).find((m) => m.status === "active" && m.room === room) ?? null;

/** Next mission that hasn't ended (today, else tomorrow's first). */
export function nextMission(now: number = Date.now()): MissionInstance | null {
  const today = missionsForDay(now).find((m) => m.status !== "ended");
  if (today) return today;
  for (let i = 1; i <= 7; i++) {
    const m = missionsForDay(trDayStart(now) + i * 86400_000 + 60_000)[0];
    if (m) return m;
  }
  return null;
}

/** "21:00" style label in Türkiye time. */
export const trTime = (ts: number) => {
  const d = new Date(ts + TR_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
