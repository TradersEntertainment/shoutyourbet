/**
 * Browser E2E for talk-to-earn: buy/upgrade mics in the UI, then speak in a real LiveKit room
 * (Chromium fake mic plays recorded speech) with two listener tabs, and watch $SPEAK arrive.
 *
 *   node apps/web/e2e/mics.e2e.cjs <outDir>
 * Needs: web :3000, API :4000 (LiveKit + economy + mics + DEV_TOOLS=1), localnet :8899 with
 * <repo>/.secrets/localnet/ecosystem.json, ffmpeg.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } = require("@solana/spl-token");
const nacl = require("tweetnacl");

const OUT = path.resolve(process.argv[2] || ".");
const ROOT = path.resolve(__dirname, "../../..");
const SITE = "http://localhost:3000";
const API = "http://localhost:4000";
const conn = new Connection("http://127.0.0.1:8899", "confirmed");
let failures = 0;
const ok = (c, label, extra = "") => {
  console.log(`${c ? "✔" : "✖"} ${label}${extra ? `  (${extra})` : ""}`);
  if (!c) failures++;
};
const post = (p, b) => fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

async function installWallet(page, user) {
  await page.exposeFunction("__tw_sign", (bytes) => Array.from(nacl.sign.detached(Uint8Array.from(bytes), user.secretKey)));
  await page.exposeFunction("__tw_signTx", (bytes) => {
    const tx = Transaction.from(Buffer.from(bytes));
    tx.partialSign(user);
    return Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  });
  await page.addInitScript(
    ({ address, pk }) => {
      const listeners = new Set();
      const chains = ["solana:devnet", "solana:localnet", "solana:mainnet"];
      const account = { address, publicKey: new Uint8Array(pk), chains, features: ["solana:signMessage", "solana:signTransaction"] };
      const w = {
        version: "1.0.0", name: "Test Wallet", chains, accounts: [],
        icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#ab9ff2"/></svg>'),
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => { w.accounts = [account]; listeners.forEach((l) => l({ accounts: w.accounts })); return { accounts: w.accounts }; } },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => { w.accounts = []; } },
          "standard:events": { version: "1.0.0", on: (_e, l) => (listeners.add(l), () => listeners.delete(l)) },
          "solana:signMessage": { version: "1.0.0", signMessage: async (...ins) => Promise.all(ins.map(async (i) => ({ signedMessage: i.message, signature: new Uint8Array(await window.__tw_sign(Array.from(i.message))) }))) },
          "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...ins) => Promise.all(ins.map(async (i) => ({ signedTransaction: new Uint8Array(await window.__tw_signTx(Array.from(i.transaction))) }))) },
        },
      };
      const register = (api) => api.register(w);
      window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
    },
    { address: user.publicKey.toBase58(), pk: Array.from(user.publicKey.toBytes()) },
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const wav = path.join(OUT, "speech.wav");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", path.join(ROOT, "apps/api/test/fixtures/speech.opus"), "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);

  const eco = await (await fetch(API + "/economy")).json();
  const mint = new PublicKey(eco.token.mint);
  const user = Keypair.generate();
  const wallet = user.publicKey.toBase58();
  await conn.confirmTransaction(await conn.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL), "confirmed");
  const eco1 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${ROOT}/.secrets/localnet/ecosystem.json`, "utf8"))));
  const to = getAssociatedTokenAddressSync(mint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(user.publicKey, to, user.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createTransferCheckedInstruction(getAssociatedTokenAddressSync(mint, eco1.publicKey, false, TOKEN_2022_PROGRAM_ID), mint, to, eco1.publicKey, 1_000_000_000n, 6, [], TOKEN_2022_PROGRAM_ID),
    ),
    [user, eco1],
  );

  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
  const errs = [];
  const mkCtx = async (nick) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone"] });
    await ctx.addInitScript((n) => {
      try {
        localStorage.setItem("syb.nick", n);
        localStorage.setItem("syb.sfxMuted", "1");
      } catch {}
    }, nick);
    return ctx;
  };
  const ctx = await mkCtx("SesliKemal");
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(String(e)));
  await installWallet(page, user);

  // --- sign in on the mics page
  await page.goto(SITE + "/mics");
  await page.waitForSelector(".connect-card");
  await page.waitForTimeout(2000); // let React hydrate before clicking
  await page.click(".connect-card .btn-primary");
  await page.click(".wallet-adapter-modal-list button:has-text('Test Wallet')");
  await page.waitForSelector(".connect-card button:has-text('İmzala')");
  await page.click(".connect-card button:has-text('İmzala')");
  await page.waitForSelector(".factory", { timeout: 15000 });
  ok(await page.locator(".empty-state:has-text('Henüz mikrofonun yok')").isVisible(), "new player sees: no mic yet");
  await page.screenshot({ path: `${OUT}/mics-1-empty.png` });

  // --- buy one box from balance, one paid from the wallet
  await post("/debug/credit", { wallet, amount: 1300 });
  await post("/debug/credit", { wallet, amount: 400, currency: "SPEAK" });
  await page.reload();
  await page.waitForSelector(".factory");
  await page.waitForFunction(() => !document.querySelector(".factory .btn-primary")?.disabled, null, { timeout: 15000 });
  await page.click(".factory .btn-primary");
  await page.waitForSelector(".reveal", { timeout: 30000 });
  ok(true, "opened a mic box from balance", (await page.locator(".reveal h2").textContent()).trim());
  await page.screenshot({ path: `${OUT}/mics-2-reveal.png` });
  await page.click(".factory button:has-text('Cüzdandan öde')");
  await page.waitForFunction(() => document.querySelectorAll(".mic-card").length === 2, null, { timeout: 40000 });
  ok(true, "second mic paid on-chain from the wallet");

  // --- equip, level up, allocate points
  const first = page.locator(".mic-card").first();
  await first.locator("button:has-text('Tak')").click();
  await page.waitForSelector(".mic-card.equipped", { timeout: 10000 });
  ok(true, "equipped a mic");
  const eq = page.locator(".mic-card.equipped");
  await eq.locator("button[title='Seviye atla']").click();
  await page.waitForFunction(() => document.querySelector(".mic-card.equipped .mc-level .mono")?.textContent?.includes("Lv 1"), null, { timeout: 10000 });
  ok(true, "levelled up to 1 (paid in $SPEAK)");
  const effBefore = Number(await eq.locator(".stat-row .mono").first().textContent());
  const ptsBefore = Number((await eq.locator(".points-bar .small").textContent()).match(/\d+/)[0]);
  await eq.locator(".alloc-btns button[aria-label='Artır']").first().click();
  await eq.locator(".alloc-btns button[aria-label='Artır']").first().click();
  await eq.locator(".points-bar button").click();
  await page.waitForSelector(".notice.ok:has-text('Puanlar kaydedildi')", { timeout: 10000 });
  await page.waitForTimeout(300);
  const effAfter = Number(await page.locator(".mic-card.equipped .stat-row .mono").first().textContent());
  const ptsAfter = Number((await page.locator(".mic-card.equipped .points-bar .small").textContent()).match(/\d+/)[0]);
  ok(Math.abs(effAfter - effBefore - 2) < 0.01 && ptsAfter === ptsBefore - 2, "allocated 2 points to Verim (shown once, saved)", `Verim ${effBefore}→${effAfter}, points ${ptsBefore}→${ptsAfter}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/mics-3-cards.png`, fullPage: true });

  // --- talk in a real LiveKit room with two listeners
  const listeners = [];
  for (const n of ["Dinleyici1", "Dinleyici2"]) {
    const lc = await mkCtx(n);
    const lp = await lc.newPage();
    await lp.goto(SITE + "/room/inst-SOL");
    await lp.waitForSelector(".stage");
    listeners.push(lc);
  }
  await page.goto(SITE + "/room/inst-SOL");
  await page.waitForSelector(".mic-btn:not([disabled])", { timeout: 20000 });
  await page.click(".mic-btn");
  await page.waitForSelector(".mic-btn.on", { timeout: 10000 });
  ok(true, "speaker turned the mic on (fake mic plays recorded speech)");
  await page.waitForSelector(".talk-hud.earning", { timeout: 60000 });
  await page.waitForTimeout(16000); // one more flush
  const earned = (await page.locator(".th-earn .mono").textContent()).trim();
  ok(Number(earned.replace("+", "").replace(",", ".")) > 0, "room HUD shows live $SPEAK earnings", earned);
  await page.screenshot({ path: `${OUT}/mics-4-room-earning.png` });
  const me = await (await fetch(API + "/me", { headers: { authorization: `Bearer ${await page.evaluate(() => JSON.parse(localStorage.getItem("syb.session")).token)}` } })).json();
  ok(me.talkToday.seconds > 0, "server recorded verified talk time", `${me.talkToday.seconds}s → +${me.talkToday.speak} SPEAK, energy ${me.energy.energy}/${me.energy.max}`);

  ok(errs.length === 0, "no page errors", errs.join(" | ").slice(0, 300));
  for (const c of listeners) await c.close();
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
