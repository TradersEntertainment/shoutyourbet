/** Talk-to-earn game logic: mic NFTs, energy, levels, repairs, minting and talk rewards. */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  MICS,
  QUALITIES,
  boxChancePerMinute,
  childQuality,
  levelUpShout,
  levelUpSpeak,
  maxEnergy,
  mintCost,
  randomType,
  repairCost,
  rollStats,
  speakPerMinute,
  wearPerMinute,
  type EnergyState,
  type Mic,
  type MicType,
  type Quality,
  type StatKey,
  type TalkStatus,
} from "@syb/shared";
import { q, tx } from "./db.js";
import { EconomyError, ensureUser, fromUnits, lockWallet, post, spend, toUnits } from "./economy.js";
import { micOwner, micsOwnedBy, mintMicNft, newMicSigner } from "./chain/nft.js";
import { verifyPaymentToTreasury } from "./chain/solana.js";

const REGEN_MS = MICS.regenIntervalHours * 3600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function rowToMic(r: any, equipped?: string | null): Mic {
  return {
    asset: r.asset,
    serial: r.serial,
    owner: r.owner,
    type: r.type,
    quality: r.quality,
    level: r.level,
    points: r.points,
    efficiency: r.efficiency,
    luck: r.luck,
    resilience: r.resilience,
    charisma: r.charisma,
    durability: round2(r.durability),
    mintCount: r.mint_count,
    equipped: equipped ? r.asset === equipped : undefined,
  };
}

// ---------- ownership (chain is the source of truth; DB caches it) ----------
const syncedAt = new Map<string, number>();
export async function syncOwnership(wallet: string, force = false) {
  if (!force && Date.now() - (syncedAt.get(wallet) ?? 0) < 30_000) return;
  const owned = await micsOwnedBy(wallet);
  if (owned.length) await q("update mics set owner = $1, synced_at = now() where asset = any($2) and owner <> $1", [wallet, owned]);
  // mics the DB thinks this wallet has but chain doesn't (sold/transferred): look up the real owner
  const stale = await q<{ asset: string }>("select asset from mics where owner = $1 and not (asset = any($2))", [wallet, owned]);
  for (const { asset } of stale) {
    const real = await micOwner(asset);
    await q("update mics set owner = $2, synced_at = now() where asset = $1", [asset, real ?? "unknown"]);
  }
  if (stale.length) await q("update users set equipped_mic = null where wallet = $1 and equipped_mic = any($2)", [wallet, stale.map((s) => s.asset)]);
  syncedAt.set(wallet, Date.now());
}

/** Owner check for the mic used to earn (cached 60 s, so marketplace sales take effect quickly). */
const ownerCache = new Map<string, { owner: string | null; at: number }>();
async function ownsOnChain(wallet: string, asset: string) {
  const c = ownerCache.get(asset);
  if (c && Date.now() - c.at < 60_000) return c.owner === wallet;
  const owner = await micOwner(asset);
  ownerCache.set(asset, { owner, at: Date.now() });
  return owner === wallet;
}

// ---------- energy ----------
async function ownedQualities(c: pg.PoolClient | null, wallet: string) {
  const sql = "select quality from mics where owner = $1";
  return (c ? (await c.query(sql, [wallet])).rows : await q(sql, [wallet])) as { quality: Quality }[];
}

/** Regenerate energy lazily and return the current state (writes back when it changed). */
export async function energyState(wallet: string, c: pg.PoolClient | null = null): Promise<EnergyState> {
  const run = async (cl: pg.PoolClient) => {
    const [u] = (await cl.query("select energy, extract(epoch from energy_at)*1000 as at_ms from users where wallet = $1", [wallet])).rows;
    if (!u) return { energy: 0, max: 0, nextRegenAt: null };
    const max = maxEnergy(await ownedQualities(cl, wallet));
    let energy = Math.min(Number(u.energy), max);
    let at = Number(u.at_ms);
    const ticks = Math.floor((Date.now() - at) / REGEN_MS);
    if (ticks > 0) {
      energy = Math.min(max, energy + ticks * MICS.regenFraction * max);
      at = energy >= max ? Date.now() : at + ticks * REGEN_MS;
      await cl.query("update users set energy = $2, energy_at = to_timestamp($3/1000.0) where wallet = $1", [wallet, energy, at]);
    }
    return { energy: round2(energy), max, nextRegenAt: energy >= max ? null : at + REGEN_MS };
  };
  return c ? run(c) : tx(run);
}

