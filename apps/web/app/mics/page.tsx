"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Zap, Wrench, ArrowUpCircle, Plus, Minus, Check, Loader2, Sparkles, Mic, Users, Clock, Package, Coins, Wallet, Info, CalendarClock, Target, Hourglass } from "lucide-react";
import {
  MICS,
  QUALITIES,
  MIC_TYPES,
  STATS,
  levelUpShout,
  levelUpSpeak,
  mintCost,
  repairCost,
  speakPerMinute,
  canTalkAnytime,
  DAILY_TALK_MINUTES,
  instrumentById,
  trTime,
  type MissionInstance,
  type Mic as MicT,
  type StatKey,
} from "@syb/shared";
import { req } from "@/lib/api";
import { fmtToken, useSession } from "@/lib/session";
import { sendShout, walletErr } from "@/lib/chain";
import { ShoutCoin, SpeakCoin } from "@/components/wallet/WalletButton";

const micImg = (m: Pick<MicT, "type" | "quality">) => `/mics/${m.type}-${m.quality}.png`;
const until = (ts: number | null) => {
  if (!ts) return "";
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`;
};

function StatBar({ label, value, max, hint }: { label: string; value: number; max: number; hint: string }) {
  return (
    <div className="stat-row" title={hint}>
      <span className="muted small">{label}</span>
      <span className="statbar">
        <span style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </span>
      <span className="mono small">{value.toFixed(1)}</span>
    </div>
  );
}

function MicCard({ mic, busy, onAction }: { mic: MicT; busy: string | null; onAction: (a: "equip" | "levelup" | "repair" | "points", m: MicT, data?: unknown) => void }) {
  const q = QUALITIES[mic.quality];
  const [alloc, setAlloc] = useState<Record<StatKey, number>>({ efficiency: 0, luck: 0, resilience: 0, charisma: 0 });
  const left = mic.points - Object.values(alloc).reduce((a, b) => a + b, 0);
  const statMax = Math.max(q.base[1] * 1.5, mic.efficiency, mic.luck, mic.resilience, mic.charisma) + 5;
  const lvlSpeak = levelUpSpeak(mic.level);
  const lvlShout = levelUpShout(mic.level);
  const fix = repairCost(100 - mic.durability, mic.level, mic.quality);
  const rate = speakPerMinute(mic, MICS.minListeners);
  const b = (k: string) => busy === `${k}:${mic.asset}`;

  return (
    <article className={`panel mic-card ${mic.equipped ? "equipped" : ""}`} style={{ ["--q" as string]: q.color }}>
      <div className="mc-top">
        <img src={micImg(mic)} alt="" className="mc-img" />
        <div className="mc-id">
          <div className="mc-name">
            Mic #{mic.serial}
            {mic.equipped && (
              <span className="tag ok">
                <Check size={11} /> Takılı
              </span>
            )}
          </div>
          <div className="small">
            <b style={{ color: q.color }}>{q.label}</b> <span className="muted">· {MIC_TYPES[mic.type].label}</span>
          </div>
          {canTalkAnytime(mic.quality) ? (
            <span className="tag ok w-fit">
              <Clock size={11} /> Her zaman kazanır
            </span>
          ) : (
            <span className="tag w-fit" title="Bu kalite sadece görev saatlerinde, görev odasında kazanır">
              <CalendarClock size={11} /> Görev saatlerinde
            </span>
          )}
          <div className="mc-level">
            <span className="mono">Lv {mic.level}</span>
            <span className="muted small">Basım {mic.mintCount}/{MICS.maxMintCount}</span>
          </div>
          <div className="muted small">
            ≈ <span className="mono">{rate.toFixed(2)}</span> $SPEAK/dk
          </div>
        </div>
      </div>

      <div className="durability">
        <div className="row-between small">
          <span className="muted">Dayanıklılık</span>
          <span className={`mono ${mic.durability < MICS.durabilityPenaltyBelow ? "down" : ""}`}>{mic.durability.toFixed(1)}/100</span>
        </div>
        <span className="meter wide dur">
          <span style={{ width: `${mic.durability}%` }} />
        </span>
      </div>

      <div className="stats">
        {STATS.map((s) => (
          <div key={s.key} className="stat-alloc">
            <StatBar label={s.label} value={mic[s.key] + alloc[s.key]} max={statMax} hint={s.hint} />
            {mic.points > 0 && (
              <span className="alloc-btns">
                <button className="icon-btn sm" disabled={alloc[s.key] <= 0} onClick={() => setAlloc({ ...alloc, [s.key]: alloc[s.key] - 1 })} aria-label="Azalt">
                  <Minus size={12} />
                </button>
                <button className="icon-btn sm" disabled={left <= 0} onClick={() => setAlloc({ ...alloc, [s.key]: alloc[s.key] + 1 })} aria-label="Artır">
                  <Plus size={12} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {mic.points > 0 && (
        <div className="points-bar">
          <span className="small">
            <Sparkles size={13} className="gold" /> {left} puan dağıtılmadı
          </span>
          <button className="btn btn-sm btn-primary" disabled={left === mic.points || b("points")} onClick={() => onAction("points", mic, alloc)}>
            {b("points") && <Loader2 size={13} className="spin" />} Kaydet
          </button>
        </div>
      )}

      <div className="mc-actions">
        {!mic.equipped && (
          <button className="btn btn-sm" disabled={!!busy} onClick={() => onAction("equip", mic)}>
            {b("equip") ? <Loader2 size={13} className="spin" /> : <Mic size={13} />} Tak
          </button>
        )}
        <button className="btn btn-sm" disabled={!!busy || mic.level >= MICS.maxLevel} onClick={() => onAction("levelup", mic)} title="Seviye atla">
          {b("levelup") ? <Loader2 size={13} className="spin" /> : <ArrowUpCircle size={13} />} Lv {mic.level + 1}
          <span className="cost">
            <SpeakCoin size={12} />
            {lvlSpeak}
            {lvlShout > 0 && (
              <>
                {" "}
                <ShoutCoin size={12} />
                {lvlShout}
              </>
            )}
          </span>
        </button>
        <button className="btn btn-sm" disabled={!!busy || mic.durability >= 100} onClick={() => onAction("repair", mic)} title="Tamir et">
          {b("repair") ? <Loader2 size={13} className="spin" /> : <Wrench size={13} />} Tamir
          {mic.durability < 100 && (
            <span className="cost">
              <SpeakCoin size={12} />
              {fix}
            </span>
          )}
        </button>
      </div>
    </article>
  );
}

type MissionView = MissionInstance & { progress: number; completed: boolean };

function MissionsPanel({ signedIn }: { signedIn: boolean }) {
  const [data, setData] = useState<{ missions: MissionView[]; next: { title: string; startAt: number; room: string; day: string } | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => req<typeof data>("/missions").then((d) => alive && setData(d)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [signedIn]);
  const list = data?.missions ?? [];
  return (
    <section className="panel missions">
      <h3 className="ph">
        <CalendarClock size={15} /> Bugünkü görevler
      </h3>
      <p className="muted small">Sıradan, Nadir ve Ender mikrofonlar sadece görev saatinde, görev odasında kazanır. Tamamlayana bonus.</p>
      {list.length === 0 && <p className="empty">Bugün görev yok.</p>}
      <ul className="mission-list">
        {list.map((m) => {
          const inst = instrumentById(m.instrumentId);
          return (
            <li key={m.id} className={`mission ${m.status} ${m.completed ? "done" : ""}`}>
              <div className="mi-top">
                <span className="mono mi-time">
                  {m.start}–{m.end}
                </span>
                {m.status === "active" && <span className="tag live">Şu an aktif</span>}
                {m.status === "ended" && !m.completed && <span className="tag">Bitti</span>}
                {m.completed && (
                  <span className="tag ok">
                    <Check size={11} /> Tamamlandı
                  </span>
                )}
              </div>
              <div className="mi-title">
                <b>{m.title}</b>
                <Link href={`/room/${m.room}`} className="muted small">
                  {inst?.name ?? m.instrumentId} odası →
                </Link>
              </div>
              <div className="mi-progress">
                <span className="meter wide">
                  <span style={{ width: `${(m.progress / m.targetSec) * 100}%` }} />
                </span>
                <span className="muted small mono">
                  {Math.floor(m.progress / 60)}/{Math.floor(m.targetSec / 60)} dk
                </span>
                <span className="mi-bonus small">
                  <Target size={12} /> +{m.bonus}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {data?.next && data.next.day !== list[0]?.day && (
        <p className="muted small">
          Sıradaki: yarın {trTime(data.next.startAt)} · {data.next.title}
        </p>
      )}
    </section>
  );
}

export default function MicsPage() {
  const s = useSession();
  const { connection } = useConnection();
  const walletCtx = useWallet();
  const modal = useWalletModal();
  const [mics, setMics] = useState<MicT[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newMic, setNewMic] = useState<MicT | null>(null);
  const [pa, setPa] = useState("");
  const [pb, setPb] = useState("");
  const enabled = s.mics?.enabled;
  const price = s.mics?.rules.factoryPriceShout ?? MICS.factoryPriceShout;

  const load = useCallback(() => req<MicT[]>("/me/mics").then(setMics).catch(() => setMics([])), []);
  useEffect(() => {
    if (s.signedIn && enabled) void load();
  }, [s.signedIn, enabled, load]);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };
  const run = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(key);
    try {
      await fn();
      await Promise.all([load(), s.refresh()]);
      if (okText) flash(true, okText);
    } catch (e) {
      flash(false, walletErr(e));
    } finally {
      setBusy(null);
    }
  };

  const onAction = (a: "equip" | "levelup" | "repair" | "points", m: MicT, data?: unknown) =>
    run(
      `${a}:${m.asset}`,
      () => req(`/mics/${m.asset}/${a === "levelup" ? "levelup" : a}`, a === "points" ? data : {}),
      { equip: `Mic #${m.serial} takıldı`, levelup: `Mic #${m.serial} seviye ${m.level + 1}!`, repair: `Mic #${m.serial} tamir edildi`, points: "Puanlar kaydedildi" }[a],
    );

  const buy = (onchain: boolean) =>
    run(onchain ? "buy:chain" : "buy:bal", async () => {
      let signature: string | undefined;
      if (onchain) {
        if (!s.economy?.token.mint || !s.economy.token.treasury) throw new Error("Token yapılandırılmamış");
        signature = await sendShout(connection, walletCtx, s.economy.token.mint, s.economy.token.treasury, price);
      }
      const m = await req<MicT>("/mics/buy", { signature, name: s.me?.nickname ?? undefined });
      setNewMic(m);
    });

  const eligible = useMemo(() => (mics ?? []).filter((m) => m.level >= MICS.mintMinLevel && m.mintCount < MICS.maxMintCount), [mics]);
  const ma = mics?.find((m) => m.asset === pa);
  const mb = mics?.find((m) => m.asset === pb);
  const mc = ma && mb ? mintCost(ma.mintCount, mb.mintCount) : null;

  if (!s.signedIn)
    return (
      <div className="page narrow">
        <div className="panel connect-card">
          <img src="/mics/collection.png" width={160} height={160} alt="" className="round-img" />
          <h1>Konuşarak kazan</h1>
          <p className="muted">
            Bir mikrofon NFT'si al, odalarda konuş. Sunucu sesini dinler; gerçekten konuştuğun ve en az {MICS.minListeners} kişinin dinlediği her dakika
            $SPEAK kazandırır. Mikrofonunu geliştir, tamir et, yenilerini bas.
          </p>
          {!s.wallet ? (
            <button className="btn btn-primary" onClick={() => modal.setVisible(true)}>
              Cüzdan bağla
            </button>
          ) : (
            <button className="btn btn-primary" onClick={s.signIn} disabled={s.busy}>
              İmzala ve giriş yap
            </button>
          )}
        </div>
      </div>
    );

  if (s.mics && !enabled)
    return (
      <div className="page narrow">
        <div className="panel empty-state">
          <Mic size={28} className="muted" />
          <h2>Mikrofonlar henüz açık değil</h2>
          <p className="muted">Sunucuda SPEAK_MINT ve MIC_COLLECTION tanımlı değil.</p>
        </div>
      </div>
    );

  const e = s.me?.energy;
  return (
    <div className="page">
      <section className="intro">
        <div>
          <h1>Mikrofonlarım</h1>
          <p className="muted">Konuştukça $SPEAK kazan. 1 enerji = {MICS.minutesPerEnergy} dakika doğrulanmış konuşma.</p>
        </div>
        <div className="intro-stats">
          <div className="kpi">
            <span className="kpi-v mono">
              <Zap size={18} className="gold" /> {e ? `${Number(e.energy.toFixed(1))}/${e.max}` : "—"}
            </span>
            <span className="kpi-l">enerji {e?.nextRegenAt ? `· ${until(e.nextRegenAt)} sonra +%25` : e?.max ? "· dolu" : ""}</span>
          </div>
          <div className="kpi">
            <span className="kpi-v mono">
              <SpeakCoin size={20} /> {fmtToken(s.me?.speak)}
            </span>
            <span className="kpi-l">bugün +{fmtToken(s.me?.talkToday?.speak)} kazanıldı</span>
          </div>
          <div className="kpi">
            <span className="kpi-v mono">
              <Hourglass size={18} className="muted" /> {Math.floor((s.me?.talkToday?.seconds ?? 0) / 60)}/{Math.floor((s.me?.talkToday?.cap ?? 0) / 60)}
            </span>
            <span className="kpi-l">dk günlük konuşma limiti</span>
          </div>
        </div>
      </section>

      {msg && <div className={`notice ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}

      {newMic && (
        <div className="panel reveal" style={{ ["--q" as string]: QUALITIES[newMic.quality].color }}>
          <img src={micImg(newMic)} alt="" />
          <div>
            <div className="muted small">Kutudan çıktı!</div>
            <h2>
              Mic #{newMic.serial} · {MIC_TYPES[newMic.type].label}
            </h2>
            <p className="muted small">
              {QUALITIES[newMic.quality].label} · NFT cüzdanına basıldı. {MIC_TYPES[newMic.type].blurb}
            </p>
          </div>
          <button className="icon-btn" onClick={() => setNewMic(null)} aria-label="Kapat">
            <Check size={18} />
          </button>
        </div>
      )}

      <div className="mics-layout">
        <div className="mic-grid">
          {mics === null ? (
            <div className="panel empty">
              <Loader2 size={16} className="spin" /> Yükleniyor…
            </div>
          ) : mics.length === 0 ? (
            <div className="panel empty-state">
              <Mic size={28} className="muted" />
              <h2>Henüz mikrofonun yok</h2>
              <p className="muted">Konuşarak kazanmak için bir mikrofon gerekli. Fabrikadan bir kutu aç.</p>
            </div>
          ) : (
            // key includes server state so a saved upgrade resets the card's local point draft
            mics.map((m) => <MicCard key={`${m.asset}:${m.level}:${m.points}:${m.efficiency}:${m.luck}:${m.resilience}:${m.charisma}`} mic={m} busy={busy} onAction={onAction} />)
          )}
        </div>

        <aside className="stack">
          <MissionsPanel signedIn={s.signedIn} />
          <section className="panel factory">
            <img src="/mics/collection.png" alt="" />
            <h3>
              <Package size={15} /> Mikrofon kutusu
            </h3>
            <p className="muted small">Rastgele tipte Sıradan bir mikrofon. NFT olarak cüzdanına basılır; pazar yerlerinde satılabilir.</p>
            <div className="si-price">
              <ShoutCoin size={18} />
              <span className="mono">{price.toLocaleString("tr-TR")}</span>
              <span className="muted small">SHOUT</span>
            </div>
            <div className="si-actions">
              <button className="btn btn-primary btn-sm" disabled={!!busy || (s.me?.balance ?? 0) < price} onClick={() => buy(false)}>
                {busy === "buy:bal" ? <Loader2 size={14} className="spin" /> : <Coins size={14} />} Bakiyeden al
              </button>
              <button className="btn btn-sm" disabled={!!busy || (s.me?.onchain ?? 0) < price} onClick={() => buy(true)}>
                {busy === "buy:chain" ? <Loader2 size={14} className="spin" /> : <Wallet size={14} />} Cüzdandan öde
              </button>
            </div>
          </section>

          <section className="panel">
            <h3 className="ph">
              <Sparkles size={15} /> Yeni mikrofon bas
            </h3>
            <p className="muted small">
              Seviye {MICS.mintMinLevel}+ iki mikrofonundan yeni bir NFT bas. Kalite ebeveynlere göre belirlenir, şanslıysan bir üst seviye çıkar.
            </p>
            {eligible.length < 2 ? (
              <p className="empty">En az iki mikrofonun seviye {MICS.mintMinLevel} olmalı.</p>
            ) : (
              <div className="mint-form">
                <select value={pa} onChange={(ev) => setPa(ev.target.value)}>
                  <option value="">1. ebeveyn</option>
                  {eligible.filter((m) => m.asset !== pb).map((m) => (
                    <option key={m.asset} value={m.asset}>
                      Mic #{m.serial} · Lv {m.level} · {QUALITIES[m.quality].label}
                    </option>
                  ))}
                </select>
                <select value={pb} onChange={(ev) => setPb(ev.target.value)}>
                  <option value="">2. ebeveyn</option>
                  {eligible.filter((m) => m.asset !== pa).map((m) => (
                    <option key={m.asset} value={m.asset}>
                      Mic #{m.serial} · Lv {m.level} · {QUALITIES[m.quality].label}
                    </option>
                  ))}
                </select>
                {mc && (
                  <div className="cost-line small">
                    Maliyet: <SpeakCoin size={13} /> {mc.speak} + <ShoutCoin size={13} /> {mc.shout}
                  </div>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!ma || !mb || !!busy}
                  onClick={() =>
                    run("mint", async () => {
                      setNewMic(await req<MicT>("/mics/mint", { a: pa, b: pb }));
                      setPa("");
                      setPb("");
                    })
                  }
                >
                  {busy === "mint" && <Loader2 size={14} className="spin" />} Bas
                </button>
              </div>
            )}
          </section>

          <section className="panel rules">
            <h3 className="ph">
              <Info size={15} /> Kurallar
            </h3>
            <ul>
              <li>
                <Users size={14} /> Konuşman en az <b>{MICS.minListeners} dinleyici</b> varken sayılır.
              </li>
              <li>
                <Mic size={14} /> Sunucu sesini dinler: sessizlik, sabit ton ve gürültü sayılmaz.
              </li>
              <li>
                <Zap size={14} /> Enerji mikrofon sayına göre; {MICS.regenIntervalHours} saatte bir %{MICS.regenFraction * 100} dolar.
              </li>
              <li>
                <CalendarClock size={14} /> Sıradan, Nadir, Ender: sadece görev saatlerinde. Destansı, Efsanevi: her zaman.
              </li>
              <li>
                <Hourglass size={14} /> Günlük limit en iyi mikrofonuna göre:{" "}
                {Object.entries(DAILY_TALK_MINUTES)
                  .map(([q, m]) => `${QUALITIES[q as keyof typeof QUALITIES].label} ${m}`)
                  .join(", ")}{" "}
                dk.
              </li>
              <li>
                <Clock size={14} /> Dayanıklılık %{MICS.durabilityPenaltyBelow}'nin altına düşünce kazanç azalır — tamir et.
              </li>
            </ul>
            <Link href="/" className="btn btn-sm full">
              Bir odaya gir ve konuş
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
