/** $SHOUT token economy — tune everything here. */
export const TOKEN = {
  symbol: "SHOUT",
  name: "ShoutYourBet",
  decimals: 6,
  supply: 1_000_000_000,
  /** share of supply per bucket (sums to 1) */
  allocation: { rewards: 0.5, treasury: 0.2, liquidity: 0.15, team: 0.15 },
} as const;

export const ECONOMY = {
  /** $SHOUT earned per positive prediction point (losers earn 0, never negative) */
  rewardPerPoint: 1,
  /** max $SHOUT a wallet can earn from predictions per UTC day */
  dailyEarnCap: 500,
  /** minimum off-chain balance to withdraw to the wallet */
  minClaim: 100,
  /** max $SHOUT a wallet can withdraw per UTC day */
  dailyClaimCap: 2_000,
  /** weekly season bonus by rank (1-based) */
  seasonBonus: [1000, 600, 400, 250, 200, 150, 120, 100, 80, 60],
  tipPresets: [10, 50, 100],
} as const;

export type ItemKind = "soundpack" | "megaphone" | "nameColor" | "roomTheme";
export interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  description: string;
  price: number;
  /** consumable items can be bought repeatedly (count goes up) */
  consumable: boolean;
  emoji: string;
}

export const SHOP: ShopItem[] = [
  { id: "megaphone", kind: "megaphone", name: "Megafon", description: "Bağırışın odanın tepesine 30 saniye sabitlenir. Herkes görür.", price: 50, consumable: true, emoji: "📢" },
  { id: "name-gold", kind: "nameColor", name: "Altın lakap", description: "Lakabın odalarda ve skor tablosunda altın renkte görünür.", price: 100, consumable: false, emoji: "✨" },
  { id: "theme-neon", kind: "roomTheme", name: "Neon oda teması", description: "Açtığın odalar neon temayla açılır.", price: 200, consumable: false, emoji: "🌈" },
  { id: "pack-degen", kind: "soundpack", name: "Degen ses paketi", description: "Soundboard'a 4 özel efekt: zil, gong, kahkaha, davul.", price: 500, consumable: false, emoji: "🎛️" },
];
export const shopItem = (id: string) => SHOP.find((i) => i.id === id);

/** Convert UI amount -> base units (bigint) and back. */
export const toBase = (amount: number) => BigInt(Math.round(amount * 10 ** TOKEN.decimals));
export const fromBase = (base: bigint | number | string) => Number(BigInt(base)) / 10 ** TOKEN.decimals;

/** Message the wallet signs to log in (Sign-In With Solana, simplified). */
export const signInMessage = (wallet: string, nonce: string, domain = "ShoutYourBet") =>
  `${domain} hesabına giriş yap\n\nCüzdan: ${wallet}\nNonce: ${nonce}\n\nBu imza işlem yapmaz ve ücret ödemez.`;
