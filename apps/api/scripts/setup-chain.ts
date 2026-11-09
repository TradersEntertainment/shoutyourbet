/**
 * Sets up everything ShoutYourBet needs on Solana (idempotent — re-run to finish a partial setup):
 *  1. $SHOUT  — Token-2022 + metadata, full fixed supply minted into the allocation wallets,
 *               mint authority revoked.
 *  2. $SPEAK  — Token-2022 + metadata, unlimited: the treasury keeps the mint authority and
 *               mints only when players withdraw talk earnings.
 *  3. Mics    — Metaplex Core collection for the Mic NFTs (5% royalties to the treasury).
 *
 *   pnpm --filter @syb/api chain:setup             # devnet (default)
 *   SOLANA_CLUSTER=localnet SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter @syb/api chain:setup
 *   SOLANA_CLUSTER=mainnet-beta SOLANA_RPC_URL=... METADATA_BASE_URL=https://your.domain pnpm --filter @syb/api chain:setup
 *
 * Keypairs are written to <repo>/.secrets/<cluster>/ (gitignored). Public addresses go to
 * <repo>/scripts/token/<cluster>.json.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  AuthorityType,
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getMintLen,
  getTokenMetadata,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import bs58 from "bs58";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SPEAK, TOKEN, toBase } from "@syb/shared";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { createCollection, fetchCollection, mplCore, ruleSet } from "@metaplex-foundation/mpl-core";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const cluster = (process.env.SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta" | "localnet";
const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const base = (process.env.METADATA_BASE_URL ?? "https://shoutyourbet.app").replace(/\/$/, "");
const conn = new Connection(rpc, "confirmed");
const secretsDir = `${ROOT}.secrets/${cluster}`;
const outFile = `${ROOT}scripts/token/${cluster}.json`;

function keypair(name: string) {
  const f = `${secretsDir}/${name}.json`;
  if (existsSync(f)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, "utf8"))));
  const kp = Keypair.generate();
  writeFileSync(f, JSON.stringify([...kp.secretKey]), { mode: 0o600 });
  return kp;
}

async function fund(kp: Keypair, sol: number) {
  const bal = await conn.getBalance(kp.publicKey);
  if (bal >= sol * LAMPORTS_PER_SOL * 0.5) return console.log(`  payer has ${bal / LAMPORTS_PER_SOL} SOL`);
  if (cluster === "mainnet-beta") throw new Error(`Fund ${kp.publicKey.toBase58()} with SOL first`);
  console.log(`  requesting ${sol} SOL ${cluster} airdrop for ${kp.publicKey.toBase58()} …`);
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    throw new Error(
      `Airdrop failed (${String(e).slice(0, 120)}).\nFund it manually at https://faucet.solana.com (devnet) → ${kp.publicKey.toBase58()} and re-run.`,
    );
  }
}

type Out = {
  cluster: string;
  shout?: Record<string, unknown> & { mint: string };
  speak?: Record<string, unknown> & { mint: string };
  mics?: Record<string, unknown> & { collection: string };
};

async function createMetadataMint(payer: Keypair, mint: Keypair, opts: { name: string; symbol: string; uri: string; decimals: number }) {
  const metadata: TokenMetadata = { mint: mint.publicKey, name: opts.name, symbol: opts.symbol, uri: opts.uri, additionalMetadata: [["app", "ShoutYourBet"]] };
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await conn.getMinimumBalanceForRentExemption(mintLen + metadataLen);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, opts.decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.uri,
      mintAuthority: payer.publicKey,
      updateAuthority: payer.publicKey,
    }),
  );
  return sendAndConfirmTransaction(conn, tx, [payer, mint]);
}

async function setupShout(treasury: Keypair) {
  const wallets = { rewards: treasury, treasury: keypair("ecosystem"), liquidity: keypair("liquidity"), team: keypair("team") };
  const mint = keypair("mint");
  console.log(`\n$SHOUT  ${mint.publicKey.toBase58()}`);
  const sigCreate = await createMetadataMint(treasury, mint, { name: TOKEN.name, symbol: TOKEN.symbol, uri: `${base}/token/shout.json`, decimals: TOKEN.decimals });
  console.log(`  mint created            ${sigCreate}`);
  const distribution: Record<string, { owner: string; ata: string; amount: number }> = {};
  const tx2 = new Transaction();
  for (const [bucket, kp] of Object.entries(wallets)) {
    const amount = Math.round(TOKEN.supply * TOKEN.allocation[bucket as keyof typeof TOKEN.allocation]);
    const ata = getAssociatedTokenAddressSync(mint.publicKey, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    tx2.add(
      createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, ata, kp.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint.publicKey, ata, treasury.publicKey, toBase(amount), [], TOKEN_2022_PROGRAM_ID),
    );
    distribution[bucket] = { owner: kp.publicKey.toBase58(), ata: ata.toBase58(), amount };
  }
  const sigMint = await sendAndConfirmTransaction(conn, tx2, [treasury]);
  console.log(`  supply minted           ${sigMint}`);
  const sigRevoke = await sendAndConfirmTransaction(
    conn,
    new Transaction().add(createSetAuthorityInstruction(mint.publicKey, treasury.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID)),
    [treasury],
  );
  console.log(`  mint authority revoked  ${sigRevoke}`);
  const info = await getMint(conn, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const meta = await getTokenMetadata(conn, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  return {
    mint: mint.publicKey.toBase58(),
    decimals: info.decimals,
    supply: Number(info.supply) / 10 ** info.decimals,
    mintAuthority: info.mintAuthority?.toBase58() ?? null,
    metadata: { name: meta?.name, symbol: meta?.symbol, uri: meta?.uri, updateAuthority: meta?.updateAuthority?.toBase58() },
    distribution,
    transactions: { create: sigCreate, mint: sigMint, revoke: sigRevoke },
  };
}

async function setupSpeak(treasury: Keypair) {
  const mint = keypair("speak-mint");
  console.log(`\n$SPEAK  ${mint.publicKey.toBase58()}`);
  const sig = await createMetadataMint(treasury, mint, { name: SPEAK.name, symbol: SPEAK.symbol, uri: `${base}/token/speak.json`, decimals: SPEAK.decimals });
  console.log(`  mint created (unlimited, authority = treasury)  ${sig}`);
  const info = await getMint(conn, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  return { mint: mint.publicKey.toBase58(), decimals: info.decimals, mintAuthority: info.mintAuthority?.toBase58() ?? null, transactions: { create: sig } };
}

async function setupMics(treasury: Keypair) {
  const umi = createUmi(rpc, "confirmed").use(mplCore());
  const kp = umi.eddsa.createKeypairFromSecretKey(treasury.secretKey);
  umi.use(keypairIdentity(createSignerFromKeypair(umi, kp)));
  const collection = generateSigner(umi);
  console.log(`\nMics    ${collection.publicKey}`);
  await createCollection(umi, {
    collection,
    name: "ShoutYourBet Mics",
    uri: `${base}/nft/collection.json`,
    plugins: [{ type: "Royalties", basisPoints: 500, creators: [{ address: umi.identity.publicKey, percentage: 100 }], ruleSet: ruleSet("None") }],
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  const c = await fetchCollection(umi, collection.publicKey);
  console.log(`  collection created (royalties 5% → treasury)`);
  return { collection: collection.publicKey.toString(), name: c.name, updateAuthority: c.updateAuthority.toString() };
}

async function main() {
  mkdirSync(secretsDir, { recursive: true });
  mkdirSync(`${ROOT}scripts/token`, { recursive: true });
  const out: Out = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { cluster };
  const save = () => writeFileSync(outFile, JSON.stringify({ ...out, updatedAt: new Date().toISOString() }, null, 2) + "\n");

  const treasury = keypair("treasury"); // rewards pool, fee payer, $SPEAK minter, NFT authority — the API holds this key
  console.log(`cluster  ${cluster}\ntreasury ${treasury.publicKey.toBase58()}`);
  await fund(treasury, 1);

  if (!out.shout) (out.shout = await setupShout(treasury)), save();
  else console.log(`\n$SHOUT  ${out.shout.mint} (exists)`);
  if (!out.speak) (out.speak = await setupSpeak(treasury)), save();
  else console.log(`$SPEAK  ${out.speak.mint} (exists)`);
  if (!out.mics) (out.mics = await setupMics(treasury)), save();
  else console.log(`Mics    ${out.mics.collection} (exists)`);

  console.log(`\nWrote ${outFile}`);
  console.log(
    `\nAPI env:\n  SOLANA_CLUSTER=${cluster}\n  SOLANA_RPC_URL=${rpc}\n  SHOUT_MINT=${out.shout.mint}\n  SPEAK_MINT=${out.speak.mint}\n  MIC_COLLECTION=${out.mics.collection}\n  SOLANA_TREASURY_SECRET=<.secrets/${cluster}/treasury.json — never commit it>`,
  );
}

main().catch((e) => {
  console.error("\n✖", e.message ?? e);
  process.exit(1);
});
