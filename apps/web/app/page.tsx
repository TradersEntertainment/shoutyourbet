"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { INSTRUMENTS, instrumentById, type RoomInfo, type RoomMode } from "@syb/shared";
import { api, fmtPct, fmtPrice, getIdentity, getNick, randomNick, setHostKey, setNick, usePrices } from "@/lib/api";
import { Leaderboard } from "@/components/Leaderboard";

export default function Lobby() {
  const prices = usePrices();
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [nick, setNickState] = useState("");
  const [form, setForm] = useState({ title: "", instrumentId: "BTC", mode: "open" as RoomMode });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNickState(getNick() || randomNick());
    const load = () => api.rooms().then(setRooms).catch(() => setErr("API'ye ulaşılamıyor (apps/api çalışıyor mu?)"));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  const saveNick = (n: string) => {
    setNickState(n);
    setNick(n.trim().slice(0, 24));
  };

  const official = rooms.filter((r) => r.official);
  const userRooms = rooms.filter((r) => !r.official);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nick.trim()) return setErr("Önce bir lakap seç");
    setNick(nick.trim());
    try {
      const r = await api.createRoom({ ...form, identity: getIdentity(), name: nick.trim() });
      setHostKey(r.name, r.hostKey);
      router.push(`/room/${r.name}`);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  };

  return (
    <main className="lobby">
      <header className="hero">
        <h1>
          📣 Shout<span>Your</span>Bet
        </h1>
        <p>Sesli trade kaos odaları. Gerçek para yok, gerçek bağırış var. Bağır, tahmin et, rekt ol.</p>
        <label className="nick">
          Lakabın:
          <input value={nick} onChange={(e) => saveNick(e.target.value)} maxLength={24} />
          <button type="button" onClick={() => saveNick(randomNick())} title="Rastgele">
            🎲
          </button>
        </label>
      </header>

      {err && <p className="down">{err}</p>}

      <h2>🔥 Kaos Odaları</h2>
      <div className="rooms">
        {(official.length ? official : INSTRUMENTS.map((i) => ({ name: `inst-${i.id}`, instrumentId: i.id, participants: 0 }) as RoomInfo)).map((r) => {
          const inst = instrumentById(r.instrumentId)!;
          const t = prices[inst.id];
          return (
            <Link key={r.name} href={`/room/${r.name}`} className="room-card" onClick={() => setNick(nick.trim())}>
              <div className="rc-top">
                <span className="rc-emoji">{inst.emoji}</span>
                <span className="rc-id">{inst.id}</span>
                <span className="rc-kind">{inst.kind === "crypto" ? "kripto" : "endeks"}</span>
              </div>
              <div className="rc-price">{fmtPrice(t?.price)}</div>
              <div className={(t?.change24h ?? 0) >= 0 ? "up" : "down"}>{fmtPct(t?.change24h)}</div>
              <div className="rc-people">🎧 {r.participants} kişi</div>
            </Link>
          );
        })}
      </div>

      <div className="lobby-grid">
        <section className="card">
          <h2>🏠 Kullanıcı Odaları</h2>
          {userRooms.length === 0 && <p className="muted">Henüz kimse oda açmadı. İlk sen aç!</p>}
          <ul className="ulist">
            {userRooms.map((r) => (
              <li key={r.name}>
                <Link href={`/room/${r.name}`} onClick={() => setNick(nick.trim())}>
                  {instrumentById(r.instrumentId)?.emoji} {r.title}
                </Link>
                <span className="muted small">
                  {r.mode === "stage" ? "🎤 sahne" : "📢 açık"} · {r.createdBy} · 🎧 {r.participants}
                </span>
              </li>
            ))}
          </ul>
          <form onSubmit={create} className="create">
            <h3>➕ Oda aç</h3>
            <input placeholder="Oda adı (ör. 'BTC 100K olmaz')" value={form.title} maxLength={60} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div className="row">
              <select value={form.instrumentId} onChange={(e) => setForm({ ...form, instrumentId: e.target.value })}>
                {INSTRUMENTS.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.emoji} {i.name}
                  </option>
                ))}
              </select>
              <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as RoomMode })}>
                <option value="open">📢 Açık mikrofon (kaos)</option>
                <option value="stage">🎤 Sahne (el kaldırma)</option>
              </select>
            </div>
            <button className="big">Odayı aç</button>
          </form>
        </section>
        <Leaderboard />
      </div>
      <footer className="muted small">Yatırım tavsiyesi değildir. Hiçbir şey yatırım tavsiyesi değildir. Özellikle burada bağırılanlar.</footer>
    </main>
  );
}
