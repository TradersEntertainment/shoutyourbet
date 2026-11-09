"use client";
import Link from "next/link";
import { Headphones, Flame, ArrowRight, Mic2, Radio, Users } from "lucide-react";
import { INSTRUMENTS, instrumentById, officialRoomName } from "@syb/shared";
import { fmtPrice } from "@/lib/api";
import { useMarket } from "@/components/shell/market";
import { InstrumentBadge } from "@/components/InstrumentBadge";
import { Sparkline } from "@/components/Sparkline";
import { Change } from "@/components/Change";
import { Leaderboard } from "@/components/Leaderboard";

export default function Lobby() {
  const { prices, sparks, rooms } = useMarket();
  const count = (name: string) => rooms.find((r) => r.name === name)?.participants ?? 0;
  const totalLive = rooms.reduce((a, r) => a + r.participants, 0);
  const movers = [...INSTRUMENTS].sort((a, b) => Math.abs(prices[b.id]?.change24h ?? 0) - Math.abs(prices[a.id]?.change24h ?? 0)).slice(0, 3);
  const community = rooms.filter((r) => !r.official).sort((a, b) => b.participants - a.participants);

  return (
    <div className="page">
      <section className="intro">
        <div>
          <h1>Piyasayı sesli konuş.</h1>
          <p className="muted">
            Her coin ve endeksin kendi canlı ses odası var. Gir, mikrofonu aç, LONG ya da SHORT bağır. 15 dakika sonra kimin haklı
            çıktığını herkes görür. Gerçek para yok.
          </p>
        </div>
        <div className="intro-stats">
          <div className="kpi">
            <span className="kpi-v mono">{totalLive}</span>
            <span className="kpi-l">
              <Headphones size={12} /> şu an odalarda
            </span>
          </div>
          <div className="kpi">
            <span className="kpi-v mono">{rooms.length || INSTRUMENTS.length}</span>
            <span className="kpi-l">
              <Users size={12} /> açık oda
            </span>
          </div>
        </div>
      </section>

      <section className="movers">
        {movers.map((i) => {
          const t = prices[i.id];
          return (
            <Link key={i.id} href={`/room/${officialRoomName(i.id)}`} className="mover">
              <div className="mover-top">
                <InstrumentBadge inst={i} size={28} />
                <div>
                  <b>{i.id}</b>
                  <div className="muted small">{i.name}</div>
                </div>
                <span className="tag hot">
                  <Flame size={11} /> Hareketli
                </span>
              </div>
              <div className="mover-mid">
                <span className="mono mover-price">{fmtPrice(t?.price)}</span>
                <Change v={t?.change24h} pill />
              </div>
              <Sparkline data={sparks[i.id]} width={260} height={44} />
            </Link>
          );
        })}
      </section>

      <div className="lobby-grid">
        <section className="panel">
          <header className="panel-head">
            <h3>Piyasa odaları</h3>
            <span className="muted small">Fiyatlar canlı</span>
          </header>
          <table className="tbl markets">
            <thead>
              <tr>
                <th>Piyasa</th>
                <th className="r">Fiyat</th>
                <th className="r">24s</th>
                <th className="r hide-sm">Son 5 dk</th>
                <th className="r">Oda</th>
                <th aria-label="Gir" />
              </tr>
            </thead>
            <tbody>
              {INSTRUMENTS.map((i) => {
                const t = prices[i.id];
                const name = officialRoomName(i.id);
                return (
                  <tr key={i.id} className="click-row">
                    <td>
                      <Link href={`/room/${name}`} className="mkt">
                        <InstrumentBadge inst={i} size={26} />
                        <span>
                          <b>{i.id}</b>
                          <small className="muted">{i.name}</small>
                        </span>
                      </Link>
                    </td>
                    <td className="r mono">{fmtPrice(t?.price)}</td>
                    <td className="r">
                      <Change v={t?.change24h} />
                    </td>
                    <td className="r hide-sm">
                      <Sparkline data={sparks[i.id]} width={88} height={24} />
                    </td>
                    <td className="r mono muted">
                      <Headphones size={12} /> {count(name)}
                    </td>
                    <td className="r">
                      <Link href={`/room/${name}`} className="btn btn-sm">
                        Gir <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="stack">
          <Leaderboard />
          <section className="panel">
            <header className="panel-head">
              <h3>Topluluk odaları</h3>
            </header>
            {community.length === 0 ? (
              <p className="empty">Henüz yok. Sol menüden “Oda aç” ile ilkini sen aç.</p>
            ) : (
              <ul className="clist">
                {community.slice(0, 8).map((r) => {
                  const inst = instrumentById(r.instrumentId)!;
                  return (
                    <li key={r.name}>
                      <Link href={`/room/${r.name}`}>
                        <InstrumentBadge inst={inst} size={22} />
                        <span className="ellipsis">{r.title}</span>
                        <span className="muted small">
                          {r.mode === "stage" ? <Mic2 size={11} /> : <Radio size={11} />}
                        </span>
                        <span className="mono muted small">
                          <Headphones size={11} /> {r.participants}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
      <footer className="foot muted small">Yatırım tavsiyesi değildir. Puanlar sanaldır, para veya ödül yoktur.</footer>
    </div>
  );
}
