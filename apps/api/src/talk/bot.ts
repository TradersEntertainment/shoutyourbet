/**
 * Talk bot: a hidden LiveKit participant that listens to every room with enough people,
 * measures real speech per speaker (SpeechAnalyzer) and credits $SPEAK via creditTalk().
 * Counting happens here, on the server — client "I'm speaking" flags are never trusted.
 */
import { AudioStream, Room, RoomEvent, TrackKind, type RemoteParticipant, type RemoteTrack } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { DATA_TOPIC, MICS, encodeMsg, type DataMsg, type ParticipantMeta } from "@syb/shared";
import { env } from "../env.js";
import { SpeechAnalyzer } from "./analyzer.js";
import { creditTalk } from "../mics.js";

export const BOT_IDENTITY = "syb-talkbot";
const FLUSH_MS = Number(process.env.TALK_FLUSH_SEC ?? 15) * 1000;
const SCAN_MS = 5000;
const MIN_PEOPLE = 1 + MICS.minListeners; // speaker + listeners

interface Speaker {
  analyzer: SpeechAnalyzer;
  pending: number;
}
interface Joined {
  room: Room;
  speakers: Map<string, Speaker>;
  timer: NodeJS.Timeout;
  lowSince: number | null;
}
const joined = new Map<string, Joined>();
const log = (...a: unknown[]) => console.log("[talkbot]", ...a);

async function botToken(room: string) {
  const at = new AccessToken(env.livekitKey, env.livekitSecret, { identity: BOT_IDENTITY, name: "ShoutYourBet", ttl: "12h" });
  at.addGrant({ room, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: true, hidden: true });
  return at.toJwt();
}

function walletOf(p: RemoteParticipant) {
  try {
    return (JSON.parse(p.metadata || "{}") as ParticipantMeta).wallet ?? null;
  } catch {
    return null;
  }
}

async function send(j: Joined, identity: string, msg: DataMsg) {
  try {
    await j.room.localParticipant?.publishData(encodeMsg(msg), { reliable: true, destination_identities: [identity], topic: DATA_TOPIC });
  } catch (e) {
    log("send failed", String(e));
  }
}

async function consume(j: Joined, track: RemoteTrack, identity: string) {
  const sp = j.speakers.get(identity) ?? { analyzer: new SpeechAnalyzer(), pending: 0 };
  j.speakers.set(identity, sp);
  const stream = new AudioStream(track, { sampleRate: 16000, numChannels: 1 });
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      for (const w of sp.analyzer.push(value.data)) if (w.talking) sp.pending++;
    }
  } catch {
    /* track ended */
  } finally {
    reader.releaseLock();
  }
}

/** Credit what each speaker said since the last flush. */
export async function flush(name: string) {
  const j = joined.get(name);
  if (!j) return;
  for (const [identity, sp] of j.speakers) {
    if (sp.pending <= 0) continue;
    const seconds = sp.pending;
    sp.pending = 0;
    const p = j.room.remoteParticipants.get(identity);
    if (!p) continue;
    const listeners = [...j.room.remoteParticipants.keys()].filter((id) => id !== identity && id !== BOT_IDENTITY).length;
    const wallet = walletOf(p);
    if (!wallet) {
      await send(j, identity, { t: "TALK", status: "no-wallet", seconds: 0, speak: 0, energy: 0, maxEnergy: 0, durability: null });
      continue;
    }
    try {
      const r = await creditTalk(wallet, name, seconds, listeners);
      if (r.speak || r.box) log(`${name} ${p.name}: ${r.seconds}s → +${r.speak} SPEAK${r.box ? ` (+${r.box} box)` : ""} (${listeners} listeners)`);
      if (r.mission?.bonus) log(`${name} ${p.name}: mission "${r.mission.title}" completed → +${r.mission.bonus} SPEAK`);
      await send(j, identity, {
        t: "TALK",
        status: r.status,
        seconds: r.seconds,
        speak: r.speak,
        energy: r.energy,
        maxEnergy: r.maxEnergy,
        durability: r.durability,
        box: r.box || undefined,
        dailyUsed: r.dailyUsed,
        dailyCap: r.dailyCap,
        mission: r.mission,
        next: r.next,
      });
    } catch (e) {
      log("credit failed", wallet, String(e));
    }
  }
}

async function join(name: string) {
  const room = new Room();
  const j: Joined = { room, speakers: new Map(), timer: setInterval(() => void flush(name), FLUSH_MS), lowSince: null };
  joined.set(name, j);
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
    if (track.kind === TrackKind.KIND_AUDIO) void consume(j, track, participant.identity);
  });
  room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => j.speakers.delete(p.identity));
  room.on(RoomEvent.Disconnected, () => void leave(name));
  try {
    await room.connect(env.livekitUrl, await botToken(name), { autoSubscribe: true, dynacast: false });
    log("joined", name);
  } catch (e) {
    log("join failed", name, String(e));
    await leave(name);
  }
}

async function leave(name: string) {
  const j = joined.get(name);
  if (!j) return;
  joined.delete(name);
  clearInterval(j.timer);
  await flush(name).catch(() => {});
  await j.room.disconnect().catch(() => {});
  log("left", name);
}

export function startTalkBot() {
  const svc = new RoomServiceClient(env.livekitUrl.replace(/^ws/, "http"), env.livekitKey, env.livekitSecret);
  const scan = async () => {
    try {
      const rooms = await svc.listRooms();
      for (const r of rooms) {
        const j = joined.get(r.name);
        const people = j ? [...j.room.remoteParticipants.keys()].filter((id) => id !== BOT_IDENTITY).length : r.numParticipants;
        if (!j && people >= MIN_PEOPLE) void join(r.name);
        if (j) {
          if (people < 2) {
            j.lowSince ??= Date.now();
            if (Date.now() - j.lowSince > 30_000) void leave(r.name);
          } else j.lowSince = null;
        }
      }
      for (const name of joined.keys()) if (!rooms.some((r) => r.name === name)) void leave(name);
    } catch (e) {
      log("scan failed", String(e));
    }
  };
  void scan();
  setInterval(scan, SCAN_MS);
  log(`started (flush ${FLUSH_MS / 1000}s, needs ${MIN_PEOPLE}+ people)`);
}
