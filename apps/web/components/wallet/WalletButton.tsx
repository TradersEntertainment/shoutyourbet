"use client";
import Link from "next/link";
import { Wallet, PenLine, Loader2 } from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { fmtToken, useSession } from "@/lib/session";

export function ShoutCoin({ size = 16 }: { size?: number }) {
  return <img src="/token/shout.png" width={size} height={size} alt="" className="coin" />;
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
    <Link href="/wallet" className="bal-chip" title="Kazanılan $SHOUT (çekilebilir)">
      <ShoutCoin size={18} />
      <span className="mono">{fmtToken(me?.balance)}</span>
      <span className="muted small hide-xs">SHOUT</span>
    </Link>
  );
}
