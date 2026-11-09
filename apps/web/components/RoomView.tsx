"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { TrendingUp, TrendingDown, Hand, Mic2, Radio, Activity, LineChart, ListOrdered, WifiOff, Siren, Zap, Trophy, Megaphone, HandCoins, Send } from "lucide-react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { instrumentById, REACTIONS, SFX, SFX_PREMIUM, type DataMsg, type RoomInfo, type Side } from "@syb/shared";
import { API, api, fmtPrice, getHostKey, req } from "@/lib/api";
import { useSession } from "@/lib/session";
import { sendShout, walletErr } from "@/lib/chain";
import { preloadSfx } from "@/lib/sfx";
import { ChaosOverlay, MegaphoneBar, useChaos, type FeedItem } from "./chaos";
import { TVChart } from "./TVChart";
import { Leaderboard } from "./Leaderboard";
import { DataBridge, MicButton, Stage, type TipFn } from "./Voice";
import { ShoutCoin } from "./wallet/WalletButton";
import { TalkHud, type TalkState } from "./TalkHud";
import { playSfx } from "@/lib/sfx";
import { InstrumentBadge } from "./InstrumentBadge";
import { Change } from "./Change";
import { useMarket } from "./shell/market";

export interface Conn {
  token: string;
  url: string;
  host: boolean;
}

const SHOUT_COOLDOWN = 20_000;
const SFX_COOLDOWN = 3_000;

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const FEED_ICON: Record<FeedItem["kind"], React.ReactNode> = {
  long: <TrendingUp size={14} className="up" />,
  short: <TrendingDown size={14} className="down" />,
  win: <Trophy size={14} className="up" />,
  loss: <Zap size={14} className="down" />,
  alarm: <Siren size={14} className="gold" />,
  sfx: <Megaphone size={14} className="muted" />,
  hand: <Hand size={14} className="muted" />,
  tip: <HandCoins size={14} className="gold" />,
  mega: <Megaphone size={14} className="gold" />,
};

