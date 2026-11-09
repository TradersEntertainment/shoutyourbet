// Records trailer footage from the running site via CDP screencast (sharp 1080p JPEG frames).
// Output: raw/<name>/frames/*.jpg + raw/<name>/meta.json { frames:[ts...], marks:{label: ts} }
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const T = __dirname;
const SITE = "http://localhost:3000";
const API = "http://localhost:4000";
const only = process.argv[2]; // optional: record a single shot

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const post = (p, b) => fetch(API + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()).catch(() => null);

async function newPage(browser, nick = "CryptoKemal") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript((n) => {
    try {
      localStorage.setItem("syb.nick", n);
      localStorage.setItem("syb.sfxMuted", "1");
    } catch {}
  }, nick);
  return ctx.newPage();
}

async function startRec(page, name) {
  const dir = path.join(T, "raw", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const rec = { dir, frames: [], marks: {}, cdp };
  cdp.on("Page.screencastFrame", (f) => {
    const i = rec.frames.length;
    fs.writeFileSync(path.join(dir, "frames", String(i).padStart(5, "0") + ".jpg"), Buffer.from(f.data, "base64"));
    rec.frames.push(f.metadata.timestamp);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  rec.mark = (label) => (rec.marks[label] = now());
  return rec;
}
async function stopRec(rec) {
  await rec.cdp.send("Page.stopScreencast").catch(() => {});
  await sleep(200);
  fs.writeFileSync(path.join(rec.dir, "meta.json"), JSON.stringify({ frames: rec.frames, marks: rec.marks }));
  console.log(`  ${path.basename(rec.dir)}: ${rec.frames.length} frames, ${(rec.frames.at(-1) - rec.frames[0]).toFixed(1)}s, marks=${Object.keys(rec.marks).join(",")}`);
}

/** Visible cursor + click ripple (headless has no cursor). */
async function cursor(page) {
  await page.evaluate(() => {
    if (document.getElementById("fcur")) return;
    const st = document.createElement("style");
    st.textContent =
      "#fcur{position:fixed;z-index:2147483647;left:0;top:0;pointer-events:none;transform:translate(640px,500px);filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}" +
      ".fring{position:fixed;z-index:2147483646;width:44px;height:44px;border-radius:50%;border:3px solid #f0b90b;pointer-events:none;animation:fring .55s ease-out forwards}" +
      "@keyframes fring{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}";
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "fcur";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5l6.8 18.2 2.6-7.4 7.3-2.7z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`), true);
    addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.className = "fring";
      r.style.left = e.clientX - 22 + "px";
      r.style.top = e.clientY - 22 + "px";
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  });
  await page.mouse.move(640, 500);
}
async function moveTo(page, selector, steps = 25) {
  const b = await page.locator(selector).first().boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
  return b;
}

/** Demo stage: fills the offline stage panel with a lively crowd (no LiveKit in this sandbox). */
async function fakeStage(page, me) {
  await page.evaluate((me) => {
    const panel = document.querySelector(".stage.offline");
    if (!panel) return;
    [...panel.children].forEach((ch) => (ch.style.display = "none"));
    const speakers = [me, "BalinaBülent", "FomoFatma", "ShortSinan", "MoonBoy42", "DipAvcısı", "LikideLider", "StopSelin"];
    const listeners = ["Ayşe", "TraderTom", "Kerem", "Neo", "Zeynep", "Hodl", "Mert", "Satoshi", "Elif", "Rekt", "Bora", "Lambo"];
    const seat = (n, small) =>
      `<div class="seat" data-n="${n}"><div class="seat-avatar">${n.slice(0, 2).toUpperCase()}<span class="seat-mic ${small ? "" : "on"}">` +
      `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></span></div>` +
      `<div class="seat-name"><span class="ellipsis">${n}</span></div>${n === me ? '<div class="seat-you">sen</div>' : ""}</div>`;
    const box = document.createElement("div");
    box.id = "fakestage";
    box.innerHTML =
      `<header class="panel-head"><h3><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Sahne <span class="muted">· 247</span></h3>` +
      `<span class="conn ok" id="talking">5 kişi konuşuyor</span></header>` +
      `<div class="seats">${speakers.map((n) => seat(n)).join("")}</div>` +
      `<div class="sub-title">Dinleyiciler · 239</div><div class="seats small">${listeners.map((n) => seat(n, true)).join("")}</div>`;
    panel.appendChild(box);
    const seats = [...box.querySelectorAll(".seats:not(.small) .seat")];
    setInterval(() => {
      let talking = 0;
      seats.forEach((s, i) => {
        const on = Math.random() < (i === 0 ? 0.35 : 0.55);
        s.classList.toggle("speaking", on);
        s.querySelector(".seat-avatar").style.setProperty("--lvl", on ? (0.3 + Math.random() * 0.7).toFixed(2) : 0);
        talking += on;
      });
      box.querySelector("#talking").textContent = `${talking} kişi konuşuyor`;
    }, 220);
    // listener count in the room bar
    document.querySelectorAll(".stat").forEach((st) => {
      if (st.querySelector(".stat-l")?.textContent.includes("Dinleyici")) st.querySelector(".stat-v").textContent = "247";
    });
  }, me);
}

/** Demo numbers on the lobby (rooms are empty in the sandbox). */
async function fakeLobby(page) {
  await page.evaluate(() => {
    const counts = [247, 182, 96, 41, 133, 58, 39, 121, 17, 64];
    document.querySelectorAll(".markets tbody tr").forEach((tr, i) => {
      const td = tr.querySelectorAll("td")[4];
      if (td) td.lastChild.textContent = " " + counts[i];
    });
    const cc = [88, 37, 12, 54];
    document.querySelectorAll(".clist li a > span:last-child").forEach((el, i) => (el.lastChild.textContent = " " + (cc[i] ?? 9)));
    const k = document.querySelector(".kpi .kpi-v");
    if (k) k.textContent = "1.284";
  });
  await fakeSidebar(page);
}
async function fakeSidebar(page) {
  await page.evaluate(() => {
    const sideCounts = [88, 37, 12, 54];
    document.querySelectorAll(".side-row > .live-count:last-child").forEach((el, i) => (el.lastChild.textContent = String(sideCounts[i] ?? 9)));
  });
}

const shots = {
  async card(browser, lang, kind) {
    const page = await newPage(browser);
    await page.goto(`file://${T}/card.html?lang=${lang}&kind=${kind}`);
    const rec = await startRec(page, `card_${kind}_${lang}`);
    rec.mark("start");
    await sleep(kind === "intro" ? 7000 : 6500);
    await stopRec(rec);
    await page.context().close();
  },

  async lobby(browser) {
    const page = await newPage(browser);
    await page.goto(SITE + "/");
    await page.waitForSelector(".markets tbody tr");
    await sleep(2500);
    await fakeLobby(page);
    await cursor(page);
    const rec = await startRec(page, "lobby");
    rec.mark("start");
    await sleep(600);
    await moveTo(page, ".mover >> nth=0", 30);
    await sleep(900);
    await moveTo(page, ".mover >> nth=1", 25);
    await sleep(700);
    await moveTo(page, ".markets tbody tr >> nth=0", 30);
    await sleep(500);
    await moveTo(page, ".markets tbody tr >> nth=0 >> .btn", 20);
    await sleep(800);
    rec.mark("click");
    await page.mouse.down();
    await page.mouse.up();
    await sleep(2500);
    await stopRec(rec);
    await page.context().close();
  },

  async room1(browser) {
    const page = await newPage(browser, "CryptoKemal");
    await page.goto(SITE + "/room/inst-BTC");
    await page.waitForSelector(".shout.long");
    await fakeStage(page, "CryptoKemal");
    await fakeSidebar(page);
    await cursor(page);
    await sleep(800);
    const rec = await startRec(page, "room1");
    rec.mark("start");
    await sleep(700);
    await moveTo(page, ".shout.long", 35);
    await sleep(400);
    rec.mark("long");
    await page.mouse.down();
    await page.mouse.up();
    await sleep(900);
    rec.mark("long2");
    await post("/shouts", { room: "inst-BTC", identity: "f-moon", name: "MoonBoy42", side: "LONG" });
    await sleep(700);
    await post("/shouts", { room: "inst-BTC", identity: "f-fomo", name: "FomoFatma", side: "LONG" });
    rec.mark("long3");
    await sleep(3500);
    await stopRec(rec);
    await page.context().close();
  },

  async room2(browser) {
    const page = await newPage(browser, "CryptoKemal");
    await page.goto(SITE + "/room/inst-BTC");
    await page.waitForSelector(".shout.short");
    await fakeStage(page, "CryptoKemal");
    await fakeSidebar(page);
    await cursor(page);
    await moveTo(page, ".shout.long", 1);
    await sleep(800);
    const rec = await startRec(page, "room2");
    rec.mark("start");
    await sleep(500);
    await moveTo(page, ".shout.short", 18);
    await sleep(250);
    rec.mark("short");
    await page.mouse.down();
    await page.mouse.up();
    await sleep(500);
    await post("/shouts", { room: "inst-BTC", identity: "f-sinan", name: "ShortSinan", side: "SHORT" });
    rec.mark("short2");
    await sleep(2200);
    // --- alarm
    rec.mark("alarm");
    await fetch(API + "/debug/alarm?symbol=BTC&pct=-3.42");
    await sleep(5600);
    // --- soundboard + emoji chaos
    rec.mark("sfx");
    // these resolve (6 s horizon + ≤5 s scorer tick) during the results shot
    for (const [id, name, side] of [["f-b2", "BalinaBülent", "LONG"], ["f-f2", "FomoFatma", "SHORT"], ["f-d2", "DipAvcısı", "LONG"], ["f-l2", "LikideLider", "SHORT"]])
      void post("/shouts", { room: "inst-BTC", identity: id, name, side });
    await moveTo(page, ".sfx-btn >> nth=0", 14); // horn
    rec.mark("horn");
    await page.mouse.down();
    await page.mouse.up();
    for (const [i, label] of [[0, "rocket"], [0], [0], [1, "skull"], [1], [5], [5], [6], [6], [6]]) {
      await moveTo(page, `.react-btn >> nth=${i}`, 5);
      if (label) rec.mark(label);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(120);
    }
    await sleep(500);
    await moveTo(page, ".sfx-btn >> nth=4", 10); // cry
    rec.mark("cry");
    await page.mouse.down();
    await page.mouse.up();
    for (const i of [2, 2, 7, 7, 4, 4]) {
      await moveTo(page, `.react-btn >> nth=${i}`, 4);
      await page.mouse.down();
      await page.mouse.up();
      await sleep(110);
    }
    await sleep(1200);
    // --- results: scroll to the leaderboard, wait for PnL toasts
    rec.mark("results");
    await page.mouse.move(1000, 400, { steps: 10 });
    await page.evaluate(() => window.scrollTo({ top: 420, behavior: "smooth" }));
    const seen = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 14000) {
      const n = await page.locator(".pnl-toast").count();
      for (let i = seen.size; i < n; i++) {
        const win = await page.locator(".pnl-toast").nth(i).evaluate((e) => e.classList.contains("win")).catch(() => false);
        rec.mark(`toast${i}_${win ? "win" : "loss"}`);
        seen.add(i);
      }
      await sleep(80);
    }
    await stopRec(rec);
    await page.context().close();
  },
};

(async () => {
  const browser = await chromium.launch();
  // warm-up round so the leaderboard already has a few names when we film it
  if (!only || only === "room2") {
    console.log("seeding leaderboard…");
    const seed = [["f-balina", "BalinaBülent", "LONG"], ["f-dip", "DipAvcısı", "SHORT"], ["f-stop", "StopSelin", "LONG"], ["f-lik", "LikideLider", "SHORT"], ["f-moon2", "MoonBoy42", "SHORT"]];
    for (const [id, name, side] of seed) await post("/shouts", { room: "inst-BTC", identity: id, name, side });
    await sleep(12500);
  }
  for (const lang of ["en", "tr"])
    for (const kind of ["intro", "outro"]) if (!only || only === "cards") await shots.card(browser, lang, kind);
  for (const name of ["lobby", "room1", "room2"]) if (!only || only === name) {
    console.log("recording", name);
    await shots[name](browser);
  }
  await browser.close();
})();
