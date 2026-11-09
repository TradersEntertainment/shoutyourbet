"use client";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Check, Loader2, Wallet, Coins } from "lucide-react";
import type { ShopItem } from "@syb/shared";
import { req } from "@/lib/api";
import { fmtToken, useSession } from "@/lib/session";
import { sendShout, walletErr } from "@/lib/chain";
import { ShoutCoin } from "@/components/wallet/WalletButton";

export default function ShopPage() {
  const { economy, wallet, signedIn, me, busy, signIn, refresh } = useSession();
  const { connection } = useConnection();
  const w = useWallet();
  const modal = useWalletModal();
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const done = (id: string, ok: boolean, text: string) => {
    setMsg({ id, ok, text });
    setPending(null);
  };

  const buyBalance = async (item: ShopItem) => {
    setPending(`${item.id}:bal`);
    try {
      await req("/purchases", { itemId: item.id });
      await refresh();
      done(item.id, true, "Satın alındı");
    } catch (e) {
      done(item.id, false, (e as Error).message);
    }
  };

  const buyWallet = async (item: ShopItem) => {
    if (!economy?.token.mint || !economy.token.treasury) return;
    setPending(`${item.id}:chain`);
    try {
      const sig = await sendShout(connection, w, economy.token.mint, economy.token.treasury, item.price);
      await req("/purchases", { itemId: item.id, signature: sig });
      await refresh();
      done(item.id, true, "Ödeme zincirde doğrulandı");
    } catch (e) {
      done(item.id, false, walletErr(e));
    }
  };

  return (
    <div className="page">
      <section className="intro">
        <div>
          <h1>Mağaza</h1>
          <p className="muted">
            $SHOUT'unu odada fark yaratmak için harca. Kazandığın bakiyeden anında al ya da cüzdanındaki token'la öde.
          </p>
        </div>
        {signedIn && (
          <div className="kpi">
            <span className="kpi-v mono">
              <ShoutCoin size={20} /> {fmtToken(me?.balance)}
            </span>
            <span className="kpi-l">kazanılan bakiye · cüzdanda {fmtToken(me?.onchain)}</span>
          </div>
        )}
      </section>

      {!signedIn && economy?.enabled && (
        <div className="panel banner-cta">
          <span>Satın almak için cüzdanınla giriş yap.</span>
          {!wallet ? (
            <button className="btn btn-primary btn-sm" onClick={() => modal.setVisible(true)}>
              Cüzdan bağla
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={signIn} disabled={busy}>
              İmzala ve giriş yap
            </button>
          )}
        </div>
      )}

      <div className="shop-grid">
        {(economy?.shop ?? []).map((item) => {
          const qty = me?.inventory[item.id] ?? 0;
          const owned = !item.consumable && qty > 0;
          const canBal = signedIn && (me?.balance ?? 0) >= item.price && !owned;
          const canChain = signedIn && (me?.onchain ?? 0) >= item.price && !owned;
          return (
            <article key={item.id} className={`panel shop-item ${owned ? "owned" : ""}`}>
              <div className="si-top">
                <span className="si-emoji">{item.emoji}</span>
                {owned && (
                  <span className="tag ok">
                    <Check size={11} /> Sende
                  </span>
                )}
                {item.consumable && qty > 0 && <span className="tag">{qty} adet</span>}
              </div>
              <h3>{item.name}</h3>
              <p className="muted small">{item.description}</p>
              <div className="si-price">
                <ShoutCoin size={18} />
                <span className="mono">{item.price}</span>
                <span className="muted small">SHOUT{item.consumable ? " / adet" : ""}</span>
              </div>
              <div className="si-actions">
                <button className="btn btn-primary btn-sm" disabled={!canBal || !!pending} onClick={() => buyBalance(item)}>
                  {pending === `${item.id}:bal` ? <Loader2 size={14} className="spin" /> : <Coins size={14} />} Bakiyeden al
                </button>
                <button className="btn btn-sm" disabled={!canChain || !!pending} onClick={() => buyWallet(item)}>
                  {pending === `${item.id}:chain` ? <Loader2 size={14} className="spin" /> : <Wallet size={14} />} Cüzdandan öde
                </button>
              </div>
              {msg?.id === item.id && <div className={`notice ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
            </article>
          );
        })}
      </div>

      <section className="panel how-earn">
        <h3>Nasıl kazanılır?</h3>
        <div className="earn-steps">
          <div>
            <b>Doğru tahmin</b>
            <span className="muted small">Pozitif puan başına {economy?.rules.rewardPerPoint ?? 1} $SHOUT. Kaybeden hiçbir şey kaybetmez.</span>
          </div>
          <div>
            <b>Haftalık sezon</b>
            <span className="muted small">Haftanın ilk 10 kâhinine {economy?.rules.seasonBonus[0] ?? 1000} $SHOUT'a kadar bonus.</span>
          </div>
          <div>
            <b>Bahşiş</b>
            <span className="muted small">Odada iyi analiz yapanlara cüzdandan cüzdana $SHOUT atılabilir.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
