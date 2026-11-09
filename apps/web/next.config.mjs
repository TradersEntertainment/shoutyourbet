import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * pnpm can install several peer-variants of the same wallet-adapter package; if the bundle
 * picks up two, React contexts (WalletContext, WalletModalContext) split and hooks see
 * "no provider". Pin every import to the single copy this app depends on.
 */
const single = ["@solana/wallet-adapter-react", "@solana/wallet-adapter-react-ui", "@solana/wallet-adapter-base"];
const alias = Object.fromEntries(single.map((p) => [p, fs.realpathSync(path.join(here, "node_modules", p))]));

/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@syb/shared"],
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...alias };
    return config;
  },
};
