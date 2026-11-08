export interface SfxDef {
  id: string;
  label: string;
  emoji: string;
}

/** Soundboard. Sounds are synthesized client-side (see web/lib/sfx.ts). */
export const SFX: SfxDef[] = [
  { id: "horn", label: "Korna", emoji: "📯" },
  { id: "rekt", label: "REKT", emoji: "💀" },
  { id: "moon", label: "Aya!", emoji: "🚀" },
  { id: "cash", label: "Kasa", emoji: "💰" },
  { id: "cry", label: "Ağla", emoji: "😭" },
  { id: "applause", label: "Alkış", emoji: "👏" },
  { id: "siren", label: "Siren", emoji: "🚨" },
  { id: "boing", label: "Boing", emoji: "🤡" },
];

export const REACTIONS = ["🚀", "💀", "🐻", "🐂", "🤡", "🔥", "😂", "🩸"] as const;
