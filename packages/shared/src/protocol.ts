/** Messages sent over LiveKit data channels (topic = DATA_TOPIC). */
export const DATA_TOPIC = "syb";

export type Side = "LONG" | "SHORT";

export type DataMsg =
  // client -> room
  | { t: "SFX"; id: string; from: string }
  | { t: "REACT"; emoji: string; from: string }
  | { t: "RAISE_HAND"; from: string; identity: string; up: boolean }
  // server -> room
  | { t: "SHOUT"; side: Side; price: number; from: string; identity: string; instrumentId: string }
  | { t: "RESULT"; side: Side; pct: number; points: number; from: string; instrumentId: string }
  | { t: "ALARM"; instrumentId: string; dir: "up" | "down"; pct: number; price: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

export const encodeMsg = (m: DataMsg) => enc.encode(JSON.stringify(m));
export function decodeMsg(b: Uint8Array): DataMsg | null {
  try {
    return JSON.parse(dec.decode(b)) as DataMsg;
  } catch {
    return null;
  }
}

export interface PriceTick {
  instrumentId: string;
  price: number;
  /** % change vs. 24h ago (or since start in mock mode) */
  change24h: number;
  ts: number;
  delayed?: boolean;
}

export interface LeaderRow {
  identity: string;
  name: string;
  points: number;
  wins: number;
  losses: number;
  /** worst single result in % */
  worstPct: number;
}
