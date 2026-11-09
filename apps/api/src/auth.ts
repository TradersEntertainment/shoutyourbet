import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { signInMessage } from "@syb/shared";
import type { FastifyRequest } from "fastify";
import { env } from "./env.js";
import { q } from "./db.js";

const SESSION_TTL_MS = 7 * 24 * 3600_000;
const NONCE_TTL_MS = 5 * 60_000;

export async function newNonce() {
  const nonce = randomBytes(16).toString("hex");
  await q("insert into nonces (nonce, expires_at) values ($1, now() + ($2 || ' milliseconds')::interval)", [nonce, NONCE_TTL_MS]);
  // opportunistic cleanup
  void q("delete from nonces where expires_at < now() - interval '1 hour'").catch(() => {});
  return nonce;
}

export function isWallet(s: unknown): s is string {
  try {
    return typeof s === "string" && new PublicKey(s).toBase58() === s;
  } catch {
    return false;
  }
}

/** Verify the signed sign-in message and consume the nonce. */
export async function verifySignIn(wallet: string, nonce: string, signatureB58: string) {
  if (!isWallet(wallet)) throw new Error("geçersiz cüzdan");
  const used = await q<{ nonce: string }>(
    "update nonces set used = true where nonce = $1 and not used and expires_at > now() returning nonce",
    [nonce],
  );
  if (!used.length) throw new Error("nonce geçersiz veya süresi dolmuş");
  const msg = new TextEncoder().encode(signInMessage(wallet, nonce));
  let sig: Uint8Array;
  try {
    sig = bs58.decode(signatureB58);
  } catch {
    throw new Error("imza okunamadı");
  }
  if (!nacl.sign.detached.verify(msg, sig, new PublicKey(wallet).toBytes())) throw new Error("imza doğrulanamadı");
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (payload: string) => createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");

export function issueSession(wallet: string) {
  const payload = b64u(JSON.stringify({ w: wallet, exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${mac(payload)}`;
}

export function readSession(token?: string): string | null {
  if (!token || !env.sessionSecret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return exp > Date.now() && isWallet(w) ? w : null;
  } catch {
    return null;
  }
}

/** Wallet from "Authorization: Bearer <session>" or null. */
export function walletOf(req: FastifyRequest) {
  const h = req.headers.authorization;
  return readSession(h?.startsWith("Bearer ") ? h.slice(7) : undefined);
}
