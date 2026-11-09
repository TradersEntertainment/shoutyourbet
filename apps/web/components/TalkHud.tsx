"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, Zap, Users, Wrench, Wallet, Radio, CalendarClock, Hourglass, Target, Check } from "lucide-react";
import { MICS, activeMissionForRoom, canTalkAnytime, instrumentById, nextMission, trTime, type DataMsg } from "@syb/shared";
import { fmtToken, useSession } from "@/lib/session";
import { SpeakCoin } from "./wallet/WalletButton";

export type TalkMsg = Extract<DataMsg, { t: "TALK" }>;
export interface TalkState {
  last: TalkMsg | null;
  /** $SPEAK earned in this room session (talk + boxes + mission bonus) */
  total: number;
  at: number;
}

const mins = (sec: number) => Math.floor(sec / 60);
const roomLabel = (room: string) => instrumentById(room.replace(/^inst-/, ""))?.name ?? room;

/** Re-render every 30 s so mission windows open/close on screen. */
function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Talk-to-earn status for the local speaker, driven by the server bot's TALK messages. */
export function TalkHud({ talk, room }: { talk: TalkState; room: string }) {
  const s = useSession();
  const now = useClock();
  if (!s.mics?.enabled) return null;
  const last = talk.last;
  const fresh = last && Date.now() - talk.at < 40_000;
  const energy = s.me?.energy;
  const eq = s.me?.equipped;
  const mission = activeMissionForRoom(room, now);
  const next = nextMission(now);
  const used = (fresh && last.dailyUsed) || s.me?.talkToday?.seconds || 0;
  const cap = (fresh && last.dailyCap) || s.me?.talkToday?.cap || 0;
  const restricted = eq ? !canTalkAnytime(eq.quality) : false;
  const nextLine = next ? `Sıradaki görev: ${trTime(next.startAt)} · ${roomLabel(next.room)} odası` : "";
  const nextLink = next && next.room !== room ? <Link href={`/room/${next.room}`}>Görev odasına git →</Link> : null;

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
  } else if (!eq || (fresh && last.status === "no-mic")) {
    icon = <Mic size={15} />;
    title = "Mikrofon takılı değil";
    sub = "Mikrofonlarım sayfasından bir mikrofon tak.";
    cta = <Link href="/mics">Tak →</Link>;
    tone = "warn";
  } else if (cap > 0 && used >= cap) {
    icon = <Hourglass size={15} />;
    title = "Günlük limit doldu";
    sub = `Bugün ${mins(cap)} dakikanın hepsini kullandın. Gece yarısı (TR) sıfırlanır.`;
    tone = "warn";
  } else if ((fresh && last.status === "outside-mission") || (restricted && !mission)) {
    icon = <CalendarClock size={15} />;
    title = "Görev saati dışında";
    sub = `Bu mikrofon sadece görev saatlerinde kazanır. ${nextLine}`;
    cta = nextLink;
    tone = "warn";
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
  } else if (fresh && last.status === "broken") {
    icon = <Wrench size={15} />;
    title = "Mikrofon bozuk";
    sub = "Dayanıklılık 0 — tamir et.";
    cta = <Link href="/mics">Tamir →</Link>;
    tone = "warn";
  }

  // mission progress: prefer the server's numbers, else what the schedule says
  const mp = fresh && last.mission ? last.mission : null;
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
      {mission && s.signedIn && (
        <div className="th-mission">
          <span className="thm-title">
            {mp?.completed ? <Check size={13} className="up" /> : <Target size={13} className="gold" />} Görev: {mission.title}
            <span className="muted"> · {trTime(mission.startAt)}–{trTime(mission.endAt)}</span>
          </span>
          <span className="meter wide">
            <span style={{ width: `${((mp?.progress ?? 0) / mission.targetSec) * 100}%` }} />
          </span>
          <span className="muted small">
            {mp?.completed ? `Tamamlandı · +${mission.bonus} $SPEAK` : `${mins(mp?.progress ?? 0)}/${mins(mission.targetSec)} dk · bitince +${mission.bonus} $SPEAK`}
          </span>
        </div>
      )}
      {cap > 0 && s.signedIn && (
        <div className="th-daily">
          <span className="muted small">Bugün</span>
          <span className="meter wide">
            <span style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
          </span>
          <span className="mono small">
            {mins(used)}/{mins(cap)} dk
          </span>
        </div>
      )}
    </div>
  );
}
