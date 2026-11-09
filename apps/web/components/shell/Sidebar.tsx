"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Headphones, Plus, Mic2, Radio } from "lucide-react";
import { INSTRUMENTS, instrumentById, officialRoomName } from "@syb/shared";
import { fmtPrice } from "@/lib/api";
import { useMarket } from "./market";
import { InstrumentBadge } from "../InstrumentBadge";
import { Change } from "../Change";

export function Sidebar({ onCreate, onNavigate }: { onCreate: () => void; onNavigate: () => void }) {
  const { prices, rooms } = useMarket();
  const path = usePathname();
  const count = (name: string) => rooms.find((r) => r.name === name)?.participants ?? 0;
  const community = rooms.filter((r) => !r.official);
  return (
    <nav className="sidebar" aria-label="Odalar">
      <div className="side-section">
        <div className="side-title">Piyasa odaları</div>
        {INSTRUMENTS.map((i) => {
          const name = officialRoomName(i.id);
          const t = prices[i.id];
          const n = count(name);
          return (
            <Link key={i.id} href={`/room/${name}`} onClick={onNavigate} className={`side-row ${path === `/room/${name}` ? "active" : ""}`}>
              <InstrumentBadge inst={i} size={26} />
              <span className="side-name">
                <b>{i.id}</b>
                <small className="muted">{i.name}</small>
              </span>
              <span className="side-price">
                <span className="mono">{fmtPrice(t?.price)}</span>
                <Change v={t?.change24h} />
              </span>
              {n > 0 && (
                <span className="live-count on-badge" title={`${n} kişi dinliyor`}>
                  <Headphones size={11} />
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="side-section">
        <div className="side-title">
          Topluluk odaları
          <button className="icon-btn sm" onClick={onCreate} title="Oda aç">
            <Plus size={16} />
          </button>
        </div>
        {community.length === 0 && <p className="side-empty">Henüz topluluk odası yok.</p>}
        {community.map((r) => {
          const inst = instrumentById(r.instrumentId)!;
          return (
            <Link key={r.name} href={`/room/${r.name}`} onClick={onNavigate} className={`side-row ${path === `/room/${r.name}` ? "active" : ""}`}>
              <InstrumentBadge inst={inst} size={22} />
              <span className="side-name">
                <b className="ellipsis">{r.title}</b>
                <small className="muted">
                  {r.mode === "stage" ? <Mic2 size={11} /> : <Radio size={11} />} {r.createdBy}
                </small>
              </span>
              <span className="live-count">
                <Headphones size={11} />
                {r.participants}
              </span>
            </Link>
          );
        })}
        <button className="btn btn-ghost full" onClick={onCreate}>
          <Plus size={16} /> Oda aç
        </button>
      </div>
    </nav>
  );
}
