/**
 * Creates the $SHOUT token on Solana (Token-2022 + on-chain metadata), mints the full
 * supply into the allocation wallets and revokes the mint authority (fixed supply).
 *
 *   pnpm --filter @syb/api token:create            # devnet (default)
 *   SOLANA_RPC_URL=... SOLANA_CLUSTER=mainnet-beta TOKEN_METADATA_URI=... pnpm --filter @syb/api token:create
 *
 * Keypairs are written to <repo>/.secrets/<cluster>/ (gitignored). Public addresses go to
 * <repo>/scripts/token/<cluster>.json. Re-running is refused if that file already exists.
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
import { TOKEN, toBase } from "@syb/shared";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const cluster = (process.env.SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta" | "localnet";
const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const uri = process.env.TOKEN_METADATA_URI ?? "https://shoutyourbet.app/token/shout.json";
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

async function main() {
  if (existsSync(outFile)) throw new Error(`${outFile} exists — token already created on ${cluster}.`);
  mkdirSync(secretsDir, { recursive: true });
  mkdirSync(`${ROOT}scripts/token`, { recursive: true });

  // treasury = rewards pool + fee payer; the API holds this key
  const treasury = keypair("treasury");
  const wallets = { rewards: treasury, treasury: keypair("ecosystem"), liquidity: keypair("liquidity"), team: keypair("team") };
  const mint = keypair("mint");
  console.log(`cluster ${cluster}\nmint    ${mint.publicKey.toBase58()}`);
  await fund(treasury, 1);

  // 1) mint account with metadata pointer + metadata
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: TOKEN.name,
    symbol: TOKEN.symbol,
    uri,
    additionalMetadata: [["app", "ShoutYourBet"]],
  };
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await conn.getMinimumBalanceForRentExemption(mintLen + metadataLen);
  const tx1 = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: treasury.publicKey, newAccountPubkey: mint.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, treasury.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, TOKEN.decimals, treasury.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mint.publicKey,
      metadata: mint.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: treasury.publicKey,
      updateAuthority: treasury.publicKey,
    }),
  );
  const sigCreate = await sendAndConfirmTransaction(conn, tx1, [treasury, mint]);
  console.log(`  mint created            ${sigCreate}`);

  // 2) mint the allocation into each wallet's token account
  const distribution: Record<string, { owner: string; ata: string; amount: number }> = {};
  const tx2 = new Transaction();
  for (const [bucket, kp] of Object.entries(wallets)) {
    const share = TOKEN.allocation[bucket as keyof typeof TOKEN.allocation];
    const amount = Math.round(TOKEN.supply * share);
    const ata = getAssociatedTokenAddressSync(mint.publicKey, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    tx2.add(
      createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, ata, kp.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint.publicKey, ata, treasury.publicKey, toBase(amount), [], TOKEN_2022_PROGRAM_ID),
    );
    distribution[bucket] = { owner: kp.publicKey.toBase58(), ata: ata.toBase58(), amount };
  }
  const sigMint = await sendAndConfirmTransaction(conn, tx2, [treasury]);
  console.log(`  supply minted           ${sigMint}`);

  // 3) fixed supply: revoke mint authority (metadata update authority is kept so the URI can change)
  const tx3 = new Transaction().add(createSetAuthorityInstruction(mint.publicKey, treasury.publicKey, AuthorityType.MintTokens, null, [], TOKEN_2022_PROGRAM_ID));
  const sigRevoke = await sendAndConfirmTransaction(conn, tx3, [treasury]);
  console.log(`  mint authority revoked  ${sigRevoke}`);

  const info = await getMint(conn, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const meta = await getTokenMetadata(conn, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const out = {
    cluster,
    mint: mint.publicKey.toBase58(),
    decimals: info.decimals,
    supply: Number(info.supply) / 10 ** info.decimals,
    mintAuthority: info.mintAuthority?.toBase58() ?? null,
    metadata: { name: meta?.name, symbol: meta?.symbol, uri: meta?.uri, updateAuthority: meta?.updateAuthority?.toBase58() },
    distribution,
    transactions: { create: sigCreate, mint: sigMint, revoke: sigRevoke },
    createdAt: new Date().toISOString(),
  };
  writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
  console.log("\n" + JSON.stringify(out, null, 2));
  console.log(`\nAPI env:\n  SHOUT_MINT=${out.mint}\n  SOLANA_TREASURY_SECRET=${bs58.encode(treasury.secretKey)}\n(treasury secret also in ${secretsDir}/treasury.json — never commit it)`);
}

main().catch((e) => {
  console.error("\n✖", e.message ?? e);
  process.exit(1);
});