// ---------- reads ----------
export async function listMics(wallet: string) {
  await syncOwnership(wallet);
  const [u] = await q("select equipped_mic from users where wallet = $1", [wallet]);
  const rows = await q("select * from mics where owner = $1 order by serial", [wallet]);
  return rows.map((r) => rowToMic(r, u?.equipped_mic));
}

export async function micBySerial(serial: number) {
  const [r] = await q("select * from mics where serial = $1", [serial]);
  return r ? rowToMic(r) : null;
}

async function ownedMic(c: pg.PoolClient, wallet: string, asset: string) {
  const [r] = (await c.query("select * from mics where asset = $1 and owner = $2 for update", [asset, wallet])).rows;
  if (!r) throw new EconomyError("Bu mikrofon sende değil", 404);
  return r;
}

// ---------- factory ----------
async function createMic(owner: string, type: MicType, quality: Quality, origin: string, parents?: [string, string]) {
  const signer = newMicSigner();
  const stats = rollStats(type, quality);
  const [row] = await q(
    `insert into mics (asset, owner, type, quality, efficiency, luck, resilience, charisma, origin, parent_a, parent_b)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [signer.publicKey.toString(), owner, type, quality, stats.efficiency, stats.luck, stats.resilience, stats.charisma, origin, parents?.[0] ?? null, parents?.[1] ?? null],
  );
  try {
    await mintMicNft(signer, owner, row.serial, type, quality);
  } catch (e) {
    await q("delete from mics where asset = $1", [row.asset]);
    throw e;
  }
  return row;
}

/** A newly owned mic raises max energy; give the difference right away so the first mic is usable. */
async function bumpEnergyForNewMic(wallet: string, oldMax: number) {
  await tx(async (c) => {
    await lockWallet(c, wallet);
    const st = await energyState(wallet, c);
    const add = Math.max(0, st.max - oldMax);
    if (add > 0) await c.query("update users set energy = least($2, energy + $3) where wallet = $1", [wallet, st.max, add]);
  });
}

/**
 * Buy a factory box (common mic, random type). Pays with the earned $SHOUT balance, or with an
 * on-chain $SHOUT transfer to the treasury when `signature` is given. Refunds if minting fails.
 */
export async function buyFactoryMic(wallet: string, nickname: string, signature?: string) {
  await ensureUser(wallet, nickname);
  const price = MICS.factoryPriceShout;
  const oldMax = (await energyState(wallet)).max;
  const ref = signature ?? `box:${randomUUID()}`;
  if (signature) {
    const [dup] = await q("select 1 from purchases where tx_sig = $1", [signature]);
    if (dup) throw new EconomyError("Bu işlem zaten kullanıldı", 409);
    try {
      await verifyPaymentToTreasury(signature, wallet, toUnits(price, "SHOUT"));
    } catch (e) {
      throw new EconomyError((e as Error).message, 400);
    }
    const r = await q("insert into purchases (tx_sig, wallet, item_id, amount) values ($1,$2,'mic-box',$3) on conflict do nothing returning tx_sig", [signature, wallet, toUnits(price, "SHOUT").toString()]);
    if (!r.length) throw new EconomyError("Bu işlem zaten kullanıldı", 409);
  } else {
    await tx(async (c) => {
      await lockWallet(c, wallet);
      await spend(c, wallet, "SHOUT", price, "mic_box", ref);
    });
  }
  try {
    const row = await createMic(wallet, randomType(), "common", "factory");
    await bumpEnergyForNewMic(wallet, oldMax);
    syncedAt.delete(wallet);
    return rowToMic(row);
  } catch (e) {
    // money back to the off-chain balance (on-chain payments are refunded off-chain too)
    await tx(async (c) => post(c, wallet, "SHOUT", toUnits(price, "SHOUT"), "mic_refund", ref));
    throw new EconomyError(`Mikrofon basılamadı, ${price} $SHOUT bakiyene iade edildi: ${String((e as Error).message).slice(0, 120)}`, 502);
  }
}

// ---------- upgrades ----------
export async function equip(wallet: string, asset: string) {
  await syncOwnership(wallet, true);
  const [m] = await q("select asset from mics where asset = $1 and owner = $2", [asset, wallet]);
  if (!m) throw new EconomyError("Bu mikrofon sende değil", 404);
  await q("update users set equipped_mic = $2 where wallet = $1", [wallet, asset]);
  return listMics(wallet);
}

export async function levelUp(wallet: string, asset: string) {
  return tx(async (c) => {
    await lockWallet(c, wallet);
    const m = await ownedMic(c, wallet, asset);
    if (m.level >= MICS.maxLevel) throw new EconomyError("Maksimum seviyede");
    const ref = `${asset}:L${m.level + 1}`;
    await spend(c, wallet, "SPEAK", levelUpSpeak(m.level), "levelup", ref);
    await spend(c, wallet, "SHOUT", levelUpShout(m.level), "levelup", ref);
    const [r] = (
      await c.query("update mics set level = level + 1, points = points + $2 where asset = $1 returning *", [asset, QUALITIES[m.quality as Quality].pointsPerLevel])
    ).rows;
    return rowToMic(r);
  });
}

export async function allocate(wallet: string, asset: string, add: Partial<Record<StatKey, number>>) {
  const keys: StatKey[] = ["efficiency", "luck", "resilience", "charisma"];
  const vals = keys.map((k) => Math.floor(Number(add[k] ?? 0)));
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) throw new EconomyError("Geçersiz puan");
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) throw new EconomyError("Dağıtılacak puan yok");
  return tx(async (c) => {
    const m = await ownedMic(c, wallet, asset);
    if (total > m.points) throw new EconomyError(`Sadece ${m.points} puanın var`);
    const [r] = (
      await c.query(
        "update mics set efficiency = efficiency + $2, luck = luck + $3, resilience = resilience + $4, charisma = charisma + $5, points = points - $6 where asset = $1 returning *",
        [asset, ...vals, total],
      )
    ).rows;
    return rowToMic(r);
  });
}

export async function repair(wallet: string, asset: string) {
  return tx(async (c) => {
    await lockWallet(c, wallet);
    const m = await ownedMic(c, wallet, asset);
    const pts = round2(100 - m.durability);
    if (pts <= 0) throw new EconomyError("Mikrofon zaten tam sağlam");
    await spend(c, wallet, "SPEAK", repairCost(pts, m.level, m.quality), "repair", `${asset}:${randomUUID()}`);
    const [r] = (await c.query("update mics set durability = 100 where asset = $1 returning *", [asset])).rows;
    return rowToMic(r);
  });
}

/** Mint a new mic from two of your mics (both level 5+, mint count < 7). */
export async function mintChild(wallet: string, a: string, b: string) {
  if (a === b) throw new EconomyError("İki farklı mikrofon seç");
  await syncOwnership(wallet, true);
  const oldMax = (await energyState(wallet)).max;
  const ref = `mint:${randomUUID()}`;
  const { type, quality } = await tx(async (c) => {
    await lockWallet(c, wallet);
    const ma = await ownedMic(c, wallet, a);
    const mb = await ownedMic(c, wallet, b);
    for (const m of [ma, mb]) {
      if (m.level < MICS.mintMinLevel) throw new EconomyError(`Mic #${m.serial} en az seviye ${MICS.mintMinLevel} olmalı`);
      if (m.mint_count >= MICS.maxMintCount) throw new EconomyError(`Mic #${m.serial} basım hakkını doldurdu`);
    }
    const cost = mintCost(ma.mint_count, mb.mint_count);
    await spend(c, wallet, "SPEAK", cost.speak, "mint", ref);
    await spend(c, wallet, "SHOUT", cost.shout, "mint", ref);
    await c.query("update mics set mint_count = mint_count + 1 where asset = any($1)", [[a, b]]);
    return { type: (Math.random() < 0.5 ? ma.type : mb.type) as MicType, quality: childQuality(ma.quality, mb.quality) };
  });
  try {
    const row = await createMic(wallet, type, quality, "mint", [a, b]);
    await bumpEnergyForNewMic(wallet, oldMax);
    syncedAt.delete(wallet);
    return rowToMic(row);
  } catch (e) {
    await tx(async (c) => {
      await lockWallet(c, wallet);
      const [ma] = (await c.query("select mint_count from mics where asset = $1", [a])).rows;
      const [mb] = (await c.query("select mint_count from mics where asset = $1", [b])).rows;
      const cost = mintCost(ma.mint_count - 1, mb.mint_count - 1);
      await post(c, wallet, "SPEAK", toUnits(cost.speak, "SPEAK"), "mint_refund", ref);
      await post(c, wallet, "SHOUT", toUnits(cost.shout, "SHOUT"), "mint_refund", ref);
      await c.query("update mics set mint_count = mint_count - 1 where asset = any($1)", [[a, b]]);
    });
    throw new EconomyError(`Basım başarısız, ücret iade edildi: ${String((e as Error).message).slice(0, 120)}`, 502);
  }
}

