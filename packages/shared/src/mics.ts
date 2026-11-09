/**
 * Talk-to-earn: Mic NFTs + $SPEAK (StepN-style, mapped from walking to talking).
 * All game numbers live here so API and UI agree. Tune freely.
 */

/** In-game token: unlimited supply, minted as people talk (only when withdrawn on-chain). */
export const SPEAK = {
  symbol: "SPEAK",
  name: "ShoutYourBet Speak",
  decimals: 2,
} as const;

export type MicType = "condenser" | "dynamic" | "ribbon" | "megaphone";
export type Quality = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type StatKey = "efficiency" | "luck" | "resilience" | "charisma";

export const STATS: { key: StatKey; label: string; hint: string }[] = [
  { key: "efficiency", label: "Verim", hint: "Konuştuğun dakika başına $SPEAK" },
  { key: "luck", label: "Şans", hint: "Sürpriz kutu çıkma ihtimali" },
  { key: "resilience", label: "Dayanıklılık", hint: "Konuşurken daha yavaş aşınır" },
  { key: "charisma", label: "Karizma", hint: "Kalabalık odada ekstra kazanç" },
];

export const MIC_TYPES: Record<MicType, { label: string; favours: StatKey; blurb: string }> = {
  condenser: { label: "Kondansatör", favours: "efficiency", blurb: "Stüdyo sesi. Dakika başı en çok kazandıran." },
  dynamic: { label: "Dinamik", favours: "resilience", blurb: "Sahne mikrofonu. Saatlerce bağırsan da yıpranmaz." },
  ribbon: { label: "Şerit", favours: "luck", blurb: "Vintage. Sürpriz kutu mıknatısı." },
  megaphone: { label: "Megafon", favours: "charisma", blurb: "Kalabalığı coşturur. Dolu odada parlar." },
};

