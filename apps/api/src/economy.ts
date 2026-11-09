import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ECONOMY, SPEAK, fromBase, shopItem, toBase } from "@syb/shared";
import { q, tx } from "./db.js";
import { chainEnabled } from "./env.js";
import { explorerTx, mintSpeakTo, sendFromTreasury, verifyPaymentToTreasury } from "./chain/solana.js";
import { env } from "./env.js";

export type Currency = "SHOUT" | "SPEAK";
/** UI amount <-> base units per currency ($SHOUT 6 decimals, $SPEAK 2). */
export const toUnits = (amount: number, cur: Currency) => (cur === "SHOUT" ? toBase(amount) : BigInt(Math.round(amount * 10 ** SPEAK.decimals)));
export const fromUnits = (units: bigint | number | string, cur: Currency) => (cur === "SHOUT" ? fromBase(units) : Number(BigInt(units)) / 10 ** SPEAK.decimals);
export const SPEAK_MIN_CLAIM = 10;

export class EconomyError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const lock = (c: pg.PoolClient, wallet: string) => c.query("select pg_advisory_xact_lock(hashtext($1))", [wallet]);
const sumOf = async (c: pg.PoolClient | null, sql: string, params: unknown[]) => {
  const rows = c ? (await c.query(sql, params)).rows : await q(sql, params);
  return BigInt(rows[0]?.s ?? 0);
};

export async function ensureUser(wallet: string, nickname: string) {
  await q(
    `insert into users (wallet, nickname) values ($1, $2)
     on conflict (wallet) do update set nickname = excluded.nickname`,
    [wallet, nickname.slice(0, 24) || "Anonim"],
  );
}

export const balance = (wallet: string, c: pg.PoolClient | null = null, cur: Currency = "SHOUT") =>
  sumOf(c, "select coalesce(sum(amount),0) s from ledger where wallet = $1 and currency = $2", [wallet, cur]);
const earnedToday = (wallet: string, c: pg.PoolClient | null = null) =>
  sumOf(c, "select coalesce(sum(amount),0) s from ledger where wallet = $1 and currency = 'SHOUT' and reason = 'reward' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'", [wallet]);
const claimedToday = (wallet: string, c: pg.PoolClient, cur: Currency) =>
  sumOf(c, "select coalesce(sum(amount),0) s from claims where wallet = $1 and currency = $2 and status <> 'failed' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'", [wallet, cur]);

/** Add a ledger row (amount in base units; negative = spend). Use inside tx() with the wallet locked. */
export async function post(c: pg.PoolClient, wallet: string, cur: Currency, units: bigint, reason: string, ref: string) {
  return c.query("insert into ledger (wallet, currency, amount, reason, ref) values ($1,$2,$3,$4,$5) on conflict do nothing", [wallet, cur, units.toString(), reason, ref]);
}
/** Debit or throw "insufficient". */
export async function spend(c: pg.PoolClient, wallet: string, cur: Currency, amountUi: number, reason: string, ref: string) {
  if (amountUi <= 0) return;
  const units = toUnits(amountUi, cur);
  if ((await balance(wallet, c, cur)) < units) throw new EconomyError(`Yetersiz $${cur} (gereken ${amountUi})`, 402);
  await post(c, wallet, cur, -units, reason, ref);
}
export const lockWallet = lock;

/** Credit a prediction reward (idempotent per shout, capped per day). Returns UI amount credited. */
export async function creditReward(wallet: string, shoutId: string, points: number) {
  if (points <= 0) return 0;
  return tx(async (c) => {
    await lock(c, wallet);
    const room = toBase(ECONOMY.dailyEarnCap) - (await earnedToday(wallet, c));
    const want = toBase(points * ECONOMY.rewardPerPoint);
    const amount = want < room ? want : room;
    if (amount <= 0n) return 0;
    const r = await c.query("insert into ledger (wallet, amount, reason, ref) values ($1,$2,'reward',$3) on conflict do nothing", [wallet, amount.toString(), shoutId]);
    return r.rowCount ? fromBase(amount) : 0;
  });
}