function Feed({ items }: { items: FeedItem[] }) {
  if (!items.length) return <p className="empty">Henüz sessiz. Biri bir şey bağırsın.</p>;
  return (
    <ul className="feed">
      {items.map((f) => (
        <li key={f.id} className={`feed-${f.kind}`}>
          <span className="feed-icon">{FEED_ICON[f.kind]}</span>
          <span className="feed-text">
            {f.who && <b>{f.who} </b>}
            {f.text}
          </span>
          <time className="mono muted">{new Date(f.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </li>
      ))}
    </ul>
  );
}

export function RoomView({ room, me, conn }: { room: RoomInfo; me: { identity: string; name: string }; conn: Conn | null }) {
  const inst = instrumentById(room.instrumentId)!;
  const { prices, rooms } = useMarket();
  const tick = prices[inst.id];
  const listeners = rooms.find((r) => r.name === room.name)?.participants;
  const chaos = useChaos();
  const sendRef = useRef<(m: DataMsg) => void>(() => {});
  const [hands, setHands] = useState<Record<string, string>>({});
  const [handUp, setHandUp] = useState(false);
  const [until, setUntil] = useState<{ shout: number; sfx: number }>({ shout: 0, sfx: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"chart" | "feed">("chart");
  const now = useNow(until.shout > Date.now() || until.sfx > Date.now());
  const hostKey = getHostKey(room.name);
  const session = useSession();
  const { connection } = useConnection();
  const walletCtx = useWallet();
  const [megaText, setMegaText] = useState("");
  const [talk, setTalk] = useState<TalkState>({ last: null, total: 0, at: 0 });
  const megaLeft = session.me?.inventory.megaphone ?? 0;
  const premium = session.owns("pack-degen");

  useEffect(() => preloadSfx([...SFX.map((s) => s.id), ...SFX_PREMIUM.map((s) => s.id), "long", "short", "siren", "cash", "rekt"]), []);

  const onMsg = useCallback(
    (m: DataMsg) => {
      if (m.t === "TALK") {
        setTalk((t) => ({ last: m, total: t.total + m.speak + (m.box ?? 0) + (m.mission?.bonus ?? 0), at: Date.now() }));
        if (m.mission?.bonus) {
          playSfx("applause");
          setNotice(`🎯 Görev tamamlandı: ${m.mission.title} · +${m.mission.bonus} $SPEAK`);
          setTimeout(() => setNotice(null), 5000);
        }
        if (m.box) {
          playSfx("cash");
          setNotice(`📦 Sürpriz kutu! +${m.box} $SPEAK`);
          setTimeout(() => setNotice(null), 4000);
        }
        void session.refresh();
        return;
      }
      if (m.t === "RAISE_HAND")
        setHands((h) => {
          const n = { ...h };
          if (m.up) n[m.identity] = m.from;
          else delete n[m.identity];
          return n;
        });
      chaos.handle(m);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chaos.handle, session.refresh],
  );

  // Without LiveKit: server events arrive over SSE so the room is still playable.
  useEffect(() => {
    if (conn) return;
    const es = new EventSource(`${API}/rooms/${room.name}/events`);
    es.onmessage = (e) => onMsg(JSON.parse(e.data));
    return () => es.close();
  }, [conn, room.name, onMsg]);

  const emit = (m: DataMsg) => {
    onMsg(m);
    sendRef.current(m);
  };
  const flash = (t: string) => {
    setNotice(t);
    setTimeout(() => setNotice(null), 2500);
  };

  const shout = async (side: Side) => {
    if (until.shout > Date.now()) return;
    setUntil((u) => ({ ...u, shout: Date.now() + SHOUT_COOLDOWN }));
    try {
      await api.shout({ room: room.name, identity: me.identity, name: me.name, side });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const sfx = (id: string) => {
    if (until.sfx > Date.now()) return;
    setUntil((u) => ({ ...u, sfx: Date.now() + SFX_COOLDOWN }));
    emit({ t: "SFX", id, from: me.name });
  };

  const tip: TipFn | undefined =
    session.signedIn && session.economy?.token.mint
      ? async (toWallet, toName, amount) => {
          if (toWallet === session.wallet) return flash("Kendine bahşiş atamazsın 🙂");
          try {
            const sig = await sendShout(connection, walletCtx, session.economy!.token.mint!, toWallet, amount);
            emit({ t: "TIP", from: me.name, to: toName, amount, sig });
            void session.refresh();
          } catch (e) {
            flash(walletErr(e));
          }
        }
      : undefined;

  const sendMega = async () => {
    const text = megaText.trim();
    if (!text) return;
    try {
      await req("/megaphone", { room: room.name, text, name: me.name });
      setMegaText("");
      void session.refresh();
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const hostAction = async (action: "speaker" | "mute" | "kick", target: string) => {
    if (!hostKey) return;
    try {
      if (action === "kick") await api.kick(room.name, { identity: me.identity, hostKey, target });
      else await api.speaker(room.name, { identity: me.identity, hostKey, target, canPublish: action === "speaker" });
      if (action === "speaker")
        setHands((h) => {
          const n = { ...h };
          delete n[target];
          return n;
        });
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const shoutLeft = Math.max(0, until.shout - now);
  const sfxLeft = Math.max(0, until.sfx - now);
  const horizonMin = 15;

  const body = (
    <div className={`room ${chaos.alarm ? `shake` : ""} ${room.theme ? `theme-${room.theme}` : ""}`}>
      <ChaosOverlay chaos={chaos} />

      <div className="room-bar">
        <div className="rb-inst">
          <InstrumentBadge inst={inst} size={36} />
          <div>
            <div className="rb-sym">
              {inst.id}
              <span className="muted"> / {inst.kind === "crypto" ? "USDT" : inst.name}</span>
            </div>
            <div className="rb-title ellipsis">{room.title}</div>
          </div>
        </div>
        <div className="rb-price">
          <span className={`mono big-price ${(tick?.change24h ?? 0) >= 0 ? "up" : "down"}`}>{fmtPrice(tick?.price)}</span>
          <Change v={tick?.change24h} pill />
          {tick?.delayed && <span className="tag">Gecikmeli</span>}
        </div>
        <div className="rb-stats">
          <div className="stat">
            <span className="stat-l">Mod</span>
            <span className="stat-v">
              {room.mode === "stage" ? <Mic2 size={13} /> : <Radio size={13} />} {room.mode === "stage" ? "Sahne" : "Açık mikrofon"}
            </span>
          </div>
          <div className="stat">
            <span className="stat-l">Dinleyici</span>
            <span className="stat-v mono">{listeners ?? "—"}</span>
          </div>
          <div className="stat chaos">
            <span className="stat-l">
              <Activity size={12} /> Kaos
            </span>
            <span className="meter">
              <span style={{ width: `${Math.max(4, chaos.chaosLevel)}%` }} />
            </span>
          </div>
        </div>
      </div>

      <MegaphoneBar mega={chaos.mega} />

      <div className="room-grid">
        <div className="room-center">
          {conn ? (
            <>
              <div className="o-stage"><Stage host={conn.host} onHost={hostAction} onTip={tip} /></div>
              {conn.host && Object.keys(hands).length > 0 && (
                <section className="panel">
                  <header className="panel-head">
                    <h3>
                      <Hand size={15} /> El kaldıranlar
                    </h3>
                  </header>
                  {Object.entries(hands).map(([id, name]) => (
                    <div key={id} className="hand-row">
                      <span>{name}</span>
                      <button className="btn btn-sm" onClick={() => hostAction("speaker", id)}>
                        Sahneye al
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : (
            <section className="panel stage offline o-stage">
              <header className="panel-head">
                <h3>
                  <WifiOff size={15} /> Sesli sohbet kapalı
                </h3>
                <span className="conn">Demo modu</span>
              </header>
              <p className="muted small">
                Sunucuda LiveKit anahtarları tanımlı değil. Bağırışlar, efektler, alarmlar ve skorlar çalışıyor; ses için{" "}
                <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code>, <code>LIVEKIT_API_SECRET</code> ekle.
              </p>
              <div className="seats">
                <div className="seat">
                  <div className="seat-avatar">{me.name.slice(0, 2).toUpperCase()}</div>
                  <div className="seat-name">
                    <span className="ellipsis">{me.name}</span>
                  </div>
                  <div className="seat-you">sen</div>
                </div>
              </div>
            </section>
          )}

          <section className="panel chart-panel o-chart">
            <header className="panel-head tabs">
              <button className={`tab ${tab === "chart" ? "on" : ""}`} onClick={() => setTab("chart")}>
                <LineChart size={14} /> Grafik
              </button>
              <button className={`tab ${tab === "feed" ? "on" : ""}`} onClick={() => setTab("feed")}>
                <ListOrdered size={14} /> Olay akışı {chaos.feed.length > 0 && <span className="count">{chaos.feed.length}</span>}
              </button>
            </header>
            {tab === "chart" ? <TVChart symbol={inst.tvSymbol} /> : <Feed items={chaos.feed} />}
          </section>
        </div>

        <aside className="room-side">
          <section className="panel ticket o-ticket">
            {conn && <TalkHud talk={talk} room={room.name} />}
            {conn && <MicButton />}
            {conn && room.mode === "stage" && !conn.host && (
              <button
                className={`btn full ${handUp ? "btn-active" : ""}`}
                onClick={() => {
                  setHandUp(!handUp);
                  emit({ t: "RAISE_HAND", from: me.name, identity: me.identity, up: !handUp });
                }}
              >
                <Hand size={16} /> {handUp ? "Eli indir" : "El kaldır"}
              </button>
            )}
            <div className="ticket-head">
              <span>Tahmin bağır</span>
              <span className="muted small">Puanlama {horizonMin} dk sonra</span>
            </div>
            <div className="ticket-row">
              <span className="muted small">Giriş fiyatı</span>
              <span className="mono">{fmtPrice(tick?.price)}</span>
            </div>
            <div className="shout-btns">
              <button className="shout long" disabled={shoutLeft > 0} onClick={() => shout("LONG")}>
                <TrendingUp size={18} /> LONG
              </button>
              <button className="shout short" disabled={shoutLeft > 0} onClick={() => shout("SHORT")}>
                <TrendingDown size={18} /> SHORT
              </button>
            </div>
            <div className={`cooldown ${shoutLeft > 0 ? "on" : ""}`}>
              <span style={{ width: `${(shoutLeft / SHOUT_COOLDOWN) * 100}%` }} />
            </div>
            {shoutLeft > 0 && <div className="muted small center-t">Sakin ol şampiyon · {Math.ceil(shoutLeft / 1000)} sn</div>}
            {session.economy?.enabled &&
              (session.signedIn ? (
                <div className="earn-line">
                  <ShoutCoin size={14} /> Doğru tahmin puan başına {session.economy.rules.rewardPerPoint} $SHOUT kazandırır
                </div>
              ) : (
                <Link href="/wallet" className="earn-line cta">
                  <ShoutCoin size={14} /> Cüzdan bağla, doğru tahminlerden $SHOUT kazan →
                </Link>
              ))}
            {megaLeft > 0 && (
              <form
                className="mega-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMega();
                }}
              >
                <Megaphone size={15} className="gold" />
                <input value={megaText} onChange={(e) => setMegaText(e.target.value)} maxLength={80} placeholder={`Megafonla bağır (${megaLeft} hak)`} />
                <button className="icon-btn sm" aria-label="Gönder">
                  <Send size={14} />
                </button>
              </form>
            )}
            {notice && <div className="notice">{notice}</div>}
          </section>

          <section className="panel o-sfx">
            <header className="panel-head">
              <h3>
                <Megaphone size={15} /> Soundboard
              </h3>
              {sfxLeft > 0 && <span className="muted small mono">{(sfxLeft / 1000).toFixed(1)}s</span>}
            </header>
            <div className="sfx-grid">
              {[...SFX, ...(premium ? SFX_PREMIUM : [])].map((s) => (
                <button key={s.id} className="sfx-btn" disabled={sfxLeft > 0} onClick={() => sfx(s.id)}>
                  <span className="sfx-emoji">{s.emoji}</span>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            <div className="react-row">
              {REACTIONS.map((e) => (
                <button key={e} className="react-btn" onClick={() => emit({ t: "REACT", emoji: e, from: me.name })} aria-label={`Tepki ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </section>

          <div className="o-board"><Leaderboard room={room.name} /></div>
        </aside>
      </div>
    </div>
  );

  if (!conn) return body;
  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio={false} video={false}>
      <DataBridge onMsg={onMsg} sendRef={sendRef} />
      {body}
    </LiveKitRoom>
  );
}
