/**
 * End-to-end test of the $SHOUT economy against a running API + Solana cluster.
 *   API_URL=http://localhost:4000 SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/e2e-economy.ts
 * Requires DEV_TOOLS=1 on the API (uses /debug/credit) and a cluster where airdrops work (localnet).
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { signInMessage, toBase } from "@syb/shared";

const API = process.env.API_URL ?? "http://localhost:4000";
const conn = new Connection(process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
let failures = 0;
const ok = (cond: unknown, label: string, extra = "") => {
  console.log(`${cond ? "✔" : "✖"} ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};
async function call(path: string, body?: unknown, session?: string) {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(kp: Keypair) {
  const wallet = kp.publicKey.toBase58();
  const { json: n } = await call("/auth/nonce");
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(signInMessage(wallet, n.nonce)), kp.secretKey));
  const r = await call("/auth/wallet", { wallet, nonce: n.nonce, signature: sig, nickname: "E2E Kemal" });
  return { ...r, nonce: n.nonce, sig };
}

async function main() {
  const { json: eco } = await call("/economy");
  const mint = new PublicKey(eco.token.mint);
  const treasuryAta = new PublicKey(eco.token.treasuryAta);
  const user = Keypair.generate();
  const wallet = user.publicKey.toBase58();
  console.log("test wallet", wallet);
  await conn.confirmTransaction(await conn.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL), "confirmed");

  // --- auth
  const l = await login(user);
  ok(l.status === 200 && l.json.session, "wallet sign-in");
  const session = l.json.session as string;
  const replay = await call("/auth/wallet", { wallet, nonce: l.nonce, signature: l.sig });
  ok(replay.status === 401, "nonce cannot be replayed", `status ${replay.status}`);
  const other = Keypair.generate();
  const { json: n2 } = await call("/auth/nonce");
  const forged = await call("/auth/wallet", {
    wallet,
    nonce: n2.nonce,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(signInMessage(wallet, n2.nonce)), other.secretKey)),
  });
  ok(forged.status === 401, "signature from another key is rejected", `status ${forged.status}`);
  ok((await call("/me")).status === 401, "/me requires a session");

  // --- earn: LONG and SHORT on BTC in two rooms -> exactly one wins (price moves every second in mock mode)
  const { json: room } = await call("/rooms", { title: "e2e", instrumentId: "BTC", mode: "open", identity: "e2e", name: "E2E Kemal" });
  await call("/shouts", { room: "inst-BTC", identity: "e2e", name: "E2E Kemal", side: "LONG" }, session);
  await call("/shouts", { room: room.name, identity: "e2e", name: "E2E Kemal", side: "SHORT" }, session);
  let me: any = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    me = (await call("/me", undefined, session)).json;
    if (me.balance > 0) break;
  }
  ok(me.balance > 0, "correct prediction earned $SHOUT", `balance ${me.balance}, earned today ${me.earnedToday}`);
  const hist = (await call("/me/history", undefined, session)).json;
  ok(hist.ledger.some((r: any) => r.reason === "reward"), "reward recorded in ledger");
  const board = (await call("/leaderboard?room=inst-BTC")).json;
  ok(board.some((r: any) => r.wallet === wallet), "leaderboard row carries the wallet");

  // --- claim (withdraw to wallet)
  await call("/debug/credit", { wallet, amount: 300 });
  const small = await call("/claims", { amount: 50 }, session);
  ok(small.status === 400, "claim below minimum is rejected", small.json.error);
  const before = (await call("/me", undefined, session)).json.balance;
  const c = await call("/claims", { amount: 150 }, session);
  ok(c.status === 200 && c.json.signature, "claim sent on-chain", c.json.signature?.slice(0, 16));
  const userAta = getAssociatedTokenAddressSync(mint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const onchain = Number((await conn.getTokenAccountBalance(userAta)).value.uiAmount);
  ok(onchain === 150, "wallet received 150 $SHOUT on-chain", `on-chain ${onchain}`);
  const after = (await call("/me", undefined, session)).json;
  ok(Math.abs(before - 150 - after.balance) < 1e-6, "off-chain balance debited", `${before} -> ${after.balance}`);
  const tooMuch = await call("/claims", { amount: 1_000_000 }, session);
  ok(tooMuch.status === 400, "claim above balance is rejected", tooMuch.json.error);

  // --- buy with off-chain balance
  const b1 = await call("/purchases", { itemId: "megaphone" }, session);
  ok(b1.status === 200 && b1.json.inventory?.megaphone === 1, "bought megaphone with balance");
  const mega = await call("/megaphone", { room: "inst-BTC", text: "BTC 100K!", name: "E2E Kemal" }, session);
  ok(mega.status === 200 && !mega.json.inventory?.megaphone, "megaphone used (consumed)");
  const mega2 = await call("/megaphone", { room: "inst-BTC", text: "again", name: "E2E Kemal" }, session);
  ok(mega2.status === 402, "megaphone without inventory is rejected", `status ${mega2.status}`);

  // --- buy on-chain: pay 100 to the treasury for the gold name
  const pay = async (amount: number) =>
    sendAndConfirmTransaction(
      conn,
      new Transaction().add(createTransferCheckedInstruction(userAta, mint, treasuryAta, user.publicKey, toBase(amount), 6, [], TOKEN_2022_PROGRAM_ID)),
      [user],
    );
  const sig = await pay(100);
  const p1 = await call("/purchases", { itemId: "name-gold", signature: sig }, session);
  ok(p1.status === 200 && p1.json.inventory?.["name-gold"] === 1, "on-chain purchase verified (gold name)");
  const p2 = await call("/purchases", { itemId: "megaphone", signature: sig }, session);
  ok(p2.status === 409, "same transaction cannot be reused", `status ${p2.status}`);
  const cheap = await pay(10);
  const p3 = await call("/purchases", { itemId: "theme-neon", signature: cheap }, session);
  ok(p3.status === 400, "underpayment is rejected", p3.json.error);
  const again = await call("/purchases", { itemId: "name-gold" }, session);
  ok(again.status === 409, "non-consumable cannot be bought twice", `status ${again.status}`);

  // --- someone else's tx can't be claimed
  const thief = Keypair.generate();
  const t = await login(thief);
  const p4 = await call("/purchases", { itemId: "name-gold", signature: cheap }, t.json.session);
  ok(p4.status === 400, "another wallet's payment is rejected", p4.json.error);

  // --- double-spend: two parallel withdrawals of 100 from a 130 balance -> only one may pass
  const bal = (await call("/me", undefined, session)).json.balance;
  const par = await Promise.all([call("/claims", { amount: 100 }, session), call("/claims", { amount: 100 }, session)]);
  const okCount = par.filter((r) => r.status === 200).length;
  ok(bal < 200 && okCount === 1, "parallel withdrawals cannot double-spend", `balance ${bal}, succeeded ${okCount}/2`);
  const finalBal = (await call("/me", undefined, session)).json.balance;
  ok(finalBal >= 0, "balance never goes negative", `final ${finalBal}`);

  // --- season bonus (dev trigger for the current week): this wallet has positive points
  const season = await call("/debug/season", {});
  const h2 = (await call("/me/history", undefined, session)).json;
  ok(season.status === 200 && h2.ledger.some((r: any) => r.reason === "season"), "weekly season bonus paid", JSON.stringify(season.json));
  const season2 = await call("/debug/season", {});
  ok(season2.json.paid === 0, "season bonus is paid only once", `second run paid ${season2.json.paid}`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