export async function me(wallet: string) {
  const [user] = await q("select wallet, nickname, created_at from users where wallet = $1", [wallet]);
  const inv = await q<{ item_id: string; qty: number }>("select item_id, qty from inventory where wallet = $1 and qty > 0", [wallet]);
  return {
    wallet,
    nickname: user?.nickname ?? null,
    balance: fromBase(await balance(wallet)),
    speak: fromUnits(await balance(wallet, null, "SPEAK"), "SPEAK"),
    earnedToday: fromBase(await earnedToday(wallet)),
    dailyEarnCap: ECONOMY.dailyEarnCap,
    inventory: Object.fromEntries(inv.map((i) => [i.item_id, i.qty])),
  };
}

export async function history(wallet: string) {
  const rows = await q("select currency, amount, reason, ref, created_at from ledger where wallet = $1 order by id desc limit 80", [wallet]);
  const claims = await q("select id, currency, amount, status, tx_sig, created_at from claims where wallet = $1 order by id desc limit 20", [wallet]);
  return {
    ledger: rows.map((r) => ({ ...r, amount: fromUnits(r.amount, r.currency) })),
    claims: claims.map((r) => ({ ...r, amount: fromUnits(r.amount, r.currency), explorer: r.tx_sig ? explorerTx(r.tx_sig) : null })),
  };
}

/** Withdraw off-chain balance to the wallet (treasury pays fees). $SHOUT is transferred, $SPEAK is minted. */
export async function claim(wallet: string, amountUi?: number, cur: Currency = "SHOUT") {
  if (!chainEnabled()) throw new EconomyError("Zincir bağlantısı yapılandırılmamış", 503);
  if (cur === "SPEAK" && !env.speakMint) throw new EconomyError("$SPEAK yapılandırılmamış", 503);
  const min = cur === "SHOUT" ? ECONOMY.minClaim : SPEAK_MIN_CLAIM;
  const claim = await tx(async (c) => {
    await lock(c, wallet);
    const bal = await balance(wallet, c, cur);
    const amount = amountUi ? toUnits(amountUi, cur) : bal;
    if (amount < toUnits(min, cur)) throw new EconomyError(`En az ${min} $${cur} çekebilirsin`);
    if (amount > bal) throw new EconomyError("Bakiye yetersiz");
    if (cur === "SHOUT" && (await claimedToday(wallet, c, cur)) + amount > toBase(ECONOMY.dailyClaimCap))
      throw new EconomyError(`Günlük çekim limiti ${ECONOMY.dailyClaimCap} $SHOUT`);
    const [row] = (await c.query("insert into claims (wallet, currency, amount, status) values ($1,$2,$3,'pending') returning id", [wallet, cur, amount.toString()])).rows;
    await post(c, wallet, cur, -amount, "claim", String(row.id));
    return { id: row.id as number, amount };
  });
  try {
    const sig = cur === "SHOUT" ? await sendFromTreasury(wallet, claim.amount) : await mintSpeakTo(wallet, claim.amount);
    await q("update claims set status = 'sent', tx_sig = $2 where id = $1", [claim.id, sig]);
    return { id: claim.id, currency: cur, amount: fromUnits(claim.amount, cur), signature: sig, explorer: explorerTx(sig) };
  } catch (e) {
    await tx(async (c) => {
      await c.query("update claims set status = 'failed', error = $2 where id = $1", [claim.id, String(e).slice(0, 500)]);
      await post(c, wallet, cur, claim.amount, "claim_refund", String(claim.id));
    });
    throw new EconomyError(`Transfer başarısız, bakiye iade edildi: ${String((e as Error).message ?? e).slice(0, 160)}`, 502);
  }
}

async function grant(c: pg.PoolClient, wallet: string, itemId: string, consumable: boolean) {
  await c.query(
    `insert into inventory (wallet, item_id, qty) values ($1,$2,1)
     on conflict (wallet, item_id) do update set qty = ${consumable ? "inventory.qty + 1" : "1"}`,
    [wallet, itemId],
  );
}
async function assertNotOwned(wallet: string, itemId: string, consumable: boolean) {
  if (consumable) return;
  const [r] = await q("select qty from inventory where wallet = $1 and item_id = $2 and qty > 0", [wallet, itemId]);
  if (r) throw new EconomyError("Bu öğe zaten sende", 409);
}

