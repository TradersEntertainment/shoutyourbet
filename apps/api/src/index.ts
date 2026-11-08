import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { INSTRUMENTS, instrumentById, type RoomInfo, type RoomMode, type Side } from "@syb/shared";
import { env, livekitConfigured } from "./env.js";
import { broadcast, roomBus, createToken, kick, participantCounts, setCanPublish } from "./livekit.js";
import { hub, startPrices } from "./prices/index.js";
import { fireAlarm, startAlarms } from "./alarms.js";
import { startScoring } from "./scoring.js";
import { store } from "./store.js";

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

app.get("/health", async () => ({ ok: true, livekit: livekitConfigured(), priceMode: env.priceMode }));

app.get("/instruments", async () => INSTRUMENTS);

// ---------- rooms ----------
app.get("/rooms", async (): Promise<RoomInfo[]> => {
  const counts = await participantCounts();
  return store.listRooms().map((r) => ({ ...r, participants: counts[r.name] ?? 0 }));
});

app.post<{ Body: { title?: string; instrumentId?: string; mode?: RoomMode; identity?: string; name?: string } }>(
  "/rooms",
  async (req, reply) => {
    const { title, instrumentId, mode, identity, name } = req.body ?? {};
    if (!instrumentById(String(instrumentId))) return reply.code(400).send({ error: "unknown instrument" });
    if (!identity || !name) return reply.code(400).send({ error: "identity & name required" });
    const room = store.createRoom({
      title: clean(title, 60) || "İsimsiz kaos",
      instrumentId: String(instrumentId),
      mode: mode === "stage" ? "stage" : "open",
      hostIdentity: clean(identity, 64),
      hostName: clean(name, 24),
    });
    return room; // { name, hostKey } — hostKey stays in the creator's browser
  },
);

// ---------- token ----------
app.post<{ Body: { room?: string; identity?: string; name?: string; hostKey?: string } }>("/token", async (req, reply) => {
  if (!livekitConfigured()) return reply.code(503).send({ error: "LIVEKIT_NOT_CONFIGURED" });
  const room = store.getRoom(String(req.body?.room));
  if (!room) return reply.code(404).send({ error: "room not found" });
  const identity = clean(req.body?.identity, 64) || randomUUID();
  const name = clean(req.body?.name, 24) || "Anonim Balina";
  const host = store.isHost(room.name, identity, req.body?.hostKey);
  const canPublish = room.mode === "open" || host;
  const token = await createToken({ room: room.name, identity, name, canPublish, host });
  return { token, url: env.livekitUrl, canPublish, host, room };
});

// ---------- stage / moderation (host only) ----------
type HostBody = { identity?: string; hostKey?: string; target?: string; canPublish?: boolean };
app.post<{ Params: { name: string }; Body: HostBody }>("/rooms/:name/speaker", async (req, reply) => {
  const b = req.body ?? {};
  if (!store.isHost(req.params.name, String(b.identity), b.hostKey)) return reply.code(403).send({ error: "host only" });
  await setCanPublish(req.params.name, String(b.target), Boolean(b.canPublish));
  return { ok: true };
});
app.post<{ Params: { name: string }; Body: HostBody }>("/rooms/:name/kick", async (req, reply) => {
  const b = req.body ?? {};
  if (!store.isHost(req.params.name, String(b.identity), b.hostKey)) return reply.code(403).send({ error: "host only" });
  await kick(req.params.name, String(b.target));
  return { ok: true };
});
app.post<{ Body: { room?: string; target?: string; reporter?: string; reason?: string } }>("/report", async (req) => {
  const b = req.body ?? {};
  store.reports.push({ room: clean(b.room, 64), target: clean(b.target, 64), reporter: clean(b.reporter, 64), reason: clean(b.reason, 200), at: Date.now() });
  return { ok: true };
});

// ---------- prices ----------
app.get("/prices", async () => hub.snapshot());

app.get("/prices/stream", (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(`data: ${JSON.stringify(hub.snapshot())}\n\n`);
  // batch ticks to at most 2 pushes / second
  let pending = new Map<string, unknown>();
  const unsub = hub.subscribe((t) => pending.set(t.instrumentId, t));
  const timer = setInterval(() => {
    if (pending.size) {
      res.write(`data: ${JSON.stringify([...pending.values()])}\n\n`);
      pending = new Map();
    } else res.write(`: ping\n\n`);
  }, 500);
  req.raw.on("close", () => {
    clearInterval(timer);
    unsub();
  });
});

/** Server events for a room over SSE — used by clients when LiveKit isn't configured. */
app.get<{ Params: { name: string } }>("/rooms/:name/events", (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
  const onMsg = (m: unknown) => res.write(`data: ${JSON.stringify(m)}\n\n`);
  roomBus.on(req.params.name, onMsg);
  const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);
  req.raw.on("close", () => {
    clearInterval(ping);
    roomBus.off(req.params.name, onMsg);
  });
});

// ---------- shouts & leaderboard ----------
const lastShout = new Map<string, number>();
app.post<{ Body: { room?: string; identity?: string; name?: string; side?: Side } }>("/shouts", async (req, reply) => {
  const b = req.body ?? {};
  const room = store.getRoom(String(b.room));
  if (!room) return reply.code(404).send({ error: "room not found" });
  if (b.side !== "LONG" && b.side !== "SHORT") return reply.code(400).send({ error: "side must be LONG or SHORT" });
  const identity = clean(b.identity, 64);
  const name = clean(b.name, 24) || "Anonim";
  const key = `${room.name}:${identity}`;
  const now = Date.now();
  if (now - (lastShout.get(key) ?? 0) < 20_000) return reply.code(429).send({ error: "Sakin ol şampiyon, 20 sn bekle" });
  const price = hub.get(room.instrumentId)?.price;
  if (!price) return reply.code(503).send({ error: "no price yet" });
  lastShout.set(key, now);
  const shout = store.addShout({
    room: room.name,
    identity,
    name,
    instrumentId: room.instrumentId,
    side: b.side,
    entryPrice: price,
    createdAt: now,
    resolveAt: now + env.shoutHorizonSec * 1000,
  });
  await broadcast(room.name, { t: "SHOUT", side: b.side, price, from: name, identity, instrumentId: room.instrumentId });
  return { ok: true, shout };
});

app.get<{ Querystring: { room?: string } }>("/leaderboard", async (req) => store.leaderboard(req.query.room || undefined));

// ---------- dev tools ----------
if (env.devTools) {
  app.get<{ Querystring: { symbol?: string; pct?: string } }>("/debug/alarm", async (req, reply) => {
    const id = String(req.query.symbol ?? "BTC").toUpperCase();
    const pct = Number(req.query.pct ?? 2);
    const price = hub.get(id)?.price;
    if (!price) return reply.code(404).send({ error: "unknown symbol / no price" });
    return fireAlarm(id, pct, price);
  });
}

startPrices();
startAlarms();
startScoring();

await app.listen({ port: env.port, host: "0.0.0.0" });
console.log(`[api] listening on :${env.port} (livekit=${livekitConfigured()}, prices=${env.priceMode})`);
