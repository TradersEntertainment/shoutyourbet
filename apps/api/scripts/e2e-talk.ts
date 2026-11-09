/**
 * Real-audio talk-to-earn test over LiveKit: participants stream PCM into rooms and the
 * API's talk bot must credit $SPEAK only for genuine speech with enough listeners.
 *
 *   API_URL=http://localhost:4000 SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/e2e-talk.ts
 * Needs: API with LiveKit + economy + mics + DEV_TOOLS=1 (TALK_FLUSH_SEC=10 recommended), ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AudioFrame, AudioSource, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { DATA_TOPIC, decodeMsg, signInMessage, type DataMsg } from "@syb/shared";

const API = process.env.API_URL ?? "http://localhost:4000";
const conn = new Connection(process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c: unknown, label: string, extra = "") => {
  console.log(`${c ? "✔" : "✖"} ${label}${extra ? `  (${extra})` : ""}`);
  if (!c) failures++;
};
async function call(path: string, body?: unknown, session?: string) {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

/** A wallet that owns + equips a mic, with full energy. */
async function player(name: string) {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL), "confirmed");
  const { json: n } = await call("/auth/nonce");
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(signInMessage(wallet, n.nonce)), kp.secretKey));
  const session = (await call("/auth/wallet", { wallet, nonce: n.nonce, signature: sig, nickname: name })).json.session as string;
  await call("/debug/credit", { wallet, amount: 1000 });
  const mic = (await call("/mics/buy", { name }, session)).json;
  await call(`/mics/${mic.asset}/equip`, {}, session);
  // Destansı: earns at any time (Sıradan would depend on the mission clock)
  await call("/debug/mic-quality", { asset: mic.asset, quality: "epic" });
  return { wallet, session, name };
}

function pcm48k(fixture: string) {
  const file = fileURLToPath(new URL(`../test/fixtures/${fixture}.opus`, import.meta.url));
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { maxBuffer: 64 << 20 });
  return new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 2);
}

async function join(room: string, name: string, session?: string) {
  const t = (await call("/token", { room, identity: `${name}-${Math.random().toString(36).slice(2, 7)}`, name }, session)).json;
  const r = new Room();
  await r.connect(t.url, t.token, { autoSubscribe: false, dynacast: false });
  return r;
}

/** Publish looping PCM as a microphone track (paced in real time by AudioSource). */
async function speak(r: Room, pcm: Int16Array, stopAt: number) {
  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack("mic", source);
  const opts = new TrackPublishOptions();
  opts.source = TrackSource.SOURCE_MICROPHONE;
  await r.localParticipant!.publishTrack(track, opts);
  const step = 480; // 10 ms
  let i = 0;
  while (Date.now() < stopAt) {
    if (i + step > pcm.length) i = 0;
    await source.captureFrame(new AudioFrame(pcm.slice(i, i + step), 48000, 1, step));
    i += step;
  }
}

async function main() {
  const health = (await call("/health")).json;
  if (!health.livekit || !health.mics) throw new Error("API needs LiveKit + mics enabled");

  const speaker = await player("Konuşkan");
  const cheater = await player("Gürültücü");
  const lonely = await player("Yalnız");
  const room2 = (await call("/rooms", { title: "e2e tek dinleyici", instrumentId: "ETH", mode: "open", identity: "x", name: "x" })).json.name;

  const msgs: DataMsg[] = [];
  const rs = await join("inst-BTC", speaker.name, speaker.session);
  rs.on(RoomEvent.DataReceived, (payload: Uint8Array, _p, _k, topic?: string) => {
    const m = topic === DATA_TOPIC ? decodeMsg(payload) : null;
    if (m?.t === "TALK") msgs.push(m);
  });
  const rc = await join("inst-BTC", cheater.name, cheater.session);
  const l1 = await join("inst-BTC", "Dinleyici1");
  const l2 = await join("inst-BTC", "Dinleyici2");
  const rl = await join(room2, lonely.name, lonely.session);
  const ll = await join(room2, "TekDinleyici");
  console.log("rooms joined, streaming audio for ~45 s …");

  const stopAt = Date.now() + 45_000;
  await Promise.all([speak(rs, pcm48k("speech"), stopAt), speak(rc, pcm48k("noise"), stopAt), speak(rl, pcm48k("speech"), stopAt)]);
  await sleep(12_000); // final flush

  const earn = msgs.filter((m) => m.t === "TALK" && m.status === "earning") as Extract<DataMsg, { t: "TALK" }>[];
  const seconds = earn.reduce((a, m) => a + m.seconds, 0);
  const speakSum = earn.reduce((a, m) => a + m.speak, 0);
  ok(earn.length > 0, "speaker received live TALK updates from the bot", `${earn.length} updates`);
  ok(seconds >= 25, "real speech over LiveKit was counted", `${seconds}s of ~45s verified`);
  const me1 = (await call("/me", undefined, speaker.session)).json;
  ok(me1.speak > 0 && Math.abs(me1.speak - speakSum) < 0.05, "$SPEAK credited to the speaker", `+${me1.speak} SPEAK`);
  ok(me1.energy.energy < me1.energy.max, "energy was spent", JSON.stringify(me1.energy));

  const me2 = (await call("/me", undefined, cheater.session)).json;
  ok(me2.speak === 0, "white noise streamed into the same room earns nothing", `${me2.speak} SPEAK`);
  const me3 = (await call("/me", undefined, lonely.session)).json;
  ok(me3.speak === 0, "speech with only 1 listener earns nothing", `${me3.speak} SPEAK`);

  for (const r of [rs, rc, l1, l2, rl, ll]) await r.disconnect();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
