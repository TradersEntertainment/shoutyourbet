/**
 * Browser E2E for the $SHOUT flows with an injected Wallet Standard test wallet
 * (same protocol Phantom/Solflare use), signing in Node with a local keypair.
 *
 *   node apps/web/e2e/wallet.e2e.cjs <outDir>
 * Needs: web on :3000, API on :4000 with DEV_TOOLS=1 + economy, a localnet validator on :8899,
 * and <repo>/.secrets/localnet/ecosystem.json (funded by create-token).
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } = require("@solana/spl-token");
const nacl = require("tweetnacl");

const OUT = process.argv[2] || ".";
const ROOT = path.resolve(__dirname, "../../..");
const SITE = "http://localhost:3000";
const API = "http://localhost:4000";
const conn = new Connection("http://127.0.0.1:8899", "confirmed");
let failures = 0;
const ok = (c, label, extra = "") => {
  console.log(`${c ? "✔" : "✖"} ${label}${extra ? `  (${extra})` : ""}`);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const eco = await (await fetch(API + "/economy")).json();
  const mint = new PublicKey(eco.token.mint);
  const user = Keypair.generate();
  const wallet = user.publicKey.toBase58();
  console.log("test wallet", wallet);
  await conn.confirmTransaction(await conn.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL), "confirmed");
  // seed 300 $SHOUT on-chain from the ecosystem wallet (for the wallet-paid purchase)
  const eco1 = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${ROOT}/.secrets/localnet/ecosystem.json`, "utf8"))));
  const from = getAssociatedTokenAddressSync(mint, eco1.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const to = getAssociatedTokenAddressSync(mint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(
    conn,
    new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(user.publicKey, to, user.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createTransferCheckedInstruction(from, mint, to, eco1.publicKey, 300_000_000n, 6, [], TOKEN_2022_PROGRAM_ID),
    ),
    [user, eco1],
  );

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("syb.nick", "PhantomKemal");
      localStorage.setItem("syb.sfxMuted", "1");
    } catch {}
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  // --- signing bridge (Node keypair) + Wallet Standard wallet registered in the page
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
      const account = { address, publicKey: new Uint8Array(pk), chains, features: ["solana:signMessage", "solana:signTransaction"], label: "Test" };
      const w = {
        version: "1.0.0",
        name: "Test Wallet",
        icon: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#ab9ff2"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">T</text></svg>'),
        chains,
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => { w.accounts = [account]; listeners.forEach((l) => l({ accounts: w.accounts })); return { accounts: w.accounts }; } },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => { w.accounts = []; listeners.forEach((l) => l({ accounts: [] })); } },
          "standard:events": { version: "1.0.0", on: (_e, l) => (listeners.add(l), () => listeners.delete(l)) },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signedMessage: i.message, signature: new Uint8Array(await window.__tw_sign(Array.from(i.message))) }))),
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs) => Promise.all(inputs.map(async (i) => ({ signedTransaction: new Uint8Array(await window.__tw_signTx(Array.from(i.transaction))) }))),
          },
        },
      };
      const register = (api) => api.register(w);
      window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
    },
    { address: wallet, pk: Array.from(user.publicKey.toBytes()) },
  );

  // --- wallet page: connect + sign in
  await page.goto(SITE + "/wallet");
  await page.waitForSelector(".connect-card");
  await page.screenshot({ path: `${OUT}/eco-1-connect.png` });
  await page.click(".connect-card .btn-primary");
  await page.waitForSelector(".wallet-adapter-modal-list");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/eco-2-modal.png` });
  await page.click(".wallet-adapter-modal-list button:has-text('Test Wallet')");
  await page.waitForSelector(".connect-card button:has-text('İmzala')");
  await page.click(".connect-card button:has-text('İmzala')");
  await page.waitForSelector(".balance-card", { timeout: 15000 });
  ok(true, "connected wallet + signed in through the UI");
  ok(await page.locator(".bal-chip").isVisible(), "balance chip in top bar");

  // --- credit (dev) and withdraw via UI
  await fetch(API + "/debug/credit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, amount: 420 }) });
  await page.reload();
  await page.waitForSelector(".balance-card");
  await page.waitForFunction(() => document.querySelector(".bc-amount .mono")?.textContent?.includes("420"), null, { timeout: 15000 });
  await page.fill(".claim-row input", "150");
  await page.click(".claim-row .btn-primary");
  await page.waitForSelector(".notice.ok, .notice.err", { timeout: 30000 });
  const claimMsg = await page.locator(".claim-card .notice").textContent();
  ok(claimMsg.includes("gönderildi"), "withdraw via UI", claimMsg.trim().slice(0, 60));
  await page.waitForFunction(() => document.querySelectorAll(".tag.ok").length > 0, null, { timeout: 10000 });
  const onchain = Number((await conn.getTokenAccountBalance(to)).value.uiAmount);
  ok(onchain === 450, "wallet holds 300 + 150 on-chain", `on-chain ${onchain}`);
  await page.screenshot({ path: `${OUT}/eco-3-wallet.png` });

  // --- shop: buy megaphone from balance, gold name paid on-chain
  await page.goto(SITE + "/shop");
  await page.waitForSelector(".shop-item");
  const item = (id) => page.locator(".shop-item", { has: page.locator(`h3:text-is("${id}")`) });
  await item("Megafon").locator("button:has-text('Bakiyeden al')").click();
  await item("Megafon").locator(".notice").waitFor({ timeout: 10000 });
  ok((await item("Megafon").locator(".notice").textContent()).includes("Satın alındı"), "bought Megafon from balance");
  await item("Altın lakap").locator("button:has-text('Cüzdandan öde')").click();
  await item("Altın lakap").locator(".notice").waitFor({ timeout: 40000 });
  const goldMsg = await item("Altın lakap").locator(".notice").textContent();
  ok(goldMsg.includes("doğrulandı"), "paid Altın lakap on-chain from the wallet", goldMsg);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/eco-4-shop.png` });

  // --- room: shout with session -> reward toast; megaphone
  await page.goto(SITE + "/room/inst-BTC");
  await page.waitForSelector(".shout.long");
  await page.waitForTimeout(1500);
  await page.click(".shout.long");
  await page.fill(".mega-compose input", "BTC 100K bu hafta, yazın bir kenara!");
  await page.click(".mega-compose button");
  await page.waitForSelector(".mega-bar", { timeout: 10000 });
  ok(true, "megaphone pinned in the room");
  await page.waitForSelector(".pnl-toast", { timeout: 25000 });
  const toast = await page.locator(".pnl-toast").first().textContent();
  ok(true, "prediction scored in the room", toast.replace(/\s+/g, " ").slice(0, 80));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/eco-5-room.png` });

  ok(errs.length === 0, "no page errors", errs.join(" | ").slice(0, 200));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
