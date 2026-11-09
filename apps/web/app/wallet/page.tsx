"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowDownToLine, ExternalLink, Copy, Check, LogOut, Trophy, ShoppingBag, Gift, Undo2, Wrench, Loader2, TrendingUp, Coins } from "lucide-react";
import { req } from "@/lib/api";
import { fmtToken, useSession } from "@/lib/session";
import { explorer, short } from "@/lib/chain";
import { ShoutCoin } from "@/components/wallet/WalletButton";

interface History {
  ledger: { amount: number; reason: string; ref: string; created_at: string }[];
  claims: { id: number; amount: number; status: string; tx_sig: string | null; created_at: string; explorer: string | null }[];
}

const REASON: Record<string, { label: string; icon: React.ReactNode }> = {
  reward: { label: "Tahmin ödülü", icon: <TrendingUp size={14} className="up" /> },
  season: { label: "Sezon bonusu", icon: <Trophy size={14} className="gold" /> },
  claim: { label: "Cüzdana çekildi", icon: <ArrowDownToLine size={14} className="muted" /> },
  claim_refund: { label: "Çekim iadesi", icon: <Undo2 size={14} className="muted" /> },
  purchase: { label: "Mağaza", icon: <ShoppingBag size={14} className="muted" /> },
  admin: { label: "Hediye", icon: <Gift size={14} className="gold" /> },
};

function CopyAddr({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="addr"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      title="Kopyala"
    >
      <span className="mono">{short(value)}</span> {done ? <Check size={13} className="up" /> : <Copy size={13} />}
    </button>
  );
}