/** Buy with the earned (off-chain) balance — instant, no transaction fee. */
export async function buyWithBalance(wallet: string, itemId: string) {
  const item = shopItem(itemId);
  if (!item) throw new EconomyError("Böyle bir öğe yok", 404);
  await assertNotOwned(wallet, itemId, item.consumable);
  await tx(async (c) => {
    await lock(c, wallet);
    if ((await balance(wallet, c)) < toBase(item.price)) throw new EconomyError("Bakiye yetersiz");
    await c.query("insert into ledger (wallet, amount, reason, ref) values ($1,$2,'purchase',$3)", [wallet, (-toBase(item.price)).toString(), `${itemId}:${randomUUID()}`]);
    await grant(c, wallet, itemId, item.consumable);
  });
  return me(wallet);
}

/** Buy with $SHOUT paid on-chain from the wallet to the treasury. */
export async function buyOnChain(wallet: string, itemId: string, signature: string) {
  const item = shopItem(itemId);
  if (!item) throw new EconomyError("Böyle bir öğe yok", 404);
  const [dup] = await q("select 1 from purchases where tx_sig = $1", [signature]);
  if (dup) throw new EconomyError("Bu işlem zaten kullanıldı", 409);
  try {
    await verifyPaymentToTreasury(signature, wallet, toBase(item.price));
  } catch (e) {
    throw new EconomyError((e as Error).message, 400);
  }
  await tx(async (c) => {
    const r = await c.query("insert into purchases (tx_sig, wallet, item_id, amount) values ($1,$2,$3,$4) on conflict do nothing", [signature, wallet, itemId, toBase(item.price).toString()]);
    if (!r.rowCount) throw new EconomyError("Bu işlem zaten kullanıldı", 409);
    await grant(c, wallet, itemId, item.consumable);
  });
  return me(wallet);
}

export async function consume(wallet: string, itemId: string) {
  const r = await q("update inventory set qty = qty - 1 where wallet = $1 and item_id = $2 and qty > 0 returning qty", [wallet, itemId]);
  if (!r.length) throw new EconomyError("Envanterinde yok", 402);
}

export async function owns(wallet: string, itemId: string) {
  const [r] = await q("select qty from inventory where wallet = $1 and item_id = $2 and qty > 0", [wallet, itemId]);
  return Boolean(r);
}

/** ISO week (Monday 00:00 UTC start) containing `d`, with an id like 2026-W46. */
export function isoWeek(d = new Date()) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() || 7) - 1));
  const thursday = new Date(start.getTime() + 3 * 86400000);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return { id: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, start };
}

/** Pay the weekly season bonus for the week starting at `start` (idempotent). */
export async function paySeason(start: Date) {
  const end = new Date(start.getTime() + 7 * 86400000);
  const { id } = isoWeek(start);
  const top = await q<{ wallet: string; points: string }>(
    `select wallet, sum(points) points from shouts
     where wallet is not null and points is not null and created_at >= $1 and created_at < $2
     group by wallet having sum(points) > 0 order by sum(points) desc limit $3`,
    [start, end, ECONOMY.seasonBonus.length],
  );
  let paid = 0;
  for (const [i, row] of top.entries()) {
    const r = await q("insert into ledger (wallet, amount, reason, ref) values ($1,$2,'season',$3) on conflict do nothing returning id", [
      row.wallet,
      toBase(ECONOMY.seasonBonus[i]).toString(),
      `${id}:${row.wallet}`,
    ]);
    paid += r.length;
  }
  return { season: id, winners: top.length, paid };
}

/** Pays last week's bonus once it's over; safe to call repeatedly. */
export function startSeasonScheduler() {
  const run = () => {
    const lastWeek = isoWeek(new Date(Date.now() - 7 * 86400000)).start;
    paySeason(lastWeek).then((r) => r.paid && console.log("[season] paid", r)).catch((e) => console.warn("[season]", String(e)));
  };
  setTimeout(run, 10_000);
  setInterval(run, 3600_000);
}
