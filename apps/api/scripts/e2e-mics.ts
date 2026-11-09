/**
 * End-to-end test of talk-to-earn (mic NFTs + $SPEAK) against a running API and a Solana cluster
 * with the Metaplex Core program (localnet: clone CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d).
 *   API_URL=http://localhost:4000 SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/e2e-mics.ts
 * Needs DEV_TOOLS=1 on the API (/debug/credit, /debug/talk).
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import { fetchAsset, fetchCollection, mplCore, transfer } from "@metaplex-foundation/mpl-core";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { MICS, levelUpShout, levelUpSpeak, signInMessage, toBase } from "@syb/shared";

const API = process.env.API_URL ?? "http://localhost:4000";
const RPC = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const conn = new Connection(RPC, "confirmed");
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
async function login(kp: Keypair, name: string) {
  const wallet = kp.publicKey.toBase58();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL), "confirmed");
  const { json: n } = await call("/auth/nonce");
  const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(signInMessage(wallet, n.nonce)), kp.secretKey));
  const r = await call("/auth/wallet", { wallet, nonce: n.nonce, signature: sig, nickname: name });
  return r.json.session as string;
}
const umiFor = (kp: Keypair) => {
  const u = createUmi(RPC, "confirmed").use(mplCore());
  u.use(keypairIdentity(createSignerFromKeypair(u, u.eddsa.createKeypairFromSecretKey(kp.secretKey))));
  return u;
};

async function main() {
  const { json: eco } = await call("/economy");
  const mint = new PublicKey(eco.token.mint);
  const treasuryAta = new PublicKey(eco.token.treasuryAta);
  const user = Keypair.generate();
  const wallet = user.publicKey.toBase58();
  const s = await login(user, "MicKemal");
  console.log("test wallet", wallet);
  const umi = umiFor(user);

  // --- without a mic nothing is earned
  const t0 = await call("/debug/talk", { wallet, seconds: 60, listeners: 3 });
  ok(t0.json.status === "no-mic" && t0.json.speak === 0, "no mic → no earnings", t0.json.status);

  // --- buy with off-chain $SHOUT
  await call("/debug/credit", { wallet, amount: 3200 });
  const b1 = await call("/mics/buy", { name: "MicKemal" }, s);
  ok(b1.status === 200 && b1.json.asset, "bought a factory mic with balance", `${b1.json.type} ${b1.json.quality} #${b1.json.serial}`);
  const a1 = await fetchAsset(umi, publicKey(b1.json.asset));
  ok(a1.owner.toString() === wallet, "mic NFT minted into the wallet on-chain", a1.name);
  ok(a1.updateAuthority.address?.toString() === eco.token.micCollection, "NFT belongs to the ShoutYourBet Mics collection");
  const col = await fetchCollection(umi, publicKey(eco.token.micCollection));
  ok(col.numMinted >= 1, "collection counts minted mics", `minted ${col.numMinted}`);

  // --- buy with an on-chain $SHOUT payment
  const c = await call("/claims", { amount: 1100 }, s);
  ok(c.status === 200, "withdrew 1100 $SHOUT to pay on-chain", c.json.error);
  const userAta = getAssociatedTokenAddressSync(mint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const paySig = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(createTransferCheckedInstruction(userAta, mint, treasuryAta, user.publicKey, toBase(MICS.factoryPriceShout), 6, [], TOKEN_2022_PROGRAM_ID)),
    [user],
  );
  const b2 = await call("/mics/buy", { signature: paySig, name: "MicKemal" }, s);
  ok(b2.status === 200 && b2.json.asset, "bought a second mic with an on-chain payment", `#${b2.json.serial}`);
  const b2again = await call("/mics/buy", { signature: paySig }, s);
  ok(b2again.status === 409, "payment cannot be reused for another box", `status ${b2again.status}`);

  // --- energy
  let me = (await call("/me", undefined, s)).json;
  ok(me.energy.max === 2 && me.energy.energy === 2, "energy: 1–2 mics → max 2, filled on purchase", JSON.stringify(me.energy));

  // --- talk rules
  await call(`/mics/${b1.json.asset}/equip`, {}, s);
  const few = await call("/debug/talk", { wallet, seconds: 60, listeners: 1 });
  ok(few.json.status === "few-listeners" && few.json.speak === 0, "1 listener → not counted", few.json.status);
  const t1 = await call("/debug/talk", { wallet, seconds: 120, listeners: 2 });
  ok(t1.json.status === "earning" && t1.json.speak > 0, "2 minutes with 2 listeners → earns $SPEAK", `+${t1.json.speak} SPEAK, energy ${t1.json.energy}, durability ${t1.json.durability}`);
  ok(Math.abs(t1.json.energy - (2 - 120 / 300)) < 0.01, "energy spent: 1 energy = 5 minutes");
  ok(t1.json.durability < 100, "mic wears while talking");
  const crowd = await call("/debug/talk", { wallet, seconds: 120, listeners: 12 });
  ok(crowd.json.speak > t1.json.speak, "busier room pays more (crowd + charisma bonus)", `${crowd.json.speak} vs ${t1.json.speak}`);
  const long = await call("/debug/talk", { wallet, seconds: 3600, listeners: 2 });
  ok(long.json.seconds < 3600 && long.json.energy === 0, "talk capped by remaining energy", `${long.json.seconds}s counted`);
  const out = await call("/debug/talk", { wallet, seconds: 60, listeners: 3 });
  ok(out.json.status === "no-energy" && out.json.speak === 0, "no energy → no earnings", out.json.status);

  // --- level, points, repair
  await call("/debug/credit", { wallet, amount: 3000, currency: "SPEAK" });
  me = (await call("/me", undefined, s)).json;
  const speakBefore = me.speak;
  let mic: any = null;
  for (const a of [b1.json.asset, b2.json.asset]) for (let l = 0; l < MICS.mintMinLevel; l++) mic = (await call(`/mics/${a}/levelup`, {}, s)).json;
  ok(mic.level === 5, "levelled both mics to 5", `level ${mic.level}`);
  me = (await call("/me", undefined, s)).json;
  const spent = Array.from({ length: 5 }, (_, l) => levelUpSpeak(l)).reduce((a, b) => a + b, 0) * 2;
  ok(Math.abs(speakBefore - me.speak - spent) < 0.01, "level-ups cost the expected $SPEAK", `${spent} SPEAK`);
  ok(levelUpShout(4) > 0, "level 5 milestone also costs $SHOUT", `${levelUpShout(4)} SHOUT each`);
  const pts = mic.points;
  const alloc = await call(`/mics/${b2.json.asset}/points`, { efficiency: pts }, s);
  ok(alloc.status === 200 && alloc.json.points === 0 && alloc.json.efficiency >= b2.json.efficiency + pts, "attribute points allocated", `+${pts} efficiency`);
  const over = await call(`/mics/${b2.json.asset}/points`, { luck: 1 }, s);
  ok(over.status === 400, "cannot allocate more points than earned");
  const rep = await call(`/mics/${b1.json.asset}/repair`, {}, s);
  ok(rep.status === 200 && rep.json.durability === 100, "repair restores durability for $SPEAK");

  // --- mint a child mic
  const child = await call("/mics/mint", { a: b1.json.asset, b: b2.json.asset }, s);
  ok(child.status === 200 && child.json.asset, "minted a new mic from two parents", `${child.json.type} ${child.json.quality} #${child.json.serial}`);
  ok((await fetchAsset(umi, publicKey(child.json.asset))).owner.toString() === wallet, "child NFT minted on-chain to the wallet");
  me = (await call("/me", undefined, s)).json;
  ok(me.energy.max === 4, "3 mics → max energy 4", JSON.stringify(me.energy));
  const mics = (await call("/me/mics", undefined, s)).json;
  ok(mics.length === 3 && mics.filter((m: any) => m.mintCount === 1).length === 2, "parents' mint count increased");

  // --- withdraw $SPEAK (minted on-chain)
  const w = await call("/claims", { amount: 50, currency: "SPEAK" }, s);
  ok(w.status === 200 && w.json.currency === "SPEAK", "withdrew 50 $SPEAK", w.json.error);
  const speakAta = getAssociatedTokenAddressSync(new PublicKey(eco.token.speak.mint), user.publicKey, false, TOKEN_2022_PROGRAM_ID);
  ok(Number((await conn.getTokenAccountBalance(speakAta)).value.uiAmount) === 50, "50 $SPEAK minted into the wallet");

  // --- live NFT metadata
  const meta = await call(`/nft/mic/${b2.json.serial}.json`);
  const lvl = meta.json.attributes?.find((a: any) => a.trait_type === "Seviye")?.value;
  ok(meta.status === 200 && lvl === 5, "NFT metadata reflects live level", `${meta.json.name}, level ${lvl}`);

  // --- sell/transfer the child mic on-chain (like a marketplace sale)
  const buyer = Keypair.generate();
  const s2 = await login(buyer, "Alıcı");
  await transfer(umi, { asset: await fetchAsset(umi, publicKey(child.json.asset)), newOwner: publicKey(buyer.publicKey.toBase58()), collection: col }).sendAndConfirm(umi);
  const eq = await call(`/mics/${child.json.asset}/equip`, {}, s);
  ok(eq.status === 404, "seller can no longer use a transferred mic", `status ${eq.status}`);
  const buyerMics = (await call("/me/mics", undefined, s2)).json;
  ok(buyerMics.some((m: any) => m.asset === child.json.asset && m.mintCount === 0), "buyer sees the mic with its stats", `#${child.json.serial}`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