export const QUALITIES: Record<Quality, { label: string; color: string; base: [number, number]; pointsPerLevel: number; energyBonus: number; repairMult: number }> = {
  common: { label: "Sıradan", color: "#9aa4b2", base: [1, 10], pointsPerLevel: 4, energyBonus: 0, repairMult: 1 },
  uncommon: { label: "Nadir", color: "#22c55e", base: [8, 18], pointsPerLevel: 6, energyBonus: 1, repairMult: 1.5 },
  rare: { label: "Ender", color: "#3b82f6", base: [15, 35], pointsPerLevel: 8, energyBonus: 2, repairMult: 2.2 },
  epic: { label: "Destansı", color: "#a855f7", base: [28, 63], pointsPerLevel: 10, energyBonus: 3, repairMult: 3.2 },
  legendary: { label: "Efsanevi", color: "#f0b90b", base: [50, 112], pointsPerLevel: 12, energyBonus: 4, repairMult: 4.5 },
};
export const QUALITY_ORDER: Quality[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** Qualities that earn at any time; the rest only earn during missions (see missions.ts). */
export const ANYTIME_QUALITIES: Quality[] = ["epic", "legendary"];
export const canTalkAnytime = (q: Quality) => ANYTIME_QUALITIES.includes(q);

/** Hard daily cap of verified talk, by the best mic you own (independent of energy). */
export const DAILY_TALK_MINUTES: Record<Quality, number> = { common: 15, uncommon: 25, rare: 40, epic: 60, legendary: 90 };
/** Daily cap in seconds for a set of owned mics (0 if none). */
export function dailyTalkCap(qualities: Quality[]) {
  if (!qualities.length) return 0;
  const best = qualities.reduce((a, b) => (QUALITY_ORDER.indexOf(b) > QUALITY_ORDER.indexOf(a) ? b : a));
  return DAILY_TALK_MINUTES[best] * 60;
}

export const MICS = {
  /** factory box: always a common mic of random type */
  factoryPriceShout: 1000,
  maxLevel: 30,
  /** minutes of verified talk per 1 energy */
  minutesPerEnergy: 5,
  /** fraction of max energy regenerated every regenIntervalHours */
  regenFraction: 0.25,
  regenIntervalHours: 6,
  /** listeners (other people in the room) required for talk to count */
  minListeners: 2,
  /** each mic can be used as a parent this many times */
  maxMintCount: 7,
  /** parents need at least this level to mint */
  mintMinLevel: 5,
  /** durability lost per verified minute at resilience 0; resilience reduces it */
  durabilityPerMinute: 1.2,
  /** below this durability earnings drop linearly */
  durabilityPenaltyBelow: 50,
} as const;

/** Max energy from mic count (StepN table) + per-mic quality bonus. */
export function maxEnergy(mics: { quality: Quality }[]) {
  const n = mics.length;
  const base = n >= 30 ? 20 : n >= 15 ? 12 : n >= 9 ? 9 : n >= 3 ? 4 : n >= 1 ? 2 : 0;
  return base + mics.reduce((s, m) => s + QUALITIES[m.quality].energyBonus, 0);
}

/** $SPEAK cost to go from `level` to level+1. */
export const levelUpSpeak = (level: number) => Math.round(10 + level * 8 + level * level * 0.6);
/** Milestone levels also need $SHOUT (ties the two tokens together). */
export const levelUpShout = (level: number) => ((level + 1) % 5 === 0 ? 50 * ((level + 1) / 5) : 0);

/** $SPEAK to repair `points` durability. */
export const repairCost = (points: number, level: number, quality: Quality) =>
  Math.ceil(points * 0.3 * QUALITIES[quality].repairMult * (1 + level * 0.05) * 100) / 100;

/** Minting a new mic from two parents: cost grows with each parent's mint count. */
export const mintCost = (mintCountA: number, mintCountB: number) => {
  const idx = Math.max(mintCountA, mintCountB);
  return { speak: [200, 300, 400, 600, 900, 1300, 2000][idx] ?? 2000, shout: [100, 100, 150, 200, 300, 400, 500][idx] ?? 500 };
};

export interface MicStats {
  efficiency: number;
  luck: number;
  resilience: number;
  charisma: number;
}

/** $SPEAK per verified minute. */
export function speakPerMinute(m: MicStats & { durability: number }, listeners: number) {
  const base = 1.0 * Math.pow(Math.max(1, m.efficiency), 0.6);
  const crowd = 1 + Math.min(0.5, 0.05 * Math.max(0, listeners - MICS.minListeners)) * (1 + m.charisma / 50);
  const wear = m.durability >= MICS.durabilityPenaltyBelow ? 1 : Math.max(0.1, m.durability / MICS.durabilityPenaltyBelow);
  return base * crowd * wear;
}

/** Durability lost per verified minute. */
export const wearPerMinute = (resilience: number) => MICS.durabilityPerMinute * Math.max(0.15, 1 - resilience / 120);

/** Chance per verified minute to drop a surprise box. */
export const boxChancePerMinute = (luck: number) => Math.min(0.25, 0.004 * luck);

/** Random stats for a fresh mic (favoured stat rolls in the top half of the range). */
export function rollStats(type: MicType, quality: Quality, rnd: () => number = Math.random): MicStats {
  const [lo, hi] = QUALITIES[quality].base;
  const roll = (fav: boolean) => {
    const a = fav ? lo + (hi - lo) / 2 : lo;
    return Math.round((a + rnd() * (hi - a)) * 10) / 10;
  };
  const fav = MIC_TYPES[type].favours;
  return {
    efficiency: roll(fav === "efficiency"),
    luck: roll(fav === "luck"),
    resilience: roll(fav === "resilience"),
    charisma: roll(fav === "charisma"),
  };
}

/** Child quality: usually the lower parent's quality, sometimes one tier up. */
export function childQuality(a: Quality, b: Quality, rnd: () => number = Math.random): Quality {
  const lo = Math.min(QUALITY_ORDER.indexOf(a), QUALITY_ORDER.indexOf(b));
  const hi = Math.max(QUALITY_ORDER.indexOf(a), QUALITY_ORDER.indexOf(b));
  const r = rnd();
  const idx = r < 0.1 ? Math.min(hi + 1, 4) : r < 0.35 ? hi : lo;
  return QUALITY_ORDER[idx];
}

export const randomType = (rnd: () => number = Math.random): MicType =>
  (["condenser", "dynamic", "ribbon", "megaphone"] as MicType[])[Math.floor(rnd() * 4)];

export interface Mic extends MicStats {
  asset: string;
  serial: number;
  owner: string;
  type: MicType;
  quality: Quality;
  level: number;
  points: number;
  durability: number;
  mintCount: number;
  equipped?: boolean;
}

export interface EnergyState {
  energy: number;
  max: number;
  /** epoch ms of the next regen tick */
  nextRegenAt: number | null;
}
