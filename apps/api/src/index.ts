import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { ECONOMY, INSTRUMENTS, SHOP, TOKEN, instrumentById, signInMessage, toBase, type RoomInfo, type RoomMode, type Side } from "@syb/shared";
import { chainEnabled, economyEnabled, env, livekitConfigured, micsEnabled } from "./env.js";
import { broadcast, roomBus, createToken, kick, participantCounts, setCanPublish } from "./livekit.js";
import { hub, startPrices } from "./prices/index.js";
import { fireAlarm, startAlarms } from "./alarms.js";
import { startScoring } from "./scoring.js";
import { store } from "./store.js";
import { shouts } from "./shouts.js";
import { migrate, q } from "./db.js";
import { isWallet, issueSession, newNonce, verifySignIn, walletOf } from "./auth.js";
import { EconomyError, buyOnChain, buyWithBalance, claim, consume, ensureUser, history, isoWeek, me, owns, paySeason, startSeasonScheduler } from "./economy.js";
import { onchainBalance, onchainSpeak, tokenInfo } from "./chain/solana.js";
import { MIC_TYPES, MICS, QUALITIES, SPEAK, levelUpShout, levelUpSpeak, mintCost, repairCost, type StatKey } from "@syb/shared";
import { allocate, buyFactoryMic, creditTalk, energyState, equip, levelUp, listMics, micBySerial, mintChild, repair, talkToday } from "./mics.js";
import { micImage, micName } from "./chain/nft.js";
import { startTalkBot } from "./talk/bot.js";

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof EconomyError) return reply.code(err.status).send({ error: err.message });
  app.log.error(err);
  return reply.code(err.statusCode ?? 500).send({ error: err.message || "server error" });
});

