"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, Volume2, VolumeX, Shuffle, Check, Pencil } from "lucide-react";
import { INSTRUMENTS } from "@syb/shared";
import { fmtPrice, getNick, randomNick, setNick } from "@/lib/api";
import { isSfxMuted, onSfxMuted, setSfxMuted } from "@/lib/sfx";
import { useMarket } from "./market";
import { Change } from "../Change";
import { WalletButton } from "../wallet/WalletButton";

function Ticker() {
  const { prices } = useMarket();
  const items = INSTRUMENTS.map((i) => (
    <span key={i.id} className="tick-item">
      <b>{i.id}</b>
      <span className="mono">{fmtPrice(prices[i.id]?.price)}</span>
      <Change v={prices[i.id]?.change24h} />
    </span>
  ));
  return (
    <div className="ticker-strip" aria-label="Canlı fiyatlar">
      <div className="ticker-track">
        {items}
        <span aria-hidden className="ticker-dup">{items}</span>
      </div>
    </div>
  );
}

function NickChip() {
  const [nick, setN] = useState("");
  const [edit, setEdit] = useState(false);
  useEffect(() => {
    let n = getNick();
    if (!n) {
      n = randomNick();
      setNick(n);
    }
    setN(n);
  }, []);
  const save = (v: string) => {
    const n = v.trim().slice(0, 24);
    if (!n) return;
    setNick(n);
    setN(n);
    setEdit(false);
  };
  if (edit)
    return (
      <form className="nick-edit" onSubmit={(e) => (e.preventDefault(), save(nick))}>
        <input value={nick} onChange={(e) => setN(e.target.value)} maxLength={24} autoFocus aria-label="Lakap" />
        <button type="button" className="icon-btn" title="Rastgele" onClick={() => setN(randomNick())}>
          <Shuffle size={16} />
        </button>
        <button className="icon-btn" title="Kaydet">
          <Check size={16} />
        </button>
      </form>
    );
  return (
    <button className="nick-chip" onClick={() => setEdit(true)} title="Lakabını değiştir">
      <span className="avatar-xs">{nick.slice(0, 2).toUpperCase()}</span>
      <span className="nick-name">{nick || "…"}</span>
      <Pencil size={13} className="muted" />
    </button>
  );
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(isSfxMuted());
    return onSfxMuted(setMuted) as () => void;
  }, []);
  return (
    <header className="topbar">
      <button className="icon-btn only-mobile" onClick={onMenu} aria-label="Menü">
        <Menu size={20} />
      </button>
      <Link href="/" className="logo">
        <span className="logo-mark">SY</span>
        <span className="logo-word">
          Shout<em>Your</em>Bet
        </span>
      </Link>
      <Ticker />
      <div className="topbar-right">
        <WalletButton />
        <button className="icon-btn" onClick={() => setSfxMuted(!muted)} title={muted ? "Efektleri aç" : "Efektleri kapat"}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <NickChip />
      </div>
    </header>
  );
}