// ---------- talk rewards ----------
export interface TalkResult {
  status: TalkStatus;
  seconds: number;
  speak: number;
  box: number;
  energy: number;
  maxEnergy: number;
  durability: number | null;
}

/**
 * Credit `seconds` of verified talk. Called by the talk bot every flush.
 * Listeners are other people in the room (bot excluded).
 */
export async function creditTalk(wallet: string, room: string, seconds: number, listeners: number, rnd: () => number = Math.random): Promise<TalkResult> {
  const [u] = await q("select equipped_mic from users where wallet = $1", [wallet]);
  const none = (status: TalkStatus, e?: EnergyState, durability: number | null = null): TalkResult => ({
    status, seconds: 0, speak: 0, box: 0, energy: e?.energy ?? 0, maxEnergy: e?.max ?? 0, durability,
  });
  if (!u) return none("no-wallet");
  if (!u.equipped_mic || !(await ownsOnChain(wallet, u.equipped_mic))) return none("no-mic", await energyState(wallet));
  if (listeners < MICS.minListeners) return none("few-listeners", await energyState(wallet));

  return tx(async (c) => {
    await lockWallet(c, wallet);
    const e = await energyState(wallet, c);
    const [m] = (await c.query("select * from mics where asset = $1 for update", [u.equipped_mic])).rows;
    if (!m || m.owner !== wallet) return none("no-mic", e);
    if (m.durability <= 0) return none("broken", e, 0);
    if (e.energy <= 0) return none("no-energy", e, round2(m.durability));

    const usable = Math.min(seconds, Math.floor(e.energy * MICS.minutesPerEnergy * 60));
    const minutes = usable / 60;
    const speak = round2(speakPerMinute(m, listeners) * minutes);
    const wear = Math.min(m.durability, wearPerMinute(m.resilience) * minutes);
    const energyUsed = usable / (MICS.minutesPerEnergy * 60);
    const box = rnd() < boxChancePerMinute(m.luck) * minutes ? round2((5 + rnd() * 20) * (1 + m.luck / 50)) : 0;
    const id = randomUUID();

    await c.query(
      "insert into talk_chunks (id, wallet, mic, room, seconds, listeners, speak, energy_used, wear) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, wallet, m.asset, room, usable, listeners, toUnits(speak, "SPEAK").toString(), energyUsed, wear],
    );
    if (speak > 0) await post(c, wallet, "SPEAK", toUnits(speak, "SPEAK"), "talk", id);
    if (box > 0) await post(c, wallet, "SPEAK", toUnits(box, "SPEAK"), "box", id);
    await c.query("update mics set durability = greatest(0, durability - $2) where asset = $1", [m.asset, wear]);
    await c.query("update users set energy = greatest(0, energy - $2) where wallet = $1", [wallet, energyUsed]);
    return {
      status: "earning" as TalkStatus,
      seconds: usable,
      speak,
      box,
      energy: round2(Math.max(0, e.energy - energyUsed)),
      maxEnergy: e.max,
      durability: round2(Math.max(0, m.durability - wear)),
    };
  });
}

export async function talkToday(wallet: string) {
  const [r] = await q(
    "select coalesce(sum(seconds),0)::int seconds, coalesce(sum(speak),0) speak from talk_chunks where wallet = $1 and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'",
    [wallet],
  );
  return { seconds: r.seconds, speak: fromUnits(r.speak, "SPEAK") };
}
