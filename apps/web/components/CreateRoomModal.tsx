"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Radio, Mic2 } from "lucide-react";
import { INSTRUMENTS, type RoomMode } from "@syb/shared";
import { api, getIdentity, getNick, setHostKey } from "@/lib/api";
import { InstrumentBadge } from "./InstrumentBadge";

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [instrumentId, setInst] = useState("BTC");
  const [mode, setMode] = useState<RoomMode>("open");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.createRoom({ title, instrumentId, mode, identity: getIdentity(), name: getNick() || "Anonim" });
      setHostKey(r.name, r.hostKey);
      onClose();
      router.push(`/room/${r.name}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Oda aç">
        <div className="modal-head">
          <h2>Yeni oda</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>
        <label className="field">
          <span>Oda adı</span>
          <input placeholder="ör. BTC 100K görmez" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <div className="field">
          <span>Piyasa</span>
          <div className="inst-pick">
            {INSTRUMENTS.map((i) => (
              <button type="button" key={i.id} className={`inst-opt ${instrumentId === i.id ? "sel" : ""}`} onClick={() => setInst(i.id)}>
                <InstrumentBadge inst={i} size={20} /> {i.id}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Mod</span>
          <div className="mode-pick">
            <button type="button" className={`mode-opt ${mode === "open" ? "sel" : ""}`} onClick={() => setMode("open")}>
              <Radio size={18} />
              <b>Açık mikrofon</b>
              <small>Herkes konuşur. Saf kaos.</small>
            </button>
            <button type="button" className={`mode-opt ${mode === "stage" ? "sel" : ""}`} onClick={() => setMode("stage")}>
              <Mic2 size={18} />
              <b>Sahne</b>
              <small>Sen sahneye alırsın, diğerleri el kaldırır.</small>
            </button>
          </div>
        </div>
        {err && <p className="down small">{err}</p>}
        <button className="btn btn-primary full" disabled={busy}>
          {busy ? "Açılıyor…" : "Odayı aç"}
        </button>
      </form>
    </div>
  );
}
