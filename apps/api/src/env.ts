export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  livekitUrl: process.env.LIVEKIT_URL ?? "",
  livekitKey: process.env.LIVEKIT_API_KEY ?? "",
  livekitSecret: process.env.LIVEKIT_API_SECRET ?? "",
  priceMode: (process.env.PRICE_MODE ?? "mock") as "live" | "mock",
  shoutHorizonSec: Number(process.env.SHOUT_HORIZON_SEC ?? 900),
  devTools: process.env.DEV_TOOLS === "1",
};

export const livekitConfigured = () => Boolean(env.livekitUrl && env.livekitKey && env.livekitSecret);
