import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { DATA_TOPIC, encodeMsg, type DataMsg } from "@syb/shared";
import { EventEmitter } from "node:events";
import { env, livekitConfigured } from "./env.js";

/** Server -> room messages are also emitted here (SSE fallback when LiveKit isn't configured). */
export const roomBus = new EventEmitter().setMaxListeners(0);

let svc: RoomServiceClient | null = null;
function service() {
  if (!livekitConfigured()) return null;
  // RoomService speaks HTTP(S), LIVEKIT_URL is usually wss://
  svc ??= new RoomServiceClient(env.livekitUrl.replace(/^ws/, "http"), env.livekitKey, env.livekitSecret);
  return svc;
}

export async function createToken(opts: {
  room: string;
  identity: string;
  name: string;
  canPublish: boolean;
  host: boolean;
  wallet?: string;
  gold?: boolean;
}) {
  const at = new AccessToken(env.livekitKey, env.livekitSecret, {
    identity: opts.identity,
    name: opts.name,
    metadata: JSON.stringify({ host: opts.host, wallet: opts.wallet, gold: opts.gold || undefined }),
    ttl: "6h",
  });
  at.addGrant({
    room: opts.room,
    roomJoin: true,
    canPublish: opts.canPublish,
    canPublishData: true,
    canSubscribe: true,
    roomAdmin: opts.host,
  });
  return at.toJwt();
}

/** Broadcast a server message to everyone in a room (no-op without LiveKit). */
export async function broadcast(room: string, msg: DataMsg) {
  roomBus.emit(room, msg);
  const s = service();
  if (!s) return;
  try {
    await s.sendData(room, encodeMsg(msg), DataPacket_Kind.RELIABLE, { topic: DATA_TOPIC });
  } catch (e) {
    // room may not exist yet (nobody inside) — that's fine
    if (!String(e).includes("not found")) console.warn("[livekit] sendData failed", room, String(e));
  }
}

/** room name -> participant count */
export async function participantCounts(): Promise<Record<string, number>> {
  const s = service();
  if (!s) return {};
  try {
    const rooms = await s.listRooms();
    return Object.fromEntries(rooms.map((r) => [r.name, r.numParticipants]));
  } catch (e) {
    console.warn("[livekit] listRooms failed", String(e));
    return {};
  }
}

export async function setCanPublish(room: string, identity: string, canPublish: boolean) {
  const s = service();
  if (!s) throw new Error("LiveKit not configured");
  await s.updateParticipant(room, identity, {
    permission: { canPublish, canPublishData: true, canSubscribe: true },
  });
}

export async function kick(room: string, identity: string) {
  const s = service();
  if (!s) throw new Error("LiveKit not configured");
  await s.removeParticipant(room, identity);
}
