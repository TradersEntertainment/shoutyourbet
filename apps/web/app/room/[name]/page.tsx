"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { RoomInfo } from "@syb/shared";
import { api, getHostKey, getIdentity, getNick, randomNick, setNick } from "@/lib/api";
import { RoomView, type Conn } from "@/components/RoomView";

export default function RoomPage() {
  const { name } = useParams<{ name: string }>();
  const [me, setMe] = useState<{ identity: string; name: string } | null>(null);
  const [needNick, setNeedNick] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const [state, setState] = useState<{ room: RoomInfo; conn: Conn | null } | { error: string } | null>(null);

  useEffect(() => {
    const n = getNick();
    if (n) setMe({ identity: getIdentity(), name: n });
    else {
      setNickDraft(randomNick());
      setNeedNick(true);
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    setState(null);
    (async () => {
      try {
        const t = await api.token({ room: name, identity: me.identity, name: me.name, hostKey: getHostKey(name) });
        setState({ room: t.room, conn: { token: t.token, url: t.url, host: t.host } });
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "LIVEKIT_NOT_CONFIGURED") {
          const room = (await api.rooms().catch(() => [])).find((r) => r.name === name);
          setState(room ? { room, conn: null } : { error: "Oda bulunamadı" });
        } else setState({ error: err.message });
      }
    })();
  }, [me, name]);

  if (needNick && !me)
    return (
      <div className="gate">
        <form
          className="panel gate-card"
          onSubmit={(e) => {
            e.preventDefault();
            const n = nickDraft.trim().slice(0, 24);
            if (!n) return;
            setNick(n);
            setMe({ identity: getIdentity(), name: n });
          }}
        >
          <h2>Odaya katıl</h2>
          <p className="muted small">Odada görünecek lakabını seç. Kayıt gerekmez.</p>
          <label className="field">
            <span>Lakap</span>
            <input value={nickDraft} onChange={(e) => setNickDraft(e.target.value)} maxLength={24} autoFocus />
          </label>
          <button className="btn btn-primary full">Katıl</button>
        </form>
      </div>
    );
  if (!state)
    return (
      <div className="gate muted">
        <Loader2 className="spin" size={22} /> Odaya bağlanılıyor…
      </div>
    );
  if ("error" in state)
    return (
      <div className="gate">
        <div className="panel gate-card">
          <h2>Oda açılamadı</h2>
          <p className="muted">{state.error}</p>
          <Link href="/" className="btn">
            Lobiye dön
          </Link>
        </div>
      </div>
    );
  return <RoomView room={state.room} me={me!} conn={state.conn} />;
}
