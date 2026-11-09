"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import bs58 from "bs58";
import { signInMessage, type ECONOMY, type EnergyState, type MICS, type MIC_TYPES, type MicType, type QUALITIES, type Quality, type ShopItem, type TOKEN } from "@syb/shared";
import { getNick, req } from "./api";
import "@solana/wallet-adapter-react-ui/styles.css";

export interface EconomyInfo {
  enabled: boolean;
  token: (typeof TOKEN) & {
    mint?: string;
    treasury?: string;
    treasuryAta?: string;
    cluster?: string;
    rpc?: string;
    explorer?: string;
    speak?: { mint: string; symbol: string; decimals: number; explorer: string } | null;
    micCollection?: string | null;
  };
  rules: typeof ECONOMY;
  shop: ShopItem[];
}
export interface MicsRules {
  enabled: boolean;
  rules: typeof MICS;
  types: typeof MIC_TYPES;
  qualities: typeof QUALITIES;
}
export interface Me {
  wallet: string;
  nickname: string | null;
  balance: number;
  speak: number;
  onchainSpeak: number | null;
  energy: EnergyState;
  /** verified talk today; cap = daily limit in seconds (by best owned mic) */
  talkToday: { seconds: number; speak: number; cap: number };
  equipped: { asset: string; serial: number; type: MicType; quality: Quality } | null;
  earnedToday: number;
  dailyEarnCap: number;
  inventory: Record<string, number>;
  onchain: number | null;
}

interface SessionCtx {
  economy: EconomyInfo | null;
  mics: MicsRules | null;
  wallet: string | null; // connected wallet
  signedIn: boolean; // connected wallet has a valid API session
  me: Me | null;
  busy: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  owns: (itemId: string) => boolean;
}
const Ctx = createContext<SessionCtx | null>(null);

const KEY = "syb.session";
const readStored = (): { wallet: string; token: string } | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const store = (v: { wallet: string; token: string } | null) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {}
};

function SessionInner({ economy, mics, children }: { economy: EconomyInfo | null; mics: MicsRules | null; children: React.ReactNode }) {
  const { publicKey, signMessage, disconnect } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [stored, setStored] = useState<{ wallet: string; token: string } | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = Boolean(wallet && stored && stored.wallet === wallet);

  useEffect(() => setStored(readStored()), []);

  const refresh = useCallback(async () => {
    if (!signedIn) return setMe(null);
    try {
      setMe(await req<Me>("/me"));
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        store(null);
        setStored(null);
      }
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
    if (!signedIn) return;
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [signedIn, refresh]);

  const signIn = useCallback(async () => {
    if (!wallet || !signMessage) return setError("Bu cüzdan mesaj imzalamayı desteklemiyor");
    setBusy(true);
    setError(null);
    try {
      const { nonce } = await req<{ nonce: string }>("/auth/nonce");
      const sig = await signMessage(new TextEncoder().encode(signInMessage(wallet, nonce)));
      const r = await req<{ session: string }>("/auth/wallet", { wallet, nonce, signature: bs58.encode(sig), nickname: getNick() });
      const v = { wallet, token: r.session };
      store(v);
      setStored(v);
      // load the full profile (balances, energy, …) with the new session
      setMe(await req<Me>("/me").catch(() => null));
    } catch (e) {
      setError((e as Error).message.includes("reject") ? "İmza iptal edildi" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [wallet, signMessage]);

  const signOut = useCallback(() => {
    store(null);
    setStored(null);
    setMe(null);
    void disconnect();
  }, [disconnect]);

  const value = useMemo<SessionCtx>(
    () => ({
      economy,
      mics,
      wallet,
      signedIn,
      me,
      busy,
      error,
      signIn,
      signOut,
      refresh,
      owns: (id) => (me?.inventory[id] ?? 0) > 0,
    }),
    [economy, mics, wallet, signedIn, me, busy, error, signIn, signOut, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [economy, setEconomy] = useState<EconomyInfo | null>(null);
  const [mics, setMics] = useState<MicsRules | null>(null);
  useEffect(() => {
    req<EconomyInfo>("/economy").then(setEconomy).catch(() => {});
    req<MicsRules>("/mics/rules").then(setMics).catch(() => {});
  }, []);
  const endpoint = economy?.token.rpc ?? process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";
  return (
    <ConnectionProvider endpoint={endpoint}>
      {/* Phantom, Solflare, Backpack… register themselves via the Wallet Standard */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <SessionInner economy={economy} mics={mics}>
            {children}
          </SessionInner>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}

export const fmtToken = (n?: number | null) =>
  n == null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: n < 100 ? 2 : 0 });