app.get("/health", async () => ({
  ok: true,
  livekit: livekitConfigured(),
  priceMode: env.priceMode,
  economy: economyEnabled(),
  chain: chainEnabled(),
  mics: micsEnabled(),
}));

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
    const wallet = economyEnabled() ? walletOf(req) : null;
    const theme = wallet && (await owns(wallet, "theme-neon").catch(() => false)) ? "neon" : undefined;
    const room = store.createRoom({
      title: clean(title, 60) || "İsimsiz kaos",
      instrumentId: String(instrumentId),
      mode: mode === "stage" ? "stage" : "open",
      hostIdentity: clean(identity, 64),
      hostName: clean(name, 24),
      theme,
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
  const wallet = economyEnabled() ? walletOf(req) : null;
  const gold = wallet ? await owns(wallet, "name-gold").catch(() => false) : false;
  const token = await createToken({ room: room.name, identity, name, canPublish, host, wallet: wallet ?? undefined, gold });
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
app.get("/prices/history", async () => hub.sparkline());

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
  const wallet = economyEnabled() ? walletOf(req) : null;
  const key = `${room.name}:${wallet ?? identity}`;
  const now = Date.now();
  if (now - (lastShout.get(key) ?? 0) < 20_000) return reply.code(429).send({ error: "Sakin ol şampiyon, 20 sn bekle" });
  const price = hub.get(room.instrumentId)?.price;
  if (!price) return reply.code(503).send({ error: "no price yet" });
  lastShout.set(key, now);
  if (wallet) await ensureUser(wallet, name);
  const shout = await shouts.add({
    room: room.name,
    identity,
    wallet,
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

app.get<{ Querystring: { room?: string } }>("/leaderboard", async (req) => shouts.leaderboard(req.query.room || undefined));

// ---------- $SHOUT economy ----------
const needEconomy = () => {
  if (!economyEnabled()) throw new EconomyError("Ekonomi kapalı (DATABASE_URL / SESSION_SECRET)", 503);
};
const needWallet = (req: Parameters<typeof walletOf>[0]) => {
  needEconomy();
  const w = walletOf(req);
  if (!w) throw new EconomyError("Önce cüzdanınla giriş yap", 401);
  return w;
};

app.get("/economy", async () => ({
  enabled: economyEnabled(),
  token: { ...TOKEN, ...(tokenInfo() ?? {}) },
  rules: ECONOMY,
  shop: SHOP,
}));

app.get("/auth/nonce", async () => {
  needEconomy();
  return { nonce: await newNonce() };
});
app.post<{ Body: { wallet?: string; nonce?: string; signature?: string; nickname?: string } }>("/auth/wallet", async (req) => {
  needEconomy();
  const { wallet, nonce, signature, nickname } = req.body ?? {};
  if (!isWallet(wallet) || !nonce || !signature) throw new EconomyError("eksik alan");
  try {
    await verifySignIn(wallet, String(nonce), String(signature));
  } catch (e) {
    throw new EconomyError((e as Error).message, 401);
  }
  await ensureUser(wallet, clean(nickname, 24) || `${wallet.slice(0, 4)}…${wallet.slice(-4)}`);
  return { session: issueSession(wallet), me: await me(wallet), message: signInMessage(wallet, String(nonce)) };
});

app.get("/me", async (req) => {
  const w = needWallet(req);
  const out = await me(w);
  return {
    ...out,
    onchain: chainEnabled() ? Number(await onchainBalance(w)) / 10 ** TOKEN.decimals : null,
    onchainSpeak: micsEnabled() ? Number(await onchainSpeak(w)) / 10 ** SPEAK.decimals : null,
    energy: await energyState(w),
    talkToday: await talkToday(w),
  };
});
app.get("/me/history", async (req) => history(needWallet(req)));
app.post<{ Body: { amount?: number; currency?: string } }>("/claims", async (req) => {
  const w = needWallet(req);
  const amount = req.body?.amount;
  return claim(w, typeof amount === "number" && amount > 0 ? amount : undefined, req.body?.currency === "SPEAK" ? "SPEAK" : "SHOUT");
});

// ---------- talk-to-earn: mic NFTs ----------
const needMics = (req: Parameters<typeof walletOf>[0]) => {
  const w = needWallet(req);
  if (!micsEnabled()) throw new EconomyError("Mikrofonlar yapılandırılmamış (SPEAK_MINT, MIC_COLLECTION)", 503);
  return w;
};
app.get("/mics/rules", async () => ({
  enabled: micsEnabled() && economyEnabled(),
  rules: MICS,
  types: MIC_TYPES,
  qualities: QUALITIES,
  costs: {
    levelUp: Array.from({ length: MICS.maxLevel }, (_, l) => ({ level: l, speak: levelUpSpeak(l), shout: levelUpShout(l) })),
    mint: Array.from({ length: MICS.maxMintCount }, (_, i) => mintCost(i, i)),
  },
}));
app.get("/me/mics", async (req) => listMics(needMics(req)));
app.post<{ Body: { signature?: string; name?: string } }>("/mics/buy", async (req) => {
  const w = needMics(req);
  return buyFactoryMic(w, clean(req.body?.name, 24) || "Anonim", req.body?.signature ? String(req.body.signature) : undefined);
});
app.post<{ Params: { asset: string } }>("/mics/:asset/equip", async (req) => equip(needMics(req), req.params.asset));
app.post<{ Params: { asset: string } }>("/mics/:asset/levelup", async (req) => levelUp(needMics(req), req.params.asset));
app.post<{ Params: { asset: string }; Body: Partial<Record<StatKey, number>> }>("/mics/:asset/points", async (req) => allocate(needMics(req), req.params.asset, req.body ?? {}));
app.post<{ Params: { asset: string } }>("/mics/:asset/repair", async (req) => repair(needMics(req), req.params.asset));
app.get<{ Querystring: { level?: string; quality?: string; durability?: string } }>("/mics/repair-cost", async (req) => {
  const lvl = Number(req.query.level ?? 0);
  const quality = (req.query.quality ?? "common") as keyof typeof QUALITIES;
  return { speak: repairCost(100 - Number(req.query.durability ?? 100), lvl, QUALITIES[quality] ? quality : "common") };
});
app.post<{ Body: { a?: string; b?: string } }>("/mics/mint", async (req) => mintChild(needMics(req), String(req.body?.a), String(req.body?.b)));

// NFT metadata (Metaplex JSON standard) — URIs of minted mics point here, so stats stay live.
app.get<{ Params: { serial: string } }>("/nft/mic/:serial.json", async (req, reply) => {
  const m = await micBySerial(Number(req.params.serial));
  if (!m) return reply.code(404).send({ error: "not found" });
  const image = micImage(m.type, m.quality);
  return {
    name: micName(m.serial, m.type),
    symbol: "SYBMIC",
    description: `${QUALITIES[m.quality].label} ${MIC_TYPES[m.type].label} mikrofon. ShoutYourBet odalarında konuşarak $SPEAK kazandırır.`,
    image,
    external_url: env.publicWebUrl,
    attributes: [
      { trait_type: "Tip", value: MIC_TYPES[m.type].label },
      { trait_type: "Kalite", value: QUALITIES[m.quality].label },
      { trait_type: "Seviye", value: m.level, display_type: "number" },
      { trait_type: "Verim", value: m.efficiency, display_type: "number" },
      { trait_type: "Şans", value: m.luck, display_type: "number" },
      { trait_type: "Dayanıklılık", value: m.resilience, display_type: "number" },
      { trait_type: "Karizma", value: m.charisma, display_type: "number" },
      { trait_type: "Basım", value: m.mintCount, display_type: "number" },
    ],
    properties: { files: [{ uri: image, type: "image/png" }], category: "image" },
  };
});
app.get("/nft/collection.json", async () => ({
  name: "ShoutYourBet Mics",
  symbol: "SYBMIC",
  description: "ShoutYourBet sesli trade odalarında konuşarak $SPEAK kazandıran mikrofonlar.",
  image: `${env.publicWebUrl}/mics/collection.png`,
  external_url: env.publicWebUrl,
}));
app.post<{ Body: { itemId?: string; signature?: string } }>("/purchases", async (req) => {
  const w = needWallet(req);
  const itemId = String(req.body?.itemId ?? "");
  return req.body?.signature ? buyOnChain(w, itemId, String(req.body.signature)) : buyWithBalance(w, itemId);
});
app.post<{ Body: { room?: string; text?: string; name?: string } }>("/megaphone", async (req) => {
  const w = needWallet(req);
  const room = store.getRoom(String(req.body?.room));
  if (!room) throw new EconomyError("room not found", 404);
  const text = clean(req.body?.text, 80);
  if (!text) throw new EconomyError("boş mesaj");
  await consume(w, "megaphone");
  const until = Date.now() + 30_000;
  await broadcast(room.name, { t: "MEGAPHONE", from: clean(req.body?.name, 24) || "Anonim", text, until });
  return me(w);
});

// ---------- dev tools ----------
if (env.devTools) {
  app.get<{ Querystring: { symbol?: string; pct?: string } }>("/debug/alarm", async (req, reply) => {
    const id = String(req.query.symbol ?? "BTC").toUpperCase();
    const pct = Number(req.query.pct ?? 2);
    const price = hub.get(id)?.price;
    if (!price) return reply.code(404).send({ error: "unknown symbol / no price" });
    return fireAlarm(id, pct, price);
  });
  /** dev: credit off-chain $SHOUT to a wallet (testing) */
  app.post<{ Body: { wallet?: string; amount?: number; currency?: string } }>("/debug/credit", async (req) => {
    needEconomy();
    const { wallet, amount } = req.body ?? {};
    const cur = req.body?.currency === "SPEAK" ? "SPEAK" : "SHOUT";
    if (!isWallet(wallet) || !amount) throw new EconomyError("wallet & amount");
    await ensureUser(wallet, "test");
    const units = cur === "SHOUT" ? toBase(amount) : BigInt(Math.round(amount * 10 ** SPEAK.decimals));
    await q("insert into ledger (wallet, currency, amount, reason, ref) values ($1,$2,$3,'admin',$4)", [wallet, cur, units.toString(), `debug:${randomUUID()}`]);
    return me(wallet);
  });
  /** dev: credit verified talk without LiveKit (tests the reward math end-to-end) */
  app.post<{ Body: { wallet?: string; seconds?: number; listeners?: number } }>("/debug/talk", async (req) => {
    needEconomy();
    const { wallet, seconds, listeners } = req.body ?? {};
    if (!isWallet(wallet)) throw new EconomyError("wallet");
    return creditTalk(wallet, "debug", Number(seconds ?? 60), Number(listeners ?? 2));
  });
  /** dev: pay a season bonus for the current week right now */
  app.post("/debug/season", async () => paySeason(isoWeek().start));
}

await migrate();
startPrices();
startAlarms();
startScoring();
if (economyEnabled()) startSeasonScheduler();
if (economyEnabled() && micsEnabled() && livekitConfigured()) startTalkBot();

await app.listen({ port: env.port, host: "0.0.0.0" });
console.log(`[api] listening on :${env.port} (livekit=${livekitConfigured()}, prices=${env.priceMode}, economy=${economyEnabled()}, chain=${chainEnabled()}, mics=${micsEnabled()})`);
