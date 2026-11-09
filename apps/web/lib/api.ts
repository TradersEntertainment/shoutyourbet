"use client";
import { useEffect, useState } from "react";
import type { LeaderRow, PriceTick, RoomInfo, RoomMode, Side } from "@syb/shared";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { code: json.error, status: res.status });
  return json as T;
}

export const api = {
  rooms: () => req<RoomInfo[]>("/rooms"),
  createRoom: (b: { title: string; instrumentId: string; mode: RoomMode; identity: string; name: string }) =>
    req<{ name: string; hostKey: string }>("/rooms", b),
  token: (b: { room: string; identity: string; name: string; hostKey?: string }) =>
    req<{ token: string; url: string; canPublish: boolean; host: boolean; room: RoomInfo }>("/token", b),
  shout: (b: { room: string; identity: string; name: string; side: Side }) => req<{ ok: true }>("/shouts", b),
  leaderboard: (room?: string) => req<LeaderRow[]>(`/leaderboard${room ? `?room=${encodeURIComponent(room)}` : ""}`),
  speaker: (room: string, b: { identity: string; hostKey: string; target: string; canPublish: boolean }) =>
    req(`/rooms/${room}/speaker`, b),
  kick: (room: string, b: { identity: string; hostKey: string; target: string }) => req(`/rooms/${room}/kick`, b),
  report: (b: { room: string; target: string; reporter: string; reason: string }) => req("/report", b),
};

// ---------- identity (guest: nickname only) ----------
const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export function getIdentity() {
  let id = safeGet("syb.identity");
  if (!id) {
    id = crypto.randomUUID();
    safeSet("syb.identity", id);
  }
  return id;
}
export const getNick = () => safeGet("syb.nick") ?? "";
export const setNick = (n: string) => safeSet("syb.nick", n);
export const getHostKey = (room: string) => safeGet(`syb.host.${room}`) ?? undefined;
export const setHostKey = (room: string, key: string) => safeSet(`syb.host.${room}`, key);

const FUNNY = ["LikideLider", "KaldıraçKemal", "FomoFatma", "ShortSinan", "BalinaBülent", "StopSelin", "MumMehmet", "DipAvcısı"];
export const randomNick = () => `${FUNNY[Math.floor(Math.random() * FUNNY.length)]}${Math.floor(Math.random() * 90 + 10)}`;

// ---------- live prices ----------
export function usePrices() {
  const [prices, setPrices] = useState<Record<string, PriceTick>>({});
  useEffect(() => {
    const es = new EventSource(`${API}/prices/stream`);
    es.onmessage = (e) => {
      const ticks: PriceTick[] = JSON.parse(e.data);
      setPrices((p) => {
        const n = { ...p };
        for (const t of ticks) n[t.instrumentId] = t;
        return n;
      });
    };
    return () => es.close();
  }, []);
  return prices;
}

export function useRooms(intervalMs = 10_000) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .rooms()
        .then((r) => alive && (setRooms(r), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return { rooms, error };
}

export function useSparklines() {
  const [data, setData] = useState<Record<string, number[]>>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/prices/history`)
        .then((r) => r.json())
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return data;
}

export function fmtPrice(p?: number) {
  if (p == null) return "…";
  const digits = p >= 1000 ? 0 : p >= 10 ? 2 : 4;
  return p.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const fmtPct = (p?: number) => (p == null ? "" : `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`);
