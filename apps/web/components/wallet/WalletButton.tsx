"use client";
import Link from "next/link";
import { Wallet, PenLine, Loader2, Zap } from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fmtToken, useSession } from "@/lib/session";

export function ShoutCoin({ size = 16 }: { size?: number }) {
  return <img src="/token/shout.png" width={size} height={size} alt="" className="coin" />;
}

export function SpeakCoin({ size = 16 }: { size?: number }) {
  return <img src="/token/speak.png" width={size} height={size} alt="" className="coin" />;
}

export function EnergyPill() {
  const { me, mics } = useSession();
  if (!me?.energy || !mics?.enabled) return null;
  const { energy, max } = me.energy;
  return (
    <Link href="/mics" className={`energy-pill ${max === 0 ? "none" : energy <= 0 ? "empty" : ""}`} title="Enerji: 1 enerji = 5 dakika doğrulanmış konuşma">
      <Zap size={14} />
      <span className="mono">
        {max === 0 ? "—" : `${Number(energy.toFixed(1))}/${max}`}
      </span>
    </Link>
  );
}

export function WalletButton() {
  const { economy, wallet, signedIn, me, busy, signIn } = useSession();
  const modal = useWalletModal();
  if (!economy?.enabled) return null;
  if (!wallet)
    return (
      <button className="btn btn-sm wallet-btn" onClick={() => modal.setVisible(true)}>
        <Wallet size={15} /> <span className="hide-xs">Cüzdan bağla</span>
      </button>
    );
  if (!signedIn)
    return (
      <button className="btn btn-sm btn-primary wallet-btn" onClick={signIn} disabled={busy}>
        {busy ? <Loader2 size={15} className="spin" /> : <PenLine size={15} />} <span className="hide-xs">İmzala, giriş yap</span>
      </button>
    );
  return (
    <>
      <EnergyPill />
      <Link href="/wallet" className="bal-chip" title="Kazanılan bakiyeler (çekilebilir)">
        <ShoutCoin size={18} />
        <span className="mono">{fmtToken(me?.balance)}</span>
        <span className="bal-sep hide-xs" />
        <SpeakCoin size={18} />
        <span className="mono">{fmtToken(me?.speak)}</span>
      </Link>
    </>
  );
}
