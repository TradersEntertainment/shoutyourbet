export const env = {
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitSecret: process.env.LIVEKIT_API_SECRET ?? "",
  priceMode: (process.env.PRICE_MODE ?? "mock") as "live" | "mock",
  shoutHorizonSec: Number(process.env.SHOUT_HORIZON_SEC ?? 900),
  devTools: process.env.DEV_TOOLS === "1",
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** HMAC secret for wallet session tokens */
  sessionSecret: process.env.SESSION_SECRET ?? "",
  solanaRpc: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  solanaCluster: (process.env.SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta" | "localnet",
  /** base58 or JSON byte array of the treasury (rewards pool) keypair */
  treasurySecret: process.env.SOLANA_TREASURY_SECRET ?? "",
  shoutMint: process.env.SHOUT_MINT ?? "",
  speakMint: process.env.SPEAK_MINT ?? "",
  micCollection: process.env.MIC_COLLECTION ?? "",
  /** public base URL of this API (NFT metadata URIs point here) */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 4000}`).replace(/\/$/, ""),
  /** web origin, used for NFT images */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, ""),
};

export const livekitConfigured = () => Boolean(env.livekitUrl && env.livekitKey && env.livekitSecret);

export const economyEnabled = () => Boolean(env.databaseUrl && env.sessionSecret);
export const chainEnabled = () => Boolean(env.treasurySecret && env.shoutMint);
export const micsEnabled = () => Boolean(chainEnabled() && env.speakMint && env.micCollection);
