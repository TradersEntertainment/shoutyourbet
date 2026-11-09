"use client";
import { useEffect, useState, type MutableRefObject } from "react";
import {
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipants,
} from "@livekit/components-react";
import { ConnectionState, RemoteParticipant, type Participant } from "livekit-client";
import { Mic, MicOff, Crown, ArrowUpCircle, ArrowDownCircle, UserX, Volume2, VolumeX, Users } from "lucide-react";
import { DATA_TOPIC, decodeMsg, encodeMsg, type DataMsg } from "@syb/shared";

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
    <div className="mic-wrap">
      <button
        className={`mic-btn ${isMicrophoneEnabled ? "on" : ""}`}
        disabled={!canPublish}
        onClick={() =>
          localParticipant
            .setMicrophoneEnabled(!isMicrophoneEnabled)
            .then(() => setErr(null))
            .catch((e) => setErr(String(e?.message ?? e)))
        }
      >
        {isMicrophoneEnabled ? <Mic size={20} /> : <MicOff size={20} />}
        <span>{!canPublish ? "Dinleyicisin" : isMicrophoneEnabled ? "Yayındasın" : "Mikrofonu aç"}</span>
        {isMicrophoneEnabled && <span className="live-dot" />}
      </button>
      {err && <small className="down">Mikrofon hatası: {err}</small>}
    </div>
  );
}

type HostAction = (action: "speaker" | "mute" | "kick", target: string) => void;

function Seat({ p, host, onHost }: { p: Participant; host: boolean; onHost: HostAction }) {
  const speaking = useIsSpeaking(p);
  const [localMuted, setLocalMuted] = useState(false);
  const isRemote = p instanceof RemoteParticipant;
  let meta: { host?: boolean } = {};
  try {
    meta = JSON.parse(p.metadata || "{}");
  } catch {}
  const canSpeak = p.permissions?.canPublish;
  const micOn = p.isMicrophoneEnabled;
  return (
    <div className={`seat ${speaking ? "speaking" : ""}`}>
      <div className="seat-avatar" style={{ ["--lvl" as string]: speaking ? Math.min(1, p.audioLevel * 4) : 0 }}>
        {(p.name || "?").slice(0, 2).toUpperCase()}
        <span className={`seat-mic ${micOn ? "on" : ""}`}>{micOn ? <Mic size={10} /> : <MicOff size={10} />}</span>
      </div>
      <div className="seat-name">
        {meta.host && <Crown size={11} className="gold" />}
        <span className="ellipsis">{p.name || p.identity.slice(0, 6)}</span>
      </div>
      {!isRemote && <div className="seat-you">sen</div>}
      {isRemote && (
        <div className="seat-actions">
          <button
            title={localMuted ? "Sesini aç (sadece sen)" : "Sustur (sadece sen)"}
            onClick={() => {
              (p as RemoteParticipant).setVolume(localMuted ? 1 : 0);
              setLocalMuted(!localMuted);
            }}
          >
            {localMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          {host && (
            <>
              <button title={canSpeak ? "Sahneden indir" : "Sahneye al"} onClick={() => onHost(canSpeak ? "mute" : "speaker", p.identity)}>
                {canSpeak ? <ArrowDownCircle size={13} /> : <ArrowUpCircle size={13} />}
              </button>
              <button title="Odadan at" onClick={() => onHost("kick", p.identity)}>
                <UserX size={13} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Stage({ host, onHost }: { host: boolean; onHost: HostAction }) {
  const ps = useParticipants();
  const state = useConnectionState();
  const speakers = ps.filter((p) => p.permissions?.canPublish);
  const listeners = ps.filter((p) => !p.permissions?.canPublish);
  const talking = ps.filter((p) => p.isSpeaking).length;
  return (
    <section className="panel stage">
      <header className="panel-head">
        <h3>
          <Users size={15} /> Sahne <span className="muted">· {ps.length}</span>
        </h3>
        <span className={`conn ${state === ConnectionState.Connected ? "ok" : ""}`}>
          {state === ConnectionState.Connected ? (talking ? `${talking} kişi konuşuyor` : "Bağlı") : "Bağlanıyor…"}
        </span>
      </header>
      <div className="seats">
        {speakers.map((p) => (
          <Seat key={p.identity} p={p} host={host} onHost={onHost} />
        ))}
      </div>
      {listeners.length > 0 && (
        <>
          <div className="sub-title">Dinleyiciler · {listeners.length}</div>
          <div className="seats small">
            {listeners.map((p) => (
              <Seat key={p.identity} p={p} host={host} onHost={onHost} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