export default function WalletPage() {
  const { economy, wallet, signedIn, me, busy, error, signIn, signOut, refresh } = useSession();
  const modal = useWalletModal();
  const [hist, setHist] = useState<History | null>(null);
  const [amount, setAmount] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);
  const rules = economy?.rules;
  const tok = economy?.token;

  const loadHist = () => req<History>("/me/history").then(setHist).catch(() => {});
  useEffect(() => {
    if (signedIn) void loadHist();
  }, [signedIn]);

  const claim = async () => {
    setClaiming(true);
    setMsg(null);
    try {
      const n = Number(amount.replace(",", "."));
      const r = await req<{ amount: number; signature: string; explorer: string }>("/claims", n > 0 ? { amount: n } : {});
      setMsg({ ok: true, text: `${fmtToken(r.amount)} $SHOUT cüzdanına gönderildi`, link: explorer("tx", r.signature, tok?.cluster, tok?.rpc) });
      setAmount("");
      await Promise.all([refresh(), loadHist()]);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setClaiming(false);
    }
  };

  if (economy && !economy.enabled)
    return (
      <div className="page narrow">
        <div className="panel empty-state">
          <Coins size={28} className="muted" />
          <h2>$SHOUT ekonomisi kapalı</h2>
          <p className="muted">Sunucuda DATABASE_URL ve SESSION_SECRET tanımlı değil.</p>
        </div>
      </div>
    );

  if (!signedIn)
    return (
      <div className="page narrow">
        <div className="panel connect-card">
          <img src="/token/shout.png" width={72} height={72} alt="" />
          <h1>Doğru tahmin et, $SHOUT kazan</h1>
          <p className="muted">
            Cüzdanını bağla, odalarda LONG/SHORT bağır. Tahminin tutarsa ödül kazanırsın; kaybedersen hiçbir şey kaybetmezsin. Kazandıklarını
            cüzdanına çek, mağazada harca ya da iyi trader'lara bahşiş at.
          </p>
          <ul className="howto">
            <li>
              <b>1</b> Cüzdan bağla (Phantom, Solflare, Backpack)
            </li>
            <li>
              <b>2</b> Mesajı imzala — işlem değil, ücret yok
            </li>
            <li>
              <b>3</b> Bağır, kazan, çek
            </li>
          </ul>
          {!wallet ? (
            <button className="btn btn-primary" onClick={() => modal.setVisible(true)}>
              Cüzdan bağla
            </button>
          ) : (
            <button className="btn btn-primary" onClick={signIn} disabled={busy}>
              {busy && <Loader2 size={15} className="spin" />} İmzala ve giriş yap
            </button>
          )}
          {error && <p className="down small">{error}</p>}
          {rules && (
            <p className="muted small">
              Puan başına {rules.rewardPerPoint} $SHOUT · günlük kazanç tavanı {rules.dailyEarnCap} · en az {rules.minClaim} çekilir
            </p>
          )}
        </div>
      </div>
    );

  const earnedPct = me ? Math.min(100, (me.earnedToday / me.dailyEarnCap) * 100) : 0;
  return (
    <div className="page">
      <div className="wallet-head">
        <h1>Cüzdan</h1>
        <div className="row">
          {wallet && <CopyAddr value={wallet} />}
          <button className="btn btn-sm" onClick={signOut}>
            <LogOut size={14} /> Çıkış
          </button>
        </div>
      </div>

      <div className="wallet-grid">
        <section className="panel balance-card">
          <div className="bc-label">Kazanılan bakiye</div>
          <div className="bc-amount">
            <ShoutCoin size={34} />
            <span className="mono">{fmtToken(me?.balance)}</span>
            <span className="muted">SHOUT</span>
          </div>
          <div className="bc-sub">
            <span className="muted">Cüzdanda (zincir üstü)</span>
            <span className="mono">{fmtToken(me?.onchain)} SHOUT</span>
          </div>
          <div className="bc-progress">
            <div className="row-between small">
              <span className="muted">Bugün kazanılan</span>
              <span className="mono">
                {fmtToken(me?.earnedToday)} / {me?.dailyEarnCap}
              </span>
            </div>
            <span className="meter wide">
              <span style={{ width: `${earnedPct}%` }} />
            </span>
          </div>
        </section>

        <section className="panel claim-card">
          <h3>
            <ArrowDownToLine size={15} /> Cüzdanına çek
          </h3>
          <p className="muted small">
            Bakiyeni Solana cüzdanına gönderiyoruz; işlem ücretini biz öderiz. En az {rules?.minClaim}, günde en fazla {rules?.dailyClaimCap} $SHOUT.
          </p>
          <div className="claim-row">
            <input
              inputMode="decimal"
              placeholder={`Tümü (${fmtToken(me?.balance)})`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Miktar"
            />
            <button className="btn btn-primary" disabled={claiming || (me?.balance ?? 0) < (rules?.minClaim ?? 0)} onClick={claim}>
              {claiming ? <Loader2 size={15} className="spin" /> : null} Çek
            </button>
          </div>
          {msg && (
            <div className={`notice ${msg.ok ? "ok" : "err"}`}>
              {msg.text}{" "}
              {msg.link && (
                <a href={msg.link} target="_blank" rel="noreferrer">
                  İşlemi gör <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
          <div className="earn-hint">
            <Link href="/" className="btn btn-sm">
              <TrendingUp size={14} /> Kazanmaya devam et
            </Link>
            <Link href="/shop" className="btn btn-sm">
              <ShoppingBag size={14} /> Mağaza
            </Link>
          </div>
        </section>
      </div>

      <div className="wallet-grid">
        <section className="panel">
          <header className="panel-head">
            <h3>Hareketler</h3>
          </header>
          {!hist?.ledger.length ? (
            <p className="empty">Henüz hareket yok. İlk doğru tahmininde burada görünecek.</p>
          ) : (
            <table className="tbl">
              <tbody>
                {hist.ledger.map((r, i) => (
                  <tr key={i}>
                    <td className="ledger-type">
                      {REASON[r.reason]?.icon ?? <Wrench size={14} />} {REASON[r.reason]?.label ?? r.reason}
                    </td>
                    <td className="muted small">{new Date(r.created_at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className={`r mono ${r.amount >= 0 ? "up" : "muted-strong"}`}>
                      {r.amount > 0 ? "+" : ""}
                      {fmtToken(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <header className="panel-head">
              <h3>Çekimler</h3>
            </header>
            {!hist?.claims.length ? (
              <p className="empty">Henüz çekim yok.</p>
            ) : (
              <table className="tbl">
                <tbody>
                  {hist.claims.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{fmtToken(c.amount)}</td>
                      <td>
                        <span className={`tag ${c.status === "sent" ? "ok" : c.status === "failed" ? "bad" : ""}`}>
                          {c.status === "sent" ? "Gönderildi" : c.status === "failed" ? "İade edildi" : "Bekliyor"}
                        </span>
                      </td>
                      <td className="r">
                        {c.tx_sig && (
                          <a className="link-ext" href={explorer("tx", c.tx_sig, tok?.cluster, tok?.rpc)} target="_blank" rel="noreferrer">
                            {short(c.tx_sig)} <ExternalLink size={12} />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {tok?.mint && (
            <section className="panel token-card">
              <header className="panel-head">
                <h3>
                  <ShoutCoin size={16} /> $SHOUT token
                </h3>
                <span className="tag">{tok.cluster}</span>
              </header>
              <dl>
                <dt>Mint</dt>
                <dd>
                  <CopyAddr value={tok.mint} />
                </dd>
                <dt>Toplam arz</dt>
                <dd className="mono">{tok.supply.toLocaleString("tr-TR")}</dd>
                <dt>Standart</dt>
                <dd>Token-2022 · {tok.decimals} ondalık</dd>
                <dt>Basım yetkisi</dt>
                <dd>Kapalı — yeni token basılamaz</dd>
              </dl>
              <a className="link-ext" href={explorer("address", tok.mint, tok.cluster, tok.rpc)} target="_blank" rel="noreferrer">
                Explorer'da gör <ExternalLink size={12} />
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
