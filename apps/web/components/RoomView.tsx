"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LiveKitRoom } from "@livekit/components-react";
import { instrumentById, REACTIONS, SFX, type DataMsg, type RoomInfo, type Side } from "@syb/shared";
import { API, api, fmtPct, fmtPrice, getHostKey, usePrices } from "@/lib/api";
import { isSfxMuted, setSfxMuted } from "@/lib/sfx";
import { ChaosOverlay, useChaos } from "./chaos";
import { TVChart } from "./TVChart";
import { Leaderboard } from "./Leaderboard";
import { DataBridge, MicButton, Participants } from "./Voice";

export interface Conn {
  token: string;
  url: string;
  host: boolean;
}

export function RoomView({ room, me, conn }: { room: RoomInfo; me: { identity: string; name: string }; conn: Conn | null }) {
  const inst = instrumentById(room.instrumentId)!;
  const prices = usePrices();
  const tick = prices[inst.id];
  const chaos = useChaos();
  const sendRef = useRef<(m: DataMsg) => void>(() => {});
  const [hands, setHands] = useState<Record<string, string>>({});
  const [handUp, setHandUp] = useState(false);
  const [cool, setCool] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(isSfxMuted());
  const hostKey = getHostKey(room.name);

  const onMsg = useCallback(
    (m: DataMsg) => {
      if (m.t === "RAISE_HAND") setHands((h) => {
        const n = { ...h };
        if (m.up) n[m.identity] = m.from;
        else delete n[m.identity];
        return n;
      });
      chaos.handle(m);
    },
    [chaos.handle],
  );

  // Without LiveKit: server events arrive over SSE so the room is still playable.
  useEffect(() => {
    if (conn) return;
    const es = new EventSource(`${API}/rooms/${room.name}/events`);
    es.onmessage = (e) => onMsg(JSON.parse(e.data));
    return () => es.close();
  }, [conn, room.name, onMsg]);

  /** Local echo + publish to others. */
  const emit = (m: DataMsg) => {
    onMsg(m);
    sendRef.current(m);
  };

  const cooldown = (key: string, ms: number) => {
    const now = Date.now();
    if ((cool[key] ?? 0) > now) return false;
    setCool((c) => ({ ...c, [key]: now + ms }));
    return true;
  };

  const shout = async (side: Side) => {
    if (!cooldown("shout", 20_000)) return flash("Sakin ol şampiyon, 20 sn bekle 😅");
    try {
      await api.shout({ room: room.name, identity: me.identity, name: me.name, side });
    } catch (e) {
      flash(String((e as Error).message));
    }
  };
  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(null), 2500);
  };

  const hostAction = async (action: "speaker" | "mute" | "kick", target: string) => {
    if (!hostKey) return;
    try {
      if (action === "kick") await api.kick(room.name, { identity: me.identity, hostKey, target });
      else await api.speaker(room.name, { identity: me.identity, hostKey, target, canPublish: action === "speaker" });
      if (action === "speaker") setHands((h) => {
        const n = { ...h };
        delete n[target];
        return n;
      });
    } catch (e) {
      flash(String((e as Error).message));
    }
  };

  const body = (
    <div className={`room ${chaos.alarm ? `shake ${chaos.alarm.dir}` : ""}`}>
      <ChaosOverlay chaos={chaos} />
      <header className="room-head">
        <Link href="/" className="link">
          ← Lobi
        </Link>
        <div className="ticker">
          <span className="sym">
            {inst.emoji} {inst.id}
          </span>
          <span className="price">{fmtPrice(tick?.price)}</span>
          <span className={(tick?.change24h ?? 0) >= 0 ? "up" : "down"}>{fmtPct(tick?.change24h)}</span>
          {tick?.delayed && <span className="pill">gecikmeli</span>}
        </div>
        <div className="chaos-meter" title="Kaos seviyesi (son 10 sn)">
          <span>Kaos</span>
          <div className="bar">
            <div style={{ width: `${chaos.chaosLevel}%` }} />
          </div>
        </div>
      </header>

      <h1 className="room-title">
        {room.title} {room.mode === "stage" && <span className="pill">🎤 Sahne modu</span>}
      </h1>

      <div className="grid">
        <div className="col">
          {conn ? (
            <>
              <Participants host={conn.host} onHost={hostAction} />
              {conn.host && Object.keys(hands).length > 0 && (
                <section className="card">
                  <h3>✋ El kaldıranlar</h3>
                  {Object.entries(hands).map(([id, name]) => (
                    <div key={id} className="row">
                      {name} <button onClick={() => hostAction("speaker", id)}>Sahneye al</button>
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : (
            <section className="card warn">
              <h3>🔇 Ses henüz bağlı değil</h3>
              <p>
                Sesli sohbet için <code>.env</code> dosyasına <code>LIVEKIT_URL</code>, <code>LIVEKIT_API_KEY</code>,{" "}
                <code>LIVEKIT_API_SECRET</code> ekle (LiveKit Cloud ücretsiz). Efektler, bağırmalar ve alarmlar yine de çalışıyor.
              </p>
            </section>
          )}
          <TVChart symbol={inst.tvSymbol} />
        </div>

        <div className="col">
          <section className="card controls">
            {conn && <MicButton />}
            {conn && room.mode === "stage" && !conn.host && (
              <button
                onClick={() => {
                  setHandUp(!handUp);
                  emit({ t: "RAISE_HAND", from: me.name, identity: me.identity, up: !handUp });
                }}
              >
                {handUp ? "✋ Eli indir" : "✋ El kaldır"}
              </button>
            )}
            <div className="shout-row">
              <button className="shout long" onClick={() => shout("LONG")}>
                🐂 LONG!
              </button>
              <button className="shout short" onClick={() => shout("SHORT")}>
                🐻 SHORT!
              </button>
            </div>
            {msg && <div className="flash">{msg}</div>}
            <h4>Soundboard</h4>
            <div className="sfx">
              {SFX.map((s) => (
                <button
                  key={s.id}
                  onClick={() => cooldown("sfx", 3000) ? emit({ t: "SFX", id: s.id, from: me.name }) : flash("Soundboard soğuyor… 3 sn")}
                >
                  <span>{s.emoji}</span>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="reacts">
              {REACTIONS.map((e) => (
                <button key={e} onClick={() => cooldown(`r`, 250) && emit({ t: "REACT", emoji: e, from: me.name })}>
                  {e}
                </button>
              ))}
            </div>
            <label className="muted small">
              <input
                type="checkbox"
                checked={muted}
                onChange={(e) => {
                  setSfxMuted(e.target.checked);
                  setMuted(e.target.checked);
                }}
              />{" "}
              Efekt seslerini kapat
            </label>
          </section>

          <section className="card feed">
            <h3>📜 Olay akışı</h3>
            {chaos.feed.length === 0 && <p className="muted">Sessizlik… biri bir şey bağırsın.</p>}
            <ul>
              {chaos.feed.map((f) => (
                <li key={f.id}>{f.text}</li>
              ))}
            </ul>
          </section>
          <Leaderboard room={room.name} />
        </div>
      </div>
    </div>
  );

  if (!conn) return body;
  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio={false} video={false} data-lk-theme="none">
      <DataBridge onMsg={onMsg} sendRef={sendRef} />
      {body}
    </LiveKitRoom>
  );
}
