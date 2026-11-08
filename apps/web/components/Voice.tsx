"use client";
import { useEffect, type MutableRefObject } from "react";
import {
  RoomAudioRenderer,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipants,
} from "@livekit/components-react";
import { RemoteParticipant, type Participant } from "livekit-client";
import { DATA_TOPIC, decodeMsg, encodeMsg, type DataMsg } from "@syb/shared";
import { useState } from "react";

/** Wires LiveKit data channel <-> our message handler. */
export function DataBridge({ onMsg, sendRef }: { onMsg: (m: DataMsg) => void; sendRef: MutableRefObject<(m: DataMsg) => void> }) {
  const { send } = useDataChannel(DATA_TOPIC, (msg) => {
    const m = decodeMsg(msg.payload);
    if (m) onMsg(m);
  });
  useEffect(() => {
    sendRef.current = (m) => void send(encodeMsg(m), { reliable: true, topic: DATA_TOPIC }).catch(() => {});
  }, [send, sendRef]);
  return <RoomAudioRenderer />;
}

export function MicButton() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const perms = useLocalParticipantPermissions();
  const canPublish = perms?.canPublish ?? false;
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!canPublish && isMicrophoneEnabled) void localParticipant.setMicrophoneEnabled(false);
  }, [canPublish, isMicrophoneEnabled, localParticipant]);
  return (
    <div className="mic">
      <button
        className={`big ${isMicrophoneEnabled ? "live" : ""}`}
        disabled={!canPublish}
        onClick={() =>
          localParticipant
            .setMicrophoneEnabled(!isMicrophoneEnabled)
            .then(() => setErr(null))
            .catch((e) => setErr(String(e?.message ?? e)))
        }
      >
        {!canPublish ? "🎙️ Dinleyicisin" : isMicrophoneEnabled ? "🔴 Mikrofon AÇIK" : "🎙️ Bağırmaya başla"}
      </button>
      {err && <small className="down">Mikrofon hatası: {err}</small>}
    </div>
  );
}

function Tile({
  p,
  host,
  onHost,
}: {
  p: Participant;
  host: boolean;
  onHost: (action: "speaker" | "mute" | "kick", target: string) => void;
}) {
  const speaking = useIsSpeaking(p);
  const [localMuted, setLocalMuted] = useState(false);
  const isRemote = p instanceof RemoteParticipant;
  let meta: { host?: boolean } = {};
  try {
    meta = JSON.parse(p.metadata || "{}");
  } catch {}
  const canSpeak = p.permissions?.canPublish;
  return (
    <div className={`tile ${speaking ? "speaking" : ""}`}>
      <div className="avatar" style={{ ["--lvl" as string]: speaking ? Math.min(1, p.audioLevel * 4) : 0 }}>
        {(p.name || "?").slice(0, 2).toUpperCase()}
      </div>
      <div className="tname">
        {meta.host && "👑 "}
        {p.name || p.identity.slice(0, 6)}
        {!isRemote && " (sen)"}
      </div>
      <div className="tactions">
        {isRemote && (
          <button
            title="Sadece benim için sustur"
            onClick={() => {
              (p as RemoteParticipant).setVolume(localMuted ? 1 : 0);
              setLocalMuted(!localMuted);
            }}
          >
            {localMuted ? "🔇" : "🔈"}
          </button>
        )}
        {host && isRemote && (
          <>
            <button title={canSpeak ? "Sahneden indir" : "Sahneye al"} onClick={() => onHost(canSpeak ? "mute" : "speaker", p.identity)}>
              {canSpeak ? "⬇️" : "⬆️"}
            </button>
            <button title="At" onClick={() => onHost("kick", p.identity)}>
              🥾
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Participants({ host, onHost }: { host: boolean; onHost: (action: "speaker" | "mute" | "kick", target: string) => void }) {
  const ps = useParticipants();
  const speakers = ps.filter((p) => p.isSpeaking).length;
  return (
    <section className="card">
      <h3>
        🎧 Odadakiler ({ps.length}) {speakers > 0 && <span className="pill">{speakers} kişi aynı anda bağırıyor</span>}
      </h3>
      <div className="tiles">
        {ps.map((p) => (
          <Tile key={p.identity} p={p} host={host} onHost={onHost} />
        ))}
      </div>
    </section>
  );
}
