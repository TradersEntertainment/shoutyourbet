"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { RoomInfo } from "@syb/shared";
import { api, getHostKey, getIdentity, getNick, randomNick, setNick } from "@/lib/api";
import { RoomView, type Conn } from "@/components/RoomView";

export default function RoomPage() {
  const { name } = useParams<{ name: string }>();
  const [me, setMe] = useState<{ identity: string; name: string } | null>(null);
  const [nickDraft, setNickDraft] = useState("");
  const [state, setState] = useState<{ room: RoomInfo; conn: Conn | null } | { error: string } | null>(null);

  useEffect(() => {
    const n = getNick();
    if (n) setMe({ identity: getIdentity(), name: n });
    else setNickDraft(randomNick());
  }, []);

  useEffect(() => {
    if (!me) return;
    (async () => {
      try {
        const t = await api.token({ room: name, identity: me.identity, name: me.name, hostKey: getHostKey(name) });
        setState({ room: t.room, conn: { token: t.token, url: t.url, host: t.host } });
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "LIVEKIT_NOT_CONFIGURED") {
          const room = (await api.rooms()).find((r) => r.name === name);
          setState(room ? { room, conn: null } : { error: "Oda bulunamadı" });
        } else setState({ error: err.message });
      }
    })();
  }, [me, name]);

  if (!me)
    return (
      <main className="center">
        <form
          className="card join"
          onSubmit={(e) => {
            e.preventDefault();
            const n = nickDraft.trim().slice(0, 24);
            if (!n) return;
            setNick(n);
            setMe({ identity: getIdentity(), name: n });
          }}
        >
          <h2>Odaya girmeden önce bir lakap 🎭</h2>
          <input value={nickDraft} onChange={(e) => setNickDraft(e.target.value)} maxLength={24} autoFocus />
          <button className="big">Gir ve bağır</button>
        </form>
      </main>
    );
  if (!state) return <main className="center">Odaya ışınlanıyor… 🛸</main>;
  if ("error" in state)
    return (
      <main className="center">
        <p>😵 {state.error}</p>
        <Link href="/">Lobiye dön</Link>
      </main>
    );
  return <RoomView room={state.room} me={me} conn={state.conn} />;
}
