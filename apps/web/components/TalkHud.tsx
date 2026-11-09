"use client";
import Link from "next/link";
import { Mic, Zap, Users, Wrench, Wallet, Radio } from "lucide-react";
import { MICS, type DataMsg } from "@syb/shared";
import { fmtToken, useSession } from "@/lib/session";
import { SpeakCoin } from "./wallet/WalletButton";

export type TalkMsg = Extract<DataMsg, { t: "TALK" }>;
export interface TalkState {
  last: TalkMsg | null;
  /** $SPEAK earned in this room session */
  total: number;
  at: number;
}

/** Talk-to-earn status for the local speaker, driven by the server bot's TALK messages. */
export function TalkHud({ talk }: { talk: TalkState }) {
  const s = useSession();
  if (!s.mics?.enabled) return null;
  const last = talk.last;
  const fresh = last && Date.now() - talk.at < 40_000;
  const energy = s.me?.energy;

  let icon = <Radio size={15} />;
  let title = "Konuş, kazan";
  let sub = `Sunucu dinliyor: doğrulanmış her dakika $SPEAK kazandırır (en az ${MICS.minListeners} dinleyici).`;
  let tone = "idle";
  let cta: React.ReactNode = null;

  if (!s.signedIn) {
    icon = <Wallet size={15} />;
    title = "Konuşarak kazan";
    sub = "Cüzdanını bağla ve bir mikrofon NFT'si al.";
    cta = <Link href="/mics">Başla →</Link>;
  } else if (!energy?.max) {
    icon = <Mic size={15} />;
    title = "Mikrofonun yok";
    sub = "Konuşarak kazanmak için bir mikrofon gerekli.";
    cta = <Link href="/mics">Mikrofon al →</Link>;
  } else if (fresh && last.status === "earning") {
    icon = <Mic size={15} />;
    title = "Kazanıyorsun";
    sub = `Son ${last.seconds} sn doğrulandı · enerji ${Number(last.energy.toFixed(2))}/${last.maxEnergy}`;
    tone = "earning";
  } else if (fresh && last.status === "few-listeners") {
    icon = <Users size={15} />;
    title = "Dinleyici az";
    sub = `Konuşman sayılması için odada en az ${MICS.minListeners} kişi olmalı.`;
    tone = "warn";
  } else if ((fresh && last.status === "no-energy") || (energy && energy.energy <= 0)) {
    icon = <Zap size={15} />;
    title = "Enerji bitti";
    sub = energy?.nextRegenAt ? `Bir sonraki dolum ${new Date(energy.nextRegenAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}` : "Enerji yenileniyor.";
    tone = "warn";
  } else if (fresh && last.status === "no-mic") {
    icon = <Mic size={15} />;
    title = "Mikrofon takılı değil";
    sub = "Mikrofonlarım sayfasından bir mikrofon tak.";
    cta = <Link href="/mics">Tak →</Link>;
    tone = "warn";
  } else if (fresh && last.status === "broken") {
    icon = <Wrench size={15} />;
    title = "Mikrofon bozuk";
    sub = "Dayanıklılık 0 — tamir et.";
    cta = <Link href="/mics">Tamir →</Link>;
    tone = "warn";
  }

  return (
    <div className={`talk-hud ${tone}`}>
      <span className="th-icon">{icon}</span>
      <div className="th-body">
        <b>{title}</b>
        <span className="muted small">{sub}</span>
      </div>
      <div className="th-earn">
        <SpeakCoin size={16} />
        <span className="mono" key={talk.total}>
          +{fmtToken(talk.total)}
        </span>
      </div>
      {cta && <span className="th-cta">{cta}</span>}
    </div>
  );
}
